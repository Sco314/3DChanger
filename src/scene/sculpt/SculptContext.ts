import * as THREE from 'three';

import { getAdjacency } from '../components/MeshAdjacency.js';

/**
 * Per-mesh sculpt cache. Built lazily on first stroke; reused across
 * strokes on the same mesh. Stored on geometry.userData so it survives
 * scene-tree updates but is dropped when the geometry is replaced.
 *
 * Brushes operate in *welded* vertex space so STLs and other non-indexed
 * meshes don't crack: a single "logical vertex" (positions deduped within
 * EPS by MeshAdjacency) maps to one or more raw vertices, and any delta
 * is written to all of them so triangles meeting at that vertex stay
 * coincident.
 */
export interface SculptCache {
  weldedCount: number;
  /** xyz per welded id, mirrors raw position attribute for the welded set. */
  weldedPos: Float32Array;
  /** weldedToRaw[w] = list of raw vertex indices that share welded id w. */
  weldedToRaw: number[][];
  /** weldedNeighbors[w] = list of welded ids that share an edge with w. */
  weldedNeighbors: number[][];
  /** Per-welded-vertex mask, 0=unmasked, 1=fully masked (protected). */
  mask: Float32Array;
}

const SCULPT_KEY = '__editor_sculpt__';

interface CacheHolder {
  [SCULPT_KEY]?: SculptCache;
}

/**
 * Convert an interleaved position attribute to a flat one in place. Brushes
 * mutate position via setXYZ which is only on the flat BufferAttribute.
 * Other attributes (normal, uv, color) are left untouched — UVs are
 * preserved, which is the whole point.
 */
export function ensureFlatPositionAttribute(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const a = geometry.attributes.position;
  if (!a) {
    throw new Error('Mesh has no position attribute; cannot sculpt');
  }
  const interleaved = (a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute;
  if (!interleaved) return a as THREE.BufferAttribute;

  const flat = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    flat[i * 3]     = a.getX(i);
    flat[i * 3 + 1] = a.getY(i);
    flat[i * 3 + 2] = a.getZ(i);
  }
  const next = new THREE.BufferAttribute(flat, 3);
  geometry.setAttribute('position', next);
  return next;
}

export function getSculptCache(mesh: THREE.Mesh): SculptCache {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const holder = geometry.userData as CacheHolder;
  if (holder[SCULPT_KEY]) return holder[SCULPT_KEY]!;

  ensureFlatPositionAttribute(geometry);
  const adj = getAdjacency(mesh);
  const positionAttr = geometry.attributes.position as THREE.BufferAttribute;

  // Walk welded face verts to find the highest welded id and group raw verts
  // by it.
  const weldedToRaw: number[][] = [];
  let weldedCount = 0;
  for (let i = 0; i < adj.weldedFaceVerts.length; i++) {
    const w = adj.weldedFaceVerts[i]!;
    if (w + 1 > weldedCount) weldedCount = w + 1;
    if (!weldedToRaw[w]) weldedToRaw[w] = [];
    const raw = adj.faceVerts[i]!;
    if (!weldedToRaw[w].includes(raw)) weldedToRaw[w].push(raw);
  }

  // Welded position table: take the first raw vertex per welded id as the
  // representative.
  const weldedPos = new Float32Array(weldedCount * 3);
  for (let w = 0; w < weldedCount; w++) {
    const raws = weldedToRaw[w];
    if (!raws || raws.length === 0) continue;
    const r = raws[0]!;
    weldedPos[w * 3]     = positionAttr.getX(r);
    weldedPos[w * 3 + 1] = positionAttr.getY(r);
    weldedPos[w * 3 + 2] = positionAttr.getZ(r);
  }

  // Welded neighbors: edge-adjacent welded ids derived from triangle edges
  // in the welded face vert table.
  const neighborSets: Set<number>[] = new Array(weldedCount);
  for (let w = 0; w < weldedCount; w++) neighborSets[w] = new Set();
  const fc = adj.faceCount;
  for (let f = 0; f < fc; f++) {
    const a = adj.weldedFaceVerts[f * 3]!;
    const b = adj.weldedFaceVerts[f * 3 + 1]!;
    const c = adj.weldedFaceVerts[f * 3 + 2]!;
    if (a !== b) { neighborSets[a]!.add(b); neighborSets[b]!.add(a); }
    if (b !== c) { neighborSets[b]!.add(c); neighborSets[c]!.add(b); }
    if (c !== a) { neighborSets[c]!.add(a); neighborSets[a]!.add(c); }
  }
  const weldedNeighbors: number[][] = neighborSets.map((s) => [...s]);

  const cache: SculptCache = {
    weldedCount,
    weldedPos,
    weldedToRaw,
    weldedNeighbors,
    mask: new Float32Array(weldedCount), // 0 by default = unmasked
  };
  holder[SCULPT_KEY] = cache;
  return cache;
}

/** Drop the cached sculpt data. Call after destructive geometry edits. */
export function invalidateSculptCache(mesh: THREE.Mesh): void {
  const holder = (mesh.geometry as THREE.BufferGeometry).userData as CacheHolder;
  delete holder[SCULPT_KEY];
}

/**
 * Write a delta back to all raw vertex indices that share a welded id, so
 * non-indexed meshes (STL) don't crack along triangle boundaries.
 */
export function applyWeldedDelta(
  cache: SculptCache,
  positionAttr: THREE.BufferAttribute,
  weldedId: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  // Update the welded representative.
  cache.weldedPos[weldedId * 3]     += dx;
  cache.weldedPos[weldedId * 3 + 1] += dy;
  cache.weldedPos[weldedId * 3 + 2] += dz;

  // Mirror to all raw indices.
  const raws = cache.weldedToRaw[weldedId];
  if (!raws) return;
  for (const r of raws) {
    positionAttr.setXYZ(
      r,
      positionAttr.getX(r) + dx,
      positionAttr.getY(r) + dy,
      positionAttr.getZ(r) + dz,
    );
  }
}

/**
 * Standard smoothstep falloff: 1 at the brush center, 0 at the edge,
 * with a smooth roll-off. distance and radius in the same units.
 */
export function falloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = Math.max(0, Math.min(1, 1 - distance / radius));
  return t * t * (3 - 2 * t);
}
