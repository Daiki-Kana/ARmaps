/**
 * AR Rogaining App - Main Controller
 *
 * 修正ポイント:
 *  - latestBearing / latestHeading の初期化を明示的に 0 にセット
 *  - GPS未取得でも方位変化だけで矢印が回転するように修正
 *  - handlePositionUpdate 内で bearing と distance を常に保持
 *  - センサーエラー時に HUD にフィードバック表示
 *  - ボタンクリックハンドラ内でDeviceOrientation権限を取得し結果をsensorsに渡す
 *  - ポイント変動時のアニメーションフィードバック追加
 */

import { sampleCheckpoints } from './data/checkpoints.js';
import { SensorManager } from './modules/sensors.js';
import { ARCompassViewer } from './modules/arCompass.js';
import { MapView } from './modules/mapView.js';
import { calculateBearing, calculateDistance, formatDistance } from './modules/geoUtils.js';

class AppController {
  constructor() {
    this.checkpoints = sampleCheckpoints;
    this.currentTarget = sampleCheckpoints.length > 0 ? sampleCheckpoints[0] : null;

    // 完了（訪問済み）チェックポイントのID集合
    const savedVisited = localStorage.getItem('visited_checkpoints');
    this.visitedIds = new Set(savedVisited ? JSON.parse(savedVisited) : []);

    this.sensors = new SensorManager();
    this.arViewer = null;
    this.mapView = null;

    this.activeTab = 'ar'; // 'ar' | 'map'

    // 方位角の最新値を保持 — 明示的に初期化
    this.latestBearing = 0;
    this.latestHeading = 0;
    this.latestDistance = null;

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    // 1. AR ビューアーのセットアップ
    const container = document.getElementById('three-canvas-container');
    const video = document.getElementById('camera-video');
    this.arViewer = new ARCompassViewer(container, video);

    // 2. マップビューの初期化
    this.mapView = new MapView('leaflet-map');
    const initialLat = this.currentTarget ? this.currentTarget.lat : 35.681236;
    const initialLng = this.currentTarget ? this.currentTarget.lng : 139.767125;
    this.mapView.init(initialLat, initialLng);
    this.mapView.renderCheckpoints(
      this.checkpoints,
      this.currentTarget ? this.currentTarget.id : null,
      this.visitedIds
    );
    if (this.currentTarget) {
      this.mapView.setTargetLocation(this.currentTarget.lat, this.currentTarget.lng, this.currentTarget.name);
    }

    // 初期HUDおよびスコア表示更新
    this.updateHUDTargetInfo();
    this.updateScoreUI();
    if (this.currentTarget) {
      this.setDestination(this.currentTarget);
    }
  }

  bindEvents() {
    // タブ切り替え
    const tabAr = document.getElementById('tab-ar');
    const tabMap = document.getElementById('tab-map');

    tabAr.addEventListener('click', () => this.switchTab('ar'));
    tabMap.addEventListener('click', () => this.switchTab('map'));

    // マップで目的地が選択された時
    this.mapView.onSelectTarget((target) => {
      this.setDestination(target);
      this.switchTab('ar'); // 自動的にAR画面へ遷移
    });

    // マップでチェックポイントの完了状態がトグルされた時
    this.mapView.onToggleVisited((cp) => {
      this.toggleVisitedCheckpoint(cp.id);
    });

    // マップ再センタリングボタン
    document.getElementById('btn-recenter').addEventListener('click', () => {
      if (this.sensors.currentPosition) {
        this.mapView.centerOnUser(this.sensors.currentPosition.lat, this.sensors.currentPosition.lng);
      } else if (this.currentTarget) {
        this.mapView.centerOnUser(this.currentTarget.lat, this.currentTarget.lng);
      } else {
        this.mapView.centerOnUser(35.681236, 139.767125);
      }
    });

    // 非セキュア環境 (HTTP接続かつ非localhost) の自動判定
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const httpWarning = document.getElementById('http-warning');
    if (!window.isSecureContext && !isLocalhost && httpWarning) {
      httpWarning.style.display = 'block';
    }

    // ローカルIPでのアクセス警告 (Safari等で自己署名証明書使用時にセンサー類がブロックされる問題)
    const isIpAddress = /^[0-9]+(\.[0-9]+){3}$/.test(location.hostname);
    const ipWarning = document.getElementById('ip-warning');
    if (location.protocol === 'https:' && isIpAddress && !isLocalhost && ipWarning) {
      ipWarning.style.display = 'block';
    }

    // 「ARナビゲーションを開始」オーバーレイボタン
    const startBtn = document.getElementById('btn-start-app');
    const overlay = document.getElementById('permission-overlay');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (overlay) overlay.style.display = 'none';

        // iOS Safari等のモバイルブラウザでは、ユーザー操作（クリック）の同期コンテキスト内で
        // 権限リクエスト（カメラ、方位、GPS）を同時に発火させないと、ユーザー操作とみなされず
        // 後続のリクエストがブロックされる（機能しない）問題が発生する。
        // そのため、await を使わずに Promise を同時並行で発火させる。

        // 1. 方位センサー権限 (Safari用)
        let orientationPromise = Promise.resolve(true);
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
          orientationPromise = DeviceOrientationEvent.requestPermission()
            .then(res => res === 'granted')
            .catch(e => {
              console.warn('DeviceOrientation error:', e);
              return false;
            });
        }

