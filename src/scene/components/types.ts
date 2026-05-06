import type * as THREE from 'three';

export type ComponentMode = 'face' | 'edge' | 'vertex';

/**
 * Edge key. Two welded vertex indices joined by '-' with the smaller first.
 * E.g. edgeKey(7, 3) === '3-7'.
 */
export type EdgeKey = string;

export function edgeKey(a: number, b: number): EdgeKey {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function parseEdgeKey(k: EdgeKey): [number, number] {
  const i = k.indexOf('-');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

/** Per-mesh component selection sets. */
export interface MeshComponentState {
  faces: Set<number>;
  edges: Set<EdgeKey>;
  vertices: Set<number>;
}

export interface SeedRef {
  mesh: THREE.Mesh;
  kind: ComponentMode;
  /** Triangle index for 'face', edge key for 'edge', welded vertex index for 'vertex'. */
  key: number | string;
}
