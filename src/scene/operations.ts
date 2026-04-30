import * as THREE from 'three';

import { isLocked } from './objectMeta.js';

/**
 * Deep clone an object as a sibling under the same parent and return the
 * clone. Refuses if the object is locked or has no parent.
 *
 * Note: three.js' Object3D.clone(true) shares geometry and material refs by
 * design — that is what we want at this slice (preserve materials). When
 * sculpt-mode lands, the brush layer must clone geometry on demand to avoid
 * deforming siblings.
 */
export function duplicateObject(obj: THREE.Object3D): THREE.Object3D | null {
  if (isLocked(obj)) return null;
  const parent = obj.parent;
  if (!parent) return null;

  const copy = obj.clone(true);
  copy.name = obj.name ? `${obj.name} (copy)` : `${obj.type} (copy)`;
  parent.add(copy);
  return copy;
}
