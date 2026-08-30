/**
 * Build `dist/ritual.html` — the whole app as one double-clickable file.
 *
 *     node tools/build-single.mjs
 *
 * No install, no server, no warning dialog, and it works on any machine with a
 * browser. Copy it to a USB stick and it runs.
 *
 * The constraint that shapes all of this: **ES modules are blocked over
 * `file://`**. A module script on a `file:` origin is refused by CORS, so the
 * 25 modules cannot stay as modules — they have to be flattened into one
 * classic `<script>`. That is what esbuild is here for (`format: 'iife'`), and
 * it is a devDependency only: the website and the desktop build both ship the
 * original source untouched.
 *
 * Everything else follows from having no files to fetch:
 *   - the five stylesheets are concatenated into one <style>
 *   - every url(../assets/…) in them becomes a data URI
 *   - the textures referenced from JS go through ASSET_MAP in
 *     src/core/assets.js, which is swapped for a populated one at bundle time
 *   - the manifest link is dropped; it would only 404
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist');

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const dataUri = (relPath) => {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`no MIME type known for ${relPath}`);
  const b64 = readFileSync(join(ROOT, relPath)).toString('base64');
  return `data:${mime};base64,${b64}`;
};

/* ── 1. the stylesheets, with every asset inlined ─────────────────────────── */

const CSS_FILES = [
  'styles/fonts.css',
  'styles/base.css',
  'styles/scene.css',
  'styles/paper.css',
  'styles/ui.css',
];

let inlinedAssets = 0;
const css = CSS_FILES.map((file) => {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  // Rewrite url(...) that point at real files. Anything else — url(#deckle) for
  // the SVG filters, and the var(--tex-*) data URIs generated at runtime — is
  // left exactly as it is.
  return raw.replace(/url\((['"]?)([^)'"]+)\1\)/g, (whole, _q, target) => {
    if (/^(data:|https?:|#)/.test(target)) return whole;
    // CSS paths are relative to the stylesheet, which lives in styles/.
    const rel = target.startsWith('../') ? target.slice(3) : `styles/${target}`;
    try {
      inlinedAssets++;
      return `url("${dataUri(rel)}")`;
    } catch (err) {
      console.warn(`  ! could not inline ${target}: ${err.message}`);
      inlinedAssets--;
      return whole;
    }
  });
}).join('\n');

/* ── 2. the JS, bundled to one IIFE with the asset map swapped in ─────────── */

// Every asset referenced from JavaScript rather than from CSS. Read straight
// out of the source so this cannot drift from what the app actually asks for.
const hands = readFileSync(join(ROOT, 'src/write/hands.js'), 'utf8');
const jsAssets = [...new Set(
  [...hands.matchAll(/'(assets\/[^']+)'/g)].map((m) => m[1])
)].sort();

const assetsModulePath = resolve(ROOT, 'src/core/assets.js');

/** Replaces src/core/assets.js with one whose ASSET_MAP is populated. */
const inlineAssetsPlugin = {
  name: 'inline-assets',
  setup(build) {
    build.onLoad({ filter: /src[\\/]core[\\/]assets\.js$/ }, (args) => {
      if (resolve(args.path) !== assetsModulePath) return null;
      const map = Object.fromEntries(jsAssets.map((p) => [p, dataUri(p)]));
      return {
        contents: `
// GENERATED for the single-file build. See tools/build-single.mjs.
export const ASSET_MAP = ${JSON.stringify(map)};
export function assetUrl(path) {
  const inlined = ASSET_MAP[path];
  if (inlined) return inlined;
  return new URL(path, document.baseURI).href;
}
`,
        loader: 'js',
      };
    });
  },
};

const bundle = await esbuild.build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome111', 'safari16.4', 'firefox113'],
  minify: true,
  write: false,
  legalComments: 'none',
  plugins: [inlineAssetsPlugin],
});
const js = bundle.outputFiles[0].text;

/* ── 3. assemble the page ─────────────────────────────────────────────────── */

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Drop the five stylesheet links and put one inline <style> in their place.
html = html.replace(
  /\n<link rel="stylesheet" href="styles\/[^"]+">/g,
  ''
).replace(
  '</head>',
  `<style>\n${css}\n</style>\n</head>`
);

// The favicon can be inlined; the manifest and the PNG icons cannot be usefully
// used from file://, so they go.
html = html
  .replace(/\n<link rel="icon" href="icon-192\.png"[^>]*>/, '')
  .replace(/\n<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\n<link rel="manifest"[^>]*>/, '')
  .replace('href="favicon.svg"', `href="${dataUri('favicon.svg')}"`);

// And the module script becomes the inline bundle.
html = html.replace(
  /<script type="module" src="src\/main\.js"><\/script>/,
  `<script>\n${js}\n</script>`
);

if (html.includes('src="src/main.js"')) throw new Error('script tag was not replaced');
if (html.includes('href="styles/')) throw new Error('a stylesheet link survived');

mkdirSync(OUT, { recursive: true });
const outFile = join(OUT, 'ritual.html');
writeFileSync(outFile, html, 'utf8');

const mb = (statSync(outFile).size / 1048576).toFixed(2);
console.log(`dist/ritual.html  ${mb} MB`);
console.log(`  ${inlinedAssets} assets inlined from CSS`);
console.log(`  ${jsAssets.length} inlined into ASSET_MAP: ${jsAssets.map((p) => p.split('/').pop()).join(', ')}`);
console.log(`  bundle ${(js.length / 1024).toFixed(0)} KB, styles ${(css.length / 1024).toFixed(0)} KB`);
