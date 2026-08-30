/**
 * Audio core: the shared context, master bus, reverb and noise buffers.
 *
 * Everything in this app is synthesised at runtime - there are no sample files.
 * The master chain is:
 *
 *   [voices] -> busGain -> toneFilter (lowpass) -> shelf -> compressor -> out
 *        \-> reverbSend -> convolver -> reverbGain -^
 *
 * `toneFilter` is the "distance" control: at low storm intensity the world is
 * muffled and far away; as the storm builds the filter opens and everything
 * moves into the room with you.
 */

import { clamp, clamp01, lerp, glide } from '../core/util.js';

export class AudioCore {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.intensity = 0;
    this._targetMaster = 0.9;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    // --- master chain ---------------------------------------------------
    this.out = ctx.createGain();
    this.out.gain.value = 0; // faded in on start

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.28;

    // A gentle low shelf keeps the storm warm rather than hissy.
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = 'lowshelf';
    this.shelf.frequency.value = 180;
    this.shelf.gain.value = 3;

    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 520;
    this.toneFilter.Q.value = 0.6;

    this.bus = ctx.createGain();
    this.bus.gain.value = 1;

    // A bus that skips the tone filter. The filter stands for how far away the
    // weather is; things that are unambiguously in the room with you — the nib
    // on the paper, the page catching fire — must not be muffled by it, or the
    // pen goes silent exactly when the sky is calmest.
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.shelf);

    this.bus.connect(this.toneFilter);
    this.toneFilter.connect(this.shelf);
    this.shelf.connect(this.compressor);
    this.compressor.connect(this.out);
    this.out.connect(ctx.destination);

    // --- reverb ----------------------------------------------------------
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.makeImpulse(3.6, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.compressor); // reverb bypasses the tone filter

    // A longer, darker tail used only by thunder.
    this.bigConvolver = ctx.createConvolver();
    this.bigConvolver.buffer = this.makeImpulse(9.5, 2.6, true);
    this.bigReverbGain = ctx.createGain();
    this.bigReverbGain.gain.value = 1.05;
    this.bigSend = ctx.createGain();
    this.bigSend.connect(this.bigConvolver);
    this.bigConvolver.connect(this.bigReverbGain);
    this.bigReverbGain.connect(this.compressor);

    // --- shared noise buffers -------------------------------------------
    this.whiteBuffer = this.makeNoiseBuffer(4, 'white');
    this.pinkBuffer = this.makeNoiseBuffer(4, 'pink');
    this.brownBuffer = this.makeNoiseBuffer(6, 'brown');

    this.ready = true;
    this.fadeIn(2.5);
    return ctx;
  }

  fadeIn(seconds = 2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(this.muted ? 0 : this._targetMaster, t + seconds);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(muted ? 0 : this._targetMaster, t + 0.4);
  }

  setMasterVolume(v) {
    this._targetMaster = clamp01(v);
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(this._targetMaster, t + 0.2);
  }

  /**
   * Drive the master tone from storm intensity.
   * Calm -> ~420Hz (weather heard through a closed window).
   * Storm -> ~9kHz (the weather is effectively in the room).
   * Drops on the pane and the pen bypass this entirely - see `core.dry`.
   */
  setIntensity(v, dt = 1 / 60) {
    this.intensity = v;
    if (!this.ready) return;
    const shaped = Math.pow(clamp01(v), 0.72);
    const target = lerp(420, 9000, shaped);
    const f = this.toneFilter.frequency;
    // Glide by hand so the filter never zippers on sudden intensity jumps.
    f.value = glide(f.value, target, 0.18, dt);
    this.reverbGain.gain.value = lerp(0.62, 0.34, shaped);
  }

  /** Procedural impulse response: shaped noise with an exponential decay. */
  makeImpulse(seconds = 3, decay = 2.5, dark = false) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0, lp2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        let n = Math.random() * 2 - 1;
        if (dark) {
          // Two one-pole lowpasses in series: a single pole leaves enough top
          // end that the tail hisses, which reads as noise rather than as a
          // valley full of thunder.
          lp += (n - lp) * 0.05;
          lp2 += (lp - lp2) * 0.05;
          n = lp2 * 9.0;
        }
        // A short pre-delay of near-silence reads as room size.
        const pre = t < 0.012 ? t / 0.012 : 1;
        data[i] = n * env * pre;
      }
    }

    // Normalise to a fixed RMS.
    //
    // The dark tail is built by running noise through two one-pole filters and
    // multiplying the result back up by a hand-picked constant, which means the
    // level depends on the filter coefficients rather than on anything
    // meaningful. Without this, changing how dark the reverb is also silently
    // changes how loud it is, and `reverbGain` stops meaning anything.
    let energy = 0, count = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i += 32) { energy += d[i] * d[i]; count++; }
    }
    const rms = Math.sqrt(energy / Math.max(1, count));
    if (rms > 1e-6) {
      const k = 0.16 / rms;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
    }
    return buf;
  }

  /** Looping noise buffer. White is flat, pink is -3dB/oct, brown is -6dB/oct. */
  makeNoiseBuffer(seconds = 4, kind = 'white') {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      if (kind === 'white') {
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } else if (kind === 'brown') {
        let last = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          last = (last + 0.02 * w) / 1.02;
          data[i] = last * 3.5;
        }
      } else {
        // Paul Kellet's pink noise approximation.
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
          b6 = w * 0.115926;
          data[i] = out * 0.11;
        }
      }
      // Cross-fade the seam so the loop is inaudible.
      const fade = Math.min(2048, (len / 4) | 0);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        data[i] = data[i] * k + data[len - fade + i] * (1 - k);
      }
    }
    return buf;
  }

  /** A looping noise source, already started. */
  noiseSource(kind = 'white', rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = kind === 'brown' ? this.brownBuffer : kind === 'pink' ? this.pinkBuffer : this.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(0);
    return src;
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type, freq, Q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    return f;
  }

  /** A slow LFO for organic drift. Returns { osc, gain } already running. */
  lfo(freq, depth, target) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    if (target) g.connect(target);
    osc.start(0);
    return { osc, gain: g };
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}

/** Ramp an AudioParam smoothly without clicks. */
export function ramp(param, value, seconds, ctx) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  if (seconds <= 0) param.setValueAtTime(value, t);
  else param.linearRampToValueAtTime(value, t + seconds);
}

/** Set an AudioParam directly but with a tiny smoothing time to avoid zipper noise. */
export function set(param, value, ctx, smooth = 0.05) {
  param.setTargetAtTime(value, ctx.currentTime, Math.max(0.001, smooth / 3));
}

export { clamp, clamp01, lerp };
