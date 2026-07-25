/**
 * PCブラウザテスト用 センサーシミュレーター & デバッグパネル
 */

export class DebugPanel {
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
          <p class="debug-desc">PCなどのセンサー非搭載環境で、端末の向きや現在地をシミュレーションしてAR矢印の挙動を確認できます。</p>
          
          <div class="debug-control-group">
            <label>端末の向き (Compass Heading): <span id="debug-heading-val">0°</span></label>
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

          <div class="debug-status-info">
            <div>GPS状態: <strong id="debug-gps-status">シミュレート中</strong></div>
            <div>コンパス: <strong id="debug-compass-status">手動設定</strong></div>
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

    const headingVal = document.getElementById('debug-heading-val');
    const latVal = document.getElementById('debug-lat-val');
    const lngVal = document.getElementById('debug-lng-val');

    headingSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      headingVal.textContent = `${val}°`;
      this.sensors.setManualHeading(val);
    });

    latSlider.addEventListener('input', (e) => {
      this.simLat = parseFloat(e.target.value);
      latVal.textContent = this.simLat.toFixed(5);
      this.sensors.setManualPosition(this.simLat, this.simLng);
    });

    lngSlider.addEventListener('input', (e) => {
      this.simLng = parseFloat(e.target.value);
      lngVal.textContent = this.simLng.toFixed(5);
      this.sensors.setManualPosition(this.simLat, this.simLng);
    });
  }
}
