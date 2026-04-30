import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { isLocked } from './objectMeta.js';

export type TransformMode = 'translate' | 'rotate' | 'scale';

/**
 * Thin wrapper over THREE.TransformControls. Refuses to attach to locked
 * objects, suspends OrbitControls during a drag, and exposes the change
 * stream so listeners (selection box helpers, scene tree) can refresh.
 */
export class TransformGizmo {
  readonly controls: TransformControls;
  private current: THREE.Object3D | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    orbit: OrbitControls,
  ) {
    this.controls = new TransformControls(camera, domElement);
    scene.add(this.controls.getHelper());

    this.controls.addEventListener('mouseDown', () => { orbit.enabled = false; });
    this.controls.addEventListener('mouseUp',   () => { orbit.enabled = true;  });
    this.controls.addEventListener('change', () => {
      for (const fn of this.listeners) fn();
    });
  }

  /** Subscribe to gizmo 'change' events (drag + every transform tweak). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  attach(obj: THREE.Object3D | null): void {
    if (this.current === obj) return;
    if (!obj || isLocked(obj)) {
      this.controls.detach();
      this.current = null;
      return;
    }
    this.controls.attach(obj);
    this.current = obj;
  }

  detach(): void {
    this.controls.detach();
    this.current = null;
  }

  setMode(mode: TransformMode): void {
    this.controls.setMode(mode);
  }

  getMode(): TransformMode {
    return this.controls.mode as TransformMode;
  }

  /** True while a gizmo handle is being dragged. */
  isDragging(): boolean {
    return (this.controls as unknown as { dragging?: boolean }).dragging === true;
  }

  /** Non-null while a gizmo handle is hovered (used to gate viewport picking). */
  hoveredAxis(): string | null {
    return (this.controls as unknown as { axis: string | null }).axis;
  }
}
