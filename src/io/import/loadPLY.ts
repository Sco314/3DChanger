import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

import { pickEntry } from '../dropFiles.js';

export interface PLYImportResult { root: THREE.Object3D; }

/**
 * Load a PLY file. PLYLoader returns a BufferGeometry — we wrap it in a
 * Mesh with a neutral PBR material so it shows up consistently with other
 * formats. Vertex colors (if present) are routed via vertexColors=true.
 */
export async function loadPLY(files: File[]): Promise<PLYImportResult> {
  const file = pickEntry(files, ['ply']);
  if (!file) throw new Error('No .ply file in drop');

  const buffer = await file.arrayBuffer();
  const geometry = new PLYLoader().parse(buffer);
  // PLY may have only positions; compute normals so lighting works.
  if (!geometry.attributes.normal) geometry.computeVertexNormals();

  const hasVColor = !!geometry.attributes.color;
  const material = new THREE.MeshStandardMaterial({
    color: 0xc8ccd0,
    roughness: 0.7,
    metalness: 0.0,
    vertexColors: hasVColor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = file.name;

  const root = new THREE.Group();
  root.name = file.name;
  root.add(mesh);
  return { root };
}
