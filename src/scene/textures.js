/**
 * Procedural textures generated once at startup and handed to CSS as data URIs.
 *
 * These are the things that have to *tile* and have to carry alpha, which is
 * exactly what CSS gradients are bad at — a `radial-gradient` repeated on a
 * fixed grid reads as a grid of dots, never as lace.
 */

import { makeRng, makeNoise2D, fbm } from '../core/noise.js';
import { clamp01, TAU } from '../core/util.js';

/**
 * A tileable panel of cotton lace.
 *
 * Real lace is a fine net carrying heavier motifs, and the *net* is what your
 * eye reads first — an even field of dots reads as printed spots on the glass.
 * So: a diamond mesh of thin threads, thickened irregularly, with ring motifs
 * worked into it at a larger interval, and the whole thing modulated by noise
 * so no two cells are identical.
 */
export function makeLaceTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  const rng = makeRng(4711);
  const n = makeNoise2D(913);

  g.clearRect(0, 0, size, size);
  g.lineCap = 'round';

  // --- the net -----------------------------------------------------------
  // Diamond mesh: two sets of diagonals. Drawn past the edges and wrapped by
  // the modulo spacing so the tile joins seamlessly.
  const cell = size / 8;
  const thread = (x1, y1, x2, y2, alpha, width) => {
    g.strokeStyle = `rgba(238, 232, 214, ${alpha})`;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };

  for (let i = -8; i <= 16; i++) {
    const o = i * cell;
    // Thread weight wanders, so the mesh looks worked rather than printed.
    const a1 = 0.30 + rng() * 0.30;
    const a2 = 0.30 + rng() * 0.30;
    thread(o, 0, o + size, size, a1, 0.7 + rng() * 0.5);
    thread(o, size, o + size, 0, a2, 0.7 + rng() * 0.5);
  }

  // --- motifs ------------------------------------------------------------
  // Worked rings at the mesh intersections, on a coarser lattice.
  const motif = size / 2;
  for (let my = 0; my < 2; my++) {
    for (let mx = 0; mx < 2; mx++) {
      const cx = (mx + 0.5) * motif;
      const cy = (my + 0.5) * motif;
      const r = motif * (0.22 + rng() * 0.06);

      g.strokeStyle = `rgba(242, 236, 220, ${0.5 + rng() * 0.25})`;
      g.lineWidth = 1.5 + rng();
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();

      // Petals around the ring — the openwork.
      const petals = 6 + Math.floor(rng() * 3);
      for (let p = 0; p < petals; p++) {
        const a = (p / petals) * TAU + rng() * 0.2;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r,
          r * (0.3 + rng() * 0.12), 0, TAU);
        g.strokeStyle = `rgba(240, 234, 218, ${0.28 + rng() * 0.2})`;
        g.lineWidth = 0.9;
        g.stroke();
      }

      // A solid heart to the motif, where the thread is densest.
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55);
      gr.addColorStop(0, 'rgba(240, 234, 218, 0.42)');
      gr.addColorStop(1, 'rgba(240, 234, 218, 0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, r * 0.55, 0, TAU); g.fill();
    }
  }

  // --- wear --------------------------------------------------------------
  // Thin the whole cloth unevenly. Old lace is not uniformly opaque.
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (d[i + 3] === 0) continue;
      // Wrapped noise, so the thinning tiles with the mesh.
      const a = (x / size) * TAU, b = (y / size) * TAU;
      const v = fbm(n, Math.cos(a) * 2 + 5, Math.cos(b) * 2 + 9, 3, 2, 0.5);
      d[i + 3] = clamp01(d[i + 3] / 255 * (0.65 + v * 0.5 + 0.35)) * 255;
    }
  }
  g.putImageData(img, 0, 0);

  return cv.toDataURL('image/png');
}

/**
 * Film grain: a tileable field of dark monochrome noise, laid over the whole
 * scene with `screen`.
 *
 * The obvious approach — mid-grey noise blended with `overlay` — is almost
 * exactly inert here, because overlay against a dark backdrop reduces to
 * `2 * base * blend`: at a backdrop luminance of 0.1 a full-swing grey noise
 * moves the result by about two levels out of 255. On a scene this dark it
 * simply does not show up.
 *
 * Dark noise through `screen` behaves the opposite way round: it adds roughly
 * `blend * (1 - base)`, so it bites hardest in the shadows and fades out in
 * the highlights. That also happens to be how real film grain reads, which is
 * why it looks like photography rather than like added static.
 */
export function makeGrainTexture(size = 160) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const rng = makeRng(1234);

  for (let i = 0; i < size * size; i++) {
    // Gaussian-ish, so the grain clusters into clumps rather than being flat
    // static, then biased dark so `screen` has something quiet to add.
    const v = (rng() + rng() + rng()) / 3;
    const c = Math.round(Math.pow(v, 1.7) * 74);
    const j = i * 4;
    d[j] = c; d[j + 1] = c; d[j + 2] = Math.round(c * 1.06);
    d[j + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/**
 * Grime: soft irregular blotches for the glass and the wood, so surfaces are
 * not evenly clean. Tiles, carries alpha, and is deliberately low-contrast.
 */
export function makeGrimeTexture(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  const n = makeNoise2D(551);
  const img = g.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Toroidal sampling keeps it seamless in both directions.
      const a = (x / size) * TAU, b = (y / size) * TAU;
      const nx = Math.cos(a) * 1.6, ny = Math.sin(a) * 1.6;
      const nz = Math.cos(b) * 1.6, nw = Math.sin(b) * 1.6;
      let v = fbm(n, nx + nz + 12, ny + nw + 30, 5, 2.1, 0.55);
      v = clamp01((v + 1) * 0.5);
      v = Math.pow(v, 2.2);
      const i = (y * size + x) * 4;
      d[i] = 40; d[i + 1] = 34; d[i + 2] = 26;
      d[i + 3] = v * 150;
    }
  }
  g.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/** Generate everything once and publish it to CSS as custom properties. */
export function installTextures(root = document.documentElement) {
  root.style.setProperty('--tex-lace', `url("${makeLaceTexture(128)}")`);
  root.style.setProperty('--tex-grain', `url("${makeGrainTexture(160)}")`);
  root.style.setProperty('--tex-grime', `url("${makeGrimeTexture(256)}")`);
}
