/**
 * The sound of the instrument on the paper.
 *
 * This is one *continuous* voice, not a burst per keypress. Firing a discrete
 * noise hit per character is what a keyboard sounds like, not what writing
 * sounds like — you do not hear someone form individual letters, you hear a
 * single stroke flowing across the page, lifting when they pause to think.
 *
 * So there is one looping noise source, shaped per instrument, riding a gain
 * envelope that is *held open* while characters keep arriving and released
 * after a real pause. The gate threshold is the whole trick: at any normal
 * writing speed the gaps between letters never reach it, so a phrase is one
 * unbroken sound, while putting the pen down to think is clearly audible.
 *
 * Letter-level detail did not disappear, it moved: each character nudges the
 * band-pass rather than triggering a new attack, which reads as the nib
 * changing direction instead of as another scratch.
 */

import { clamp01, lerp, rand } from '../core/util.js';
import { set } from './core.js';

export const INSTRUMENT_VOICES = {
  pencil: {
    // Graphite dragging over the tooth of the paper: dry, mid, and grainy.
    band: [820, 1900], q: 1.1, hp: 340, lp: 4600,
    level: 0.030, grit: 1.0, body: 0.12, rate: 1.0,
  },
  ballpoint: {
    // Hard and thin, and the quietest of them — a biro is nearly silent.
    band: [650, 1400], q: 1.8, hp: 280, lp: 3200,
    level: 0.018, grit: 0.45, body: 0.18, rate: 1.15,
  },
  fountain: {
    // A wet nib barely rasps. Low and round: mostly the sound of the paper.
    band: [300, 780], q: 1.3, hp: 140, lp: 1900,
    level: 0.024, grit: 0.30, body: 0.45, rate: 0.7,
  },
  quill: {
    // A split nib genuinely scratches, so this is the bright one — but the
    // brightness comes from a wider band, never from a sharp attack.
    band: [1000, 2700], q: 1.4, hp: 460, lp: 5600,
    level: 0.032, grit: 1.45, body: 0.14, rate: 1.25,
  },
  charcoal: {
    // Broad and dusty, with almost no high end at all.
    band: [200, 600], q: 0.9, hp: 80, lp: 1200,
    level: 0.034, grit: 0.80, body: 0.55, rate: 0.6,
  },
};

/**
 * How long the scratch is held open after a character before it starts to
 * release, and how fast it then falls away. 0.19s sits above the gap in
 * ordinary typing (~0.08-0.15s) and well below a pause for thought.
 */
const HOLD = 0.19;
const RELEASE_TAU = 0.13;

export class WritingVoice {
  constructor(core) {
    this.core = core;

    this.out = core.gain(0.9);
    this.out.connect(core.dry);
    this.send = core.gain(0.1);
    this.out.connect(this.send);
    this.send.connect(core.reverbSend);

    // --- the scratch: always running, gated by the envelope ---------------
    this.src = core.noiseSource('pink', 0.7);
    this.hp = core.filter('highpass', 140, 0.7);
    this.bp = core.filter('bandpass', 500, 1.3);
    this.lp = core.filter('lowpass', 1900, 0.7);
    this.env = core.gain(0);
    // A separate stage for the tremolo so the LFOs modulate *around* 1 rather
    // than adding an absolute offset to a gain that only ever reaches ~0.03.
    this.wobble = core.gain(1);
    this.src.connect(this.hp);
    this.hp.connect(this.bp);
    this.bp.connect(this.lp);
    this.lp.connect(this.env);
    this.env.connect(this.wobble);
    this.wobble.connect(this.out);

    // Hand pressure is never constant, so neither is the level.
    core.lfo(3.7, 0.14, this.wobble.gain);
    core.lfo(0.9, 0.09, this.wobble.gain);

    // --- body: the dull rub of hand and paper, tapped before the highpass --
    this.bodyLP = core.filter('lowpass', 250, 1.0);
    this.bodyGain = core.gain(0);
    this.src.connect(this.bodyLP);
    this.bodyLP.connect(this.bodyGain);
    this.bodyGain.connect(this.out);

    this.instrument = 'fountain';
    this.enabled = true;

    /** Audio-clock time of the last character. Drives the gate. */
    this.strokeAt = -99;
    /** Smoothed envelope, 0..1. */
    this.activity = 0;
    /** Smoothed keystroke velocity — how firmly the hand is pressing. */
    this.vel = 0.5;
    /** Nudged per character; reads as the nib changing direction. */
    this.nudge = 0;
    this.phase = 0;
    this.intensity = 0;
    /** Audio-clock timestamp of the last update. */
    this.lastAt = 0;
  }

