import * as THREE from 'three';

import { getAdjacency } from '../components/MeshAdjacency.js';
import { edgeKey, parseEdgeKey } from '../components/types.js';

/**
 * Pure BufferGeometry edits used by the slice-4 mesh ops. Each function
 * returns a *new* geometry (or a small set of new geometries), leaving the
 * input untouched. Callers replace the source mesh's geometry, build new
 * sibling meshes, and invalidate the adjacency cache as needed.
 *
 * Two execution paths exist for each op:
 *   - indexed: copy attributes by reference, rebuild a new index buffer.
 *   - non-indexed: slice each attribute by triangle (3 entries per face).
 *
 * In both paths `geometry.groups` are rebuilt by RLE on the kept faces'
 * material slot (taken from the source's adjacency cache).
 */

/** Build a new geometry with the given face indices removed. */
export function removeFaces(
  source: THREE.BufferGeometry,
  faces: ReadonlySet<number>,
): THREE.BufferGeometry {
  return rebuildByFaceFilter(source, (f) => !faces.has(f));
}

/** Build a new geometry containing only the given face indices. */
export function extractFaces(
  source: THREE.BufferGeometry,
  faces: ReadonlySet<number>,
): THREE.BufferGeometry {
  return rebuildByFaceFilter(source, (f) => faces.has(f));
}

/**
 * Returns one geometry per material slot present in `source.groups`. If the
 * source has no groups, returns an empty array (caller decides to do nothing).
 *
 * The resulting geometries always have a single group spanning all faces
 * with materialIndex 0 — the caller is expected to assign the *single*
 * matching material from the source's material array.
 */
export function splitByMaterial(
  source: THREE.BufferGeometry,
): Array<{ geometry: THREE.BufferGeometry; sourceMaterialIndex: number }> {
  if (!source.groups || source.groups.length === 0) return [];

  const facesByMat = new Map<number, Set<number>>();
  const faceCount = countFaces(source);
  // Group faces by material slot using the same logic MeshAdjacency uses.
  for (const g of source.groups) {
    const startFace = Math.floor(g.start / 3);
    const endFace = Math.min(startFace + Math.floor(g.count / 3), faceCount);
    const slot = g.materialIndex ?? 0;
    let s = facesByMat.get(slot);
    if (!s) { s = new Set(); facesByMat.set(slot, s); }
    for (let f = startFace; f < endFace; f++) s.add(f);
  }

  const out: Array<{ geometry: THREE.BufferGeometry; sourceMaterialIndex: number }> = [];
  for (const [slot, faces] of facesByMat) {
    if (faces.size === 0) continue;
    const geom = extractFaces(source, faces);
    flattenSingleGroup(geom);
    out.push({ geometry: geom, sourceMaterialIndex: slot });
  }
  return out;
}

/**
 * Returns one geometry per connected component (via shared-edge adjacency).
 * If the source is a single component, returns a single-element array — the
 * caller can detect that and skip the operation.
 */
export function splitByComponent(mesh: THREE.Mesh): THREE.BufferGeometry[] {
  const adj = getAdjacency(mesh);
  if (adj.faceCount === 0) return [];

  const visited = new Uint8Array(adj.faceCount);
  const components: Set<number>[] = [];

  for (let f = 0; f < adj.faceCount; f++) {
    if (visited[f]) continue;
    const comp = new Set<number>();
    const stack = [f];
    visited[f] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.add(cur);
      for (let k = 0; k < 3; k++) {
        const n = adj.faceNeighbors[cur * 3 + k]!;
        if (n < 0 || visited[n]) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }
    components.push(comp);
  }

  return components.map((c) => extractFaces(mesh.geometry as THREE.BufferGeometry, c));
}

/**
 * Find boundary loops on a mesh. A boundary edge is one that has exactly
 * one adjacent face. Loops are returned as ordered lists of *welded* vertex
 * indices, closed (i.e. loop[0] is reachable from loop[loop.length-1]).
 *
 * Non-manifold edges (3+ faces) are skipped to keep the walk deterministic.
 */
export function findBoundaryLoops(mesh: THREE.Mesh): number[][] {
  const adj = getAdjacency(mesh);
  const next = new Map<number, number[]>();
  for (const [k, faces] of adj.edgeFaces) {
    if (faces.length !== 1) continue;
    const [a, b] = parseEdgeKey(k);
    pushNeighbor(next, a, b);
    pushNeighbor(next, b, a);
  }
  const used = new Set<string>();
  const loops: number[][] = [];

  for (const start of next.keys()) {
    if (used.has(`${start}:start`)) continue;
    const loop: number[] = [];
    let cur = start;
    let prev = -1;
    let safety = 0;
    while (safety++ < 1_000_000) {
      const neighbors = next.get(cur);
      if (!neighbors || neighbors.length === 0) break;
      // Pick the first neighbor that isn't `prev`. If all are `prev`, take any.
      let nxt = -1;
      for (const n of neighbors) if (n !== prev) { nxt = n; break; }
      if (nxt < 0) nxt = neighbors[0]!;
      const stepKey = edgeKey(cur, nxt);
      if (used.has(stepKey)) break;
      used.add(stepKey);
      loop.push(cur);
      prev = cur;
      cur = nxt;
      if (cur === start) break;
    }
    if (loop.length >= 3) {
      loops.push(loop);
      used.add(`${start}:start`);
    }
  }
  return loops;
}

