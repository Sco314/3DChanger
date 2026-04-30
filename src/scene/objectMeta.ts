import type * as THREE from 'three';

/**
 * Editor-side per-object flags. Stored in obj.userData.editor so they survive
 * scene clones and any future serialization without polluting the Object3D
 * type itself.
 */
export interface EditorMeta {
  locked?: boolean;
}

export function getMeta(obj: THREE.Object3D): EditorMeta {
  const ud = obj.userData as { editor?: EditorMeta };
  if (!ud.editor) ud.editor = {};
  return ud.editor;
}

export function isLocked(obj: THREE.Object3D): boolean {
  return getMeta(obj).locked === true;
}

export function setLocked(obj: THREE.Object3D, locked: boolean): void {
  getMeta(obj).locked = locked;
}
