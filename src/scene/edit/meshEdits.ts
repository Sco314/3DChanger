import * as THREE from 'three';

import { invalidateAdjacency } from '../components/MeshAdjacency.js';
import {
  removeFaces,
  extractFaces,
  splitByMaterial,
  splitByComponent,
  findBoundaryLoops,
  fillBoundaryLoops,
} from './geometryEdits.js';

/**
 * Mesh-level edit ops. Each one operates on a single Mesh, returns a
 * description of what changed (added / removed siblings), and leaves the
 * scene graph in a consistent state. Adjacency caches are invalidated for
 * every mesh whose geometry was modified or replaced.
 *
 * The pure geometry math lives in geometryEdits.ts; this layer is the
 * "scene plumbing" — replacing geometries on the existing Mesh, parenting
 * new sibling Meshes, and propagating material assignments.
 */

export interface EditDelta {
  /** Meshes that were removed from the scene (replaced or detached). */
  removed: THREE.Mesh[];
  /** Meshes that were added (separated/detached/split fragments). */
  added: THREE.Mesh[];
  /** Meshes whose geometry was edited in place. */
  modified: THREE.Mesh[];
}

const EMPTY_DELTA: EditDelta = { removed: [], added: [], modified: [] };

/** Replace a Mesh's geometry in place; dispose the old one. */
export function replaceGeometry(mesh: THREE.Mesh, next: THREE.BufferGeometry): void {
  const old = mesh.geometry;
  mesh.geometry = next;
  invalidateAdjacency(mesh);
  if (old && old !== next) old.dispose();
}

/** Delete the given face indices from a single mesh. */
export function deleteFaces(mesh: THREE.Mesh, faces: ReadonlySet<number>): EditDelta {
  if (faces.size === 0) return EMPTY_DELTA;
  const next = removeFaces(mesh.geometry as THREE.BufferGeometry, faces);
  replaceGeometry(mesh, next);
  return { removed: [], added: [], modified: [mesh] };
}

/** Delete every face NOT in the set. */
export function keepFaces(mesh: THREE.Mesh, faces: ReadonlySet<number>): EditDelta {
  if (faces.size === 0) return EMPTY_DELTA;
  const next = extractFaces(mesh.geometry as THREE.BufferGeometry, faces);
  replaceGeometry(mesh, next);
  return { removed: [], added: [], modified: [mesh] };
}

/**
 * Move the selected faces out of `mesh` into a new sibling Mesh sharing the
 * same material(s) and transform. The source mesh keeps its remaining faces.
 */
export function separateFaces(mesh: THREE.Mesh, faces: ReadonlySet<number>): EditDelta {
  if (faces.size === 0 || !mesh.parent) return EMPTY_DELTA;

  const sourceGeo = mesh.geometry as THREE.BufferGeometry;
  const extracted = extractFaces(sourceGeo, faces);
  const remaining = removeFaces(sourceGeo, faces);

  const sibling = new THREE.Mesh(extracted, cloneMaterialRef(mesh.material));
  sibling.name = mesh.name ? `${mesh.name} (separated)` : 'separated';
  sibling.position.copy(mesh.position);
  sibling.quaternion.copy(mesh.quaternion);
  sibling.scale.copy(mesh.scale);
  mesh.parent.add(sibling);

  replaceGeometry(mesh, remaining);
  return { removed: [], added: [sibling], modified: [mesh] };
}

/**
 * For multi-material meshes, replace the source mesh with one new sibling
 * per material slot. For single-material meshes, returns EMPTY_DELTA.
 */
export function detachByMaterial(mesh: THREE.Mesh): EditDelta {
  if (!mesh.parent) return EMPTY_DELTA;
  const sourceGeo = mesh.geometry as THREE.BufferGeometry;
  if (!sourceGeo.groups || sourceGeo.groups.length === 0) return EMPTY_DELTA;
  if (!Array.isArray(mesh.material)) return EMPTY_DELTA;

  const parts = splitByMaterial(sourceGeo);
  if (parts.length <= 1) return EMPTY_DELTA;

  const added: THREE.Mesh[] = [];
  for (let i = 0; i < parts.length; i++) {
    const { geometry, sourceMaterialIndex } = parts[i]!;
    const mat = mesh.material[sourceMaterialIndex] ?? mesh.material[0]!;
    const piece = new THREE.Mesh(geometry, mat);
    piece.name = `${mesh.name || 'part'} [${mat.name || `mat${sourceMaterialIndex}`}]`;
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    mesh.parent.add(piece);
    added.push(piece);
  }

  invalidateAdjacency(mesh);
  mesh.parent.remove(mesh);
  mesh.geometry.dispose();
  return { removed: [mesh], added, modified: [] };
}

/**
 * Replace the source mesh with one new sibling per connected component
 * (faces flooded via shared-edge adjacency).
 */
export function detachByComponent(mesh: THREE.Mesh): EditDelta {
  if (!mesh.parent) return EMPTY_DELTA;

  const parts = splitByComponent(mesh);
  if (parts.length <= 1) return EMPTY_DELTA;

  const added: THREE.Mesh[] = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = new THREE.Mesh(parts[i]!, cloneMaterialRef(mesh.material));
    piece.name = `${mesh.name || 'part'} [c${i + 1}]`;
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    mesh.parent.add(piece);
    added.push(piece);
  }

  invalidateAdjacency(mesh);
  mesh.parent.remove(mesh);
  mesh.geometry.dispose();
  return { removed: [mesh], added, modified: [] };
}

/**
 * Detect open boundary loops on `mesh` and patch each with a centroid fan.
 * Indexed geometry only; non-indexed returns EMPTY_DELTA. Caller is expected
 * to optionally run recomputeNormals afterwards.
 */
export function fillHoles(mesh: THREE.Mesh): EditDelta {
  const sourceGeo = mesh.geometry as THREE.BufferGeometry;
  if (!sourceGeo.index) return EMPTY_DELTA;
  const loops = findBoundaryLoops(mesh);
  if (loops.length === 0) return EMPTY_DELTA;
  const next = fillBoundaryLoops(mesh, loops);
  if (!next) return EMPTY_DELTA;
  replaceGeometry(mesh, next);
  return { removed: [], added: [], modified: [mesh] };
}

/** Run `geometry.computeVertexNormals()` on the mesh's geometry. */
export function recomputeNormals(mesh: THREE.Mesh): EditDelta {
  const geo = mesh.geometry as THREE.BufferGeometry;
  geo.computeVertexNormals();
  // Bounds may also need refreshing after fill / heavy edits.
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  // Adjacency depends on positions (unchanged here) but face normals are
  // cached too; safest to drop and rebuild on next click.
  invalidateAdjacency(mesh);
  return { removed: [], added: [], modified: [mesh] };
}

function cloneMaterialRef(
  m: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  // We deliberately share the material reference. Disabling that for the
  // detach-by-material case (which already provides a single material per
  // piece). Callers that need independent materials should clone explicitly.
  return Array.isArray(m) ? [...m] : m;
}
