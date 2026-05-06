import type * as THREE from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

import { pickEntry } from '../dropFiles.js';

export interface ThreeMFImportResult { root: THREE.Object3D; }

/**
 * Load a 3MF (.3mf) file. 3MF is a zipped XML container with embedded
 * geometry and (optionally) materials. ThreeMFLoader handles unpacking;
 * sibling files in the drop are not required.
 */
export async function load3MF(files: File[]): Promise<ThreeMFImportResult> {
  const file = pickEntry(files, ['3mf']);
  if (!file) throw new Error('No .3mf file in drop');

  const buffer = await file.arrayBuffer();
  const root = new ThreeMFLoader().parse(buffer);
  root.name = file.name;
  return { root };
}
