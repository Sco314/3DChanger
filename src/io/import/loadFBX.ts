import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import { makeFileManager, pickEntry, type FileMap } from '../dropFiles.js';

export interface FBXImportResult {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/**
 * Load an FBX file. FBX is a binary or ASCII container that may reference
 * sibling textures by relative path; the LoadingManager URL modifier
 * resolves those against the dropped file map.
 */
export async function loadFBX(files: File[], fileMap: FileMap): Promise<FBXImportResult> {
  const file = pickEntry(files, ['fbx']);
  if (!file) throw new Error('No .fbx file in drop');

  const { manager, dispose } = makeFileManager(fileMap);
  try {
    const buffer = await file.arrayBuffer();
    const root = new FBXLoader(manager).parse(buffer, '');
    // FBXLoader stuffs animations onto the returned object's `.animations`.
    const animations = (root as { animations?: THREE.AnimationClip[] }).animations ?? [];
    return { root, animations };
  } finally {
    dispose();
  }
}
