/**
 * GPSおよび端末方位(DeviceOrientation/Compass)マネージャー
 * 
 * 修正ポイント:
 *  - iOS webkitCompassHeading / Android deviceorientationabsolute の両対応を強化
 *  - absolute イベントの判定を厳密に処理
 *  - ローパスフィルタでノイズを除去し安定したコンパス方位を提供
 *  - GPS初期位置の即時取得 (getCurrentPosition) を追加
 *  - start() にorientationPermissionGrantedパラメータ追加で権限二重リクエスト防止
 *  - イベントリスナーの二重登録防止ガード追加
 */

export class SensorManager {
  constructor() {
    this.currentPosition = null; // { lat, lng, accuracy }
    this.compassHeading = 0;      // 端末の現在の方位角 (0° = 真北)
    this.isHeadingAvailable = false;
    this.isGpsAvailable = false;

    this.positionWatchId = null;
    this.onPositionChangeCallbacks = [];
    this.onHeadingChangeCallbacks = [];
    this.onErrorCallbacks = [];

    // iOSなどのセンサー許可状態
    this.permissionGranted = false;

    // イベントリスナー登録済みフラグ（二重登録防止）
    this._orientationListenerAttached = false;

    // ローパスフィルタ用の前回値
    this._lastFilteredHeading = null;
    this._lpfAlpha = 0.3; // ローパスフィルタ係数 (小さい=滑らか / 大きい=応答速い)

    // 手動制御フラグ (デバッグモードではセンサー値を上書きしない)
    this._manualPositionActive = false;
    this._manualHeadingActive = false;

    this._bindEvents();
  }

  _bindEvents() {
    this._handleOrientation = this._handleOrientation.bind(this);
  }

  /**
   * センサー取得の開始 (位置情報 + 端末方位)
   * @param {boolean} orientationPermissionGranted - 呼び出し元で既にDeviceOrientation権限を取得済みかどうか
   */
  async start(orientationPermissionGranted = false) {
    // 1. HTTPS / セキュアコンテキストチェック
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!window.isSecureContext && !isLocalhost) {
      this._triggerError('HTTPS接続が必要です。URLを https:// に変更して開き直してください。');
    }

    // 2. 位置情報トラッキングの開始
    try {
      if ('geolocation' in navigator) {
        // まず getCurrentPosition で初期位置を素早く取得
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (this._manualPositionActive) return; // デバッグ手動モードなら無視
            this.currentPosition = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            };
            this.isGpsAvailable = true;
            this.onPositionChangeCallbacks.forEach((cb) => cb(this.currentPosition));
          },
          (err) => {
            console.warn('Geolocation initial position error (non-critical):', err.message);
            this._triggerError('GPS初期取得エラー: ' + err.message);
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
        );

