/**
 * Three.js を用いた 3D ARコンパスビューアー (シンプル赤色矢印・円リング付き・画面中央下配置)
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

    this.targetAngle = 0;   // 目標回転角度 (度)
    this.currentAngle = 0;  // 現在の滑らかな表示角度 (度)

    this.isCameraActive = false;
    this.animFrameId = null;

    this.initThree();
  }

  initThree() {
    if (typeof THREE === 'undefined') return;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // シーン
    this.scene = new THREE.Scene();

    // カメラ (画面中央下を見下ろすアングル)
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(0, 3.2, 4.0);
    this.camera.lookAt(0, 0.6, 0);

    // レンダラー
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.container.appendChild(this.renderer.domElement);

    // ライティング
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);

    // 3D 矢印 & 円リングの構築
    this.create3DCompass();

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();
  }

  /**
   * シンプルな赤色の 3D ナビゲーション矢印と周囲の円リングを作成
   */
  create3DCompass() {
    this.arrowGroup = new THREE.Group();
    this.arrowGroup.position.set(0, -0.6, 0.5); // 画面中央下に配置

    // シンプルな矢印の押出形状 (Extrude Shape)
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.4);        // 先端 (前方)
    shape.lineTo(0.55, 0.45);    // 右ウイング
    shape.lineTo(0.22, 0.45);    // 右インナー
    shape.lineTo(0.22, -0.8);    // 右シャフト
    shape.lineTo(-0.22, -0.8);   // 左シャフト
    shape.lineTo(-0.22, 0.45);   // 左インナー
    shape.lineTo(-0.55, 0.45);   // 左ウイング
    shape.closePath();

    const extrudeSettings = {
      depth: 0.2,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.03,
      bevelThickness: 0.03,
    };

    const arrowGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    arrowGeo.center();
    arrowGeo.rotateX(-Math.PI / 2); // 先端が -Z (前方) を指すように回転

    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,        // 鮮やかな赤色
      emissive: 0x7f1d1d,     // 深い赤のエミッシブ
      emissiveIntensity: 0.35,
      roughness: 0.25,
      metalness: 0.4,
    });

    const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
    this.arrowGroup.add(arrowMesh);

    // 矢印の周囲に円 (Ring Geometry) を追加
    const ringGeo = new THREE.RingGeometry(1.3, 1.36, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
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

      // 画面中央下でなめらかに浮遊
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
