import * as THREE from 'three';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';

import { makeFileManager, pickEntry, type FileMap } from '../dropFiles.js';

export interface TDSImportResult { root: THREE.Object3D; }

/** Load a legacy 3D Studio (.3ds) file. Materials/textures go through the
 *  LoadingManager so sibling images resolve. */
export async function load3DS(files: File[], fileMap: FileMap): Promise<TDSImportResult> {
  const file = pickEntry(files, ['3ds']);
  if (!file) throw new Error('No .3ds file in drop');

  const { manager, dispose } = makeFileManager(fileMap);
  try {
    const buffer = await file.arrayBuffer();
    const root = new TDSLoader(manager).parse(buffer, '');
    return { root };
  } finally {
    dispose();
  }
}
