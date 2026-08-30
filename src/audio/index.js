/**
 * Soundscape facade. One object the rest of the app talks to.
 *
 * Owns the audio context and every voice, and forwards storm intensity to all
 * of them each frame. Nothing here loads a file - it is all synthesis.
 */

import { AudioCore } from './core.js';
import { RainVoice, WindVoice, ThunderVoice } from './weather.js';
import { MusicEngine } from './music.js';
import { WritingVoice, FireVoice } from './writing.js';
import { clamp01 } from '../core/util.js';

export class Soundscape {
  constructor() {
    this.core = new AudioCore();
    this.started = false;
    this.rain = null;
    this.wind = null;
    this.thunder = null;
    this.music = null;
    this.writing = null;
    this.fire = null;
    this.volume = 0.85;
    this.muted = false;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async start() {
    if (this.started) {
      if (this.core.ctx && this.core.ctx.state === 'suspended') await this.core.ctx.resume();
      return;
    }
    await this.core.start();
    this.core.setMasterVolume(this.volume);

    this.rain = new RainVoice(this.core);
    this.wind = new WindVoice(this.core);
    this.thunder = new ThunderVoice(this.core);
    this.music = new MusicEngine(this.core);
    this.writing = new WritingVoice(this.core);
    this.fire = new FireVoice(this.core);

    this.music.start();
    this.started = true;
  }

  update(intensity, dt, presence = 1) {
    if (!this.started) return;
    this.core.setIntensity(intensity, dt);
    this.rain.update(intensity, dt, presence);
    this.wind.update(intensity, dt);
    this.music.update(intensity, dt);
    this.writing.update();
  }

  /** @param {number} distance 0 = overhead crack, 1 = distant rumble */
  strikeThunder(distance = 0.5, level = 1) {
    if (!this.started) return 0;
    return this.thunder.strike(distance, level) || 0;
  }

  stroke(velocity, intensity) {
    if (!this.started) return;
    this.writing.stroke(velocity, intensity);
  }

  rustle(level, dur) {
    if (!this.started) return;
    this.writing.rustle(level, dur);
  }

  /** Glass set down on wood — choosing an ink. */
  clink(pitch, level) {
    if (!this.started) return;
    this.writing.clink(pitch, level);
  }

  setInstrument(name) {
    if (this.writing) this.writing.setInstrument(name);
  }

  accent(octave, level) {
    if (this.music) this.music.accent(octave, level);
  }

  setFire(level, dt) {
    if (this.fire) this.fire.setLevel(level, dt);
  }

  igniteFire() {
    if (this.fire) this.fire.ignite();
  }

  /** The Release: cut the heavy weather away fast. */
  release() {
    if (!this.started) return;
    this.rain.release(1.1);
    this.wind.release(1.8);
  }

  /** After the burn: one open sustained chord and soft rain. */
  enterTranquility() {
    if (!this.started) return;
    this.music.enterTranquility();
    const ctx = this.core.ctx;
    // Bring a gentle drizzle back rather than leaving dead silence.
    this.rain.bodyGain.gain.cancelScheduledValues(ctx.currentTime);
    this.rain.bodyGain.gain.setTargetAtTime(0.14, ctx.currentTime, 2.5);
    this.rain.bodyLP.frequency.setTargetAtTime(1100, ctx.currentTime, 2.5);
    this.core.toneFilter.frequency.setTargetAtTime(2400, ctx.currentTime, 3);
  }

  setVolume(v) {
    this.volume = clamp01(v);
    this.core.setMasterVolume(this.volume);
  }

  setMuted(m) {
    this.muted = m;
    this.core.setMuted(m);
  }

  get ready() {
    return this.started;
  }
}
