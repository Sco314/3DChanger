import type * as THREE from 'three';

export type BrushKind = 'inflate' | 'smooth' | 'flatten' | 'pinch' | 'grab' | 'mask';

export interface BrushParams {
  /** Brush sphere radius in mesh-local units. */
  radius: number;
  /** Per-step intensity, 0..1. */
  strength: number;
}

/**
 * The hit point + surface normal of the brush, in *mesh-local* space. Brush
 * radius queries also operate in mesh-local space so non-uniform world
 * scaling on the parent transform doesn't deform the brush footprint.
 */
export interface BrushHit {
  positionLocal: THREE.Vector3;
  normalLocal: THREE.Vector3;
}
