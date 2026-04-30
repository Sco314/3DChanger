// Helpers for accepting multi-file imports (OBJ + MTL + textures, glTF + bin + textures).
//
// We build a virtual file map keyed by lowercased basename AND lowercased
// relative path, then install a THREE.LoadingManager URL modifier that
// rewrites loader-issued URLs to blob: URLs from this map.

import * as THREE from 'three';

export type FileMap = Map<string, File>;

export function buildFileMap(files: File[]): FileMap {
  const map: FileMap = new Map();
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    map.set(rel.toLowerCase(), f);
    map.set(basename(rel).toLowerCase(), f);
  }
  return map;
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Make a LoadingManager that resolves any loader-requested URL against the
 * given file map by basename. Object URLs are tracked so they can be revoked
 * via the returned `dispose()`.
 */
export function makeFileManager(files: FileMap): {
  manager: THREE.LoadingManager;
  dispose: () => void;
} {
  const created: string[] = [];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    // Loaders sometimes pass blob:/data: URLs through here; leave those alone.
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const key = basename(decodeURI(url)).toLowerCase();
    const file = files.get(key);
    if (!file) return url;
    const obj = URL.createObjectURL(file);
    created.push(obj);
    return obj;
  });
  return {
    manager,
    dispose: () => {
      for (const u of created) URL.revokeObjectURL(u);
    },
  };
}

/** Pick the first file in `files` whose extension is in `exts`. */
export function pickEntry(files: File[], exts: string[]): File | undefined {
  for (const f of files) {
    if (exts.includes(ext(f.name))) return f;
  }
  return undefined;
}
