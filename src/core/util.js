// Small math helpers shared across the storm, scene and audio engines.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** Remap v from [a,b] into [0,1], clamped. */
export const norm = (v, a, b) => clamp01(invLerp(a, b, v));

/** Classic smoothstep easing. */
export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t) => Math.pow(clamp01(t), 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/**
 * Frame-rate independent exponential glide toward `target`.
 * `tau` is the time constant in seconds: after ~3*tau we are ~95% of the way there.
 */
export const glide = (current, target, tau, dt) => {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
};

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** Gaussian-ish value in roughly [-1,1] via the sum of uniforms. */
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export const TAU = Math.PI * 2;

/** Convert 0..1 to a decibel-ish gain curve so faders feel natural. */
export const gainCurve = (v) => clamp01(v) ** 1.8;

export const now = () => performance.now() / 1000;
