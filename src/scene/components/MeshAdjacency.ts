import * as THREE from 'three';

import { edgeKey, type EdgeKey } from './types.js';

/**
 * Per-mesh derived data we need for component selection / flood fills /
 * by-material / hard-edge detection. Built lazily and cached on the
 * geometry's userData so we don't recompute on every click.
 *
 * Indexing model:
 * - `faceCount` = triangles in the mesh.
 * - `faceVerts[3*f .. 3*f+3)` are the geometry's *raw* vertex indices for
 *   triangle f. For indexed geometry this is the index buffer; for
 *   non-indexed it is `[3f, 3f+1, 3f+2]`.
 * - `weldedFaceVerts[3*f .. 3*f+3)` are the *welded* indices used for
 *   adjacency / edge keys. Welding deduplicates positions within EPS so two
 *   triangles meeting along an edge share vertex IDs even when the source
 *   geometry has unique-per-triangle vertices (typical of STL).
 */
export interface MeshAdjacency {
  faceCount: number;
  faceVerts: Uint32Array;        // length 3 * faceCount
  weldedFaceVerts: Uint32Array;  // length 3 * faceCount
  /** Per-face neighbor face indices (3 per face), -1 where the edge is a border. */
  faceNeighbors: Int32Array;     // length 3 * faceCount
  /** Map from edge key -> faces sharing the edge (1 or 2 typically; can be >2 on non-manifold). */
  edgeFaces: Map<EdgeKey, number[]>;
  /** Material slot index per face, or -1 if not segmented by group. */
  faceMaterial: Int32Array;      // length faceCount
  /** Face normals in mesh-local space, length 3 * faceCount. */
  faceNormals: Float32Array;
}

const EPS = 1e-5;

const ADJ_KEY = '__editor_adjacency__';

interface AdjacencyHolder {
  [ADJ_KEY]?: MeshAdjacency;
}

export function getAdjacency(mesh: THREE.Mesh): MeshAdjacency {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const holder = geometry.userData as AdjacencyHolder;
  if (holder[ADJ_KEY]) return holder[ADJ_KEY]!;
  const adj = buildAdjacency(geometry);
  holder[ADJ_KEY] = adj;
  return adj;
}

/** Drop the cached adjacency. Call after destructive geometry edits. */
export function invalidateAdjacency(mesh: THREE.Mesh): void {
  const holder = (mesh.geometry as THREE.BufferGeometry).userData as AdjacencyHolder;
  delete holder[ADJ_KEY];
}

function buildAdjacency(geometry: THREE.BufferGeometry): MeshAdjacency {
  const positionAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!positionAttr) {
    return emptyAdjacency();
  }

  const faceVerts = buildFaceVerts(geometry);
  const faceCount = faceVerts.length / 3;
  const weldedFaceVerts = buildWeldedFaceVerts(positionAttr, faceVerts);

  const edgeFaces = new Map<EdgeKey, number[]>();
  for (let f = 0; f < faceCount; f++) {
    const a = weldedFaceVerts[f * 3]!;
    const b = weldedFaceVerts[f * 3 + 1]!;
    const c = weldedFaceVerts[f * 3 + 2]!;
    pushEdge(edgeFaces, a, b, f);
    pushEdge(edgeFaces, b, c, f);
    pushEdge(edgeFaces, c, a, f);
  }

  const faceNeighbors = new Int32Array(3 * faceCount).fill(-1);
  for (let f = 0; f < faceCount; f++) {
    const a = weldedFaceVerts[f * 3]!;
    const b = weldedFaceVerts[f * 3 + 1]!;
    const c = weldedFaceVerts[f * 3 + 2]!;
    faceNeighbors[f * 3]     = pickNeighbor(edgeFaces, a, b, f);
    faceNeighbors[f * 3 + 1] = pickNeighbor(edgeFaces, b, c, f);
    faceNeighbors[f * 3 + 2] = pickNeighbor(edgeFaces, c, a, f);
  }

  const faceMaterial = buildFaceMaterial(geometry, faceCount);
  const faceNormals = buildFaceNormals(positionAttr, faceVerts);

  return {
    faceCount,
    faceVerts,
    weldedFaceVerts,
    faceNeighbors,
    edgeFaces,
    faceMaterial,
    faceNormals,
  };
}

