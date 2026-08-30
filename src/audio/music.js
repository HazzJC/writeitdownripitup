/**
 * Emergent soundscape engine.
 *
 * Generative ethereal music in D aeolian that accretes as you write. It is not a
 * loop - notes are scheduled one at a time from a lookahead clock, and both the
 * density and the register are driven by storm intensity, so the music speeds up
 * when you speed up and thins out when you stop.
 *
 * Layers arrive in order as the storm builds:
 *   drone   - a sustained root/fifth, always present, felt more than heard
 *   pad     - slow detuned chords with long attack
 *   bell    - sparse struck notes, the melodic surface
 *   shimmer - high glassy partials, only in a real tempest
 *   pulse   - a low heartbeat that appears near the peak
 */

import { clamp01, lerp, pick, rand } from '../core/util.js';
import { set } from './core.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// D natural minor. Scale degrees as semitone offsets from the root.
const SCALE = [0, 2, 3, 5, 7, 8, 10];

// A slow, unresolved progression: i - VI - III - iv
const PROGRESSION = [
  { root: 50, chord: [0, 3, 7, 10] },   // Dm7
  { root: 46, chord: [0, 4, 7, 11] },   // Bbmaj7
  { root: 41, chord: [0, 4, 7, 11] },   // Fmaj7
  { root: 43, chord: [0, 3, 7, 10] },   // Gm7
];

// Where the ritual lands once the page is burned: open, major, resolved.
const TRANQUIL = { root: 50, chord: [0, 7, 12, 16, 19] };

