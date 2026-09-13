/**
 * The lighting engine.
 *
 * Two real light sources plus an ambient term:
 *
 *   candle    warm, close, unstable. Flicker is layered noise plus occasional
 *             gusts, and the gusts get worse as the storm builds.
 *   lightning cold, distant, violent. A strike is a short burst of 2-4 pulses
 *             with an afterglow, not a single flat flash.
 *   ambient   the last of the evening behind the cloud, which the storm eats.
 *
 * Every frame it writes CSS custom properties on :root so the DOM scene reacts,
 * and exposes the same numbers to the canvas renderers.
 */

import { clamp01, lerp, rand } from '../core/util.js';
import { makeNoise1D } from '../core/noise.js';

export class LightingEngine {
  constructor(root = document.documentElement) {
    this.root = root;
    this.t = 0;

    // --- candle ---
    this.candle = {
      lit: true,
      base: 1.0,        // steady output
      flicker: 1.0,     // multiplier, ~0.7..1.25
      value: 1.0,       // base * flicker, published
      gust: 0,          // decaying impulse from a draught
      gustTimer: rand(3, 9),
      x: 0.5, y: 0.5,   // screen-space position, set by the candle renderer
      warmth: 1,
    };
    this.nFlicker = makeNoise1D(11);
    this.nFlicker2 = makeNoise1D(29);

    // --- lightning ---
    this.flash = 0;           // 0..1 published brightness
    this.flashPulses = [];    // active pulse envelopes
    this.flashSeed = 0;       // changes per strike so bolts differ
    this.lastFlashAt = -999;
    this.flashDistance = 0.5;

    // --- ambient ---
    this.ambient = 0.35;
    this.intensity = 0;

    // The colour the room settles to, blended between candle warmth and the
    // cold blue of the window.
    this.warmMix = 1;

    // What CSS last saw. See publish().
    this.slowCandle = 1;
    this.candleAge = 1;
    this.published = {};
    this.lightwash = null;
    this.lastWash = '';
  }

  /**
   * Trigger a strike.
   * @param {number}  distance 0 = overhead, 1 = far
   * @param {number}  level    brightness multiplier
   * @param {boolean} grand    the single strike on release. An ordinary flash
   *                           is over in a fifth of a second, which is right
   *                           for weather but far too quick for the moment the
   *                           whole session has been building toward — this one
   *                           holds the room white and takes seconds to fade.
   */
  strike(distance = 0.5, level = 1, grand = false) {
    this.flashSeed = Math.random() * 1000;
    this.flashDistance = clamp01(distance);
    this.lastFlashAt = this.t;

    const near = 1 - this.flashDistance;
    const count = 2 + Math.floor(rand(0, 3) * (0.4 + near));
    const amp = lerp(0.28, 1.0, near) * level;

    this.flashPulses.length = 0;

    if (grand) {
      // Hold, then release. A plateau at full brightness is what makes it read
      // as one enormous strike rather than as another flicker.
      this.flashPulses.push({ t: 0, peak: amp * 1.3, rise: 0.03, hold: 0.16, fall: 0.85 });
      this.flashPulses.push({ t: -0.22, peak: amp * 0.8, rise: 0.02, hold: 0.06, fall: 0.55 });
      this.flashPulses.push({ t: -0.44, peak: amp * 0.5, rise: 0.02, hold: 0, fall: 1.1 });
      // And an afterglow that takes its time going out.
      this.flashPulses.push({ t: -0.1, peak: amp * 0.22, rise: 0.2, hold: 0.4, fall: 3.4 });
      this.grandUntil = this.t + 5;
    } else {
      let delay = 0;
      for (let i = 0; i < count; i++) {
        this.flashPulses.push({
          t: -delay,
          // The first pulse is the brightest; the rest are stutters.
          peak: amp * (i === 0 ? 1 : rand(0.25, 0.7)),
          rise: rand(0.008, 0.03),
          hold: 0,
          fall: rand(0.06, 0.22) * lerp(0.7, 1.6, this.flashDistance),
        });
        delay += rand(0.03, 0.16);
      }
      // A long, dim afterglow reading as cloud-to-cloud illumination.
      this.flashPulses.push({
        t: -rand(0.0, 0.1),
        peak: amp * 0.16,
        rise: 0.05,
        hold: 0,
        fall: rand(0.5, 1.3),
      });
    }

    // A strike disturbs the flame a moment later, as if the air moved.
    this.candle.gust = Math.max(this.candle.gust, near * 0.7);
  }

  /** Knock the flame about - used when the page is moved or the seal is held. */
  disturb(amount = 0.6) {
    this.candle.gust = Math.min(1.4, this.candle.gust + amount);
  }

  setCandleLit(lit) {
    this.candle.lit = lit;
  }

