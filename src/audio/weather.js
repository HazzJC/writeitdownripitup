/**
 * Weather voices: rain, wind and thunder - all synthesised.
 *
 * The governing idea for the rain is that **you are indoors**. You are not
 * standing in the weather; you are listening to it through a pane of glass and
 * a roof. Broadband hiss is what rain sounds like when it is falling on *you*,
 * and it swamps everything else, so there is none of it here.
 *
 * What is left is what you actually hear from a chair by a window:
 *   roof   a dark, quiet rumble - rain on tiles and on the garden, through a wall
 *   wash   a slightly less muffled layer that only arrives in heavy rain
 *   taps   discrete resonant ticks of individual drops striking the pane, spread
 *          across the stereo field because the window is wide
 *
 * The taps carry the character. The beds are almost subliminal.
 */

import { clamp01, lerp, rand } from '../core/util.js';
import { set } from './core.js';

export class RainVoice {
  constructor(core) {
    this.core = core;
    const ctx = core.ctx;

    this.out = core.gain(1);
    this.out.connect(core.bus);
    // A little of the rain goes to the reverb so it has space around it.
    this.send = core.gain(0.22);
    this.out.connect(this.send);
    this.send.connect(core.reverbSend);

    // --- roof: the bed --------------------------------------------------
    // Rain on tiles and on the garden, arriving through a wall. Almost all of
    // its energy is below 500Hz; anything brighter reads as being outdoors.
    this.bedSrc = core.noiseSource('pink', 1);
    this.bodyHP = core.filter('highpass', 95, 0.7);
    this.bodyLP = core.filter('lowpass', 460, 0.8);
    this.bodyGain = core.gain(0.0);
    // Multiplicative drift, so the modulation can never invert the signal.
    this.bodyDrift = core.gain(1.0);
    this.bedSrc.connect(this.bodyHP);
    this.bodyHP.connect(this.bodyLP);
    this.bodyLP.connect(this.bodyGain);
    this.bodyGain.connect(this.bodyDrift);
    this.bodyDrift.connect(this.out);

    // --- wash: heavy rain on the path, still muffled ---------------------
    this.washSrc = core.noiseSource('pink', 1);
    this.washBP = core.filter('bandpass', 780, 0.6);
    this.patGain = core.gain(0.0);
    this.washSrc.connect(this.washBP);
    this.washBP.connect(this.patGain);
    this.patGain.connect(this.out);

    // --- roar: the weight of a real downpour on the roof -----------------
    this.roarSrc = core.noiseSource('brown', 1);
    this.roarLP = core.filter('lowpass', 240, 0.9);
    this.roarGain = core.gain(0.0);
    this.roarSrc.connect(this.roarLP);
    this.roarLP.connect(this.roarGain);
    this.roarGain.connect(this.out);

    // Slow drift so the rain breathes instead of sitting still.
    this.drift = core.lfo(0.055, 0.16, this.bodyDrift.gain);
    this.drift2 = core.lfo(0.031, 90, this.bodyLP.frequency);

    // --- taps: their own path -------------------------------------------
    // A drop striking the pane is not "distant weather" — it is a hard object
    // hitting glass half a metre from your ear. Putting it behind the master
    // distance filter with the rest of the storm makes it vanish exactly when
    // the sky is quietest, which is when it is the only thing to hear.
    this.tapLP = core.filter('lowpass', 5200, 0.7);
    this.tapOut = core.gain(0.9);
    this.tapOut.connect(this.tapLP);
    this.tapLP.connect(core.dry);
    this.tapSend = core.gain(0.16);
    this.tapOut.connect(this.tapSend);
    this.tapSend.connect(core.reverbSend);

    this.nextTapAt = 0;
    this.intensity = 0;
    this.presence = 0;
  }