export class MusicEngine {
  constructor(core) {
    this.core = core;
    const ctx = core.ctx;

    this.out = core.gain(0.0);
    this.out.connect(core.bus);
    this.send = core.gain(0.85);
    this.out.connect(this.send);
    this.send.connect(core.reverbSend);

    // A gentle tape-style delay gives the pads their drifting tail.
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.66;
    this.feedback = core.gain(0.42);
    this.delayFilter = core.filter('lowpass', 2200, 0.7);
    this.delayMix = core.gain(0.34);
    this.out.connect(this.delay);
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delayFilter.connect(this.delayMix);
    this.delayMix.connect(core.bus);
    // Drift the delay time very slightly - tape wow.
    core.lfo(0.07, 0.006, this.delay.delayTime);

    this.intensity = 0;
    this.started = false;
    this.tranquil = false;

    this.nextNote = 0;      // absolute ctx time of the next scheduled event
    this.step = 0;          // event counter, advances the progression
    this.chordIndex = 0;
    this.lookahead = 0.25;

    this.droneNodes = null;
    this.pendingAccents = [];
  }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = this.core.ctx;
    this.nextNote = ctx.currentTime + 0.4;
    this.out.gain.setTargetAtTime(0.5, ctx.currentTime, 2.0);
    this.startDrone();
  }

  get current() {
    return this.tranquil ? TRANQUIL : PROGRESSION[this.chordIndex % PROGRESSION.length];
  }

  /** A continuous root/fifth bed that fades up with the storm floor. */
  startDrone() {
    const core = this.core;
    const ctx = core.ctx;
    const g = core.gain(0);
    const lp = core.filter('lowpass', 700, 0.8);
    g.connect(lp);
    lp.connect(this.out);

    const oscs = [];
    const base = this.current.root - 12;
    for (const [semi, detune, level] of [[0, -4, 1], [0, 5, 0.9], [7, 2, 0.55], [12, -7, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(base + semi);
      o.detune.value = detune;
      const og = core.gain(level * 0.25);
      o.connect(og);
      og.connect(g);
      o.start();
      oscs.push({ o, og, semi });
    }
    // Very slow filter movement so the drone never sits still.
    core.lfo(0.023, 220, lp.frequency);
    this.droneNodes = { g, lp, oscs, base };
  }

  /** Retune the drone when the progression moves. */
  retuneDrone(seconds = 3.5) {
    if (!this.droneNodes) return;
    const ctx = this.core.ctx;
    const base = this.current.root - 12;
    this.droneNodes.base = base;
    for (const { o, semi } of this.droneNodes.oscs) {
      o.frequency.setTargetAtTime(mtof(base + semi), ctx.currentTime, seconds / 3);
    }
  }

  update(v, dt) {
    if (!this.started) return;
    const ctx = this.core.ctx;
    this.intensity = v;
    const s = clamp01(v);

    // Overall level and brightness track the storm.
    set(this.out.gain, this.tranquil ? 0.55 : lerp(0.34, 0.62, s), ctx, 0.6);
    set(this.delayMix.gain, lerp(0.30, 0.16, s), ctx, 0.6);
    set(this.feedback.gain, lerp(0.46, 0.32, s), ctx, 0.6);
    if (this.droneNodes) {
      set(this.droneNodes.g.gain, this.tranquil ? 0.5 : lerp(0.16, 0.44, s), ctx, 1.2);
      set(this.droneNodes.lp.frequency, lerp(420, 1600, s), ctx, 0.8);
    }

    // --- lookahead scheduler -------------------------------------------
    const horizon = ctx.currentTime + this.lookahead;
    let guard = 0;
    while (this.nextNote < horizon && guard++ < 16) {
      this.scheduleEvent(this.nextNote, s);
      // Density: sparse and slow when calm, urgent when the storm is up.
      const base = this.tranquil ? rand(6, 11) : lerp(4.6, 0.82, Math.pow(s, 0.85));
      // Humanise, and occasionally leave a longer gap for air.
      const jitter = 0.7 + Math.random() * 0.7;
      const rest = Math.random() < lerp(0.22, 0.04, s) ? 1.9 : 1;
      this.nextNote += base * jitter * rest;
      this.step++;
      // Move the progression on every eight events.
      if (!this.tranquil && this.step % 8 === 0) {
        this.chordIndex++;
        this.retuneDrone();
      }
    }

    // Accents queued by paragraph breaks and other one-shot moments.
    while (this.pendingAccents.length) {
      const a = this.pendingAccents.shift();
      this.bell(ctx.currentTime + 0.02, a.midi, a.level, a.decay);
    }
  }

  scheduleEvent(when, s) {
    const { root, chord } = this.current;

    // Pad: a soft sustained cluster, more likely when calm.
    if (Math.random() < lerp(0.75, 0.35, s)) {
      const oct = Math.random() < 0.5 ? 0 : 12;
      const notes = chord.slice(0, 2 + ((Math.random() * 3) | 0)).map((c) => root + c + oct);
      this.pad(when, notes, lerp(0.16, 0.10, s));
    }

    // Bell: the melodic surface. Register climbs with the storm.
    if (Math.random() < lerp(0.45, 0.95, s)) {
      const octave = 12 * (1 + (Math.random() < lerp(0.25, 0.7, s) ? 1 : 0));
      const degree = pick(SCALE);
      const midi = root + degree + octave;
      this.bell(when + rand(0, 0.12), midi, lerp(0.14, 0.24, s), lerp(6.0, 2.6, s));
    }

    // Shimmer: only in a real tempest.
    if (s > 0.62 && Math.random() < (s - 0.62) / 0.38 * 0.7) {
      const midi = root + pick(SCALE) + 36;
      this.shimmer(when + rand(0, 0.2), midi, (s - 0.62) / 0.38 * 0.10);
    }

    // Pulse: a low heartbeat near the peak.
    if (s > 0.78 && Math.random() < (s - 0.78) / 0.22 * 0.55) {
      this.pulse(when, root - 24, (s - 0.78) / 0.22 * 0.3);
    }
  }

  /** Long, breathing chord tones. */
  pad(when, midis, level) {
    const core = this.core;
    const ctx = core.ctx;
    const attack = rand(1.6, 3.4);
    const hold = rand(1.2, 3.0);
    const release = rand(3.0, 6.0);
    const total = attack + hold + release;

    const g = core.gain(0);
    const lp = core.filter('lowpass', rand(900, 2600), 0.6);
    g.connect(lp);
    lp.connect(this.out);

    const oscs = [];
    for (const m of midis) {
      for (const d of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
        o.frequency.value = mtof(m);
        o.detune.value = d + rand(-4, 4);
        const og = core.gain(1 / (midis.length * 2));
        o.connect(og);
        og.connect(g);
        o.start(when);
        o.stop(when + total + 0.1);
        oscs.push(o);
      }
    }

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + attack);
    g.gain.setValueAtTime(level, when + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, when + total);

    if (oscs.length) oscs[oscs.length - 1].onended = () => {
      try { g.disconnect(); lp.disconnect(); } catch (_) {}
    };
  }

  /** A struck note - sine fundamental plus an inharmonic partial. */
  bell(when, midi, level, decay = 4) {
    const core = this.core;
    const ctx = core.ctx;
    const f = mtof(midi);

    const g = core.gain(0);
    g.connect(this.out);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const og = core.gain(1);
    o.connect(og);
    og.connect(g);

    // A quiet, slightly sharp partial gives it a glass edge.
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.76;
    const og2 = core.gain(0.14);
    o2.connect(og2);
    og2.connect(g);

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    o.start(when); o.stop(when + decay + 0.05);
    o2.start(when); o2.stop(when + decay * 0.4);
    o.onended = () => {
      try { o.disconnect(); og.disconnect(); o2.disconnect(); og2.disconnect(); g.disconnect(); } catch (_) {}
    };
  }

  /** High glassy noise-band, like wind over a bottle top. */
  shimmer(when, midi, level) {
    const core = this.core;
    const ctx = core.ctx;
    const src = ctx.createBufferSource();
    src.buffer = core.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rand(0.8, 1.3);
    const bp = core.filter('bandpass', mtof(midi), 26);
    const g = core.gain(0);
    src.connect(bp); bp.connect(g); g.connect(this.out);
    const dur = rand(1.4, 3.2);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.start(when); src.stop(when + dur + 0.05);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (_) {} };
  }

  /** A low, soft heartbeat felt at high intensity. */
  pulse(when, midi, level) {
    const core = this.core;
    const ctx = core.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(midi) * 1.5, when);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), when + 0.25);
    const g = core.gain(0);
    o.connect(g); g.connect(this.out);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
    o.start(when); o.stop(when + 1.2);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (_) {} };
  }

  /** Queue a melodic accent - used for paragraph breaks. */
  accent(octaveBias = 1, level = 0.2) {
    const { root, chord } = this.current;
    const midi = root + pick(chord) + 12 * octaveBias;
    this.pendingAccents.push({ midi, level, decay: 5.5 });
  }

  /** After the burn: resolve everything to one open, sustained chord. */
  enterTranquility() {
    this.tranquil = true;
    this.chordIndex = 0;
    this.retuneDrone(6);
    const ctx = this.core.ctx;
    const t = ctx.currentTime;
    // One last resolving swell.
    const { root, chord } = TRANQUIL;
    this.pad(t + 0.3, chord.map((c) => root + c), 0.2);
    this.bell(t + 1.1, root + 24, 0.16, 9);
    this.bell(t + 2.4, root + 19, 0.12, 9);
    set(this.delayMix.gain, 0.4, ctx, 2);
  }

  fadeOut(seconds = 4) {
    const ctx = this.core.ctx;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setValueAtTime(this.out.gain.value, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + seconds);
  }
}