  update(dt, intensity) {
    this.t += dt;
    this.intensity = clamp01(intensity);
    const s = this.intensity;

    // --- candle flicker ------------------------------------------------
    // Two noise rates: a fast shimmer and a slow wander.
    const fast = this.nFlicker(this.t * 9.5);
    const slow = this.nFlicker2(this.t * 2.1);
    let flicker = 1 + fast * 0.075 + slow * 0.085;

    // Draughts: more frequent and more violent as the storm rises, because the
    // window is rattling.
    this.candle.gustTimer -= dt * lerp(0.6, 3.2, s);
    if (this.candle.gustTimer <= 0) {
      this.candle.gustTimer = rand(2.5, 8);
      this.candle.gust += rand(0.15, 0.5) * lerp(0.35, 1.3, s);
    }
    this.candle.gust *= Math.exp(-dt / 0.42);
    // A gust makes the flame dip and then flare back.
    const gustWave = Math.sin(this.t * 17) * 0.5 + Math.sin(this.t * 26.3) * 0.5;
    flicker -= this.candle.gust * (0.35 + gustWave * 0.3);

    this.candle.flicker = Math.max(0.18, flicker);
    this.candle.base = this.candle.lit ? 1 : 0;
    this.candle.value = this.candle.base * this.candle.flicker;
    // A struggling flame runs oranger; a steady one is paler and hotter.
    this.candle.warmth = clamp01(0.55 + this.candle.flicker * 0.45);

    // --- lightning ------------------------------------------------------
    let flash = 0;
    for (let i = this.flashPulses.length - 1; i >= 0; i--) {
      const p = this.flashPulses[i];
      p.t += dt;
      if (p.t < 0) continue;
      let v;
      const hold = p.hold || 0;
      if (p.t < p.rise) {
        v = p.t / p.rise;
      } else if (p.t < p.rise + hold) {
        v = 1;
      } else {
        const k = (p.t - p.rise - hold) / p.fall;
        if (k >= 1) { this.flashPulses.splice(i, 1); continue; }
        v = Math.pow(1 - k, 2.2);
      }
      flash = Math.max(flash, v * p.peak);
    }
    this.flash = clamp01(flash);

    // --- ambient ---------------------------------------------------------
    // The sky darkens as the storm thickens, so the candle takes over.
    this.ambient = lerp(0.38, 0.12, s);

    // What is lighting the room: candle vs window.
    const windowLight = this.ambient * 0.8 + this.flash * 2.2;
    const candleLight = this.candle.value * 0.9;
    this.warmMix = clamp01(candleLight / (candleLight + windowLight + 0.001));

    this.publish(dt);
  }

  /**
   * Push the light into CSS — sparingly, because this used to be the most
   * expensive thing in the frame by a distance.
   *
   * A custom property written on :root makes the browser re-resolve style for
   * the whole document, and repaint every element whose painting refers to any
   * variable at all, even variables that never change. At the 1829x1143@175%
   * this runs at on an Intel Iris Xe, writing eight of them every frame cost
   * 520ms of style work a second and 550 megapixels a second of repainting,
   * and held writing to 13 frames a second. Five of the eight were read by
   * nothing.
   *
   * So the fast flicker is not published. It lives where it costs nothing: in
   * the canvases, which redraw every frame regardless, and in the opacity of
   * #lightwash, set on that one composited element directly. CSS gets a slow
   * candle — the flame smoothed over a third of a second — and the storm, each
   * written only when it has moved by a visible step. The flash is written
   * every frame while a strike is lit, because a strike is fast and has to
   * look it, and not at all otherwise.
   */
  publish(dt = 1 / 60) {
    const r = this.root.style;
    this.slowCandle += (this.candle.value - this.slowCandle) * (1 - Math.exp(-Math.min(dt, 0.1) / 0.35));
    // Stepped, and rate-limited too: a smoothed flame still crosses a step
    // many times a second, and each crossing restyles the document. Ordinary
    // wandering goes out at most every 150ms. A real change — a gust knocking
    // the flame down, or the candle going out — is written immediately.
    const candle = (Math.round(this.slowCandle / 0.02) * 0.02).toFixed(2);
    const shown = this.published['--candle'];
    this.candleAge += dt;
    if (candle !== shown
      && (shown === undefined || this.candleAge >= 0.15 || Math.abs(+candle - +shown) >= 0.08)) {
      this.write(r, '--candle', candle);
      this.candleAge = 0;
    }
    this.write(r, '--storm', (Math.round(this.intensity / 0.01) * 0.01).toFixed(2));
    this.write(r, '--flash', this.flash > 0.002 ? this.flash.toFixed(3) : '0');

    // The full-rate flicker, over the whole room. The /1.4 pairs with the
    // brighter fixed gradient in scene.css so the result matches the old
    // colour-times-opacity exactly, while staying inside opacity's 0..1.
    if (!this.lightwash) this.lightwash = document.getElementById('lightwash');
    if (this.lightwash) {
      const c = this.candle.value;
      const o = clamp01((c * (0.6 + 0.4 * c)) / 1.4).toFixed(3);
      if (o !== this.lastWash) {
        this.lightwash.style.opacity = o;
        this.lastWash = o;
      }
    }
  }

  /** Set a property only if its text has changed since it was last written. */
  write(style, name, value) {
    if (this.published[name] === value) return;
    this.published[name] = value;
    style.setProperty(name, value);
  }

  /** Where the candle is on screen, in px. Set by the candle renderer. */
  setCandlePosition(x, y) {
    this.candle.x = x;
    this.candle.y = y;
  }
}
