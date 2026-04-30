import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { WebIO } from '@gltf-transform/core';
import { dedup, prune } from '@gltf-transform/functions';

import { saveBlob } from './saveBlob.js';

export interface ExportGLBOptions {
  /** If true, skip the gltf-transform dedup/prune cleanup pass. */
  raw?: boolean;
  /** Animations to embed (clips that came in with the model). */
  animations?: THREE.AnimationClip[];
}

async function exportSceneToGLB(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      { binary: true, animations, embedImages: true },
    );
  });
}

/**
 * Export to GLB. By default runs the result through gltf-transform's dedup +
 * prune passes to remove duplicate textures/buffers and unused references.
 * Call with { raw: true } to bypass cleanup.
 */
export async function exportGLB(
  root: THREE.Object3D,
  filename: string,
  opts: ExportGLBOptions = {},
): Promise<void> {
  const ab = await exportSceneToGLB(root, opts.animations ?? []);

  let outBytes: Uint8Array;
  if (opts.raw) {
    outBytes = new Uint8Array(ab);
  } else {
    const io = new WebIO();
    const doc = await io.readBinary(new Uint8Array(ab));
    await doc.transform(dedup(), prune());
    outBytes = await io.writeBinary(doc);
  }

  // Use a fresh ArrayBuffer to avoid SharedArrayBuffer-typed views from
  // upstream APIs leaking into the Blob constructor's type expectations.
  const view = new Uint8Array(outBytes.byteLength);
  view.set(outBytes);
  saveBlob(new Blob([view.buffer], { type: 'model/gltf-binary' }), filename);
}