  /**
   * @param {number} v         storm intensity 0..1
   * @param {number} dt
   * @param {number} presence  how far the weather has established itself, 0..1.
   *                           At 0 the sky is dry and only the odd drop lands.
   */
  update(v, dt, presence = 1) {
    const ctx = this.core.ctx;
    this.intensity = v;
    this.presence = clamp01(presence);
    const s = clamp01(v);
    // Presence gates the continuous beds hard, so a session opens in silence
    // and the first thing you ever hear is a single drop on the glass.
    const p = Math.pow(this.presence, 1.35);

    set(this.bodyGain.gain, lerp(0.0, 0.20, Math.pow(s, 1.1)) * p, ctx, 0.3);
    set(this.bodyLP.frequency, lerp(320, 700, s), ctx, 0.4);

    set(this.patGain.gain, lerp(0.0, 0.085, Math.pow(s, 1.8)) * p, ctx, 0.3);
    set(this.washBP.frequency, lerp(620, 1000, s), ctx, 0.4);

    set(this.roarGain.gain,
      Math.pow(clamp01((s - 0.45) / 0.55), 1.5) * 0.16 * p, ctx, 0.5);

    // --- drops on the pane ---------------------------------------------
    // These are the rain, as far as the ear is concerned. Even at full storm
    // the rate stays countable — a wall of ticks becomes hiss again.
    //
    // Presence, not intensity, is what governs the opening. Writing your first
    // sentence pushes intensity up quickly, so gating the drops on intensity
    // alone gives you a downpour within seconds of starting. Gated hard on
    // presence instead: one drop every ten seconds or so before you write,
    // roughly one every two seconds once you have, and a proper pane full of
    // water only after minutes.
    const rate = lerp(0.5, 30, Math.pow(s, 1.2)) * lerp(0.06, 1, Math.pow(this.presence, 0.75));

    // Scheduled against the *audio* clock, not the render clock.
    //
    // The frame loop clamps its delta so a slow frame cannot explode the
    // physics, which means on a struggling device the accumulated time runs
    // behind the wall clock — measured at 1.5s of simulated time per 4s real
    // when frames got slow. Driving the rain off that clock made the drops
    // slow down with the frame rate, which is not a thing rain does. The audio
    // clock never stalls, and scheduling ahead on it is sample-accurate.
    const now = ctx.currentTime;
    if (!this.nextTapAt) this.nextTapAt = now;
    // If we have fallen a long way behind (a hidden tab), skip the backlog
    // rather than firing every drop that "should" have landed at once.
    if (this.nextTapAt < now - 1) this.nextTapAt = now;

    // And if the rate has risen sharply since the last drop was scheduled, the
    // next one is parked way out in the future at the old rate — during a dry
    // spell that is twenty seconds away, so the rain would take twenty seconds
    // to notice you had started writing again. Pull it back in.
    const maxAhead = 3 / Math.max(0.05, rate);
    if (this.nextTapAt > now + maxAhead) this.nextTapAt = now + Math.random() * maxAhead;

    let guard = 0;
    while (this.nextTapAt <= now + 0.1 && guard++ < 32) {
      this.tap(s, Math.max(now, this.nextTapAt));
      // Exponential gaps, so drops arrive irregularly rather than on a grid.
      this.nextTapAt += -Math.log(1 - Math.random()) / Math.max(0.05, rate);
    }
  }

  /**
   * One drop striking the glass: a short, resonant tick. The high-Q bandpass
   * does the work - it rings briefly, the way a pane does.
   */
  tap(s, when) {
    const core = this.core;
    const ctx = core.ctx;
    const t = Math.max(ctx.currentTime, when || 0);

    // Every so often a fat drop lands, lower and slower than the rest.
    const fat = Math.random() < 0.14;
    const dur = fat ? rand(0.05, 0.12) : rand(0.012, 0.045);
    const freq = fat ? rand(700, 1500) : rand(1500, 4200);

    const src = ctx.createBufferSource();
    src.buffer = core.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rand(0.7, 1.5);

    const hp = core.filter('highpass', fat ? 400 : 900, 0.7);
    const bp = core.filter('bandpass', freq, fat ? rand(5, 9) : rand(9, 22));
    const g = core.gain(0);
    // The window is wide, so drops land across it.
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = rand(-0.85, 0.85);

    src.connect(hp); hp.connect(bp); bp.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.tapOut); } else { g.connect(this.tapOut); }

    // Louder drops as the storm builds, but never by much - it is glass, not
    // a drum. The quietest taps at rest are meant to be almost missable.
    const peak = (fat ? rand(0.055, 0.11) : rand(0.02, 0.06))
      * lerp(0.55, 1.15, s)
      * lerp(0.7, 1, this.presence);

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.03);
    src.onended = () => {
      try {
        src.disconnect(); hp.disconnect(); bp.disconnect(); g.disconnect();
        if (pan) pan.disconnect();
      } catch (_) {}
    };
  }

  /** Cut the rain away on submit. */
  release(seconds = 0.9) {
    const ctx = this.core.ctx;
    for (const g of [this.bodyGain, this.patGain, this.roarGain, this.tapOut]) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.01, ctx.currentTime + seconds);
    }
  }
}

