import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { zipSync, strToU8 } from 'fflate';

import { saveBlob } from './saveBlob.js';

export interface ExportGLTFOptions {
  animations?: THREE.AnimationClip[];
}

/**
 * Export a glTF folder bundled into a zip. The folder layout is:
 *   <name>.gltf
 *   <name>.bin       (one buffer)
 *   *.png|*.jpg      (external textures, when present)
 */
export async function exportGLTFZip(
  root: THREE.Object3D,
  zipName: string,
  opts: ExportGLTFOptions = {},
): Promise<void> {
  const exporter = new GLTFExporter();
  const result = await new Promise<unknown>((resolve, reject) => {
    exporter.parse(
      root,
      (r) => resolve(r),
      (err) => reject(err),
      {
        binary: false,
        animations: opts.animations ?? [],
        // embedImages defaults to true; when false, GLTFExporter emits the
        // images as data URIs in the JSON. We post-process below to externalize.
      },
    );
  });

  const baseName = zipName.replace(/\.zip$/i, '');
  const files: Record<string, Uint8Array> = {};
  const json = result as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };

  await externalizeBuffers(json, baseName, files);
  await externalizeImages(json, files);

  files[`${baseName}.gltf`] = strToU8(JSON.stringify(json, null, 2));

  const zipped = zipSync(files);
  // Copy into a fresh ArrayBuffer so Blob ctor sees a plain ArrayBuffer view.
  const out = new Uint8Array(zipped.byteLength);
  out.set(zipped);
  saveBlob(new Blob([out.buffer], { type: 'application/zip' }), zipName);
}

async function externalizeBuffers(
  json: { buffers?: Array<{ uri?: string }> },
  baseName: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  if (!json.buffers) return;
  let idx = 0;
  for (const buf of json.buffers) {
    if (!buf.uri || !buf.uri.startsWith('data:')) continue;
    const bytes = dataUriToBytes(buf.uri);
    const name = idx === 0 ? `${baseName}.bin` : `${baseName}.${idx}.bin`;
    files[name] = bytes;
    buf.uri = name;
    idx++;
  }
}

async function externalizeImages(
  json: { images?: Array<{ uri?: string; mimeType?: string }> },
  files: Record<string, Uint8Array>,
): Promise<void> {
  if (!json.images) return;
  json.images.forEach((img, i) => {
    if (!img.uri || !img.uri.startsWith('data:')) return;
    const bytes = dataUriToBytes(img.uri);
    const ext = mimeToExt(img.mimeType ?? extractMimeFromDataUri(img.uri));
    const name = `texture_${i}.${ext}`;
    files[name] = bytes;
    img.uri = name;
  });
}

function dataUriToBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  const meta = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return strToU8(decodeURIComponent(data));
}

function extractMimeFromDataUri(uri: string): string {
  const m = uri.match(/^data:([^;,]+)/);
  return m ? m[1]! : 'application/octet-stream';
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/ktx2': return 'ktx2';
    default: return 'bin';
  }
}
