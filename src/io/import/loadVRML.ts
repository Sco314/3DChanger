import type * as THREE from 'three';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';

import { pickEntry } from '../dropFiles.js';

export interface VRMLImportResult { root: THREE.Object3D; }

/**
 * Load a VRML (.wrl) file. VRMLLoader does not honor LoadingManager for
 * referenced textures (its parser is text-only), so external image refs
 * inside a WRL won't resolve. The geometry/colors still load fine.
 */
export async function loadVRML(files: File[]): Promise<VRMLImportResult> {
  const file = pickEntry(files, ['wrl']);
  if (!file) throw new Error('No .wrl file in drop');

  const text = await file.text();
  const root = new VRMLLoader().parse(text, '');
  root.name = file.name;
  return { root };
}
