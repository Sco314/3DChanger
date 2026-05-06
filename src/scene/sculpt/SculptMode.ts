import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { invalidateAdjacency } from '../components/MeshAdjacency.js';
import { SculptCursor } from './SculptCursor.js';
import { getSculptCache, invalidateSculptCache } from './SculptContext.js';
import {
  BrushBase,
  MaskBrush,
  makeBrush,
  type SculptStrokeContext,
} from './brushes.js';
import type { BrushHit, BrushKind, BrushParams } from './types.js';

const NDC = new THREE.Vector2();
const RAY = new THREE.Raycaster();
const TMP_INV_MAT = new THREE.Matrix4();
const TMP_NORMAL_MAT = new THREE.Matrix3();

/**
 * Sculpt mode controller. Owns:
 *   - the active brush instance and parameters
 *   - the active target Mesh (whichever was selected when sculpting starts)
 *   - the cursor preview ring on hover
 *   - pointer handlers for drag strokes
 *
 * Pointer handlers attach to the canvas at construction time but only react
 * when `enabled` is true. The mode controller suspends OrbitControls during
 * a stroke and is responsible for invalidating the mesh's adjacency cache
 * and recomputing normals when the stroke ends.
 */
export class SculptMode {
  enabled = false;

  /** Recompute vertex normals at end of every stroke. Default on. */
  recomputeNormalsAfterStroke = true;

  params: BrushParams = { radius: 0.1, strength: 0.5 };

  private kind: BrushKind = 'inflate';
  private brush: BrushBase = makeBrush('inflate');
  private cursor: SculptCursor;
  private stroking = false;
  private strokeMesh: THREE.Mesh | null = null;
  private prevHit: BrushHit | null = null;
  private autoRadiusSet = false;