/**
 * Append centroid-fan triangles to fill the supplied boundary loops.
 * Indexed input only. Returns a new geometry with extended position/normal/
 * UV/color attributes plus the new triangles in the index buffer.
 *
 * Caveats — fill is a baseline. New triangles get a centroid vertex with
 * zero UV/color/normal; users should run "Recompute normals" after.
 */
export function fillBoundaryLoops(
  mesh: THREE.Mesh,
  loops: number[][],
): THREE.BufferGeometry | null {
  const source = mesh.geometry as THREE.BufferGeometry;
  if (!source.index) return null; // only indexed for now
  if (loops.length === 0) return null;

  const adj = getAdjacency(mesh);
  const positionAttr = source.attributes.position as THREE.BufferAttribute;

  // Welded -> any raw vertex index that maps to it (representative).
  const weldedToRaw = new Map<number, number>();
  for (let i = 0; i < adj.weldedFaceVerts.length; i++) {
    const w = adj.weldedFaceVerts[i]!;
    if (!weldedToRaw.has(w)) weldedToRaw.set(w, adj.faceVerts[i]!);
  }

  const oldVertCount = positionAttr.count;
  const totalNewVerts = loops.length;
  const newVertCount = oldVertCount + totalNewVerts;

  const oldPos = positionAttr.array as Float32Array;
  const newPos = new Float32Array(newVertCount * 3);
  newPos.set(oldPos);

  const fanCenters: number[] = []; // raw indices for each loop's centroid
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]!;
    let cx = 0, cy = 0, cz = 0;
    for (const w of loop) {
      const raw = weldedToRaw.get(w)!;
      cx += oldPos[raw * 3]!;
      cy += oldPos[raw * 3 + 1]!;
      cz += oldPos[raw * 3 + 2]!;
    }
    const inv = 1 / loop.length;
    const idx = oldVertCount + li;
    newPos[idx * 3]     = cx * inv;
    newPos[idx * 3 + 1] = cy * inv;
    newPos[idx * 3 + 2] = cz * inv;
    fanCenters.push(idx);
  }

  // Build the new index by appending fan triangles per loop.
  const oldIndex = source.index.array as ArrayLike<number>;
  let newTriCount = oldIndex.length / 3;
  for (const loop of loops) newTriCount += loop.length;
  const newIndex = new Uint32Array(newTriCount * 3);
  for (let i = 0; i < oldIndex.length; i++) newIndex[i] = oldIndex[i]!;

  let w = oldIndex.length;
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]!;
    const center = fanCenters[li]!;
    for (let i = 0; i < loop.length; i++) {
      const a = weldedToRaw.get(loop[i]!)!;
      const b = weldedToRaw.get(loop[(i + 1) % loop.length]!)!;
      newIndex[w++] = center;
      newIndex[w++] = a;
      newIndex[w++] = b;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setIndex(new THREE.Uint32BufferAttribute(newIndex, 1));
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));

  // Extend other vertex-level attributes with zeros for the centroid verts.
  for (const [name, attr] of Object.entries(source.attributes)) {
    if (name === 'position') continue;
    const a = attr as THREE.BufferAttribute;
    out.setAttribute(name, extendAttributeWithZeros(a, totalNewVerts));
  }

  // Groups: keep the original groups; add one extra group covering the new
  // triangles using materialIndex 0 (or the source's last group's slot).
  if (source.groups && source.groups.length > 0) {
    const lastSlot = source.groups[source.groups.length - 1]!.materialIndex ?? 0;
    for (const g of source.groups) out.addGroup(g.start, g.count, g.materialIndex);
    const fillStart = oldIndex.length;
    const fillCount = w - oldIndex.length;
    if (fillCount > 0) out.addGroup(fillStart, fillCount, lastSlot);
  }

  return out;
}

// ---- Internals ----

function rebuildByFaceFilter(
  source: THREE.BufferGeometry,
  keep: (faceIndex: number) => boolean,
): THREE.BufferGeometry {
  return source.index
    ? rebuildIndexed(source, keep)
    : rebuildNonIndexed(source, keep);
}

