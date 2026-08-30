/**
 * The Intensity Meter.
 *
 * A single 0..1 scalar (`value`) that everything else reads from: audio filters,
 * rain density, wind, thunder probability, lightning, screen shaders, haptics.
 *
 * It is assembled from four influences:
 *   1. Personal Baseline  - a flow-state detector comparing your instant typing
 *                           speed against your own session average. Absolute WPM
 *                           is irrelevant; only a personal sprint matters.
 *   2. Baseline Floor     - time elapsed + characters written raise the minimum
 *                           storm level so a long session never returns to silence.
 *   3. Cold-Start Clamp   - the first 20s cannot unlock full storm power.
 *   4. Asymmetrical Glide - swells fast (~2-3s), decays slow (~6-8s).
 */

import { clamp01, norm, glide, lerp } from './core/util.js';

export const INTENSITY_CONFIG = {
  // 1. Personal baseline / flow state
  instantWindow: 5.0,       // seconds of keystrokes averaged for "instant" speed
  surgeMax: 0.60,           // being in-the-zone adds up to +60% on top of the floor
  surgeLowRatio: 0.50,      // instant/average at which surge begins to register
  surgeHighRatio: 1.15,     // instant/average at which surge is maxed out
  minCredibleAvg: 55,       // chars/min hard floor so we can never divide by ~0
  assumedAvg: 210,          // chars/min assumed until we've learned your real pace
  baselineConfidence: 30,   // seconds of active writing before we fully trust the measured average
  idleGap: 5.0,             // seconds without a keystroke before active time stops accruing

  // 2. Baseline floor
  timeCeiling: 180,         // seconds - time influence maxes out at 3 minutes
  volumeCeiling: 1500,      // characters - maxes out at ~250-300 words
  floorMin: 0.05,           // a very quiet ambient drizzle
  floorMax: 0.40,           // heavy steady rain that never fully subsides

  // 3. Cold-start clamp
  coldStart: 20,            // seconds; at 0s surges unlock 0%, at 10s 50%, at 20s 100%

  // 4. Asymmetrical glide (time constants; ~3*tau reaches 95% of the target)
  tauAttack: 0.85,          // ~2.5s to swell to full
  tauDecay: 1.65,           // ~5s of glide; with the 5s stroke window draining alongside it,
                            // a full stop settles to the floor in ~7s

  // Crescendo override (submit hold)
  crescendoRamp: 2.4,       // seconds to swell while the seal is held
  crescendoLift: 0.20,      // how far above the current level the swell reaches
  crescendoCap: 0.82,       // and the ceiling it will not go past
  releaseFade: 0.9,         // seconds to fall away on submit
};

export class IntensityEngine {
  constructor(config = {}) {
    this.cfg = { ...INTENSITY_CONFIG, ...config };

    /** The published value everything else reads. */
    this.value = this.cfg.floorMin;

    // Raw, pre-glide target - useful for debugging/telemetry.
    this.target = this.cfg.floorMin;

    // --- keystroke bookkeeping ---
    this.strokes = [];        // timestamps (seconds) inside the instant window
    this.totalChars = 0;      // monotonic count of characters committed
    this.charCount = 0;       // current document length (can shrink on delete)
    this.startedAt = null;    // first keystroke
    this.lastStroke = -Infinity;
    this.activeTime = 0;      // seconds spent actually writing (long pauses excluded)
    this.elapsed = 0;         // wall-clock seconds since the first keystroke

    // --- derived, exposed for the debug readout ---
    this.instantRate = 0;     // chars/min over the last `instantWindow`
    this.sessionRate = 0;     // chars/min over active time
    this.surge = 0;
    this.floor = this.cfg.floorMin;
    this.warmth = 0;          // cold-start clamp, 0..1

    // --- overrides ---
    this.mode = 'live';       // 'live' | 'crescendo' | 'release'
    this.overrideT = 0;
    this.overrideFrom = 0;

    this.listeners = new Set();
  }

  /** Register a callback fired every update with (value, engine). */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call once per character committed to the page. */
  keystroke(t, docLength) {
    if (this.startedAt === null) this.startedAt = t;
    this.strokes.push(t);
    this.totalChars++;
    if (typeof docLength === 'number') this.charCount = docLength;
    this.lastStroke = t;
  }

  /** Keep the volume influence honest when text is deleted or pasted. */
  setDocLength(n) {
    this.charCount = n;
  }

