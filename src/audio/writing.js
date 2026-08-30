/**
 * The sound of the instrument on the paper.
 *
 * Each keystroke is a very short filtered noise burst. The instrument changes
 * the filter shape, the grit and the decay, so a pencil rasps, a ballpoint
 * ticks, and a fountain pen lays down a wet, soft stroke.
 *
 * These fire many times a second, so the graph per stroke is kept tiny and
 * every node is torn down on `ended`.
 */

import { clamp01, lerp, rand } from '../core/util.js';

export const INSTRUMENT_VOICES = {
  pencil: {
    // Graphite dragging over tooth: bright, dry, gritty.
    band: [1500, 3400], q: [1.2, 2.6], dur: [0.045, 0.085],
    level: 0.075, noise: 'white', rate: [0.75, 1.5], hp: 700, body: 0,
  },
  ballpoint: {
    // A quick, hard, plasticky tick with very little tail.
    band: [900, 2000], q: [2.5, 5], dur: [0.022, 0.045],
    level: 0.055, noise: 'white', rate: [0.9, 1.4], hp: 420, body: 0.15,
  },
  fountain: {
    // Wet nib: lower, rounder, a touch of resonance and a longer stroke.
    band: [420, 1150], q: [1.6, 3.2], dur: [0.06, 0.13],
    level: 0.062, noise: 'pink', rate: [0.55, 0.95], hp: 180, body: 0.35,
  },
  quill: {
    // Split-nib scratch: uneven, scratchy, the loudest of the four.
    band: [1800, 4600], q: [2, 6], dur: [0.05, 0.12],
    level: 0.085, noise: 'white', rate: [0.6, 1.7], hp: 900, body: 0.1,
  },
  charcoal: {
    // Soft, broad, dusty. Almost no high end.
    band: [300, 900], q: [0.8, 1.8], dur: [0.07, 0.15],
    level: 0.07, noise: 'brown', rate: [0.5, 1.0], hp: 90, body: 0.5,
  },
};

export class WritingVoice {
  constructor(core) {
    this.core = core;
    this.out = core.gain(0.9);
    this.out.connect(core.dry);
    this.send = core.gain(0.12);
    this.out.connect(this.send);
    this.send.connect(core.reverbSend);
    this.instrument = 'fountain';
    this.enabled = true;
    // Successive strokes drift in tone so a fast run doesn't machine-gun.
    this.phase = 0;
  }

  setInstrument(name) {
    if (INSTRUMENT_VOICES[name]) this.instrument = name;
  }

  /**
   * @param {number} velocity 0..1 - how hard the stroke lands
   * @param {number} intensity current storm intensity, used to duck the level
   *                 slightly so writing never fights the downpour
   */
  stroke(velocity = 0.6, intensity = 0) {
    if (!this.enabled || !this.core.ready) return;
    const v = INSTRUMENT_VOICES[this.instrument] || INSTRUMENT_VOICES.fountain;
    const core = this.core;
    const ctx = core.ctx;
    const t = ctx.currentTime;

    this.phase += 0.37;
    const drift = Math.sin(this.phase) * 0.5 + Math.sin(this.phase * 2.3) * 0.3;

    const dur = rand(v.dur[0], v.dur[1]);
    const src = ctx.createBufferSource();
    src.buffer = v.noise === 'brown' ? core.brownBuffer
      : v.noise === 'pink' ? core.pinkBuffer : core.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rand(v.rate[0], v.rate[1]);
    // Start at a random point in the buffer so repeats never phase-lock.
    const offset = Math.random() * (src.buffer.duration - dur - 0.05);

    const bp = core.filter('bandpass', rand(v.band[0], v.band[1]) * (1 + drift * 0.12),
      rand(v.q[0], v.q[1]));
    const hp = core.filter('highpass', v.hp, 0.7);
    const g = core.gain(0);

    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.out);

    // A little low body for the wetter instruments.
    let bodyG = null, bodyF = null;
    if (v.body > 0) {
      bodyF = core.filter('lowpass', 300, 1.1);
      bodyG = core.gain(0);
      hp.connect(bodyF); bodyF.connect(bodyG); bodyG.connect(this.out);
    }

    // Duck a touch when the storm is loud, so it stays audible but not shrill.
    const duck = lerp(1, 0.62, clamp01(intensity));
    const peak = v.level * (0.55 + velocity * 0.75) * (0.8 + Math.random() * 0.45) * duck;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (bodyG) {
      bodyG.gain.setValueAtTime(0, t);
      bodyG.gain.linearRampToValueAtTime(peak * v.body, t + dur * 0.3);
      bodyG.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.4);
    }

    src.start(t, offset);
    src.stop(t + dur * 1.5 + 0.02);
    src.onended = () => {
      try {
        src.disconnect(); hp.disconnect(); bp.disconnect(); g.disconnect();
        if (bodyG) { bodyF.disconnect(); bodyG.disconnect(); }
      } catch (_) {}
    };
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
