/**
 * Haptics, driven by the same intensity meter as everything else.
 *
 * `navigator.vibrate` only exists on Android browsers, is ignored without a
 * prior user gesture, and is silently absent on iOS and desktop — so every call
 * is guarded and failure is not interesting. Nothing here is load-bearing.
 *
 * Patterns are shaped like the sound they accompany: a distant rumble is a long
 * soft roll, an overhead crack is a short hard hit followed by the tail.
 */

import { clamp01, lerp } from '../core/util.js';

export class Haptics {
  constructor() {
    this.enabled = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    this.muted = false;
    this.lastAt = 0;
  }

  setMuted(m) { this.muted = m; }

  fire(pattern) {
    if (!this.enabled || this.muted) return;
    // Don't stack patterns on top of each other.
    const now = performance.now();
    if (now - this.lastAt < 260) return;
    this.lastAt = now;
    try { navigator.vibrate(pattern); } catch (_) { /* not available; fine */ }
  }

  /**
   * Thunder. `distance` 0 = overhead, 1 = far off.
   * @param {number} level overall strength 0..1
   */
  thunder(distance, level = 1) {
    const near = clamp01(1 - distance) * clamp01(level);
    if (near < 0.12) return;   // too far away to feel

    if (near > 0.7) {
      // A close strike: the crack, a gap, then the rolling tail.
      this.fire([Math.round(lerp(20, 55, near)), 40, Math.round(lerp(60, 160, near)),
                 70, Math.round(lerp(30, 90, near))]);
    } else {
      // A distant roll: one long, gentle pulse.
      this.fire([Math.round(lerp(40, 120, near))]);
    }
  }

  /** The seal completing its hold. */
  sealComplete() {
    this.fire([18, 30, 18]);
  }

  /** The page catching light. */
  ignite() {
    this.fire([30, 50, 90, 40, 140]);
  }

  /** Picking something up off the desk. */
  tick() {
    this.fire(8);
  }

  stop() {
    if (!this.enabled) return;
    try { navigator.vibrate(0); } catch (_) {}
  }
}
