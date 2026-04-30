import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { Selection } from '../scene/Selection.js';
import { SelectionVisuals } from '../scene/SelectionVisuals.js';
import { Isolation } from '../scene/Isolation.js';
import { TransformGizmo } from '../scene/TransformGizmo.js';
import { isLocked, setLocked } from '../scene/objectMeta.js';
import { duplicateObject } from '../scene/operations.js';

export class Editor {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  /** Root group for the currently-loaded model. Swapped on each new import. */
  modelRoot: THREE.Group;

  /** Animation clips that came with the loaded model (e.g. from glTF). */
  animations: THREE.AnimationClip[] = [];

  readonly selection = new Selection();
  readonly selectionVisuals: SelectionVisuals;
  readonly isolation = new Isolation();
  readonly gizmo: TransformGizmo;

  /** Fired after a scene-tree-relevant change (visibility, lock, hierarchy). */
  private readonly treeListeners = new Set<() => void>();

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

    this.selectionVisuals = new SelectionVisuals(this.scene, this.selection);
    this.gizmo = new TransformGizmo(this.camera, this.renderer.domElement, this.scene, this.controls);

    // Keep gizmo's attached object in sync with the primary selection.
    this.selection.on(() => {
      this.gizmo.attach(this.selection.primary() ?? null);
    });

    // Update selection wireframes during gizmo drag.
    this.gizmo.onChange(() => this.selectionVisuals.refresh());

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

  /** Subscribe to scene-tree-relevant changes. Returns an unsubscribe fn. */
  onTreeChanged(fn: () => void): () => void {
    this.treeListeners.add(fn);
    return () => this.treeListeners.delete(fn);
  }

  private emitTreeChanged() {
    for (const fn of this.treeListeners) fn();
  }

  /** Replace the current model with a new root, then frame the camera on it. */
  setModel(root: THREE.Object3D, animations: THREE.AnimationClip[] = []) {
    this.isolation.exit(this.modelRoot);
    this.selection.clear();
    this.modelRoot.clear();
    this.modelRoot.add(root);
    this.animations = animations;
    this.frameOnObject(root);
    this.emitTreeChanged();
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

  // ---- Object-level operations ----

  toggleVisibility(obj: THREE.Object3D) {
    obj.visible = !obj.visible;
    this.selectionVisuals.refresh();
    this.emitTreeChanged();
  }

  toggleLock(obj: THREE.Object3D) {
    setLocked(obj, !isLocked(obj));
    if (isLocked(obj) && this.gizmo.controls.object === obj) {
      this.gizmo.detach();
    } else if (!isLocked(obj) && this.selection.primary() === obj) {
      this.gizmo.attach(obj);
    }
    this.emitTreeChanged();
  }

  isolateSelection() {
    const targets = this.selection.all();
    if (targets.length === 0) return;
    this.isolation.enter(targets, this.modelRoot);
    this.selectionVisuals.refresh();
    this.emitTreeChanged();
  }

  exitIsolate() {
    if (!this.isolation.isActive()) return;
    this.isolation.exit(this.modelRoot);
    this.selectionVisuals.refresh();
    this.emitTreeChanged();
  }

  duplicateSelection(): THREE.Object3D[] {
    const sources = [...this.selection.all()];
    const created: THREE.Object3D[] = [];
    for (const src of sources) {
      const copy = duplicateObject(src);
      if (copy) created.push(copy);
    }
    if (created.length > 0) {
      this.selection.clear();
      for (const c of created) this.selection.add(c);
      this.emitTreeChanged();
    }
    return created;
  }
}