  /**
   * The swell while the seal is held.
   *
   * Originally this force-ramped to a flat 1.0, which arrives as a slam — the
   * sky goes from wherever you were to maximum in a second and a half, and it
   * feels like the app taking over rather than the moment building. It now
   * lifts a fixed amount above wherever you already are, under a ceiling, so
   * it is clearly perceptible without being a jump cut. The big moment is the
   * single strike on release, not the hold.
   */
  beginCrescendo() {
    if (this.mode === 'crescendo') return;
    this.mode = 'crescendo';
    this.overrideT = 0;
    this.overrideFrom = this.value;
    this.crescendoTo = Math.min(
      this.cfg.crescendoCap,
      Math.max(this.value + this.cfg.crescendoLift, this.cfg.crescendoLift * 1.6)
    );
  }

  /** Abandon a crescendo without submitting (pointer left the seal). */
  cancelCrescendo() {
    if (this.mode === 'crescendo') this.mode = 'live';
  }

  /** The release: cut the storm away fast. */
  beginRelease() {
    this.mode = 'release';
    this.overrideT = 0;
    this.overrideFrom = this.value;
  }

  /** How far through the crescendo ramp we are, 0..1. */
  get crescendoProgress() {
    return this.mode === 'crescendo' ? clamp01(this.overrideT / this.cfg.crescendoRamp) : 0;
  }

  update(t, dt) {
    const c = this.cfg;

    // ---- 1. Personal baseline -------------------------------------------
    // Trim the rolling window and measure instant speed in chars/min.
    const cutoff = t - c.instantWindow;
    while (this.strokes.length && this.strokes[0] < cutoff) this.strokes.shift();
    this.instantRate = (this.strokes.length / c.instantWindow) * 60;

    if (this.startedAt !== null) {
      this.elapsed = t - this.startedAt;
      // Active time excludes long pauses, so the personal baseline reflects how
      // you write rather than how long you stared out of the window.
      if (t - this.lastStroke < c.idleGap) this.activeTime += dt;
      this.sessionRate = this.activeTime > 0.5 ? (this.totalChars / this.activeTime) * 60 : 0;
    }

    // Until we have watched you write for a while we don't know your personal
    // pace, so we blend from a typical writer's speed toward the measured one.
    // Without this, a normal opening sentence reads as a colossal sprint purely
    // because the running average is still near zero.
    const confidence = norm(this.activeTime, 0, c.baselineConfidence);
    const learned = lerp(c.assumedAvg, this.sessionRate, confidence);
    const baseline = Math.max(learned, c.minCredibleAvg);
    const ratio = this.instantRate / baseline;
    // Above your own average = maxed surge; the ramp keeps it from flickering.
    this.surge = norm(ratio, c.surgeLowRatio, c.surgeHighRatio);

    // ---- 2. Baseline floor ----------------------------------------------
    const timeInfluence = norm(this.elapsed, 0, c.timeCeiling);
    const volumeInfluence = norm(this.charCount, 0, c.volumeCeiling);
    // Whichever has progressed further leads, but both still contribute.
    const growth = Math.max(timeInfluence, volumeInfluence) * 0.75 +
                   ((timeInfluence + volumeInfluence) * 0.5) * 0.25;
    this.floor = lerp(c.floorMin, c.floorMax, growth);

    // ---- 3. Cold-start clamp --------------------------------------------
    this.warmth = this.startedAt === null ? 0 : norm(this.elapsed, 0, c.coldStart);

    // ---- Target ----------------------------------------------------------
    this.target = clamp01(this.floor + this.surge * c.surgeMax * this.warmth);

    // ---- Overrides + 4. Asymmetrical glide ------------------------------
    if (this.mode === 'crescendo') {
      this.overrideT += dt;
      const p = clamp01(this.overrideT / c.crescendoRamp);
      // Ease-in-out so the ramp feels like an inhale rather than a jump cut.
      const eased = -(Math.cos(Math.PI * p) - 1) / 2;
      this.value = lerp(this.overrideFrom, this.crescendoTo ?? 1.0, eased);
    } else if (this.mode === 'release') {
      this.overrideT += dt;
      const p = clamp01(this.overrideT / c.releaseFade);
      this.value = this.overrideFrom * (1 - p) * (1 - p);
    } else {
      const tau = this.target > this.value ? c.tauAttack : c.tauDecay;
      this.value = glide(this.value, this.target, tau, dt);
    }

    this.value = clamp01(this.value);
    for (const fn of this.listeners) fn(this.value, this);
    return this.value;
  }

  /** Snapshot for the debug overlay. */
  debug() {
    return {
      value: this.value,
      target: this.target,
      floor: this.floor,
      surge: this.surge,
      warmth: this.warmth,
      instant: this.instantRate,
      session: this.sessionRate,
      chars: this.charCount,
      elapsed: this.elapsed,
      mode: this.mode,
    };
  }
}
