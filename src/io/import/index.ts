import * as THREE from 'three';

import { buildFileMap, ext } from '../dropFiles.js';
import { loadGLTF } from './loadGLTF.js';
import { loadOBJ } from './loadOBJ.js';
import { loadSTL } from './loadSTL.js';

export type ImportFormat = 'gltf' | 'obj' | 'stl';

export interface ImportResult {
  format: ImportFormat;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export function detectFormat(files: File[]): ImportFormat | undefined {
  const exts = new Set(files.map((f) => ext(f.name)));
  if (exts.has('glb') || exts.has('gltf')) return 'gltf';
  if (exts.has('obj')) return 'obj';
  if (exts.has('stl')) return 'stl';
  return undefined;
}

/** Top-level dispatch by extension. */
export async function importFiles(
  files: File[],
  renderer: THREE.WebGLRenderer,
): Promise<ImportResult> {
  const format = detectFormat(files);
  if (!format) throw new Error('Unsupported format. Slice 1 supports GLB/glTF, OBJ, STL.');

  const map = buildFileMap(files);
  switch (format) {
    case 'gltf': {
      const { root, animations } = await loadGLTF(files, map, renderer);
      return { format, root, animations };
    }
    case 'obj': {
      const { root } = await loadOBJ(files, map);
      return { format, root, animations: [] };
    }
    case 'stl': {
      const { root } = await loadSTL(files);
      return { format, root, animations: [] };
    }
  }
}
