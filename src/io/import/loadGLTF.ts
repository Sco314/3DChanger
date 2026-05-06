import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { ext, makeFileManager, pickEntry, type FileMap } from '../dropFiles.js';

export interface GLTFImportResult {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/**
 * Load a glTF or GLB. For GLB: pass a single File. For glTF: pass all sibling
 * files (the .gltf JSON, .bin buffers, and texture images) and we'll resolve
 * references via a LoadingManager URL modifier.
 *
 * Renderer is required so KTX2Loader can detect supported texture compression
 * formats; pass it through from the Editor.
 */
export async function loadGLTF(
  files: File[],
  fileMap: FileMap,
  renderer: THREE.WebGLRenderer,
): Promise<GLTFImportResult> {
  const entry = pickEntry(files, ['glb', 'gltf']);
  if (!entry) throw new Error('No .glb or .gltf file in drop');

  const { manager, dispose } = makeFileManager(fileMap);

  // Decoder paths must be absolute URLs. DRACOLoader spawns a Web Worker
  // built from a blob: URL; relative paths inside the worker resolve
  // against that blob URL and break. document.baseURI is the deployment
  // root (e.g. https://user.github.io/3DChanger/), so new URL('draco/',
  // baseURI).href yields the right absolute path in dev and prod.
  const dracoPath = new URL('draco/', document.baseURI).href;
  const basisPath = new URL('basis/', document.baseURI).href;
  const draco = new DRACOLoader(manager).setDecoderPath(dracoPath);
  const ktx2 = new KTX2Loader(manager).setTranscoderPath(basisPath).detectSupport(renderer);

  const loader = new GLTFLoader(manager)
    .setDRACOLoader(draco)
    .setKTX2Loader(ktx2)
    .setMeshoptDecoder(MeshoptDecoder);

  try {
    const gltf: GLTF = await new Promise((resolve, reject) => {
      const isBinary = ext(entry.name) === 'glb';
      if (isBinary) {
        entry.arrayBuffer().then(
          (ab) => loader.parse(ab, '', resolve, reject),
          reject,
        );
      } else {
        const url = URL.createObjectURL(entry);
        loader.load(url, (g) => { URL.revokeObjectURL(url); resolve(g); }, undefined, (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        });
      }
    });
    return { root: gltf.scene, animations: gltf.animations ?? [] };
  } finally {
    draco.dispose();
    ktx2.dispose();
    dispose();
  }
}