export class WindVoice {
  constructor(core) {
    this.core = core;
    const ctx = core.ctx;

    this.out = core.gain(1);
    this.out.connect(core.bus);

    // Low moan through the window frame.
    this.src = core.noiseSource('brown', 1);
    this.bp = core.filter('bandpass', 340, 1.6);
    this.g = core.gain(0);
    this.gDrift = core.gain(1.0);
    this.src.connect(this.bp);
    this.bp.connect(this.g);
    this.g.connect(this.gDrift);
    this.gDrift.connect(this.out);

    // A thin whistle that only shows up in a gale.
    this.src2 = core.noiseSource('white', 1);
    this.bp2 = core.filter('bandpass', 1500, 9);
    this.g2 = core.gain(0);
    this.src2.connect(this.bp2);
    this.bp2.connect(this.g2);
    this.g2.connect(this.out);

    // Gusts: two incommensurate LFOs so the pattern never audibly repeats.
    this.gust1 = core.lfo(0.041, 180, this.bp.frequency);
    this.gust2 = core.lfo(0.017, 0.22, this.gDrift.gain);
    this.gust3 = core.lfo(0.073, 420, this.bp2.frequency);

    this.gustPhase = Math.random() * 100;
  }

  update(v, dt) {
    const ctx = this.core.ctx;
    const s = clamp01(v);
    this.gustPhase += dt * lerp(0.08, 0.35, s);
    // A slow swell on top of the LFOs gives long, believable gusts.
    const swell = 0.6 + 0.4 * Math.sin(this.gustPhase) * Math.sin(this.gustPhase * 0.37);

    set(this.g.gain, lerp(0.02, 0.34, Math.pow(s, 1.15)) * swell, ctx, 0.5);
    set(this.bp.frequency, lerp(220, 520, s), ctx, 0.6);
    set(this.g2.gain, Math.pow(clamp01((s - 0.5) / 0.5), 2) * 0.075 * swell, ctx, 0.5);
  }

  release(seconds = 1.6) {
    const ctx = this.core.ctx;
    for (const g of [this.g, this.g2]) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.0, ctx.currentTime + seconds);
    }
  }
}

/**
 * Thunder.
 *
 * The thing that makes synthesised thunder sound fake is a sharp transient —
 * it reads as a click, or as a door slamming. Real thunder, heard from inside,
 * has almost no attack at all: it arrives, swells, and then rolls for a long
 * time while the sound bounces off everything between you and it.
 *
 * So: no crack layer, a slow attack even on close strikes, most of the energy
 * under 200Hz, and a lot of the signal sent to a long dark reverb.
 *
 * `distance` 0 = overhead, 1 = a long way off.
 */
export class ThunderVoice {
  constructor(core) {
    this.core = core;
    this.out = core.gain(1);
    this.out.connect(core.bus);
    // Heavily reverberant: most of what you hear is the tail, not the source.
    this.send = core.gain(1.35);
    this.out.connect(this.send);
    this.send.connect(core.bigSend);
    this.lastStrike = -999;
  }

