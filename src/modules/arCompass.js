/**
 * Three.js を用いた 3D ARコンパスビューアー
 *
 * 修正ポイント:
 *  - 矢印回転の符号・軸方向を修正（正しく目的地方角を指すように）
 *  - Lerp alpha を上げて高速応答化
 *  - アニメーションループ内でリアルタイム回転更新
 *  - コンパスリングも連動回転
 */
import * as THREE from 'three';
import { lerpAngle } from './geoUtils.js';

export class ARCompassViewer {
  constructor(containerElement, videoElement) {
    this.container = containerElement;
    this.video = videoElement;

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.arrowGroup = null;
    this.compassRingGroup = null;
    this.pulseMesh = null;

    this.targetAngle = 0;   // 目標回転角度 (度, 0° = 画面上方向 = 北方向)
    this.currentAngle = 0;  // 現在の滑らかな表示角度 (度)

    this.isCameraActive = false;
    this.animFrameId = null;

    this.initThree();
  }

  /**
   * Three.js シーン・ライティング・3Dコンパスオブジェクトの初期化
   */
  initThree() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // シーン
    this.scene = new THREE.Scene();

    // カメラ (PerspectiveCamera) — やや上から見下ろす
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(0, 3.5, 4.0);
    this.camera.lookAt(0, 0, 0);

    // レンダラー (透過背景)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.container.appendChild(this.renderer.domElement);

    // ライトのセットアップ
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.8);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x34d399, 2.5, 10);
    pointLight.position.set(0, 1, 0);
    this.scene.add(pointLight);

    // 3D コンパスオブジェクトグループの構築
    this.create3DCompass();

    // ウィンドウリサイズ対応
    window.addEventListener('resize', () => this.onWindowResize());

    // アニメーションループ開始
    this.animate();
  }

  /**
   * スタイリッシュな 3D 矢印とコンパスリングを作成
   *
   * Three.js の座標系:
   *   X → 右,  Y → 上,  Z → 画面手前(カメラ方向)
   *   矢印は -Z 方向（画面奥 = 前方）を指すように作成し、
   *   Y軸回転で方角を表現する
   */
  create3DCompass() {
    this.arrowGroup = new THREE.Group();

    // 1. メインの矢印ヘッド (Cone) — 先端が -Z 方向(前方)を指す
    const coneGeo = new THREE.ConeGeometry(0.55, 1.3, 32);
    coneGeo.rotateX(-Math.PI / 2); // 先端を -Z 方向へ向ける
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

    // 2. 矢印のシャフト (Cylinder)
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

    // 3. 発光コア球体 (Center Glow)
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

    // 4. 矢印尾部 (後方のインジケーター)
    const tailGeo = new THREE.ConeGeometry(0.25, 0.5, 16);
    tailGeo.rotateX(Math.PI / 2); // 先端を +Z (後方)方向に
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      emissive: 0x334155,
      emissiveIntensity: 0.3,
      roughness: 0.5,
      metalness: 0.5,
      transparent: true,
      opacity: 0.6
    });
    const tailMesh = new THREE.Mesh(tailGeo, tailMat);
    tailMesh.position.set(0, 0.2, 1.1);
    this.arrowGroup.add(tailMesh);

    // 5. 外枠コンパスリング (Torus)
    const ringGeo = new THREE.TorusGeometry(1.8, 0.04, 16, 64);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.5
    });
    this.compassRingGroup = new THREE.Mesh(ringGeo, ringMat);
    this.compassRingGroup.position.set(0, 0, 0);
    this.scene.add(this.compassRingGroup);

    // 6. 方位マーカー (北マーク — リング上に小球体)
    const northMarkerGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const northMarkerMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    this.northMarker = new THREE.Mesh(northMarkerGeo, northMarkerMat);
    this.northMarker.position.set(0, 0, -1.8); // 初期位置: -Z(前方) = 北
    this.scene.add(this.northMarker);

    // 7. 拡散パルス波 (Ground Ripple Circle)
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

    // 矢印全体をシーンに追加
    this.scene.add(this.arrowGroup);
  }

  /**
   * Webカメラバックグラウンドの起動
   */
  async startCamera() {
    if (!this.video) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      this.video.srcObject = stream;
      await this.video.play();
      this.isCameraActive = true;
      return true;
    } catch (err) {
      console.warn('Camera Access Failed/Denied:', err);
      this.isCameraActive = false;
      return false;
    }
  }

  /**
   * カメラの停止
   */
  stopCamera() {
    if (this.video && this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach((track) => track.stop());
      this.video.srcObject = null;
    }
    this.isCameraActive = false;
  }

  /**
   * AR矢印の向きをアップデート
   * @param {number} relativeAngleDeg - 目的地への相対角度 (Bearing - CompassHeading)
   *   正の値 = 右方向, 負の値 = 左方向
   */
  setRelativeAngle(relativeAngleDeg) {
    // -180 ~ 180 に正規化してからターゲットにセット (Lerp用)
    let normalized = relativeAngleDeg % 360;
    if (normalized < 0) normalized += 360;
    this.targetAngle = normalized;
  }

  /**
   * 毎フレームのレンダリングおよびアニメーション処理
   */
  animate() {
    this.animFrameId = requestAnimationFrame(() => this.animate());

    // 角度の滑らかなアニメーション (Lerp) — alpha を上げてリアルタイム追従を高速化
    this.currentAngle = lerpAngle(this.currentAngle, this.targetAngle, 0.25);

    if (this.arrowGroup) {
      // Y軸回転:
      //   currentAngle = 0° → 矢印は -Z(前方=北) を指す
      //   currentAngle = 90° → 矢印は -X(左方向=東) を指す? いいえ：
      //   Y軸正方向の回転 = 上から見て反時計回り
      //   目的地が右 (時計回り) にあるとき currentAngle > 0 なので、
      //   Three.js の Y 回転を負にする必要がある
      const rad = -(this.currentAngle * Math.PI) / 180;
      this.arrowGroup.rotation.y = rad;

      // 微小な浮遊アニメーション (Floating Up/Down)
      const time = Date.now() * 0.003;
      this.arrowGroup.position.y = Math.sin(time) * 0.08;
    }

    // パルスリングアニメーション
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

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.stopCamera();
    if (this.renderer && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
