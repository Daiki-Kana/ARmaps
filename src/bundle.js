(function (THREE) {
  'use strict';

  function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
      Object.keys(e).forEach(function (k) {
        if (k !== 'default') {
          var d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: function () { return e[k]; }
          });
        }
      });
    }
    n.default = e;
    return Object.freeze(n);
  }

  var THREE__namespace = /*#__PURE__*/_interopNamespaceDefault(THREE);

  const sampleCheckpoints = [
    {
      id: "cp-01",
      name: "CP01: スターティングポイント",
      code: "START-01",
      lat: 35.681236,
      lng: 139.767125,
      points: 10,
      description: "大会のスタート・ゴール地点。準備を整えて出発しましょう。",
    },
    {
      id: "cp-02",
      name: "CP02: 和田倉噴水公園",
      code: "PARK-02",
      lat: 35.68412,
      lng: 139.76175,
      points: 25,
      description: "美しい大噴水がある公園。歴史的な雰囲気を感じられるスポット。",
    },
    {
      id: "cp-03",
      name: "CP03: 皇居外苑 桜田門",
      code: "GATE-03",
      lat: 35.6781,
      lng: 139.7524,
      points: 40,
      description: "重要文化財に指定されている歴史的な城門。",
    },
    {
      id: "cp-04",
      name: "CP04: 東京タワー前広場",
      code: "TOWER-04",
      lat: 35.65858,
      lng: 139.74543,
      points: 50,
      description: "高得点エリア！シンボルタワーの足元にある絶景スポット。",
    },
    {
      id: "cp-05",
      name: "CP05: 日比谷公園 心字池",
      code: "POND-05",
      lat: 35.6732,
      lng: 139.7568,
      points: 30,
      description: "静かな池と緑に囲まれた憩いの場。",
    },
  ];

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

      this.permissionGranted = false;

      this._lastFilteredHeading = null;
      this._lpfAlpha = 0.3;

      this._manualPositionActive = false;
      this._manualHeadingActive = false;

      this._bindEvents();
    }

    _bindEvents() {
      this._handleOrientation = this._handleOrientation.bind(this);
    }

    async start() {
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        this._triggerError('GPS: HTTPS接続が必要です (http:// -> https://)');
        return;
      }

      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (this._manualPositionActive) return;
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
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
        );

        this.positionWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (this._manualPositionActive) return;
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

      await this.requestOrientationPermission();
    }

    async requestOrientationPermission() {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const permissionState = await DeviceOrientationEvent.requestPermission();
          if (permissionState === 'granted') {
            this.permissionGranted = true;
            window.addEventListener('deviceorientation', this._handleOrientation, true);
          } else {
            this._triggerError('方位センサーの権限が拒否されました。設定アプリからカメラ・モーション許可を確認してください。');
          }
        } catch (e) {
          console.warn('DeviceOrientation Permission Error:', e);
          this._triggerError('方位センサーの権限要求でエラーが発生しました。');
        }
      } else {
        this.permissionGranted = true;
        if ('ondeviceorientationabsolute' in window) {
          window.addEventListener('deviceorientationabsolute', this._handleOrientation, true);
        } else if ('ondeviceorientation' in window) {
          window.addEventListener('deviceorientation', this._handleOrientation, true);
        }
      }
    }

    _handleOrientation(event) {
      if (this._manualHeadingActive) return;

      let heading = null;

      if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        heading = event.webkitCompassHeading;
      } 
      else if (event.alpha !== undefined && event.alpha !== null) {
        if (event.absolute === true || event.type === 'deviceorientationabsolute') {
          heading = (360 - event.alpha) % 360;
        } else {
          heading = (360 - event.alpha) % 360;
        }
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
    }
  }

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

  function lerpAngle(current, target, alpha = 0.15) {
    let diff = target - current;
    diff = ((diff % 360) + 540) % 360 - 180;

    let result = current + diff * alpha;
    return ((result % 360) + 360) % 360;
  }

  class ARCompassViewer {
    constructor(containerElement, videoElement) {
      this.container = containerElement;
      this.video = videoElement;

      this.scene = null;
      this.camera = null;
      this.renderer = null;

      this.arrowGroup = null;

      this.targetAngle = 0;
      this.currentAngle = 0;

      this.isCameraActive = false;
      this.animFrameId = null;

      this.initThree();
    }

    initThree() {
      if (typeof THREE__namespace === 'undefined') return;

      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;

      this.scene = new THREE__namespace.Scene();

      this.camera = new THREE__namespace.PerspectiveCamera(60, width / height, 0.1, 1000);
      this.camera.position.set(0, 3.2, 4.0);
      this.camera.lookAt(0, 0.6, 0);

      this.renderer = new THREE__namespace.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      this.container.appendChild(this.renderer.domElement);

      const ambientLight = new THREE__namespace.AmbientLight(0xffffff, 0.9);
      this.scene.add(ambientLight);

      const dirLight = new THREE__namespace.DirectionalLight(0xffffff, 1.8);
      dirLight.position.set(5, 10, 7);
      this.scene.add(dirLight);

      this.create3DCompass();

      window.addEventListener('resize', () => this.onWindowResize());
      this.animate();
    }

    create3DCompass() {
      this.arrowGroup = new THREE__namespace.Group();
      this.arrowGroup.position.set(0, -0.6, 0.5);

      const shape = new THREE__namespace.Shape();
      shape.moveTo(0, 1.4);
      shape.lineTo(0.55, 0.45);
      shape.lineTo(0.22, 0.45);
      shape.lineTo(0.22, -0.8);
      shape.lineTo(-0.22, -0.8);
      shape.lineTo(-0.22, 0.45);
      shape.lineTo(-0.55, 0.45);
      shape.closePath();

      const extrudeSettings = {
        depth: 0.2,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.03,
        bevelThickness: 0.03,
      };

      const arrowGeo = new THREE__namespace.ExtrudeGeometry(shape, extrudeSettings);
      arrowGeo.center();
      arrowGeo.rotateX(-Math.PI / 2);

      const arrowMat = new THREE__namespace.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0x7f1d1d,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.4,
      });

      const arrowMesh = new THREE__namespace.Mesh(arrowGeo, arrowMat);
      this.arrowGroup.add(arrowMesh);

      const ringGeo = new THREE__namespace.RingGeometry(1.3, 1.36, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE__namespace.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE__namespace.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const ringMesh = new THREE__namespace.Mesh(ringGeo, ringMat);
      ringMesh.position.set(0, -0.1, 0);
      this.arrowGroup.add(ringMesh);

      this.scene.add(this.arrowGroup);
    }

    async startCamera() {
      if (!this.video) return false;

      this.video.setAttribute('playsinline', 'true');
      this.video.setAttribute('webkit-playsinline', 'true');
      this.video.muted = true;

      const tryStream = async (constraints) => {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = stream;
        try {
          await this.video.play();
        } catch (err) {
          console.warn('Camera video play error:', err);
        }
        return true;
      };

      try {
        await tryStream({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        this.isCameraActive = true;
        return true;
      } catch (e1) {
        try {
          await tryStream({ video: true, audio: false });
          this.isCameraActive = true;
          return true;
        } catch (e2) {
          this.isCameraActive = false;
          document.getElementById('ar-view').style.background = '#121214';
          return false;
        }
      }
    }

    stopCamera() {
      if (this.video && this.video.srcObject) {
        const tracks = this.video.srcObject.getTracks();
        tracks.forEach((track) => track.stop());
        this.video.srcObject = null;
      }
      this.isCameraActive = false;
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

        const time = Date.now() * 0.002;
        this.arrowGroup.position.y = -0.6 + Math.sin(time) * 0.04;
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

    destroy() {
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
      this.stopCamera();
      if (this.renderer && this.renderer.domElement) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }

  class MapView {
    constructor(mapContainerId) {
      this.containerId = mapContainerId;
      this.map = null;
      this.userMarker = null;
      this.targetMarker = null;
      this.checkpointMarkers = [];

      this.onSelectTargetCallback = null;
      this.onToggleVisitedCallback = null;
      this.isInitialized = false;
    }

    init(defaultLat = 35.681236, defaultLng = 139.767125) {
      if (this.isInitialized || typeof L === 'undefined') return;

      const mapElement = document.getElementById(this.containerId);
      if (!mapElement) return;

      this.map = L.map(this.containerId, {
        zoomControl: false
      }).setView([defaultLat, defaultLng], 15);

      L.control.zoom({ position: 'bottomright' }).addTo(this.map);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      }).addTo(this.map);

      this.map.on('click', (e) => {
        this.setCustomTarget(e.latlng.lat, e.latlng.lng, 'カスタム選択地点');
      });

      this.isInitialized = true;
    }

    renderCheckpoints(checkpoints, activeTargetId = null, visitedIds = new Set()) {
      if (!this.map) return;

      this.checkpointMarkers.forEach((m) => this.map.removeLayer(m));
      this.checkpointMarkers = [];

      checkpoints.forEach((cp) => {
        const isSelected = cp.id === activeTargetId;
        const isVisited = visitedIds && visitedIds.has(cp.id);

        const pinClasses = [
          'cp-pin',
          isSelected ? 'is-active' : '',
          isVisited ? 'is-visited' : '',
        ].filter(Boolean).join(' ');

        const customIcon = L.divIcon({
          className: 'custom-cp-marker',
          html: `
          <div class="${pinClasses}">
            <span class="cp-code">${isVisited ? '✓' : (cp.code || 'CP')}</span>
            <div class="cp-pulse"></div>
          </div>
        `,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });

        const marker = L.marker([cp.lat, cp.lng], { icon: customIcon }).addTo(this.map);

        const visitBtnLabel = isVisited ? '🔄 未訪問に戻す' : '✅ 訪問済みにする';
        const visitBtnClass = isVisited ? 'btn-unvisit' : 'btn-visit';

        const popupContent = `
        <div class="map-popup-card">
          <h4>${cp.name}</h4>
          <p>${cp.description || ''}</p>
          <div class="popup-info">
            <span class="badge-pts">+${cp.points} pts</span>
            ${isVisited ? '<span class="badge-visited">訪問済み</span>' : ''}
          </div>
          <button class="btn-toggle-visited ${visitBtnClass}" data-cpid="${cp.id}">
            ${visitBtnLabel}
          </button>
          <button class="btn-select-target" data-cpid="${cp.id}">
            📍 この地点を目的地に設定
          </button>
        </div>
      `;

        marker.bindPopup(popupContent);
        marker.on('popupopen', () => {
          const btnSelect = document.querySelector(`.btn-select-target[data-cpid="${cp.id}"]`);
          if (btnSelect) {
            btnSelect.addEventListener('click', () => {
              if (this.onSelectTargetCallback) {
                this.onSelectTargetCallback(cp);
              }
              this.map.closePopup();
            });
          }

          const btnToggle = document.querySelector(`.btn-toggle-visited[data-cpid="${cp.id}"]`);
          if (btnToggle) {
            btnToggle.addEventListener('click', () => {
              if (this.onToggleVisitedCallback) {
                this.onToggleVisitedCallback(cp);
              } else if (window.app && window.app.toggleVisited) {
                window.app.toggleVisited(cp.id);
              }
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
          html: '<div class="user-dot"></div><div class="user-pulse"></div>',
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

      if (this.targetMarker) {
        this.map.removeLayer(this.targetMarker);
        this.targetMarker = null;
      }

      if (lat === null || lat === undefined || lng === null || lng === undefined) {
        return;
      }

      const targetIcon = L.divIcon({
        className: 'target-location-marker',
        html: '<div class="target-flag">🏁</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      this.targetMarker = L.marker([lat, lng], { icon: targetIcon, zIndexOffset: 900 }).addTo(this.map);
    }

    setCustomTarget(lat, lng, name = '指定した地点') {
      const customTarget = {
        id: 'custom-' + Date.now(),
        name: name,
        lat: lat,
        lng: lng,
        points: 10,
        description: `座標 (${lat.toFixed(5)}, ${lng.toFixed(5)})`
      };

      this.setTargetLocation(lat, lng, name);
      if (this.onSelectTargetCallback) {
        this.onSelectTargetCallback(customTarget);
      }
    }

    centerOnUser(lat, lng) {
      if (this.map && lat && lng) {
        this.map.flyTo([lat, lng], 16, { duration: 1.2 });
      }
    }

    onSelectTarget(callback) {
      this.onSelectTargetCallback = callback;
    }

    onToggleVisited(callback) {
      this.onToggleVisitedCallback = callback;
    }
  }

  class AppController {
    constructor() {
      const urlCheckpoints = this.loadFromUrlHash();
      this.checkpoints = (urlCheckpoints && urlCheckpoints.length > 0) ? urlCheckpoints : sampleCheckpoints;
      this.currentTarget = this.checkpoints.length > 0 ? this.checkpoints[0] : null;

      this.sensors = new SensorManager();
      this.arViewer = null;
      this.mapView = null;

      this.activeTab = 'ar';

      this.latestBearing = 0;
      this.latestHeading = 0;
      this.latestDistance = null;

      this.visitedIds = this.loadVisitedIds();

      this.initDOM();
      this.bindEvents();
    }

    initDOM() {
      const container = document.getElementById('three-canvas-container');
      const video = document.getElementById('camera-video');
      this.arViewer = new ARCompassViewer(container, video);

      this.mapView = new MapView('leaflet-map');
      const defaultLat = this.currentTarget ? this.currentTarget.lat : 35.681236;
      const defaultLng = this.currentTarget ? this.currentTarget.lng : 139.767125;
      this.mapView.init(defaultLat, defaultLng);

      const targetId = this.currentTarget ? this.currentTarget.id : null;
      this.mapView.renderCheckpoints(this.checkpoints, targetId, this.visitedIds);
      if (this.currentTarget) {
        this.mapView.setTargetLocation(this.currentTarget.lat, this.currentTarget.lng, this.currentTarget.name);
      } else {
        this.mapView.setTargetLocation(null, null);
      }

      this.updateHUDTargetInfo();
      this.updateScoreUI();
      this.setDestination(this.currentTarget);
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

      this.mapView.onToggleVisited((cp) => {
        this.toggleVisited(cp.id);
      });

      document.getElementById('btn-recenter').addEventListener('click', () => {
        if (this.sensors.currentPosition) {
          this.mapView.centerOnUser(this.sensors.currentPosition.lat, this.sensors.currentPosition.lng);
        } else if (this.currentTarget) {
          this.mapView.centerOnUser(this.currentTarget.lat, this.currentTarget.lng);
        } else {
          this.mapView.centerOnUser(35.681236, 139.767125);
        }
      });

      const startBtn = document.getElementById('btn-start-app');
      const overlay = document.getElementById('permission-overlay');

      if (startBtn) {
        startBtn.addEventListener('click', async () => {
          if (overlay) overlay.style.display = 'none';

          try {
            if (this.sensors) await this.sensors.start();
          } catch (e) {
            console.warn('センサー起動エラー:', e);
          }

          try {
            if (this.arViewer) {
              const cameraOk = await this.arViewer.startCamera();
              if (!cameraOk) {
                console.warn('カメラを起動できませんでした。');
              }
            }
          } catch (e) {
            console.warn('カメラ起動エラー:', e);
          }
        });
      }

      this.sensors.onPositionChange((pos) => {
        this.handlePositionUpdate(pos);
      });

      this.sensors.onHeadingChange((heading) => {
        this.handleHeadingUpdate(heading);
      });

      this.sensors.onError((msg) => {
        console.warn('Sensor Warning:', msg);
        const text = document.getElementById('chip-gps-text');
        if (text) text.textContent = 'GPS: エラー';
      });

      this.initQRScanner();
      this.initURLInput();
    }

    initURLInput() {
      const btnInputUrl = document.getElementById('btn-input-url');
      const modal = document.getElementById('url-input-modal');
      const btnCancel = document.getElementById('btn-cancel-url-input');
      const btnLoad = document.getElementById('btn-load-url-course');
      const inputField = document.getElementById('course-url-input');

      if (btnInputUrl) {
        btnInputUrl.addEventListener('click', () => {
          if (modal) {
            modal.classList.add('active');
            if (inputField) inputField.value = '';
          }
        });
      }

      if (btnCancel) {
        btnCancel.addEventListener('click', () => {
          if (modal) modal.classList.remove('active');
        });
      }

      if (btnLoad) {
        btnLoad.addEventListener('click', () => {
          if (!inputField) return;
          const urlStr = inputField.value.trim();
          if (!urlStr) {
            alert('URLを入力してください。');
            return;
          }
          
          try {
            let hashPart = '';
            if (urlStr.includes('#course=')) {
               hashPart = '#course=' + urlStr.split('#course=')[1];
            } else {
               alert('有効なコースURLではありません。(#course= が見つかりません)');
               return;
            }

            window.location.hash = hashPart;
            window.location.reload();
            
          } catch(e) {
            console.error(e);
            alert('URLの解析に失敗しました。');
          }
        });
      }
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

    setDestination(target) {
      this.currentTarget = target;
      this.updateHUDTargetInfo();

      const targetId = target ? target.id : null;
      this.mapView.renderCheckpoints(this.checkpoints, targetId, this.visitedIds);
      if (target) {
        this.mapView.setTargetLocation(target.lat, target.lng, target.name);
      } else {
        this.mapView.setTargetLocation(null, null);
      }

      if (this.sensors.currentPosition) {
        this.handlePositionUpdate(this.sensors.currentPosition);
      }
    }

    updateHUDTargetInfo() {
      const nameEl = document.getElementById('hud-target-name');
      if (nameEl) {
        nameEl.textContent = this.currentTarget ? this.currentTarget.name : '目的地未設定 (コースを読み込んでください)';
      }
    }

    handlePositionUpdate(pos) {
      const dot = document.getElementById('chip-gps-dot');
      const text = document.getElementById('chip-gps-text');
      if (dot) dot.classList.add('active');
      if (text) {
        const accStr = pos.accuracy != null ? ` (±${Math.round(pos.accuracy)}m)` : '';
        text.textContent = `GPS: 測位中${accStr}`;
      }

      this.mapView.updateUserLocation(pos.lat, pos.lng);

      const distEl = document.getElementById('hud-distance-val');
      if (this.currentTarget) {
        this.latestDistance = calculateDistance(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);
        this.latestBearing = calculateBearing(pos.lat, pos.lng, this.currentTarget.lat, this.currentTarget.lng);
        if (distEl) distEl.textContent = formatDistance(this.latestDistance);
      } else {
        this.latestDistance = null;
        this.latestBearing = 0;
        if (distEl) distEl.textContent = '---';
      }

      this.updateARCompassAngle();
    }

    handleHeadingUpdate(heading) {
      const dot = document.getElementById('chip-compass-dot');
      const text = document.getElementById('chip-compass-text');
      if (dot) dot.classList.add('active');
      if (text) text.textContent = `コンパス: ${Math.round(heading)}°`;

      this.latestHeading = heading;
      this.updateARCompassAngle();
    }

    updateARCompassAngle() {
      const relativeAngle = this.latestBearing - this.latestHeading;
      if (this.arViewer) {
        this.arViewer.setRelativeAngle(relativeAngle);
      }
    }

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

        if (this.mapView && this.mapView.map) {
          setTimeout(() => this.mapView.map.invalidateSize(), 200);
        }
      }
    }

    loadFromUrlHash() {
      try {
        const hash = window.location.hash;
        if (!hash || !hash.includes('course=')) return null;

        const base64 = hash.split('course=')[1];
        if (!base64) return null;

        const jsonStr = decodeURIComponent(escape(atob(base64)));
        const data = JSON.parse(jsonStr);

        if (data.p && Array.isArray(data.p)) {
          const checkpoints = data.p.map(cp => ({
            id: cp.i || '',
            name: cp.n || '',
            code: cp.k || '',
            lat: parseFloat(cp.a) || 0,
            lng: parseFloat(cp.g) || 0,
            points: parseInt(cp.s, 10) || 0,
            description: cp.d || '',
          }));

          if (data.c) {
            console.log(`📍 コース読み込み: ${data.c.n || '名称未設定'}`);
            console.log(`⏱️ 制限時間: ${data.c.t || '---'}分`);
            this.courseInfo = {
              name: data.c.n || '',
              timeLimit: data.c.t || 0,
              description: data.c.d || '',
            };
          }

          console.log(`✅ URLから${checkpoints.length}個のチェックポイントを読み込みました`);
          return checkpoints.length > 0 ? checkpoints : null;
        }

        return null;
      } catch (e) {
        console.warn('URLハッシュからのデータ読み込みに失敗:', e);
        return null;
      }
    }

    loadVisitedIds() {
      try {
        const saved = localStorage.getItem('armaps_visited_cps');
        if (saved) {
          return new Set(JSON.parse(saved));
        }
      } catch (e) {
        console.warn('訪問済みデータの読み込みに失敗:', e);
      }
      return new Set();
    }

    saveVisitedIds() {
      try {
        localStorage.setItem('armaps_visited_cps', JSON.stringify([...this.visitedIds]));
      } catch (e) {
        console.warn('訪問済みデータの保存に失敗:', e);
      }
    }

    toggleVisited(cpId) {
      if (this.visitedIds.has(cpId)) {
        this.visitedIds.delete(cpId);
      } else {
        this.visitedIds.add(cpId);
      }
      this.saveVisitedIds();
      this.updateScoreUI();

      const targetId = this.currentTarget ? this.currentTarget.id : null;
      this.mapView.renderCheckpoints(this.checkpoints, targetId, this.visitedIds);
      if (this.currentTarget) {
        this.mapView.setTargetLocation(this.currentTarget.lat, this.currentTarget.lng, this.currentTarget.name);
      } else {
        this.mapView.setTargetLocation(null, null);
      }
    }

    updateScoreUI() {
      let totalScore = 0;
      if (this.checkpoints && Array.isArray(this.checkpoints)) {
        this.checkpoints.forEach((cp) => {
          if (this.visitedIds && this.visitedIds.has(cp.id)) {
            totalScore += (cp.points || 0);
          }
        });
      }

      const scoreValEl = document.getElementById('total-score-val');
      if (scoreValEl) {
        scoreValEl.textContent = `${totalScore} pts`;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
  });

})(THREE);
