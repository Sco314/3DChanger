import * as THREE from 'three';

import type { ComponentSelection } from './ComponentSelection.js';
import { getAdjacency } from './MeshAdjacency.js';
import { parseEdgeKey } from './types.js';

const FACE_COLOR = new THREE.Color(0xffa54a);
const EDGE_COLOR = new THREE.Color(0xffd34a);
const VERT_COLOR = new THREE.Color(0xffd34a);

/**
 * Renders three overlays (face, edge, vertex) per source mesh that has a
 * non-empty selection. Rebuilds them on every selection change. Overlays
 * share the source mesh's transform by reparenting under it; they ignore
 * raycasts so picks always land on the source geometry.
 */
export class ComponentVisuals {
  /** All overlays live in this group so we can attach/detach quickly. */
  private readonly group = new THREE.Group();
  private overlays = new Map<THREE.Mesh, MeshOverlays>();
  private readonly disposeSub: () => void;

  /** A position attribute clone per source mesh (welded-aware vert positions). */
  private positionCache = new Map<THREE.Mesh, THREE.Float32BufferAttribute>();

  constructor(scene: THREE.Scene, private readonly selection: ComponentSelection) {
    this.group.name = 'editor:componentOverlays';
    scene.add(this.group);
    this.disposeSub = selection.on(() => this.rebuild());
  }

  dispose(): void {
    this.disposeSub();
    this.clear();
    this.positionCache.clear();
    this.group.parent?.remove(this.group);
  }

  private clear(): void {
    for (const ov of this.overlays.values()) ov.dispose();
    this.overlays.clear();
  }

  private rebuild(): void {
    const states = this.selection.states_();

    // Discard overlays for meshes no longer selected.
    for (const [mesh, ov] of [...this.overlays]) {
      if (!states.has(mesh)) {
        ov.dispose();
        this.overlays.delete(mesh);
      }
    }

    for (const [mesh, state] of states) {
      let ov = this.overlays.get(mesh);
      if (!ov) {
        ov = new MeshOverlays(mesh);
        this.overlays.set(mesh, ov);
      }
      this.updateOverlays(mesh, ov, state);
    }
  }

  private updateOverlays(
    mesh: THREE.Mesh,
    ov: MeshOverlays,
    state: { faces: Set<number>; edges: Set<string>; vertices: Set<number> },
  ): void {
    ov.faces.visible = state.faces.size > 0;
    ov.edges.visible = state.edges.size > 0;
    ov.points.visible = state.vertices.size > 0;

    const positionAttr = (mesh.geometry as THREE.BufferGeometry)
      .attributes.position as THREE.BufferAttribute | undefined;
    if (!positionAttr) return;

    if (state.faces.size > 0) this.fillFaceOverlay(mesh, ov, state.faces);
    if (state.edges.size > 0) this.fillEdgeOverlay(mesh, ov, state.edges);
    if (state.vertices.size > 0) this.fillPointOverlay(mesh, ov, state.vertices);
  }

  private fillFaceOverlay(mesh: THREE.Mesh, ov: MeshOverlays, faces: Set<number>): void {
    const adj = getAdjacency(mesh);
    const idx = new Uint32Array(faces.size * 3);
    let w = 0;
    for (const f of faces) {
      idx[w++] = adj.faceVerts[f * 3]!;
      idx[w++] = adj.faceVerts[f * 3 + 1]!;
      idx[w++] = adj.faceVerts[f * 3 + 2]!;
    }
    const geom = ov.faces.geometry;
    geom.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    // Share the source position attribute so transforms stay correct without
    // copies. Bounding sphere is needed for frustum culling.
    geom.setAttribute('position', mesh.geometry.attributes.position!);
    geom.computeBoundingSphere();
  }