        // 継続的な位置トラッキング
        this.positionWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (this._manualPositionActive) return; // デバッグ手動モードなら無視
            this.currentPosition = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            };
            this.isGpsAvailable = true;
            this.onPositionChangeCallbacks.forEach((cb) => cb(this.currentPosition));
          },
          (err) => {
            console.warn('Geolocation watch error:', err);
            this._triggerError('GPS位置情報の取得に失敗しました: ' + err.message);
          },
          {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 15000
          }
        );
      } else {
        this._triggerError('このブラウザはGeolocationに対応していません。');
      }
    } catch (gpsErr) {
      console.warn('GPS起動時エラー:', gpsErr);
      this._triggerError('GPS起動エラー: ' + gpsErr.message);
    }

    // 3. 端末方位センサーの開始
    // 呼び出し元で既に権限取得済みなら、リスナー登録のみ行う
    try {
      if (orientationPermissionGranted) {
        this.permissionGranted = true;
        this._attachOrientationListener();
      } else {
        await this.requestOrientationPermission();
      }
    } catch (orientErr) {
      console.warn('方位センサー起動時エラー:', orientErr);
      this._triggerError('コンパス起動エラー: ' + orientErr.message);
    }
  }

  /**
   * iOS 13+ などで必要なDeviceOrientation権限の要求
   */
  async requestOrientationPermission() {
    // iOS 13+ (requestPermission が存在する場合)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState === 'granted') {
          this.permissionGranted = true;
          this._attachOrientationListener();
          return true;
        } else {
          this._triggerError('方位センサーの権限が拒否されました。設定から動作と方向へのアクセスを許可してください。');
          return false;
        }
      } catch (e) {
        console.warn('DeviceOrientation Permission Error:', e);
        this._triggerError('方位センサーの権限要求でエラーが発生しました: ' + e.message);
        return false;
      }
    } else {
      // Android / PC ブラウザ等（権限リクエスト不要）
      this.permissionGranted = true;
      this._attachOrientationListener();
      return true;
    }
  }

  /**
   * 方位イベントリスナーを登録（二重登録防止付き）
   */
  _attachOrientationListener() {
    if (this._orientationListenerAttached) return; // 二重登録防止

    // 優先順位: deviceorientationabsolute > deviceorientation
    // deviceorientationabsolute は地磁気基準(真北)のalphaを返す
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._handleOrientation, true);
    }
    // iOS では webkitCompassHeading が使えるので deviceorientation も常に登録
    // Android でも absolute が取れない場合のフォールバック
    window.addEventListener('deviceorientation', this._handleOrientation, true);

    this._orientationListenerAttached = true;
  }

  /**
   * 方位角イベントハンドラ
   * 端末の向き → コンパス方位角 (0° = 真北, 時計回り) に変換
   */
  _handleOrientation(event) {
    if (this._manualHeadingActive) return; // デバッグ手動モードなら無視

    let heading = null;

    // 1. iOS (webkitCompassHeading: 真北基準の度数 0〜360, 時計回り)
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      heading = event.webkitCompassHeading;
    } 
    // 2. Android deviceorientationabsolute / event.absolute === true
    //    alpha: 画面上端が真北を向くとき 0°, 東を向くとき 90° (反時計回り)
    //    → コンパス方位角 = (360 - alpha) % 360
    else if (event.alpha !== undefined && event.alpha !== null) {
      if (event.absolute === true || event.type === 'deviceorientationabsolute') {
        heading = (360 - event.alpha) % 360;
      } else {
        // 非 absolute の場合も使用する (相対値だが、何もないより良い)
        heading = (360 - event.alpha) % 360;
      }
    }

    if (heading !== null && !isNaN(heading)) {
      // ローパスフィルタでノイズを除去
      heading = this._applyLowPassFilter(heading);
      
      this.compassHeading = heading;
      this.isHeadingAvailable = true;
      this.onHeadingChangeCallbacks.forEach((cb) => cb(this.compassHeading));
    }
  }

  /**
   * 角度値に対するローパスフィルタ (360°/0° 境界を正しく処理)
   */
  _applyLowPassFilter(newHeading) {
    if (this._lastFilteredHeading === null) {
      this._lastFilteredHeading = newHeading;
      return newHeading;
    }

    // 角度差分を -180 ~ 180 に正規化してから補間
    let diff = newHeading - this._lastFilteredHeading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    this._lastFilteredHeading = (this._lastFilteredHeading + diff * this._lpfAlpha + 360) % 360;
    return this._lastFilteredHeading;
  }

  /**
   * 手動で現在地を設定 (デバッグ用)
   */
  setManualPosition(lat, lng) {
    this._manualPositionActive = true;
    this.currentPosition = { lat, lng, accuracy: 1.0 };
    this.isGpsAvailable = true;
    this.onPositionChangeCallbacks.forEach((cb) => cb(this.currentPosition));
  }

  /**
   * 手動で方位角を設定 (デバッグ用)
   */
  setManualHeading(heading) {
    this._manualHeadingActive = true;
    this.compassHeading = (heading + 360) % 360;
    this.isHeadingAvailable = true;
    this.onHeadingChangeCallbacks.forEach((cb) => cb(this.compassHeading));
  }

  onPositionChange(callback) {
    this.onPositionChangeCallbacks.push(callback);
  }

  onHeadingChange(callback) {
    this.onHeadingChangeCallbacks.push(callback);
  }

  onError(callback) {
    this.onErrorCallbacks.push(callback);
  }

  _triggerError(msg) {
    this.onErrorCallbacks.forEach((cb) => cb(msg));
  }

  stop() {
    if (this.positionWatchId !== null) {
      navigator.geolocation.clearWatch(this.positionWatchId);
      this.positionWatchId = null;
    }
    window.removeEventListener('deviceorientation', this._handleOrientation, true);
    window.removeEventListener('deviceorientationabsolute', this._handleOrientation, true);
    this._orientationListenerAttached = false;
  }
}
