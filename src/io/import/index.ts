import * as THREE from 'three';

import { buildFileMap, ext } from '../dropFiles.js';
import { loadGLTF } from './loadGLTF.js';
import { loadOBJ } from './loadOBJ.js';
import { loadSTL } from './loadSTL.js';

export type ImportFormat =
  | 'gltf' | 'obj' | 'stl'    // slice 1, eager
  | 'fbx' | '3ds' | 'ply' | 'dae' | 'wrl' | '3mf';  // slice 6, lazy

export interface ImportResult {
  format: ImportFormat;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** All file extensions we recognize for import. */
export const SUPPORTED_EXTENSIONS = [
  'glb', 'gltf', 'obj', 'mtl', 'stl',
  'fbx', '3ds', 'ply', 'dae', 'wrl', '3mf',
] as const;

export function detectFormat(files: File[]): ImportFormat | undefined {
  const exts = new Set(files.map((f) => ext(f.name)));
  if (exts.has('glb') || exts.has('gltf')) return 'gltf';
  if (exts.has('obj')) return 'obj';
  if (exts.has('stl')) return 'stl';
  if (exts.has('fbx')) return 'fbx';
  if (exts.has('3ds')) return '3ds';
  if (exts.has('ply')) return 'ply';
  if (exts.has('dae')) return 'dae';
  if (exts.has('wrl')) return 'wrl';
  if (exts.has('3mf')) return '3mf';
  return undefined;
}

/**
 * Top-level dispatch by extension. Slice-1 formats (gltf/obj/stl) load eagerly
 * because they're tiny. Slice-6 formats are dynamically imported so their
 * loader code only ships to users who actually drop a matching file.
 */
export async function importFiles(
  files: File[],
  renderer: THREE.WebGLRenderer,
): Promise<ImportResult> {
  const format = detectFormat(files);
  if (!format) {
    throw new Error(
      `Unsupported format. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    );
  }

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
    case 'fbx': {
      const mod = await import('./loadFBX.js');
      const { root, animations } = await mod.loadFBX(files, map);
      return { format, root, animations };
    }
    case '3ds': {
      const mod = await import('./load3DS.js');
      const { root } = await mod.load3DS(files, map);
      return { format, root, animations: [] };
    }
    case 'ply': {
      const mod = await import('./loadPLY.js');
      const { root } = await mod.loadPLY(files);
      return { format, root, animations: [] };
    }
    case 'dae': {
      const mod = await import('./loadDAE.js');
      const { root, animations } = await mod.loadDAE(files, map);
      return { format, root, animations };
    }
    case 'wrl': {
      const mod = await import('./loadVRML.js');
      const { root } = await mod.loadVRML(files);
      return { format, root, animations: [] };
    }
    case '3mf': {
      const mod = await import('./load3MF.js');
      const { root } = await mod.load3MF(files);
      return { format, root, animations: [] };
    }
  }
}
