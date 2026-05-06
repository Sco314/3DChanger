import type * as THREE from 'three';

import type {
  ComponentMode,
  EdgeKey,
  MeshComponentState,
  SeedRef,
} from './types.js';
import { getAdjacency, type MeshAdjacency } from './MeshAdjacency.js';

export type ComponentListener = (sel: ComponentSelection) => void;

/**
 * Per-Editor state for face/edge/vertex selections across all meshes.
 *
 * Selection is partitioned by Mesh. Edge keys and vertex indices use the
 * *welded* index space from MeshAdjacency so picks on shared edges or
 * coincident vertices behave the way a user expects.
 */
export class ComponentSelection {
  private mode: ComponentMode = 'face';
  private states = new Map<THREE.Mesh, MeshComponentState>();
  private seed: SeedRef | null = null;
  private listeners = new Set<ComponentListener>();

  on(fn: ComponentListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }

  getMode(): ComponentMode { return this.mode; }
  setMode(m: ComponentMode): void {
    if (this.mode === m) return;
    this.mode = m;
    this.emit();
  }

  getSeed(): SeedRef | null { return this.seed; }

  /** Read-only snapshot of state per mesh. */
  states_(): ReadonlyMap<THREE.Mesh, MeshComponentState> { return this.states; }

  /** Read-only state for one mesh, or empty if none. */
  stateOf(mesh: THREE.Mesh): MeshComponentState | undefined {
    return this.states.get(mesh);
  }

  /** Total count across all meshes for the active mode. */
  size(): number {
    let n = 0;
    for (const s of this.states.values()) {
      n += this.mode === 'face' ? s.faces.size
         : this.mode === 'edge' ? s.edges.size
         : s.vertices.size;
    }
    return n;
  }

  clear(): void {
    if (this.states.size === 0 && !this.seed) return;
    this.states.clear();
    this.seed = null;
    this.emit();
  }

  // ---- Single-component toggles (set as seed) ----

  toggleFace(mesh: THREE.Mesh, faceIndex: number, additive: boolean): void {
    const s = this.ensureState(mesh);
    if (!additive) this.clearAllExcept(mesh, 'face');
    if (!additive) s.faces.clear();
    if (s.faces.has(faceIndex)) s.faces.delete(faceIndex);
    else s.faces.add(faceIndex);
    this.seed = { mesh, kind: 'face', key: faceIndex };
    this.compact();
    this.emit();
  }

  toggleEdge(mesh: THREE.Mesh, edgeK: EdgeKey, additive: boolean): void {
    const s = this.ensureState(mesh);
    if (!additive) this.clearAllExcept(mesh, 'edge');
    if (!additive) s.edges.clear();
    if (s.edges.has(edgeK)) s.edges.delete(edgeK);
    else s.edges.add(edgeK);
    this.seed = { mesh, kind: 'edge', key: edgeK };
    this.compact();
    this.emit();
  }

  toggleVertex(mesh: THREE.Mesh, weldedVertex: number, additive: boolean): void {
    const s = this.ensureState(mesh);
    if (!additive) this.clearAllExcept(mesh, 'vertex');
    if (!additive) s.vertices.clear();
    if (s.vertices.has(weldedVertex)) s.vertices.delete(weldedVertex);
    else s.vertices.add(weldedVertex);
    this.seed = { mesh, kind: 'vertex', key: weldedVertex };
    this.compact();
    this.emit();
  }

  // ---- Bulk actions (operate on the seed mesh / scene) ----

  /** Select every triangle on the seed mesh. */
  selectByObject(): void {
    if (!this.seed) return;
    const mesh = this.seed.mesh;
    const adj = getAdjacency(mesh);
    const s = this.ensureState(mesh);
    s.faces.clear();
    for (let f = 0; f < adj.faceCount; f++) s.faces.add(f);
    this.mode = 'face';
    this.emit();
  }

