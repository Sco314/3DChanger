import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

import { saveBlob } from './saveBlob.js';

/**
 * Export to OBJ. three.js' OBJExporter emits geometry only — no MTL, no
 * textures. A faithful MTL writer is a follow-up; for now this is
 * "geometry-only OBJ" and the diagnostics panel will reflect that on
 * re-import.
 */
export function exportOBJ(root: THREE.Object3D, filename: string): void {
  const text = new OBJExporter().parse(root);
  saveBlob(new Blob([text], { type: 'text/plain' }), filename);
}
