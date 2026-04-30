// Copies Draco and KTX2/Basis decoder files from three.js into public/
// so GLTFLoader can fetch them at runtime. Runs from npm pre-dev / pre-build.

import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const pairs = [
  ['node_modules/three/examples/jsm/libs/draco/', 'public/draco/'],
  ['node_modules/three/examples/jsm/libs/basis/', 'public/basis/'],
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

for (const [from, to] of pairs) {
  const src = resolve(root, from);
  const dst = resolve(root, to);
  if (!(await exists(src))) {
    console.warn(`[copy-decoders] skip (not found): ${from}`);
    continue;
  }
  await mkdir(dst, { recursive: true });
  await cp(src, dst, { recursive: true });
  console.log(`[copy-decoders] ${from} -> ${to}`);
}
