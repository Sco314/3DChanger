import * as THREE from 'three';

import { invalidateAdjacency } from '../components/MeshAdjacency.js';

/**
 * Material assignment ops. Goals:
 *   - Preserve imported textures and UVs. None of these ops touch
 *     geometry.attributes; they only change `mesh.material` and
 *     `geometry.groups`.
 *   - Live property edits go directly on the Material instance
 *     (color/roughness/metalness/emissive). Three.js re-uploads uniforms
 *     on the next draw, so no needsUpdate is required.
 *   - When a face subset gets a new material, the mesh becomes
 *     multi-material: an array of materials plus a `groups` array on the
 *     geometry that maps index ranges to materialIndex.
 */

/** Defaults for a freshly minted MeshStandardMaterial. */
const DEFAULT_COLOR = 0xc8ccd0;
const DEFAULT_ROUGHNESS = 0.7;
const DEFAULT_METALNESS = 0.0;

export interface MaterialAssignDelta {
  /** Meshes whose material reference or geometry.groups changed. */
  modified: THREE.Mesh[];
}

const EMPTY: MaterialAssignDelta = { modified: [] };

/**
 * Build a fresh MeshStandardMaterial. If `template` is supplied, clone it so
 * texture maps and existing parameters carry over (lets users tweak from the
 * imported look without losing UV-mapped textures).
 */
export function makeMaterial(template?: THREE.Material): THREE.MeshStandardMaterial {
  if (template && (template as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return (template as THREE.MeshStandardMaterial).clone();
  }
  if (template) {
    // Convert from non-PBR (Phong, Basic, Lambert) to MeshStandardMaterial,
    // copying color and any albedo map so the look stays close.
    const next = new THREE.MeshStandardMaterial({
      color: DEFAULT_COLOR,
      roughness: DEFAULT_ROUGHNESS,
      metalness: DEFAULT_METALNESS,
    });
    const tAny = template as unknown as { color?: THREE.Color; map?: THREE.Texture };
    if (tAny.color) next.color.copy(tAny.color);
    if (tAny.map) next.map = tAny.map;
    next.name = template.name;
    return next;
  }
  return new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    roughness: DEFAULT_ROUGHNESS,
    metalness: DEFAULT_METALNESS,
  });
}

/**
 * Replace the mesh's material with a clone (or per-slot clones for arrays)
 * so subsequent property edits don't bleed into other meshes that shared
 * the original instance. Texture references are preserved.
 */
export function makeMaterialUnique(mesh: THREE.Mesh): MaterialAssignDelta {
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((m) => m.clone());
  } else if (mesh.material) {
    mesh.material = mesh.material.clone();
  }
  return { modified: [mesh] };
}

/**
 * Append a new material slot to the mesh covering the supplied face indices.
 * Non-selected faces stay on the mesh's first slot.
 *
 * The new material defaults to a clone of the mesh's current first material
 * so textures and UV mapping survive the assignment; callers tweak its
 * color/roughness/metalness afterwards.
 *
 * Returns the index of the new slot in the material array, or -1 if the
 * input face set was empty.
 */
export function assignFaceMaterial(
  mesh: THREE.Mesh,
  faces: ReadonlySet<number>,
  newMaterial: THREE.Material,
): { delta: MaterialAssignDelta; newSlot: number } {
  if (faces.size === 0) return { delta: EMPTY, newSlot: -1 };

  // Step 1: ensure mesh.material is an array.
  if (!Array.isArray(mesh.material)) {
    mesh.material = [mesh.material];
  }
  const matArray = mesh.material as THREE.Material[];
  matArray.push(newMaterial);
  const newSlot = matArray.length - 1;

  // Step 2: build per-face slot map from existing groups (default 0).
  const geo = mesh.geometry as THREE.BufferGeometry;
  const faceCount = countFaces(geo);
  const slots = perFaceSlot(geo, faceCount);

  // Step 3: assign the new slot to selected faces.
  for (const f of faces) {
    if (f >= 0 && f < faceCount) slots[f] = newSlot;
  }

  // Step 4: rebuild groups by RLE on the per-face slot map.
  rebuildGroups(geo, slots, faceCount);

  invalidateAdjacency(mesh);
  return { delta: { modified: [mesh] }, newSlot };
}

// ---- Internals ----

function countFaces(geo: THREE.BufferGeometry): number {
  return geo.index
    ? geo.index.count / 3
    : (geo.attributes.position as THREE.BufferAttribute).count / 3;
}

function perFaceSlot(geo: THREE.BufferGeometry, faceCount: number): Int32Array {
  const out = new Int32Array(faceCount); // default slot 0
  if (!geo.groups || geo.groups.length === 0) return out;
  for (const g of geo.groups) {
    const startFace = Math.floor(g.start / 3);
    const endFace = Math.min(startFace + Math.floor(g.count / 3), faceCount);
    const slot = g.materialIndex ?? 0;
    for (let f = startFace; f < endFace; f++) out[f] = slot;
  }
  return out;
}

function rebuildGroups(
  geo: THREE.BufferGeometry,
  slots: Int32Array,
  faceCount: number,
): void {
  geo.clearGroups();
  if (faceCount === 0) return;

  let runStart = 0;
  let runSlot = slots[0]!;
  for (let f = 1; f < faceCount; f++) {
    const slot = slots[f]!;
    if (slot !== runSlot) {
      geo.addGroup(runStart * 3, (f - runStart) * 3, runSlot);
      runStart = f;
      runSlot = slot;
    }
  }
  geo.addGroup(runStart * 3, (faceCount - runStart) * 3, runSlot);
}
