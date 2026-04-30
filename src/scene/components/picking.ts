import * as THREE from 'three';

import { getAdjacency } from './MeshAdjacency.js';
import { edgeKey, type EdgeKey } from './types.js';

const NDC = new THREE.Vector2();
const RAY = new THREE.Raycaster();
const LOCAL_POINT = new THREE.Vector3();
const VA = new THREE.Vector3();
const VB = new THREE.Vector3();
const VC = new THREE.Vector3();

export interface ComponentHit {
  mesh: THREE.Mesh;
  faceIndex: number;
  /** Welded vertex indices for the three triangle corners. */
  weldedVerts: [number, number, number];
  /** Closest welded vertex to the hit point. */
  nearestVertex: number;
  /** Edge key for the edge of the triangle closest to the hit point. */
  nearestEdge: EdgeKey;
  /** Hit point in mesh-local space. */
  pointLocal: THREE.Vector3;
}

/**
 * Pick a triangle on any visible Mesh under `root`. Returns the closest
 * vertex (welded) and edge key on that triangle, both for use with
 * ComponentSelection's toggleEdge / toggleVertex APIs.
 */
export function pickComponent(
  event: PointerEvent | MouseEvent,
  domElement: HTMLElement,
  camera: THREE.Camera,
  root: THREE.Object3D,
): ComponentHit | null {
  const rect = domElement.getBoundingClientRect();
  NDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  NDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  RAY.setFromCamera(NDC, camera);

  const hits = RAY.intersectObject(root, true);
  for (const hit of hits) {
    const obj = hit.object;
    if (!(obj as unknown as { isMesh?: boolean }).isMesh) continue;

    // Skip if any ancestor is hidden.
    let visible = true;
    for (let cur: THREE.Object3D | null = obj; cur; cur = cur.parent) {
      if (!cur.visible) { visible = false; break; }
    }
    if (!visible) continue;
    if (hit.faceIndex == null) continue;

    const mesh = obj as THREE.Mesh;
    const adj = getAdjacency(mesh);
    if (hit.faceIndex >= adj.faceCount) continue;

    const f = hit.faceIndex;
    const wa = adj.weldedFaceVerts[f * 3]!;
    const wb = adj.weldedFaceVerts[f * 3 + 1]!;
    const wc = adj.weldedFaceVerts[f * 3 + 2]!;

    // Transform hit point (world) into mesh-local space.
    mesh.updateMatrixWorld();
    LOCAL_POINT.copy(hit.point).applyMatrix4(
      new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
    );

    // Triangle vertex positions in mesh-local space.
    const pos = (mesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
    VA.fromBufferAttribute(pos, adj.faceVerts[f * 3]!);
    VB.fromBufferAttribute(pos, adj.faceVerts[f * 3 + 1]!);
    VC.fromBufferAttribute(pos, adj.faceVerts[f * 3 + 2]!);

    const dA = VA.distanceToSquared(LOCAL_POINT);
    const dB = VB.distanceToSquared(LOCAL_POINT);
    const dC = VC.distanceToSquared(LOCAL_POINT);
    let nearestVertex = wa;
    let nearestD = dA;
    if (dB < nearestD) { nearestVertex = wb; nearestD = dB; }
    if (dC < nearestD) { nearestVertex = wc; nearestD = dC; }

    // Closest edge by point-to-segment distance.
    const eAB = pointSegSq(LOCAL_POINT, VA, VB);
    const eBC = pointSegSq(LOCAL_POINT, VB, VC);
    const eCA = pointSegSq(LOCAL_POINT, VC, VA);
    let nearestEdge: EdgeKey = edgeKey(wa, wb);
    let bestE = eAB;
    if (eBC < bestE) { nearestEdge = edgeKey(wb, wc); bestE = eBC; }
    if (eCA < bestE) { nearestEdge = edgeKey(wc, wa); bestE = eCA; }

    return {
      mesh,
      faceIndex: f,
      weldedVerts: [wa, wb, wc],
      nearestVertex,
      nearestEdge,
      pointLocal: LOCAL_POINT.clone(),
    };
  }
  return null;
}

const TMP_AB = new THREE.Vector3();
const TMP_AP = new THREE.Vector3();
const TMP_PROJ = new THREE.Vector3();

function pointSegSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  TMP_AB.subVectors(b, a);
  TMP_AP.subVectors(p, a);
  const ab2 = TMP_AB.dot(TMP_AB);
  const t = ab2 > 0 ? Math.max(0, Math.min(1, TMP_AP.dot(TMP_AB) / ab2)) : 0;
  TMP_PROJ.copy(a).addScaledVector(TMP_AB, t);
  return TMP_PROJ.distanceToSquared(p);
}
