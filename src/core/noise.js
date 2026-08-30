// Deterministic value/simplex-ish noise used for textures, flame motion and rain.

/** Mulberry32 — small, fast, seedable PRNG. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 2D value noise with a permutation table. Cheap and smooth enough for texture work. */
export function makeNoise2D(seed = 1337) {
  const rng = makeRng(seed);
  const size = 256;
  const grad = new Float32Array(size * size);
  for (let i = 0; i < grad.length; i++) grad[i] = rng();

  const at = (x, y) => grad[((y & 255) << 8) | (x & 255)];

  return function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf) * 2 - 1;
  };
}

/** Fractal brownian motion over any 2D noise function. */
export function fbm(noise2, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 1D smooth noise — handy for flicker and flame sway. */
export function makeNoise1D(seed = 7) {
  const rng = makeRng(seed);
  const table = new Float32Array(512);
  for (let i = 0; i < table.length; i++) table[i] = rng() * 2 - 1;
  return function noise1(x) {
    const xi = Math.floor(x);
    const xf = fade(x - xi);
    return lerp(table[xi & 511], table[(xi + 1) & 511], xf);
  };
}