  /**
   * Select every triangle that uses the same Material as the triangle under
   * the seed. Works across all Mesh descendants of `searchRoot`.
   *
   * - Multi-material meshes use geometry.groups[].materialIndex.
   * - Single-material meshes match by Material UUID across the scene.
   */
  selectByMaterial(searchRoot: THREE.Object3D): void {
    if (!this.seed) return;
    const seedMesh = this.seed.mesh;
    const seedAdj = getAdjacency(seedMesh);
    const seedFace = this.faceIndexFromSeed(seedAdj);
    if (seedFace < 0) return;

    const seedSlot = seedAdj.faceMaterial[seedFace] ?? -1;
    const seedMatUUID = materialUUIDOnMesh(seedMesh, seedSlot >= 0 ? seedSlot : 0);

    this.states.clear();
    searchRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const adj = getAdjacency(mesh);
      const s = this.ensureState(mesh);
      for (let f = 0; f < adj.faceCount; f++) {
        const slot = adj.faceMaterial[f] ?? -1;
        const uuid = materialUUIDOnMesh(mesh, slot >= 0 ? slot : 0);
        if (uuid && uuid === seedMatUUID) s.faces.add(f);
      }
    });
    this.mode = 'face';
    this.compact();
    this.emit();
  }

  /** Flood-fill faces from the seed via shared-edge adjacency. */
  selectConnected(): void {
    if (!this.seed) return;
    const mesh = this.seed.mesh;
    const adj = getAdjacency(mesh);
    const seedFace = this.faceIndexFromSeed(adj);
    if (seedFace < 0) return;
    const reached = floodFill(adj, seedFace, () => true);
    const s = this.ensureState(mesh);
    s.faces.clear();
    for (const f of reached) s.faces.add(f);
    this.mode = 'face';
    this.emit();
  }

  /**
   * Flood-fill faces from the seed but stop crossing any edge whose dihedral
   * angle (between adjacent face normals) exceeds `thresholdDeg`.
   */
  selectByNormalAngle(thresholdDeg: number): void {
    if (!this.seed) return;
    const mesh = this.seed.mesh;
    const adj = getAdjacency(mesh);
    const seedFace = this.faceIndexFromSeed(adj);
    if (seedFace < 0) return;

    const cosThresh = Math.cos((thresholdDeg * Math.PI) / 180);
    const reached = floodFill(adj, seedFace, (from, to) => {
      // Allow if the dot of face normals is >= cos(threshold). We treat large
      // negative dots (>180°) as hard edges as well, since they are degenerate.
      const fnx = adj.faceNormals[from * 3]!;
      const fny = adj.faceNormals[from * 3 + 1]!;
      const fnz = adj.faceNormals[from * 3 + 2]!;
      const tnx = adj.faceNormals[to * 3]!;
      const tny = adj.faceNormals[to * 3 + 1]!;
      const tnz = adj.faceNormals[to * 3 + 2]!;
      const dot = fnx * tnx + fny * tny + fnz * tnz;
      return dot >= cosThresh;
    });
    const s = this.ensureState(mesh);
    s.faces.clear();
    for (const f of reached) s.faces.add(f);
    this.mode = 'face';
    this.emit();
  }

  // ---- Internals ----

  private ensureState(mesh: THREE.Mesh): MeshComponentState {
    let s = this.states.get(mesh);
    if (!s) {
      s = { faces: new Set(), edges: new Set(), vertices: new Set() };
      this.states.set(mesh, s);
    }
    return s;
  }

  private clearAllExcept(keepMesh: THREE.Mesh, _kind: ComponentMode): void {
    for (const [mesh, s] of this.states) {
      if (mesh === keepMesh) continue;
      s.faces.clear();
      s.edges.clear();
      s.vertices.clear();
    }
    this.compact();
  }

  /** Drop fully-empty mesh states to keep the map tidy. */
  private compact(): void {
    for (const [mesh, s] of this.states) {
      if (s.faces.size === 0 && s.edges.size === 0 && s.vertices.size === 0) {
        this.states.delete(mesh);
      }
    }
  }

  private faceIndexFromSeed(adj: MeshAdjacency): number {
    if (!this.seed) return -1;
    if (this.seed.kind === 'face') return this.seed.key as number;
    if (this.seed.kind === 'edge') {
      const arr = adj.edgeFaces.get(this.seed.key as EdgeKey);
      return arr && arr.length > 0 ? arr[0]! : -1;
    }
    // vertex: find any face that contains this welded vertex.
    const v = this.seed.key as number;
    for (let f = 0; f < adj.faceCount; f++) {
      if (
        adj.weldedFaceVerts[f * 3]     === v ||
        adj.weldedFaceVerts[f * 3 + 1] === v ||
        adj.weldedFaceVerts[f * 3 + 2] === v
      ) return f;
    }
    return -1;
  }
}

function floodFill(
  adj: MeshAdjacency,
  start: number,
  allow: (from: number, to: number) => boolean,
): Set<number> {
  const visited = new Set<number>();
  const stack: number[] = [start];
  visited.add(start);
  while (stack.length > 0) {
    const f = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const n = adj.faceNeighbors[f * 3 + k]!;
      if (n < 0 || visited.has(n)) continue;
      if (!allow(f, n)) continue;
      visited.add(n);
      stack.push(n);
    }
  }
  return visited;
}

function materialUUIDOnMesh(mesh: THREE.Mesh, slot: number): string | null {
  const m = mesh.material;
  if (Array.isArray(m)) {
    const item = m[slot];
    return item ? item.uuid : null;
  }
  return m ? m.uuid : null;
}
