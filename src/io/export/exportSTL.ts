import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

import { saveBlob } from './saveBlob.js';

/** Binary STL (geometry only). */
export function exportSTL(root: THREE.Object3D, filename: string): void {
  const data = new STLExporter().parse(root, { binary: true });
  // STLExporter returns a DataView when binary:true.
  const buf = (data as DataView).buffer;
  const view = new Uint8Array(buf as ArrayBuffer);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  saveBlob(new Blob([copy.buffer], { type: 'model/stl' }), filename);
}
