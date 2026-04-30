import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

import { pickEntry } from '../dropFiles.js';

export interface STLImportResult {
  root: THREE.Object3D;
}

export async function loadSTL(files: File[]): Promise<STLImportResult> {
  const file = pickEntry(files, ['stl']);
  if (!file) throw new Error('No .stl file in drop');

  const buffer = await file.arrayBuffer();
  const geometry = new STLLoader().parse(buffer);

  // STL has no material, no UVs. Use a neutral PBR material so the diagnostics
  // panel can correctly report 1 material, 0 textures.
  const material = new THREE.MeshStandardMaterial({
    color: 0xc8ccd0,
    roughness: 0.7,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = file.name;

  const root = new THREE.Group();
  root.name = file.name;
  root.add(mesh);
  return { root };
}
