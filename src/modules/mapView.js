/**
 * Leaflet.js 地図ビューアおよびチェックポイント選択モジュール
 */

export class MapView {
  constructor(mapContainerId) {
    this.containerId = mapContainerId;
    this.map = null;
    this.userMarker = null;
    this.targetMarker = null;
    this.checkpointMarkers = [];

    this.onSelectTargetCallback = null;
    this.isInitialized = false;
  }

  /**
   * マップの初期化
   */
  init(defaultLat = 35.681236, defaultLng = 139.767125) {
    if (this.isInitialized || typeof L === 'undefined') return;

    const mapElement = document.getElementById(this.containerId);
    if (!mapElement) return;

    // Leaflet マップ初期化
    this.map = L.map(this.containerId, {
      zoomControl: false
    }).setView([defaultLat, defaultLng], 15);

    // ZoomControlを右下に移動
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // タイルレイヤー (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
    }).addTo(this.map);

    // マップタップイベント: 任意の場所を目的地に設定
    this.map.on('click', (e) => {
      this.setCustomTarget(e.latlng.lat, e.latlng.lng, 'カスタム選択地点');
    });

    this.isInitialized = true;
  }

  /**
   * チェックポイント一覧をマップ上にピン配置
   */
  renderCheckpoints(checkpoints, activeTargetId = null) {
    if (!this.map) return;

    // 既存のCPマーカーを削除
    this.checkpointMarkers.forEach((m) => this.map.removeLayer(m));
    this.checkpointMarkers = [];

    checkpoints.forEach((cp) => {
      const isSelected = cp.id === activeTargetId;

      // アイコンスタイル定義
      const customIcon = L.divIcon({
        className: 'custom-cp-marker',
        html: `
          <div class="cp-pin ${isSelected ? 'is-active' : ''}">
            <span class="cp-code">${cp.code || 'CP'}</span>
            <div class="cp-pulse"></div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      const marker = L.marker([cp.lat, cp.lng], { icon: customIcon }).addTo(this.map);

      // ポップアップ内容
      const popupContent = `
        <div class="map-popup-card">
          <h4>${cp.name}</h4>
          <p>${cp.description || ''}</p>
          <div class="popup-info">
            <span class="badge-pts">+${cp.points} pts</span>
          </div>
          <button class="btn-select-target" data-cpid="${cp.id}">
            📍 この地点を目的地に設定
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('popupopen', () => {
        const btn = document.querySelector(`.btn-select-target[data-cpid="${cp.id}"]`);
        if (btn) {
          btn.addEventListener('click', () => {
            if (this.onSelectTargetCallback) {
              this.onSelectTargetCallback(cp);
            }
            this.map.closePopup();
          });
        }
      });

      this.checkpointMarkers.push(marker);
    });
  }

  /**
   * 現在地の青丸マーカー更新
   */
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

  /**
   * 目的地マーカーの更新
   */
  setTargetLocation(lat, lng, label = '目的地') {
    if (!this.map) return;

    if (this.targetMarker) {
      this.map.removeLayer(this.targetMarker);
    }

    const targetIcon = L.divIcon({
      className: 'target-location-marker',
      html: '<div class="target-flag">🏁</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });

    this.targetMarker = L.marker([lat, lng], { icon: targetIcon, zIndexOffset: 900 }).addTo(this.map);
  }

  /**
   * 任意のタップ地点を目的地にセット
   */
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

  /**
   * 中心を現在地にフォーカス
   */
  centerOnUser(lat, lng) {
    if (this.map && lat && lng) {
      this.map.flyTo([lat, lng], 16, { duration: 1.2 });
    }
  }

  onSelectTarget(callback) {
    this.onSelectTargetCallback = callback;
  }
}
