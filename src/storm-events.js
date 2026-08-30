/**
 * Discrete storm events - the moments that punctuate the continuous intensity
 * curve. Two sources:
 *
 *   Paragraph breaks  Guaranteed the first couple of times so the writer learns
 *                     that the sky is listening. After that the odds and the
 *                     severity are governed by current intensity.
 *
 *   Ambient           Background thunder that becomes more frequent, closer and
 *                     more likely to be accompanied by lightning as the storm
 *                     builds.
 *
 * This module only decides *what* should happen. Dispatching it to audio and to
 * the visual scene is the caller's job.
 */

import { clamp01, lerp, rand } from './core/util.js';

/** @typedef {{kind:'thunder'|'lightning'|'none', distance:number, level:number, reason:string}} StormEvent */

const NONE = { kind: 'none', distance: 1, level: 0, reason: '' };

export class StormEvents {
  constructor() {
    this.paragraphCount = 1;   // the document starts on paragraph 1
    this.ambientTimer = 14;    // seconds until the next ambient roll
    this.lastEventAt = -999;
    this.history = [];
  }

  /**
   * Called when the writer opens a new paragraph.
   * @param {number} n         the ordinal of the paragraph just opened (2 = second)
   * @param {number} intensity current storm intensity
   * @returns {StormEvent}
   */
  paragraph(n, intensity) {
    const s = clamp01(intensity);

    // --- guaranteed openings ------------------------------------------
    if (n === 2) {
      return this.emit({
        kind: 'thunder',
        distance: rand(0.62, 0.8),   // distant, felt more than heard
        level: 0.85,
        reason: 'paragraph-2',
      });
    }
    if (n === 3) {
      return this.emit({
        kind: 'lightning',
        distance: rand(0.34, 0.5),   // closer, and you see it this time
        level: 1.0,
        reason: 'paragraph-3',
      });
    }
    if (n < 2) return NONE;

    // --- everything after is earned -----------------------------------
    // A quiet sky rarely answers; a raging one almost always does.
    const chance = lerp(0.28, 0.85, s);
    if (Math.random() > chance) return this.emit({ ...NONE, reason: 'paragraph-miss' });

    // Low intensity gives thunder only. Lightning needs a sky with some
    // charge in it, and becomes the norm at the top end.
    const lightningOdds = clamp01((s - 0.42) / 0.45);
    const kind = Math.random() < lightningOdds ? 'lightning' : 'thunder';

    return this.emit({
      kind,
      // Storms close in as they intensify.
      distance: clamp01(lerp(0.85, 0.12, s) + rand(-0.14, 0.14)),
      level: lerp(0.7, 1.0, s),
      reason: `paragraph-${n}`,
    });
  }

  /**
   * Rolled every frame; returns an event occasionally.
   * @returns {StormEvent}
   */
  ambient(dt, intensity) {
    const s = clamp01(intensity);
    this.ambientTimer -= dt * lerp(0.35, 2.4, s);
    if (this.ambientTimer > 0) return NONE;

    // Reschedule first, so an early return still resets the clock.
    this.ambientTimer = rand(9, 26);

    // Below a whisper of a storm the sky stays quiet.
    if (s < 0.16) return NONE;
    if (Math.random() > lerp(0.25, 0.95, s)) return NONE;

    const lightningOdds = clamp01((s - 0.5) / 0.5) * 0.8;
    const kind = Math.random() < lightningOdds ? 'lightning' : 'thunder';
    return this.emit({
      kind,
      distance: clamp01(lerp(0.9, 0.2, s) + rand(-0.2, 0.2)),
      level: lerp(0.5, 0.95, s),
      reason: 'ambient',
    });
  }

  /** The crescendo fires rapid, very close strikes. */
  crescendoStrike() {
    return this.emit({
      kind: 'lightning',
      distance: rand(0.0, 0.18),
      level: 1.0,
      reason: 'crescendo',
    });
  }

  emit(ev) {
    if (ev.kind !== 'none') this.history.push({ ...ev, at: Date.now() });
    return ev;
  }

  reset() {
    this.paragraphCount = 1;
    this.ambientTimer = 14;
    this.history.length = 0;
  }
}
