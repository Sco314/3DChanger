import type * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

import { makeFileManager, pickEntry, type FileMap } from '../dropFiles.js';

export interface DAEImportResult {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/**
 * Load a Collada (.dae) file. Returns the parsed scene plus any animation
 * clips Collada describes via its `library_animations` block.
 */
export async function loadDAE(files: File[], fileMap: FileMap): Promise<DAEImportResult> {
  const file = pickEntry(files, ['dae']);
  if (!file) throw new Error('No .dae file in drop');

  const { manager, dispose } = makeFileManager(fileMap);
  try {
    const text = await file.text();
    const result = new ColladaLoader(manager).parse(text, '');
    const root = result.scene;
    const animations = (result as { animations?: THREE.AnimationClip[] }).animations ?? [];
    return { root, animations };
  } finally {
    dispose();
  }
}