  /**
   * @param {number} distance 0..1
   * @param {number} level    overall loudness multiplier
   * @param {number} spread   scales duration - 1.6 or so for the final strike
   */
  strike(distance = 0.5, level = 1, spread = 1) {
    const core = this.core;
    const ctx = core.ctx;
    if (!ctx) return 0;
    const t = ctx.currentTime;
    this.lastStrike = t;

    const near = 1 - clamp01(distance);
    const dur = lerp(4.5, 9.0, clamp01(distance)) * (0.85 + Math.random() * 0.4) * spread;

    // --- rumble body: brown noise through a resonant lowpass -------------
    const src = ctx.createBufferSource();
    src.buffer = core.brownBuffer;
    src.loop = true;
    src.playbackRate.value = 0.35 + Math.random() * 0.35;

    // Even directly overhead this stays dark. Anything above ~500Hz in a
    // thunderclap heard through a window is the part that sounds like a click.
    const lp = core.filter('lowpass', lerp(120, 420, near), 1.1);
    const hp = core.filter('highpass', 22, 0.7);
    const g = core.gain(0);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(this.out);

    // Build an irregular decaying envelope - this is what makes it "roll".
    const steps = 190;
    const curve = new Float32Array(steps);
    let bump = 0;
    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      const decay = Math.pow(1 - p, lerp(1.5, 2.4, clamp01(distance)));
      // Random slow undulation plus occasional sharper swells.
      bump += (Math.random() - 0.5) * 0.32;
      bump *= 0.88;
      const swell = 1 + bump + 0.30 * Math.sin(p * 9 + Math.random() * 0.2);
      // A deliberately slow attack. Nothing here should ever click.
      const attack = p < 0.10 ? Math.pow(p / 0.10, 1.6) : 1;
      curve[i] = Math.max(0, decay * swell * attack);
    }
    let max = 0;
    for (const c of curve) max = Math.max(max, c);
    const amp = lerp(0.22, 0.46, near) * level;
    for (let i = 0; i < steps; i++) curve[i] = (curve[i] / (max || 1)) * amp;

    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(curve, t, dur);

    // The lowpass opens a little as the front of the sound arrives, then
    // closes over the tail - distant reflections lose their highs first.
    lp.frequency.setValueAtTime(lerp(90, 260, near), t);
    lp.frequency.linearRampToValueAtTime(lerp(130, 460, near), t + dur * 0.12);
    lp.frequency.exponentialRampToValueAtTime(lerp(55, 110, near), t + dur);

    src.start(t);
    src.stop(t + dur + 0.3);

    // --- sub: the pressure you feel in your chest ------------------------
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subG = core.gain(0);
    const subShape = core.filter('lowpass', 120, 0.7);
    sub.connect(subShape);
    subShape.connect(subG);
    subG.connect(this.out);
    sub.frequency.setValueAtTime(lerp(40, 62, near), t);
    sub.frequency.exponentialRampToValueAtTime(lerp(19, 26, near), t + dur * 0.75);
    subG.gain.setValueAtTime(0, t);
    // Slow in, so the sub swells under the rumble rather than thudding.
    subG.gain.linearRampToValueAtTime(lerp(0.10, 0.30, near) * level, t + dur * 0.16);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
    sub.start(t);
    sub.stop(t + dur);

    // --- a second, later rumble: the sound coming back off the hills -----
    let echo = null, echoG = null, echoLP = null;
    if (Math.random() < 0.75) {
      const delay = dur * rand(0.18, 0.4);
      echo = ctx.createBufferSource();
      echo.buffer = core.brownBuffer;
      echo.loop = true;
      echo.playbackRate.value = 0.3 + Math.random() * 0.3;
      echoLP = core.filter('lowpass', lerp(90, 190, near), 1.0);
      echoG = core.gain(0);
      echo.connect(echoLP); echoLP.connect(echoG); echoG.connect(this.out);
      const ed = dur * 0.7;
      const eAmp = amp * rand(0.3, 0.6);
      echoG.gain.setValueAtTime(0, t + delay);
      echoG.gain.linearRampToValueAtTime(eAmp, t + delay + ed * 0.25);
      echoG.gain.exponentialRampToValueAtTime(0.0001, t + delay + ed);
      echo.start(t + delay);
      echo.stop(t + delay + ed + 0.2);
    }

    const cleanup = () => {
      try {
        src.disconnect(); hp.disconnect(); lp.disconnect(); g.disconnect();
        sub.disconnect(); subShape.disconnect(); subG.disconnect();
        if (echo) { echo.disconnect(); echoLP.disconnect(); echoG.disconnect(); }
      } catch (_) {}
    };
    src.onended = cleanup;

    return dur;
  }
}