function rebuildIndexed(
  source: THREE.BufferGeometry,
  keep: (faceIndex: number) => boolean,
): THREE.BufferGeometry {
  const oldIdx = source.index!.array as ArrayLike<number>;
  const oldFaceCount = oldIdx.length / 3;

  const slotByFace = perFaceMaterialSlot(source, oldFaceCount);

  const newIdx: number[] = [];
  const newGroups: Array<{ start: number; count: number; materialIndex?: number }> = [];
  let runStart = 0;
  let runSlot: number | -1 = -1;

  for (let f = 0; f < oldFaceCount; f++) {
    if (!keep(f)) continue;
    const slot = slotByFace[f]!;
    if (newIdx.length === 0 || slot !== runSlot) {
      if (newIdx.length > 0 && runSlot >= 0) {
        newGroups.push({ start: runStart, count: newIdx.length - runStart, materialIndex: runSlot });
      }
      runStart = newIdx.length;
      runSlot = slot;
    }
    newIdx.push(oldIdx[f * 3]!, oldIdx[f * 3 + 1]!, oldIdx[f * 3 + 2]!);
  }
  if (newIdx.length > 0 && runSlot >= 0) {
    newGroups.push({ start: runStart, count: newIdx.length - runStart, materialIndex: runSlot });
  }

  const out = new THREE.BufferGeometry();
  out.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(newIdx), 1));
  for (const [name, attr] of Object.entries(source.attributes)) {
    out.setAttribute(name, attr); // share by reference; vertices reused via index
  }
  for (const g of newGroups) out.addGroup(g.start, g.count, g.materialIndex);
  return out;
}

function rebuildNonIndexed(
  source: THREE.BufferGeometry,
  keep: (faceIndex: number) => boolean,
): THREE.BufferGeometry {
  const positionAttr = source.attributes.position as THREE.BufferAttribute;
  const oldFaceCount = positionAttr.count / 3;
  const slotByFace = perFaceMaterialSlot(source, oldFaceCount);

  const keepFaces: number[] = [];
  for (let f = 0; f < oldFaceCount; f++) if (keep(f)) keepFaces.push(f);

  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    out.setAttribute(name, sliceAttributeByFace(attr as THREE.BufferAttribute, keepFaces));
  }

  // Rebuild groups by RLE'ing slot over the kept face order.
  let runStart = 0;
  let runSlot: number | -1 = -1;
  let cursor = 0;
  for (const f of keepFaces) {
    const slot = slotByFace[f]!;
    if (cursor === 0 || slot !== runSlot) {
      if (cursor > 0 && runSlot >= 0) {
        out.addGroup(runStart, cursor - runStart, runSlot);
      }
      runStart = cursor;
      runSlot = slot;
    }
    cursor += 3;
  }
  if (cursor > 0 && runSlot >= 0) {
    out.addGroup(runStart, cursor - runStart, runSlot);
  }
  return out;
}

function perFaceMaterialSlot(geo: THREE.BufferGeometry, faceCount: number): Int32Array {
  const out = new Int32Array(faceCount).fill(-1);
  if (!geo.groups || geo.groups.length === 0) return out;
  for (const g of geo.groups) {
    const startFace = Math.floor(g.start / 3);
    const endFace = Math.min(startFace + Math.floor(g.count / 3), faceCount);
    const slot = g.materialIndex ?? 0;
    for (let f = startFace; f < endFace; f++) out[f] = slot;
  }
  return out;
}

function sliceAttributeByFace(
  src: THREE.BufferAttribute,
  keepFaces: number[],
): THREE.BufferAttribute {
  const itemSize = src.itemSize;
  const arr = src.array as ArrayLike<number>;
  const ctor = arr.constructor as { new (n: number): typeof arr };
  // typed-array length per face: 3 verts * itemSize.
  const out = new (ctor as unknown as { new (n: number): Float32Array })(keepFaces.length * 3 * itemSize);
  let w = 0;
  for (const f of keepFaces) {
    const base = f * 3 * itemSize;
    for (let i = 0; i < 3 * itemSize; i++) out[w++] = arr[base + i]!;
  }
  return new THREE.BufferAttribute(out, itemSize, src.normalized);
}

function extendAttributeWithZeros(
  src: THREE.BufferAttribute,
  extraVerts: number,
): THREE.BufferAttribute {
  const itemSize = src.itemSize;
  const arr = src.array as ArrayLike<number>;
  const ctor = arr.constructor as { new (n: number): typeof arr };
  const out = new (ctor as unknown as { new (n: number): Float32Array })(arr.length + extraVerts * itemSize);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i]!;
  // Extra entries are zero by default (typed-array initialization).
  return new THREE.BufferAttribute(out, itemSize, src.normalized);
}

function flattenSingleGroup(geo: THREE.BufferGeometry): void {
  const total = geo.index ? geo.index.count : (geo.attributes.position as THREE.BufferAttribute).count;
  geo.clearGroups();
  geo.addGroup(0, total, 0);
}

function countFaces(geo: THREE.BufferGeometry): number {
  return geo.index
    ? geo.index.count / 3
    : (geo.attributes.position as THREE.BufferAttribute).count / 3;
}

function pushNeighbor(map: Map<number, number[]>, a: number, b: number): void {
  const arr = map.get(a);
  if (arr) arr.push(b);
  else map.set(a, [b]);
}