function emptyAdjacency(): MeshAdjacency {
  return {
    faceCount: 0,
    faceVerts: new Uint32Array(0),
    weldedFaceVerts: new Uint32Array(0),
    faceNeighbors: new Int32Array(0),
    edgeFaces: new Map(),
    faceMaterial: new Int32Array(0),
    faceNormals: new Float32Array(0),
  };
}

function buildFaceVerts(geometry: THREE.BufferGeometry): Uint32Array {
  if (geometry.index) {
    const arr = geometry.index.array;
    const out = new Uint32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i]!;
    return out;
  }
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const vCount = pos.count;
  const out = new Uint32Array(vCount);
  for (let i = 0; i < vCount; i++) out[i] = i;
  return out;
}

function buildWeldedFaceVerts(
  positionAttr: THREE.BufferAttribute,
  faceVerts: Uint32Array,
): Uint32Array {
  const vCount = positionAttr.count;
  const remap = new Uint32Array(vCount);
  const map = new Map<string, number>();
  let next = 0;
  const inv = 1 / EPS;
  for (let i = 0; i < vCount; i++) {
    const x = Math.round(positionAttr.getX(i) * inv);
    const y = Math.round(positionAttr.getY(i) * inv);
    const z = Math.round(positionAttr.getZ(i) * inv);
    const key = `${x}|${y}|${z}`;
    let idx = map.get(key);
    if (idx === undefined) { idx = next++; map.set(key, idx); }
    remap[i] = idx;
  }
  const out = new Uint32Array(faceVerts.length);
  for (let i = 0; i < faceVerts.length; i++) out[i] = remap[faceVerts[i]!]!;
  return out;
}

function pushEdge(
  map: Map<EdgeKey, number[]>,
  a: number,
  b: number,
  face: number,
): void {
  if (a === b) return;
  const key = edgeKey(a, b);
  const arr = map.get(key);
  if (arr) arr.push(face);
  else map.set(key, [face]);
}

function pickNeighbor(
  map: Map<EdgeKey, number[]>,
  a: number,
  b: number,
  self: number,
): number {
  const arr = map.get(edgeKey(a, b));
  if (!arr) return -1;
  for (const f of arr) if (f !== self) return f;
  return -1;
}

function buildFaceMaterial(geometry: THREE.BufferGeometry, faceCount: number): Int32Array {
  const out = new Int32Array(faceCount).fill(-1);
  if (!geometry.groups || geometry.groups.length === 0) return out;
  for (const g of geometry.groups) {
    const startFace = Math.floor(g.start / 3);
    const endFace = startFace + Math.floor(g.count / 3);
    const m = g.materialIndex ?? 0;
    for (let f = startFace; f < endFace && f < faceCount; f++) out[f] = m;
  }
  return out;
}

function buildFaceNormals(positionAttr: THREE.BufferAttribute, faceVerts: Uint32Array): Float32Array {
  const faceCount = faceVerts.length / 3;
  const out = new Float32Array(3 * faceCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n  = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    a.fromBufferAttribute(positionAttr, faceVerts[f * 3]!);
    b.fromBufferAttribute(positionAttr, faceVerts[f * 3 + 1]!);
    c.fromBufferAttribute(positionAttr, faceVerts[f * 3 + 2]!);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len > 1e-12) n.multiplyScalar(1 / len);
    out[f * 3]     = n.x;
    out[f * 3 + 1] = n.y;
    out[f * 3 + 2] = n.z;
  }
  return out;
}
