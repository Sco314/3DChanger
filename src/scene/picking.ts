import * as THREE from 'three';

const NDC = new THREE.Vector2();
const RAY = new THREE.Raycaster();

/**
 * Cast a ray from the camera through the pointer event's screen position and
 * return the closest visible Mesh hit under `root`, or null if nothing is hit.
 */
export function pickObject(
  event: PointerEvent | MouseEvent,
  domElement: HTMLElement,
  camera: THREE.Camera,
  root: THREE.Object3D,
): THREE.Object3D | null {
  const rect = domElement.getBoundingClientRect();
  NDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  NDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  RAY.setFromCamera(NDC, camera);
  const hits = RAY.intersectObject(root, true);
  for (const hit of hits) {
    // Skip hits on hidden objects or invisible ancestors.
    let visible = true;
    for (let cur: THREE.Object3D | null = hit.object; cur; cur = cur.parent) {
      if (!cur.visible) { visible = false; break; }
    }
    if (visible) return hit.object;
  }
  return null;
}
