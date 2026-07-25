/**
 * AR Rogaining App - Realtime GPS Tracking & Clean AR Overlay Bundle
 */

(function () {
  'use strict';

  // --- 1. Checkpoints Data ---
  const sampleCheckpoints = [
    {
      id: 'cp-01',
      name: 'CP01: スターティングポイント',
      code: 'START-01',
      lat: 35.681236,
      lng: 139.767125,
      points: 10,
      description: '大会のスタート・ゴール地点。準備を整えて出発しましょう。'
    },
    {
      id: 'cp-02',
      name: 'CP02: 和田倉噴水公園',
      code: 'PARK-02',
      lat: 35.684120,
      lng: 139.761750,
      points: 25,
      description: '美しい大噴水がある公園。歴史的な雰囲気を感じられるスポット。'
    },
    {
      id: 'cp-03',
      name: 'CP03: 皇居外苑 桜田門',
      code: 'GATE-03',
      lat: 35.678100,
      lng: 139.752400,
      points: 40,
      description: '重要文化財に指定されている歴史的な城門。'
    },
    {
      id: 'cp-04',
      name: 'CP04: 東京タワー前広場',
      code: 'TOWER-04',
      lat: 35.658580,
      lng: 139.745430,
      points: 50,
      description: '高得点エリア！シンボルタワーの足元にある絶景スポット。'
    },
    {
      id: 'cp-05',
      name: 'CP05: 日比谷公園 心字池',
      code: 'POND-05',
      lat: 35.673200,
      lng: 139.756800,
      points: 30,
      description: '静かな池と緑に囲まれた憩いの場。'
    }
  ];

  // --- 2. Geo Utils ---
  const EARTH_RADIUS = 6371000;

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const rLat1 = toRadians(lat1);
    const rLat2 = toRadians(lat2);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS * c;
  }

  /**
   * 地点1(現在地)から地点2(目的地)への方位角 Bearing (0° = 北, 90° = 東, 180° = 南, 270° = 西) を計算
   */
  function calculateBearing(lat1, lon1, lat2, lon2) {
    const rLat1 = toRadians(lat1);
    const rLat2 = toRadians(lat2);
    const dLon = toRadians(lon2 - lon1);

    const y = Math.sin(dLon) * Math.cos(rLat2);
    const x =
      Math.cos(rLat1) * Math.sin(rLat2) -
      Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);

    let brng = toDegrees(Math.atan2(y, x));
    return (brng + 360) % 360;
  }

  function formatDistance(meters) {
    if (meters == null || isNaN(meters)) return '測位中...';
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function lerpAngle(current, target, alpha = 0.25) {
    let diff = target - current;
    diff = ((diff % 360) + 540) % 360 - 180;
    let result = current + diff * alpha;
    return ((result % 360) + 360) % 360;
  }

  // --- 3. Sensor Manager (Continuous High-Precision GPS Tracker) ---
  class SensorManager {
    constructor() {
      this.currentPosition = null;
      this.compassHeading = 0;
      this.isHeadingAvailable = false;
      this.isGpsAvailable = false;

      this.positionWatchId = null;
      this.onPositionChangeCallbacks = [];
      this.onHeadingChangeCallbacks = [];
      this.onErrorCallbacks = [];

      this._lastFilteredHeading = null;
      this._lpfAlpha = 0.35;

      this._manualPositionActive = false;
      this._manualHeadingActive = false;

      this._bindEvents();
    }

    _bindEvents() {
      this._handleOrientation = this._handleOrientation.bind(this);
    }

    requestPermissions() {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then((permissionState) => {
            if (permissionState === 'granted') {
              window.addEventListener('deviceorientation', this._handleOrientation, true);
            } else {
              this._triggerError('iOSの設定でモーションアクセスの許可が必要です。');
            }
          })
          .catch((err) => {
            console.warn('iOS DeviceOrientation error:', err);
            window.addEventListener('deviceorientation', this._handleOrientation, true);
          });
      } else {
        if ('ondeviceorientationabsolute' in window) {
          window.addEventListener('deviceorientationabsolute', this._handleOrientation, true);
        }
        window.addEventListener('deviceorientation', this._handleOrientation, true);
      }

      this.startContinuousGPS();
    }

    /**
     * 移動に合わせて常にリアルタイムでGPS現在地を連続追跡する
     */
    startContinuousGPS() {
      if (!('geolocation' in navigator)) {
        this._triggerError('Geolocation非対応のブラウザです。');
        return;
      }

      const successHandler = (pos) => {
        if (this._manualPositionActive) return;
        this.currentPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        this.isGpsAvailable = true;
        // 登録されたコールバック(現在地更新・Bearing再計算)を即時実行
        this.onPositionChangeCallbacks.forEach((cb) => cb(this.currentPosition));
      };

      // 高精度かつリアルタイム更新 (maximumAge: 0 で古い位置情報を破棄)
      // 高精度GPS連続追跡 (歩行移動に即座に追従)
      this.positionWatchId = navigator.geolocation.watchPosition(
        successHandler,
        (err) => {
          console.warn('GPS Watch High Accuracy failed, retrying standard mode:', err.message);
          // フォールバック: 標準精度で再試行
          navigator.geolocation.getCurrentPosition(
            successHandler,
            (err2) => this._triggerError('GPSの位置情報を取得できません'),
            { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 }
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,        // キャッシュを使わず常に最新GPS位置を取得
          timeout: 10000
        }
      );
    }

    _handleOrientation(event) {
      if (this._manualHeadingActive) return;

      let heading = null;

      if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        heading = event.webkitCompassHeading;
      } else if (event.alpha !== undefined && event.alpha !== null) {
        heading = (360 - event.alpha) % 360;
      }

      if (heading !== null && !isNaN(heading)) {
        heading = this._applyLowPassFilter(heading);
        this.compassHeading = heading;
        this.isHeadingAvailable = true;
        this.onHeadingChangeCallbacks.forEach((cb) => cb(this.compassHeading));
      }
    }

    _applyLowPassFilter(newHeading) {
      if (this._lastFilteredHeading === null) {
        this._lastFilteredHeading = newHeading;
        return newHeading;
      }
      let diff = newHeading - this._lastFilteredHeading;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this._lastFilteredHeading = (this._lastFilteredHeading + diff * this._lpfAlpha + 360) % 360;
      return this._lastFilteredHeading;
    }

    setManualPosition(lat, lng) {
      this._manualPositionActive = true;
      this.currentPosition = { lat, lng, accuracy: 1.0 };
      this.isGpsAvailable = true;
      this.onPositionChangeCallbacks.forEach((cb) => cb(this.currentPosition));
    }

    setManualHeading(heading) {
      this._manualHeadingActive = true;
      this.compassHeading = (heading + 360) % 360;
      this.isHeadingAvailable = true;
      this.onHeadingChangeCallbacks.forEach((cb) => cb(this.compassHeading));
    }

    onPositionChange(cb) { this.onPositionChangeCallbacks.push(cb); }
    onHeadingChange(cb) { this.onHeadingChangeCallbacks.push(cb); }
    onError(cb) { this.onErrorCallbacks.push(cb); }

    _triggerError(msg) {
      this.onErrorCallbacks.forEach((cb) => cb(msg));
    }
  }

  // --- 4. AR Compass Viewer (Three.js - Clean Overlay / No Grid) ---
  class ARCompassViewer {
    constructor(containerElement, videoElement) {
      this.container = containerElement;
      this.video = videoElement;

      this.scene = null;
      this.camera = null;
      this.renderer = null;

      this.arrowGroup = null;
      this.compassRingGroup = null;
      this.pulseMesh = null;

      this.targetAngle = 0;
      this.currentAngle = 0;

      this.isCameraActive = false;
      this.animFrameId = null;

      this.initThree();
    }

    initThree() {
      if (typeof THREE === 'undefined') return;

      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;

      this.scene = new THREE.Scene();

      this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
      this.camera.position.set(0, 3.5, 4.0);
      this.camera.lookAt(0, 0, 0);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      this.container.appendChild(this.renderer.domElement);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
      this.scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
      dirLight.position.set(5, 10, 7);
      this.scene.add(dirLight);

      const pointLight = new THREE.PointLight(0x34d399, 2.5, 10);
      pointLight.position.set(0, 1, 0);
      this.scene.add(pointLight);

      // ※ 黒いグリッド線 (GridHelper) は完全に削除しました

      this.create3DCompass();

      window.addEventListener('resize', () => this.onWindowResize());
      this.animate();
    }

    create3DCompass() {
      this.arrowGroup = new THREE.Group();

      // Cone Head (-Z 方向 = 前方)
      const coneGeo = new THREE.ConeGeometry(0.55, 1.3, 32);
      coneGeo.rotateX(-Math.PI / 2);
      const coneMat = new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0891b2,
        emissiveIntensity: 0.6,
        roughness: 0.2,
        metalness: 0.8
      });
      const coneMesh = new THREE.Mesh(coneGeo, coneMat);
      coneMesh.position.set(0, 0.2, -1.1);
      this.arrowGroup.add(coneMesh);

      // Cylinder Shaft
      const cylGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.4, 32);
      cylGeo.rotateX(Math.PI / 2);
      const cylMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.4,
        roughness: 0.3,
        metalness: 0.7
      });
      const cylMesh = new THREE.Mesh(cylGeo, cylMat);
      cylMesh.position.set(0, 0.2, -0.2);
      this.arrowGroup.add(cylMesh);

      // Center Sphere Glow
      const sphereGeo = new THREE.SphereGeometry(0.35, 32, 32);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x10b981,
        emissiveIntensity: 0.9,
        roughness: 0.1
      });
      const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      sphereMesh.position.set(0, 0.25, 0.4);
      this.arrowGroup.add(sphereMesh);

      // Compass Ring
      const ringGeo = new THREE.TorusGeometry(1.8, 0.04, 16, 64);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.5
      });
      this.compassRingGroup = new THREE.Mesh(ringGeo, ringMat);
      this.scene.add(this.compassRingGroup);

      // Ground Pulse Wave
      const pulseGeo = new THREE.RingGeometry(0.1, 2.0, 32);
      pulseGeo.rotateX(-Math.PI / 2);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.3
      });
      this.pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      this.pulseMesh.position.set(0, -0.05, 0);
      this.scene.add(this.pulseMesh);

      this.scene.add(this.arrowGroup);
    }

    async startCamera() {
      if (!this.video) return false;
      const tryStream = async (constraints) => {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = stream;
        await this.video.play();
        return true;
      };

      try {
        await tryStream({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        this.isCameraActive = true;
        return true;
      } catch (e1) {
        try {
          await tryStream({ video: true, audio: false });
          this.isCameraActive = true;
          return true;
        } catch (e2) {
          this.isCameraActive = false;
          document.getElementById('ar-view').style.background = 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)';
          return false;
        }
      }
    }

    setRelativeAngle(relativeAngleDeg) {
      let normalized = relativeAngleDeg % 360;
      if (normalized < 0) normalized += 360;
      this.targetAngle = normalized;
    }

    resetAngle(relativeAngleDeg) {
      let normalized = relativeAngleDeg % 360;
      if (normalized < 0) normalized += 360;
      this.targetAngle = normalized;
      this.currentAngle = normalized;
      if (this.arrowGroup) {
        const rad = (this.currentAngle * Math.PI) / 180;
        this.arrowGroup.rotation.y = rad;
      }
    }

    animate() {
      this.animFrameId = requestAnimationFrame(() => this.animate());

      this.currentAngle = lerpAngle(this.currentAngle, this.targetAngle, 0.25);

      if (this.arrowGroup) {
        const rad = (this.currentAngle * Math.PI) / 180;
        this.arrowGroup.rotation.y = rad;

        const time = Date.now() * 0.003;
        this.arrowGroup.position.y = Math.sin(time) * 0.08;
      }

      if (this.pulseMesh) {
        const pTime = (Date.now() * 0.0015) % 1;
        const scale = 0.5 + pTime * 1.2;
        this.pulseMesh.scale.set(scale, scale, 1);
        this.pulseMesh.material.opacity = Math.max(0, 0.5 * (1 - pTime));
      }

      this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  }

  // --- 5. Map View (Leaflet) ---
  class MapView {
    constructor(mapContainerId) {
      this.containerId = mapContainerId;
      this.map = null;
      this.userMarker = null;
      this.targetMarker = null;
      this.checkpointMarkers = [];
      this.onSelectTargetCallback = null;
      this.isInitialized = false;
    }

    init(defaultLat = 35.681236, defaultLng = 139.767125) {
      if (this.isInitialized || typeof L === 'undefined') return;

      const mapElement = document.getElementById(this.containerId);
      if (!mapElement) return;

      this.map = L.map(this.containerId, { zoomControl: false }).setView([defaultLat, defaultLng], 15);
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(this.map);

      this.isInitialized = true;
    }

    renderCheckpoints(checkpoints, activeTargetId = null) {
      if (!this.map) return;
      this.checkpointMarkers.forEach((m) => this.map.removeLayer(m));
      this.checkpointMarkers = [];

      checkpoints.forEach((cp) => {
        const isSelected = cp.id === activeTargetId;
        const customIcon = L.divIcon({
          className: 'custom-cp-marker',
          html: `<div class="cp-pin ${isSelected ? 'is-active' : ''}"><span class="cp-code">${cp.code || 'CP'}</span></div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });

        const marker = L.marker([cp.lat, cp.lng], { icon: customIcon }).addTo(this.map);
        const popupContent = `
          <div class="map-popup-card">
            <h4>${cp.name}</h4>
            <p>${cp.description || ''}</p>
            <div class="popup-info"><span class="badge-pts">+${cp.points || 10} pts</span></div>
            <button class="btn-select-target" data-cpid="${cp.id}">📍 この地点を目的地に設定</button>
          </div>
        `;

        marker.bindPopup(popupContent);
        marker.on('popupopen', () => {
          const btn = document.querySelector(`.btn-select-target[data-cpid="${cp.id}"]`);
          if (btn) {
            btn.addEventListener('click', () => {
              if (this.onSelectTargetCallback) this.onSelectTargetCallback(cp);
              this.map.closePopup();
            });
          }
        });

        this.checkpointMarkers.push(marker);
      });
    }

    updateUserLocation(lat, lng) {
      if (!this.map) return;
      if (!this.userMarker) {
        const userIcon = L.divIcon({
          className: 'user-location-marker',
          html: '<div class="user-dot"></div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        this.userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(this.map);
      } else {
        this.userMarker.setLatLng([lat, lng]);
      }
    }

    setTargetLocation(lat, lng, label = '目的地') {
      if (!this.map) return;
      if (this.targetMarker) this.map.removeLayer(this.targetMarker);

      const targetIcon = L.divIcon({
        className: 'target-location-marker',
        html: '<div class="target-flag">🏁</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      this.targetMarker = L.marker([lat, lng], { icon: targetIcon, zIndexOffset: 900 }).addTo(this.map);
    }

    centerOnUser(lat, lng) {
      if (this.map && lat && lng) {
        this.map.flyTo([lat, lng], 16, { duration: 1.2 });
      }
    }

    onSelectTarget(callback) {
      this.onSelectTargetCallback = callback;
    }
  }

  // --- 6. Debug Panel ---
  class DebugPanel {
    constructor(sensorManager, defaultTarget) {
      this.sensors = sensorManager;
      this.target = defaultTarget;
      this.panelElement = null;

      this.simLat = 35.681236;
      this.simLng = 139.767125;
      this.simHeading = 0;

      this.initUI();
    }

    initUI() {
      const debugHtml = `
        <div id="debug-panel" class="debug-panel collapsed">
          <button id="btn-toggle-debug" class="debug-toggle-btn">
            <span>🛠️ 開発用デバッグシミュレーター</span>
            <span class="toggle-icon">▲</span>
          </button>
          <div class="debug-content">
            <p class="debug-desc">PCや手動テスト用スライダー。スマホ連動時は操作しなくても実機センサーが優先動作します。</p>
            <div class="debug-control-group">
              <label>端末の向き (Heading): <span id="debug-heading-val">0°</span></label>
              <input type="range" id="slider-heading" min="0" max="360" value="0" step="1">
            </div>
            <div class="debug-control-group">
              <label>現在地 緯度 (Lat): <span id="debug-lat-val">35.68123</span></label>
              <input type="range" id="slider-lat" min="35.6500" max="35.7000" value="35.6812" step="0.0002">
            </div>
            <div class="debug-control-group">
              <label>現在地 経度 (Lng): <span id="debug-lng-val">139.7671</span></label>
              <input type="range" id="slider-lng" min="139.7300" max="139.8000" value="139.7671" step="0.0002">
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', debugHtml);
      this.panelElement = document.getElementById('debug-panel');

      this.bindEvents();
    }

    bindEvents() {
      const toggleBtn = document.getElementById('btn-toggle-debug');
      toggleBtn.addEventListener('click', () => {
        this.panelElement.classList.toggle('collapsed');
        const icon = toggleBtn.querySelector('.toggle-icon');
        icon.textContent = this.panelElement.classList.contains('collapsed') ? '▲' : '▼';
      });

      const headingSlider = document.getElementById('slider-heading');
      const latSlider = document.getElementById('slider-lat');
      const lngSlider = document.getElementById('slider-lng');

      headingSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('debug-heading-val').textContent = `${val}°`;
        this.sensors.setManualHeading(val);
      });

      latSlider.addEventListener('input', (e) => {
        this.simLat = parseFloat(e.target.value);
        document.getElementById('debug-lat-val').textContent = this.simLat.toFixed(5);
        this.sensors.setManualPosition(this.simLat, this.simLng);
      });

      lngSlider.addEventListener('input', (e) => {
        this.simLng = parseFloat(e.target.value);
        document.getElementById('debug-lng-val').textContent = this.simLng.toFixed(5);
        this.sensors.setManualPosition(this.simLat, this.simLng);
      });
    }
  }

  // --- 7. Main Application Controller ---
  class AppController {
    constructor() {
      this.checkpoints = [...sampleCheckpoints];
      this.currentTarget = this.checkpoints[0];

      this.sensors = new SensorManager();
      this.arViewer = null;
      this.mapView = null;
      this.debugPanel = null;

      this.latestBearing = 0;
      this.latestHeading = 0;

      this.initDOM();
      this.bindEvents();
    }

    initDOM() {
      const container = document.getElementById('three-canvas-container');
      const video = document.getElementById('camera-video');
      this.arViewer = new ARCompassViewer(container, video);

      this.mapView = new MapView('leaflet-map');
      this.mapView.init(this.currentTarget.lat, this.currentTarget.lng);
      this.mapView.renderCheckpoints(this.checkpoints, this.currentTarget.id);
      this.mapView.setTargetLocation(this.currentTarget.lat, this.currentTarget.lng, this.currentTarget.name);

      this.debugPanel = new DebugPanel(this.sensors, this.currentTarget);
      this.updateHUDTargetInfo();
    }

    bindEvents() {
      const tabAr = document.getElementById('tab-ar');
      const tabMap = document.getElementById('tab-map');

      tabAr.addEventListener('click', () => this.switchTab('ar'));
      tabMap.addEventListener('click', () => this.switchTab('map'));

      this.mapView.onSelectTarget((target) => {
        this.setDestination(target);
        this.switchTab('ar');
      });

      document.getElementById('btn-recenter').addEventListener('click', () => {
        if (this.sensors.currentPosition) {
          this.mapView.centerOnUser(this.sensors.currentPosition.lat, this.sensors.currentPosition.lng);
        } else {
          this.mapView.centerOnUser(this.currentTarget.lat, this.currentTarget.lng);
        }
      });

      const startBtn = document.getElementById('btn-start-app');
      const overlay = document.getElementById('permission-overlay');

      startBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        this.sensors.requestPermissions();
        this.arViewer.startCamera();
      });

      // リアルタイムGPS更新時に現在地から目的地への方向・距離を即座に再計算して追従
      this.sensors.onPositionChange((pos) => this.handlePositionUpdate(pos));
      this.sensors.onHeadingChange((heading) => this.handleHeadingUpdate(heading));

      this.sensors.onError((msg) => {
        console.warn('Sensor Alert:', msg);
        const text = document.getElementById('chip-gps-text');
        if (text) text.textContent = msg;
      });
    }

    setDestination(target) {
      this.currentTarget = target;
      this.updateHUDTargetInfo();

      this.mapView.renderCheckpoints(this.checkpoints, target.id);
      this.mapView.setTargetLocation(target.lat, target.lng, target.name);

      // 現在地からの最新方向・距離を即座に適用
      if (this.sensors.currentPosition) {
        this.handlePositionUpdate(this.sensors.currentPosition);
      } else {
        const uLat = this.debugPanel.simLat;
        const uLng = this.debugPanel.simLng;
        this.latestBearing = calculateBearing(uLat, uLng, target.lat, target.lng);
        const dist = calculateDistance(uLat, uLng, target.lat, target.lng);

        const distEl = document.getElementById('hud-distance-val');
        if (distEl) distEl.textContent = formatDistance(dist);

        const relativeAngle = this.latestBearing - this.latestHeading;
        this.arViewer.resetAngle(relativeAngle);
      }
    }

    updateHUDTargetInfo() {
      const nameEl = document.getElementById('hud-target-name');
      if (nameEl) nameEl.textContent = this.currentTarget.name;
    }

    /**
     * ユーザー移動時のリアルタイムGPS更新ハンドラ
     * ユーザーの位置が変わると動的に目的地への方位角・距離を連続追従
     */
    handlePositionUpdate(pos) {
      const dot = document.getElementById('chip-gps-dot');
      const text = document.getElementById('chip-gps-text');
      if (dot) dot.classList.add('active');
      if (text) {
        const accStr = pos.accuracy != null ? ` (±${Math.round(pos.accuracy)}m)` : '';
        text.textContent = `GPS: 測位中${accStr}`;
      }

      // マップの現在地自車マーク更新
      this.mapView.updateUserLocation(pos.lat, pos.lng);

      // ユーザーの「現在の最新GPS位置 (pos.lat, pos.lng)」から「目的地 (currentTarget.lat, currentTarget.lng)」への方位角と距離を計算
      const dist = calculateDistance(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);
      this.latestBearing = calculateBearing(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);

      const distEl = document.getElementById('hud-distance-val');
      if (distEl) distEl.textContent = formatDistance(dist);

      // AR矢印の向く相対角度 (Bearing - Heading) をリアルタイム更新
      this.updateARCompassAngle();
    }

    handleHeadingUpdate(heading) {
      const dot = document.getElementById('chip-compass-dot');
      const text = document.getElementById('chip-compass-text');
      if (dot) {
        dot.classList.add('active');
        dot.style.backgroundColor = '#10b981';
      }
      if (text) text.textContent = `コンパス: ${Math.round(heading)}°`;

      this.latestHeading = heading;
      this.updateARCompassAngle();
    }

    updateARCompassAngle() {
      const relativeAngle = this.latestBearing - this.latestHeading;
      this.arViewer.setRelativeAngle(relativeAngle);
    }

    switchTab(tab) {
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
        if (this.mapView && this.mapView.map) {
          setTimeout(() => this.mapView.map.invalidateSize(), 200);
        }
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
  });
})();