  setInstrument(name) {
    if (!INSTRUMENT_VOICES[name]) return;
    this.instrument = name;
    const v = INSTRUMENT_VOICES[name];
    const ctx = this.core.ctx;
    if (!ctx) return;
    // Glide rather than jump: changing pens mid-sentence must not click.
    set(this.hp.frequency, v.hp, ctx, 0.08);
    set(this.lp.frequency, v.lp, ctx, 0.08);
    set(this.bp.Q, v.q, ctx, 0.08);
    set(this.src.playbackRate, v.rate, ctx, 0.08);
  }

  /**
   * One character committed. This plays nothing by itself — it feeds the
   * envelope the continuous voice rides on.
   *
   * @param {number} velocity 0..1 - how hard the stroke lands
   * @param {number} intensity current storm intensity, used to duck the level
   *                 slightly so writing never fights the downpour
   */
  stroke(velocity = 0.6, intensity = 0) {
    if (!this.enabled || !this.core.ready) return;
    this.intensity = intensity;
    // Stamped on the audio clock, so the gate below measures the real gap
    // between characters however erratically the frames are arriving.
    this.strokeAt = this.core.ctx.currentTime;
    // Smoothed, so one hard keypress in a soft passage does not spike.
    this.vel += (clamp01(velocity) - this.vel) * 0.3;
    this.nudge = Math.min(1, this.nudge + 0.55);
    this.phase += 0.61;
  }

  /**
   * Called every frame from the soundscape.
   *
   * Timed off the audio clock rather than the frame delta. The render loop
   * caps its own dt to keep animation sane on a slow device, and borrowing
   * that cap here would stretch the sound of a pen stroke to match the
   * stutter — the hand would still be writing long after the typing stopped.
   */
  update() {
    if (!this.core.ready) return;
    const ctx = this.core.ctx;
    const v = INSTRUMENT_VOICES[this.instrument] || INSTRUMENT_VOICES.fountain;

    const now = ctx.currentTime;
    const dt = this.lastAt === 0 ? 0.016 : Math.min(0.25, now - this.lastAt);
    this.lastAt = now;

    this.nudge *= Math.exp(-dt / 0.1);

    // Held wide open while letters keep arriving; released after a pause.
    const since = now - this.strokeAt;
    const gate = this.enabled
      ? (since < HOLD ? 1 : Math.exp(-(since - HOLD) / RELEASE_TAU))
      : 0;
    const goal = gate * lerp(0.66, 1, this.vel);
    // Asymmetric: catch the first letter quickly, let the tail down gently.
    const tau = goal > this.activity ? 0.03 : 0.09;
    this.activity += (goal - this.activity) * (1 - Math.exp(-dt / tau));
    if (this.activity < 0.0004) this.activity = 0;

    const a = clamp01(this.activity);
    // Duck a little when the storm is loud: present, never shouting over it.
    const duck = lerp(1, 0.7, clamp01(this.intensity));
    set(this.env.gain, a * v.level * duck, ctx, 0.02);
    set(this.bodyGain.gain, a * v.level * v.body * duck, ctx, 0.03);

    // The nib moves. The band drifts continuously and jumps a little on each
    // character — timbre now carries the detail the attacks used to.
    const drift = Math.sin(this.phase) * 0.5 + Math.sin(this.phase * 2.7) * 0.3;
    const centre = lerp(v.band[0], v.band[1], clamp01(0.4 + drift * 0.28));
    const jitter = 1 + this.nudge * v.grit * 0.2 * Math.sin(this.phase * 5.3);
    set(this.bp.frequency, centre * jitter, ctx, 0.02);
  }

  clink(pitch = 1, level = 0.5) {
    if (!this.core.ready) return;
    const core = this.core;
    const ctx = core.ctx;
    const t = ctx.currentTime;
    const f0 = rand(1650, 2350) * pitch;

    for (const [mul, amp, decay] of [[1, 1, 0.34], [2.71, 0.4, 0.2], [5.3, 0.13, 0.11]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * mul;
      const g = core.gain(0);
      o.connect(g); g.connect(this.out);
      const peak = 0.055 * amp * level;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay * rand(0.8, 1.2));
      o.start(t); o.stop(t + decay + 0.05);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (_) {} };
    }

