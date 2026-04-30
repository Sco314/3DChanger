import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Editor {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  /** Root group for the currently-loaded model. Swapped on each new import. */
  modelRoot: THREE.Group;

  /** Animation clips that came with the loaded model (e.g. from glTF). */
  animations: THREE.AnimationClip[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202428);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.camera.position.set(3, 2, 4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 6, 3);
    this.scene.add(key);
    this.scene.add(new THREE.GridHelper(10, 20, 0x444444, 0x2a2a2a));

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'modelRoot';
    this.scene.add(this.modelRoot);

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  handleResize() {
    const c = this.renderer.domElement.parentElement!;
    const w = c.clientWidth;
    const h = c.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Replace the current model with a new root, then frame the camera on it. */
  setModel(root: THREE.Object3D, animations: THREE.AnimationClip[] = []) {
    this.modelRoot.clear();
    this.modelRoot.add(root);
    this.animations = animations;
    this.frameOnObject(root);
  }

  frameOnObject(obj: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(obj);
    if (!isFinite(box.min.x) || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    this.camera.near = Math.max(maxDim / 1000, 0.001);
    this.camera.far = Math.max(maxDim * 100, 100);
    this.camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.6, dist));
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }
}