        // 2. カメラ起動
        if (this.arViewer) {
          this.arViewer.startCamera().catch(e => {
            console.warn('カメラ起動エラー:', e);
          });
        }

        // 3. センサー (GPS / コンパス) 起動の開始
        // 方位権限の結果を待ってから開始する
        orientationPromise.then(granted => {
          if (this.sensors) {
            this.sensors.start(granted).catch(e => {
              console.warn('センサー起動エラー:', e);
            });
          }
        });
      });
    }

    // 位置情報チェンジイベント
    this.sensors.onPositionChange((pos) => {
      this.handlePositionUpdate(pos);
    });

    // 方位角チェンジイベント
    this.sensors.onHeadingChange((heading) => {
      this.handleHeadingUpdate(heading);
    });

    // エラーハンドリング
    this.sensors.onError((msg) => {
      console.warn('Sensor Warning:', msg);
      // エラーをHUDにフィードバック表示
      const gpsText = document.getElementById('chip-gps-text');
      const compassText = document.getElementById('chip-compass-text');
      if (msg.includes('GPS') || msg.includes('位置')) {
        if (gpsText) gpsText.textContent = 'GPS: エラー';
      }
      if (msg.includes('方位') || msg.includes('コンパス') || msg.includes('DeviceOrientation')) {
        if (compassText) compassText.textContent = 'コンパス: エラー';
      }
    });

    this.initQRScanner();
  }

  initQRScanner() {
    const btnOpenQr = document.getElementById('btn-open-qr');
    const btnCloseQr = document.getElementById('btn-close-qr');
    const qrModal = document.getElementById('qr-modal');
    const qrResult = document.getElementById('qr-scan-result');
    const fileInput = document.getElementById('qr-file-input');

    const urlConfirmModal = document.getElementById('url-confirm-modal');
    const urlConfirmText = document.getElementById('url-confirm-text');
    const btnOpenUrl = document.getElementById('btn-open-url');
    const btnCancelUrl = document.getElementById('btn-cancel-url');

    let html5QrCode = null;

    const handleScannedCode = (decodedText) => {
      console.log('QR Code Scanned:', decodedText);
      this.stopQrScanner(html5QrCode, qrModal);

      let targetUrl = decodedText.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
      }

      const textUpper = decodedText.toUpperCase();
      let matchedCP = this.checkpoints.find(
        (cp) =>
          cp.id.toUpperCase() === textUpper ||
          cp.code.toUpperCase() === textUpper ||
          cp.name.toUpperCase().includes(textUpper) ||
          textUpper.includes(cp.code.toUpperCase())
      );

      if (!matchedCP) {
        const numMatch = textUpper.match(/\d+/);
        if (numMatch) {
          const cpNum = numMatch[0].padStart(2, '0');
          matchedCP = this.checkpoints.find(
            (cp) => cp.id.endsWith(cpNum) || cp.code.endsWith(cpNum)
          );
        }
      }

      if (matchedCP) {
        this.setDestination(matchedCP);
      }

      if (urlConfirmModal) {
        if (urlConfirmText) urlConfirmText.textContent = targetUrl;
        if (btnOpenUrl) {
          btnOpenUrl.href = /^https?:\/\//i.test(targetUrl)
            ? targetUrl
            : `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
        }
        urlConfirmModal.classList.add('active');
      }
    };

    if (btnCancelUrl) {
      btnCancelUrl.addEventListener('click', () => {
        if (urlConfirmModal) urlConfirmModal.classList.remove('active');
      });
    }

    if (btnOpenUrl) {
      btnOpenUrl.addEventListener('click', () => {
        if (urlConfirmModal) urlConfirmModal.classList.remove('active');
      });
    }

    if (btnOpenQr) {
      btnOpenQr.addEventListener('click', () => {
        qrModal.classList.add('active');
        if (qrResult) qrResult.style.display = 'none';

        if (typeof Html5Qrcode !== 'undefined') {
          try {
            if (!html5QrCode) {
              html5QrCode = new Html5Qrcode('qr-reader');
            }
            html5QrCode
              .start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 200, height: 200 } },
                handleScannedCode,
                () => {}
              )
              .catch((err) => {
                console.warn('Camera QR Scanner Start Error:', err);
              });
          } catch (e) {
            console.warn('Html5Qrcode Init Error:', e);
          }
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length === 0) return;
        const imageFile = e.target.files[0];
        if (typeof Html5Qrcode !== 'undefined') {
          const scanner = html5QrCode || new Html5Qrcode('qr-reader');
          scanner
            .scanFile(imageFile, true)
            .then(handleScannedCode)
            .catch((err) => {
              if (qrResult) {
                qrResult.textContent = '画像からQRコードを検出できませんでした。';
                qrResult.style.display = 'block';
              }
            });
        }
      });
    }

    if (btnCloseQr) {
      btnCloseQr.addEventListener('click', () => {
        this.stopQrScanner(html5QrCode, qrModal);
      });
    }
  }

  stopQrScanner(scannerInstance, modalEl) {
    if (modalEl) modalEl.classList.remove('active');
    if (scannerInstance) {
      scannerInstance
        .stop()
        .catch(() => {})
        .then(() => {
          try {
            scannerInstance.clear();
          } catch (e) {}
        });
    }
  }

  /**
   * 目的地を更新
   */
  setDestination(target) {
    this.currentTarget = target;
    this.updateHUDTargetInfo();

    if (target) {
      // マップ表示も更新
      this.mapView.renderCheckpoints(this.checkpoints, target.id, this.visitedIds);
      this.mapView.setTargetLocation(target.lat, target.lng, target.name);
    }

    // 直ちに方位角・距離を再計算
    if (this.sensors.currentPosition) {
      this.handlePositionUpdate(this.sensors.currentPosition);
    }
  }

  /**
   * チェックポイントの完了状態を切り替え
   */
  toggleVisitedCheckpoint(cpId) {
    // ポイント変動量を計算するために、事前に変動前のポイントを記録
    const cp = this.checkpoints.find(c => c.id === cpId);
    const wasVisited = this.visitedIds.has(cpId);

    if (wasVisited) {
      this.visitedIds.delete(cpId);
    } else {
      this.visitedIds.add(cpId);
    }

    // localStorage に保存
    localStorage.setItem('visited_checkpoints', JSON.stringify([...this.visitedIds]));

    // UI及びスコアを更新
    this.updateScoreUI();
    this.mapView.renderCheckpoints(
      this.checkpoints,
      this.currentTarget ? this.currentTarget.id : null,
      this.visitedIds
    );

    // ポイント変動フィードバックを表示
    if (cp && cp.points) {
      const delta = wasVisited ? -cp.points : cp.points;
      this.showScoreFeedback(delta);
    }
  }

  /**
   * 合計ポイントを計算してUIに反映
   */
  updateScoreUI() {
    let totalScore = 0;
    this.checkpoints.forEach((cp) => {
      if (this.visitedIds.has(cp.id)) {
        totalScore += cp.points || 0;
      }
    });

    const scoreValEl = document.getElementById('total-score-val');
    if (scoreValEl) {
      scoreValEl.textContent = `${totalScore} pts`;
    }

    // スコアバナーにパルスアニメーション
    const banner = document.querySelector('.map-banner-overlay');
    if (banner) {
      banner.classList.remove('score-pulse');
      // リフロー強制でアニメーションリセット
      void banner.offsetWidth;
      banner.classList.add('score-pulse');
    }
  }

  /**
   * ポイント変動トースト表示
   */
  showScoreFeedback(delta) {
    const toast = document.getElementById('score-toast');
    if (!toast) return;

    const sign = delta > 0 ? '+' : '';
    toast.textContent = `${sign}${delta} pts`;
    toast.className = 'score-toast ' + (delta > 0 ? 'score-plus' : 'score-minus');

    // 表示アニメーション
    toast.classList.add('visible');

    // 一定時間後に非表示
    clearTimeout(this._scoreToastTimer);
    this._scoreToastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 1800);
  }

  /**
   * HUDの目的地情報テキストを更新
   */
  updateHUDTargetInfo() {
    const nameEl = document.getElementById('hud-target-name');
    if (nameEl) {
      nameEl.textContent = this.currentTarget ? this.currentTarget.name : '目的地未設定';
    }
  }

  /**
   * 現在地更新時の処理
   */
  handlePositionUpdate(pos) {
    // 1. GPS チップ UI 更新
    const dot = document.getElementById('chip-gps-dot');
    const text = document.getElementById('chip-gps-text');
    if (dot) dot.classList.add('active');
    if (text) {
      const accStr = pos.accuracy != null ? ` (±${Math.round(pos.accuracy)}m)` : '';
      text.textContent = `GPS: 測位中${accStr}`;
    }

    // 2. マップ上の現在地マーカー更新
    this.mapView.updateUserLocation(pos.lat, pos.lng);

    // 3. 目的地までの距離と Bearing を計算
    if (this.currentTarget) {
      this.latestDistance = calculateDistance(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);
      this.latestBearing = calculateBearing(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);
    } else {
      this.latestDistance = null;
      this.latestBearing = 0;
    }

    // HUD の距離表示更新
    const distEl = document.getElementById('hud-distance-val');
    if (distEl) {
      distEl.textContent = this.latestDistance !== null ? formatDistance(this.latestDistance) : '--- m';
    }

    // AR矢印の角度を即座に更新
    this.updateARCompassAngle();
  }

  /**
   * 方位角更新時の処理
   */
  handleHeadingUpdate(heading) {
    // 1. コンパス チップ UI 更新
    const dot = document.getElementById('chip-compass-dot');
    const text = document.getElementById('chip-compass-text');
    if (dot) dot.classList.add('active');
    if (text) text.textContent = `コンパス: ${Math.round(heading)}°`;

    this.latestHeading = heading;

    // 方位角が変わるたびに即座にAR矢印を更新 (GPSが来ていなくても回転する)
    this.updateARCompassAngle();
  }

  /**
   * 目的地への相対角度 (Bearing - Heading) を動的に計算して 3D 矢印に反映
   *
   * relativeAngle:
   *   = 0°  → 端末が目的地を正面に向いている
   *   > 0°  → 目的地は端末の右側にある
   *   < 0°  → 目的地は端末の左側にある
   */
  updateARCompassAngle() {
    const relativeAngle = this.latestBearing - this.latestHeading;
    if (this.arViewer) {
      this.arViewer.setRelativeAngle(relativeAngle);
    }
  }

  /**
   * ビュータブの切り替え
   */
  switchTab(tab) {
    this.activeTab = tab;

    const tabAr = document.getElementById('tab-ar');
    const tabMap = document.getElementById('tab-map');
    const viewAr = document.getElementById('ar-view');
    const viewMap = document.getElementById('map-view');

    if (tab === 'ar') {
      tabAr.classList.add('active');
      tabMap.classList.remove('active');
      viewAr.classList.add('active');
      viewMap.classList.remove('active');
    } else {
      tabMap.classList.add('active');
      tabAr.classList.remove('active');
      viewMap.classList.add('active');
      viewAr.classList.remove('active');

      // 地図サイズ再計算
      if (this.mapView && this.mapView.map) {
        setTimeout(() => this.mapView.map.invalidateSize(), 200);
      }
    }
  }
}

// アプリケーション起動
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
