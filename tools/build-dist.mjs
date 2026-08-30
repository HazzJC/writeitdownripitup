/**
 * Copy just the app into `dist/app/` — the tree the desktop build bundles.
 *
 *     node tools/build-dist.mjs
 *
 * The website does not use this. Cloudflare Pages serves the repo root directly
 * with no build command, which is the most robust configuration available
 * because there is nothing between a push and a working site that can fail.
 * Shipping a README and a dev server alongside it costs 12 KB and nobody minds.
 *
 * Tauri is different: it copies whatever `frontendDist` points at straight into
 * the binary. Pointed at the repo root it would swallow `node_modules`, `.git`
 * and `dist` itself, so it gets a clean tree instead.
 */

import { cpSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist', 'app');

// Everything the app needs to run, and nothing else. Note the absence of
// sw.js and manifest.webmanifest: a service worker inside a desktop app is a
// cache for files that are already local, and a version to keep in step for
// no reason. src/main.js skips registering it outside http(s) anyway.
const ENTRIES = [
  'index.html',
  'favicon.svg',
  'src',
  'styles',
  'assets/fonts',
  'assets/textures',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let files = 0;
let bytes = 0;
const measure = (p) => {
  const s = statSync(p);
  if (s.isDirectory()) for (const n of readdirSync(p)) measure(join(p, n));
  else { files++; bytes += s.size; }
};

for (const entry of ENTRIES) {
  const from = join(ROOT, entry);
  if (!existsSync(from)) throw new Error(`missing: ${entry}`);
  const to = join(OUT, entry);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(from, to, { recursive: true });
  measure(from);
}

console.log(`dist/app  ${files} files, ${(bytes / 1048576).toFixed(2)} MB`);
