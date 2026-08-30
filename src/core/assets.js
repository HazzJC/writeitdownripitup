/**
 * Where the bundled assets live.
 *
 * Every build serves these differently:
 *
 *   dev server / Cloudflare Pages   real files, resolved against the document
 *   Tauri                           the same real files, from the app bundle
 *   the single-file build           inlined as data URIs, no files at all
 *
 * The last one is why this exists. `build-single.mjs` flattens the whole app
 * into one .html that opens over `file://`, which means there are no asset
 * files left to fetch — so it replaces `ASSET_MAP` below with a
 * path → data-URI table. Routing every asset reference through one function
 * keeps that swap explicit and greppable, instead of the build having to
 * string-replace base64 blobs into a bundle and hope.
 */

/**
 * Populated only by the single-file build. Left empty everywhere else, in
 * which case paths resolve against the document as normal.
 */
export const ASSET_MAP = {};

/**
 * Resolve a bundled asset path to something usable in `url(...)` or `src`.
 *
 * Note this is deliberately resolved against `document.baseURI` rather than
 * left relative: a bare relative path inside a CSS custom property is resolved
 * against the *stylesheet* that consumes it, not the element it is set on, so
 * `assets/textures/x.jpg` would be looked for under `/styles/`.
 */
export function assetUrl(path) {
  const inlined = ASSET_MAP[path];
  if (inlined) return inlined;
  return new URL(path, document.baseURI).href;
}