  private readonly listeners = new Set<() => void>();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly domElement: HTMLElement,
    private readonly orbit: OrbitControls,
    private readonly getActiveMesh: () => THREE.Mesh | null,
  ) {
    this.cursor = new SculptCursor(scene);

    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup',   this.onPointerUp);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup',   this.onPointerUp);
    this.cursor.dispose();
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.cursor.setVisible(false);
      this.endStrokeIfActive();
    } else {
      // First time enabling on a new mesh: auto-pick a sensible radius.
      this.maybeAutoRadius();
    }
    this.emit();
  }

  setBrush(kind: BrushKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.brush = makeBrush(kind);
    this.emit();
  }

  getBrush(): BrushKind { return this.kind; }

  setRadius(r: number): void {
    this.params.radius = Math.max(1e-6, r);
    this.emit();
  }
  setStrength(s: number): void {
    this.params.strength = Math.max(0, Math.min(1, s));
    this.emit();
  }

  setInvertMask(inv: boolean): void {
    if (this.brush instanceof MaskBrush) this.brush.invert = inv;
  }

  /** Reset every per-vertex mask on the active mesh's sculpt cache to 0. */
  clearMask(): void {
    const mesh = this.getActiveMesh();
    if (!mesh) return;
    const cache = getSculptCache(mesh);
    cache.mask.fill(0);
  }

  /** Pick an initial radius if the user hasn't tuned one. */
  private maybeAutoRadius(): void {
    if (this.autoRadiusSet) return;
    const mesh = this.getActiveMesh();
    if (!mesh) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    geom.computeBoundingSphere();
    const r = geom.boundingSphere?.radius ?? 1;
    this.params.radius = r * 0.08;
    this.autoRadiusSet = true;
    this.emit();
  }

  // ---- pointer handlers ----

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.stroking && this.strokeMesh) {
      const hit = this.raycastMesh(e, this.strokeMesh);
      if (!hit) return;
      this.applyStrokeStep(hit);
      this.updateCursorOnMesh(this.strokeMesh, hit);
      return;
    }
    // Hover update.
    const mesh = this.getActiveMesh();
    if (!mesh) {
      this.cursor.setVisible(false);
      return;
    }
    const hit = this.raycastMesh(e, mesh);
    if (!hit) { this.cursor.setVisible(false); return; }
    this.updateCursorOnMesh(mesh, hit);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button !== 0) return;
    const mesh = this.getActiveMesh();
    if (!mesh) return;
    const hit = this.raycastMesh(e, mesh);
    if (!hit) return;

    this.strokeMesh = mesh;
    this.stroking = true;
    this.prevHit = null;
    this.orbit.enabled = false;
    (this.domElement as HTMLElement).setPointerCapture?.(e.pointerId);

    const ctx = this.makeStrokeContext(mesh);
    this.brush.beginStroke(ctx, hit);
    this.applyStrokeStep(hit);
  };

  private onPointerUp = (_e: PointerEvent): void => {
    this.endStrokeIfActive();
  };

  private endStrokeIfActive(): void {
    if (!this.stroking) return;
    const mesh = this.strokeMesh;
    this.stroking = false;
    this.prevHit = null;
    this.orbit.enabled = true;
    if (mesh) {
      const ctx = this.makeStrokeContext(mesh);
      this.brush.endStroke(ctx);
      const geom = mesh.geometry as THREE.BufferGeometry;
      if (this.recomputeNormalsAfterStroke && !(this.brush instanceof MaskBrush)) {
        geom.computeVertexNormals();
      }
      geom.computeBoundingSphere();
      geom.computeBoundingBox();
      // Adjacency face normals / material slot caches may be stale.
      invalidateAdjacency(mesh);
      // Sculpt cache stays valid: positions changed but topology / mask /
      // welded mapping are unchanged.
    }
    this.strokeMesh = null;
  }

  private applyStrokeStep(hit: BrushHit): void {
    if (!this.strokeMesh) return;
    const ctx = this.makeStrokeContext(this.strokeMesh);
    this.brush.applyStep(ctx, hit, this.prevHit);
    this.prevHit = { positionLocal: hit.positionLocal.clone(), normalLocal: hit.normalLocal.clone() };
  }

  private makeStrokeContext(mesh: THREE.Mesh): SculptStrokeContext {
    const cache = getSculptCache(mesh);
    const positionAttr = (mesh.geometry as THREE.BufferGeometry)
      .attributes.position as THREE.BufferAttribute;
    return { mesh, positionAttr, cache, params: this.params };
  }

  private raycastMesh(e: PointerEvent, mesh: THREE.Mesh): BrushHit | null {
    const rect = this.domElement.getBoundingClientRect();
    NDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    NDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    RAY.setFromCamera(NDC, this.camera);
    // Restrict the ray to the active mesh so other scene items don't steal
    // hovers / picks during a stroke.
    const hits = RAY.intersectObject(mesh, true);
    for (const h of hits) {
      if (h.faceIndex == null) continue;
      mesh.updateMatrixWorld();
      TMP_INV_MAT.copy(mesh.matrixWorld).invert();
      const localPoint = h.point.clone().applyMatrix4(TMP_INV_MAT);
      // Transform world-space normal into mesh-local using the inverse
      // transpose. h.face?.normal is already in object-local in modern
      // three.js when the face came from a Mesh, but to be safe use the
      // surface normal at the hit point computed from the face.
      const nWorld = (h.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone();
      TMP_NORMAL_MAT.getNormalMatrix(TMP_INV_MAT);
      // h.face.normal is already in mesh-local; just normalize it.
      nWorld.normalize();
      return { positionLocal: localPoint, normalLocal: nWorld };
    }
    return null;
  }

  private updateCursorOnMesh(mesh: THREE.Mesh, hit: BrushHit): void {
    mesh.updateMatrixWorld();
    const worldPos = hit.positionLocal.clone().applyMatrix4(mesh.matrixWorld);
    // Approximate world normal by transforming the local normal through
    // the normal matrix.
    TMP_NORMAL_MAT.getNormalMatrix(mesh.matrixWorld);
    const worldNormal = hit.normalLocal.clone().applyMatrix3(TMP_NORMAL_MAT).normalize();
    // Approximate world radius assuming roughly uniform scale.
    const scale = mesh.matrixWorld.getMaxScaleOnAxis();
    this.cursor.set(worldPos, worldNormal, this.params.radius * scale);
  }

}

/**
 * Drop the sculpt cache for a mesh. Call after destructive geometry edits
 * (slice 4 ops) or on import of a fresh mesh.
 */
export function invalidateSculpt(mesh: THREE.Mesh): void {
  invalidateSculptCache(mesh);
}
