import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

import { makeFileManager, pickEntry, type FileMap } from '../dropFiles.js';

export interface OBJImportResult {
  root: THREE.Object3D;
}

/**
 * Load OBJ + optional MTL + textures. The user can drop:
 *   - a single .obj
 *   - .obj + .mtl
 *   - .obj + .mtl + image files (png/jpg/...)
 *
 * We parse MTL first so OBJLoader can attach materials to named groups.
 */
export async function loadOBJ(files: File[], fileMap: FileMap): Promise<OBJImportResult> {
  const objFile = pickEntry(files, ['obj']);
  if (!objFile) throw new Error('No .obj file in drop');
  const mtlFile = pickEntry(files, ['mtl']);

  const { manager, dispose } = makeFileManager(fileMap);

  try {
    const objLoader = new OBJLoader(manager);

    if (mtlFile) {
      const mtlText = await mtlFile.text();
      const mtlLoader = new MTLLoader(manager);
      const materials = mtlLoader.parse(mtlText, '');
      materials.preload();
      objLoader.setMaterials(materials);
    }

    const objText = await objFile.text();
    const root = objLoader.parse(objText);
    root.name = objFile.name;
    return { root };
  } finally {
    dispose();
  }
}
