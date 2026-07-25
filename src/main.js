/**
 * AR Rogaining App - Main Controller
 *
 * 修正ポイント:
 *  - latestBearing / latestHeading の初期化を明示的に 0 にセット
 *  - GPS未取得でも方位変化だけで矢印が回転するように修正
 *  - handlePositionUpdate 内で bearing と distance を常に保持
 *  - センサーエラー時に HUD にフィードバック表示
 */

import { sampleCheckpoints } from './data/checkpoints.js';
import { SensorManager } from './modules/sensors.js';
import { ARCompassViewer } from './modules/arCompass.js';
import { MapView } from './modules/mapView.js';
import { DebugPanel } from './modules/debugPanel.js';
import { calculateBearing, calculateDistance, formatDistance } from './modules/geoUtils.js';

class AppController {
  constructor() {
    this.checkpoints = sampleCheckpoints;
    this.currentTarget = sampleCheckpoints[0]; // デフォルト目的地: CP01

    this.sensors = new SensorManager();
    this.arViewer = null;
    this.mapView = null;
    this.debugPanel = null;

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
    this.mapView.init(this.currentTarget.lat, this.currentTarget.lng);
    this.mapView.renderCheckpoints(this.checkpoints, this.currentTarget.id);
    this.mapView.setTargetLocation(this.currentTarget.lat, this.currentTarget.lng, this.currentTarget.name);

    // 3. デバッグパネルの初期化 (PC用テストシミュレーター)
    this.debugPanel = new DebugPanel(this.sensors, this.currentTarget);

    // 初期HUD表示更新
    this.updateHUDTargetInfo();
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

    // マップ再センタリングボタン
    document.getElementById('btn-recenter').addEventListener('click', () => {
      if (this.sensors.currentPosition) {
        this.mapView.centerOnUser(this.sensors.currentPosition.lat, this.sensors.currentPosition.lng);
      } else {
        this.mapView.centerOnUser(this.currentTarget.lat, this.currentTarget.lng);
      }
    });

    // 「ARナビゲーションを開始」オーバーレイボタン
    const startBtn = document.getElementById('btn-start-app');
    const overlay = document.getElementById('permission-overlay');

    startBtn.addEventListener('click', async () => {
      overlay.style.display = 'none';

      // カメラ起動
      const cameraOk = await this.arViewer.startCamera();
      if (!cameraOk) {
        console.warn('カメラを起動できませんでした。PCの場合はデバッグモードをご利用ください。');
      }

      // センサー起動 (位置情報 & iOSコンパス)
      await this.sensors.start();
    });

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
      // エラーをHUDにも一時的に表示
      const text = document.getElementById('chip-gps-text');
      if (text) text.textContent = 'GPS: エラー';
    });
  }

  /**
   * 目的地を更新
   */
  setDestination(target) {
    this.currentTarget = target;
    this.updateHUDTargetInfo();

    // マップ表示も更新
    this.mapView.renderCheckpoints(this.checkpoints, target.id);
    this.mapView.setTargetLocation(target.lat, target.lng, target.name);

    // 直ちに方位角・距離を再計算
    if (this.sensors.currentPosition) {
      this.handlePositionUpdate(this.sensors.currentPosition);
    }
  }

  /**
   * HUDの目的地情報テキストを更新
   */
  updateHUDTargetInfo() {
    const nameEl = document.getElementById('hud-target-name');
    if (nameEl) nameEl.textContent = this.currentTarget.name;
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
    this.latestDistance = calculateDistance(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);
    this.latestBearing = calculateBearing(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);

    // HUD の距離表示更新
    const distEl = document.getElementById('hud-distance-val');
    if (distEl) distEl.textContent = formatDistance(this.latestDistance);

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
    this.arViewer.setRelativeAngle(relativeAngle);
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