  private fillEdgeOverlay(mesh: THREE.Mesh, ov: MeshOverlays, edges: Set<string>): void {
    const positions = this.weldedRepresentativePositions(mesh);
    const out = new Float32Array(edges.size * 6);
    let w = 0;
    for (const k of edges) {
      const [a, b] = parseEdgeKey(k);
      out[w++] = positions.getX(a);
      out[w++] = positions.getY(a);
      out[w++] = positions.getZ(a);
      out[w++] = positions.getX(b);
      out[w++] = positions.getY(b);
      out[w++] = positions.getZ(b);
    }
    const geom = ov.edges.geometry;
    geom.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    geom.computeBoundingSphere();
  }

  private fillPointOverlay(mesh: THREE.Mesh, ov: MeshOverlays, vertices: Set<number>): void {
    const positions = this.weldedRepresentativePositions(mesh);
    const out = new Float32Array(vertices.size * 3);
    let w = 0;
    for (const v of vertices) {
      out[w++] = positions.getX(v);
      out[w++] = positions.getY(v);
      out[w++] = positions.getZ(v);
    }
    const geom = ov.points.geometry;
    geom.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    geom.computeBoundingSphere();
  }

  /**
   * Map welded-index space to representative xyz positions. We use the first
   * raw vertex we encounter for each welded id. Cached per mesh.
   */
  private weldedRepresentativePositions(mesh: THREE.Mesh): THREE.Float32BufferAttribute {
    const cached = this.positionCache.get(mesh);
    if (cached) return cached;

    const adj = getAdjacency(mesh);
    const positionAttr = (mesh.geometry as THREE.BufferGeometry)
      .attributes.position as THREE.BufferAttribute;
    let weldedCount = 0;
    for (let i = 0; i < adj.weldedFaceVerts.length; i++) {
      if (adj.weldedFaceVerts[i]! + 1 > weldedCount) weldedCount = adj.weldedFaceVerts[i]! + 1;
    }
    const out = new Float32Array(weldedCount * 3);
    const filled = new Uint8Array(weldedCount);
    for (let i = 0; i < adj.weldedFaceVerts.length; i++) {
      const w = adj.weldedFaceVerts[i]!;
      if (filled[w]) continue;
      const raw = adj.faceVerts[i]!;
      out[w * 3]     = positionAttr.getX(raw);
      out[w * 3 + 1] = positionAttr.getY(raw);
      out[w * 3 + 2] = positionAttr.getZ(raw);
      filled[w] = 1;
    }
    const attr = new THREE.Float32BufferAttribute(out, 3);
    this.positionCache.set(mesh, attr);
    return attr;
  }
}

/** The three overlay objects parented to one source mesh. */
class MeshOverlays {
  faces: THREE.Mesh;
  edges: THREE.LineSegments;
  points: THREE.Points;

  constructor(parent: THREE.Mesh) {
    this.faces = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: FACE_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      }),
    );
    this.faces.name = 'editor:faceOverlay';
    this.faces.raycast = () => undefined;
    this.faces.renderOrder = 999;

    this.edges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: EDGE_COLOR, depthTest: true, transparent: true, opacity: 0.95 }),
    );
    this.edges.name = 'editor:edgeOverlay';
    this.edges.raycast = () => undefined;
    this.edges.renderOrder = 1000;

    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: VERT_COLOR, size: 6, sizeAttenuation: false, depthTest: true }),
    );
    this.points.name = 'editor:vertexOverlay';
    this.points.raycast = () => undefined;
    this.points.renderOrder = 1001;

    parent.add(this.faces);
    parent.add(this.edges);
    parent.add(this.points);
  }

  dispose(): void {
    for (const obj of [this.faces, this.edges, this.points] as THREE.Object3D[]) {
      obj.parent?.remove(obj);
      const geom = (obj as { geometry?: THREE.BufferGeometry }).geometry;
      if (geom) geom.dispose();
      const mat = (obj as { material?: THREE.Material }).material;
      if (mat) mat.dispose();
    }
  }
}