    // The knock of the base meeting the desk, under the ring.
    const src = ctx.createBufferSource();
    src.buffer = core.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rand(0.6, 1.0);
    const lp = core.filter('lowpass', rand(340, 600), 1.4);
    const kg = core.gain(0);
    src.connect(lp); lp.connect(kg); kg.connect(this.out);
    kg.gain.setValueAtTime(0, t);
    kg.gain.linearRampToValueAtTime(0.05 * level, t + 0.003);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    src.start(t); src.stop(t + 0.12);
    src.onended = () => { try { src.disconnect(); lp.disconnect(); kg.disconnect(); } catch (_) {} };
  }

  /** Paper being moved, turned or lifted. */
  rustle(level = 0.5, dur = 0.55) {
    if (!this.core.ready) return;
    const core = this.core;
    const ctx = core.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = core.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rand(0.6, 1.1);
    const bp = core.filter('bandpass', rand(1800, 3600), 0.8);
    const g = core.gain(0);
    src.connect(bp); bp.connect(g); g.connect(this.out);

    // Crumple envelope: a few irregular bursts rather than one smooth swell.
    const steps = 48;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      const burst = Math.random() < 0.35 ? Math.random() : Math.random() * 0.25;
      curve[i] = burst * Math.pow(1 - p, 1.2) * level * 0.16;
    }
    curve[0] = 0; curve[steps - 1] = 0;
    g.gain.setValueCurveAtTime(curve, t, dur);
    src.start(t); src.stop(t + dur + 0.05);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (_) {} };
  }
}

/**
 * Fire, for the burning of the page: a broadband crackle bed plus discrete pops.
 */
export class FireVoice {
  constructor(core) {
    this.core = core;
    this.out = core.gain(0);
    this.out.connect(core.dry);
    this.send = core.gain(0.3);
    this.out.connect(this.send);
    this.send.connect(core.reverbSend);

    this.bed = core.noiseSource('pink', 1);
    this.bedBP = core.filter('bandpass', 900, 0.6);
    this.bedGain = core.gain(0.5);
    this.bed.connect(this.bedBP);
    this.bedBP.connect(this.bedGain);
    this.bedGain.connect(this.out);
    core.lfo(0.9, 0.22, this.bedGain.gain);
    core.lfo(0.31, 300, this.bedBP.frequency);

    this.popTimer = 0;
    this.level = 0;
  }

  /** 0 = out, 1 = the page is fully alight. */
  setLevel(v, dt = 1 / 60) {
    const ctx = this.core.ctx;
    this.level = clamp01(v);
    this.out.gain.setTargetAtTime(this.level * 0.5, ctx.currentTime, 0.15);
    this.bedBP.frequency.setTargetAtTime(lerp(600, 2200, this.level), ctx.currentTime, 0.2);

    this.popTimer -= dt;
    if (this.popTimer <= 0 && this.level > 0.05) {
      this.popTimer = rand(0.02, 0.16) / Math.max(0.1, this.level);
      this.pop();
    }
  }

  /** A single crackle. */
  pop() {
    const core = this.core;
    const ctx = core.ctx;
    const t = ctx.currentTime;
    const dur = rand(0.012, 0.05);
    const src = ctx.createBufferSource();
    src.buffer = core.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rand(0.7, 1.6);
    const bp = core.filter('bandpass', rand(1200, 5200), rand(4, 14));
    const g = core.gain(0);
    src.connect(bp); bp.connect(g); g.connect(this.out);
    const peak = rand(0.06, 0.3) * this.level;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t); src.stop(t + dur + 0.02);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (_) {} };
  }

  /** The whoosh of paper catching. */
  ignite() {
    const core = this.core;
    const ctx = core.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = core.whiteBuffer;
    src.loop = true;
    const bp = core.filter('bandpass', 700, 0.9);
    const g = core.gain(0);
    src.connect(bp); bp.connect(g); g.connect(this.out);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.start(t); src.stop(t + 1.2);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (_) {} };
  }
}
