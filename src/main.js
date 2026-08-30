/**
 * Ritual — bootstrap and the frame loop.
 *
 * Everything hangs off one number. `IntensityEngine` watches how you write and
 * publishes a single 0..1 storm value; the lighting engine, the sky, the glass,
 * the candle, the atmosphere, the props and the whole soundscape are consumers
 * of it. Nothing polls anything else.
 *
 * The arc: a rumble, a build, a crescendo, and then quiet.
 */

import { IntensityEngine } from './intensity.js';
import { StormEvents } from './storm-events.js';

import { LightingEngine } from './scene/lighting.js';
import { SkyRenderer } from './scene/sky.js';
import { GlassRenderer } from './scene/glass.js';
import { CandleRenderer } from './scene/candle.js';
import { AtmosRenderer } from './scene/atmos.js';
import { PropsRenderer } from './scene/props.js';
import { BurnRenderer } from './scene/burn.js';
import { installTextures } from './scene/textures.js';

import { Paper } from './write/paper.js';
import { DeskUI } from './ui/desk.js';
import { Seal } from './ui/seal.js';
import { SealArt } from './ui/seal-art.js';
import { InfoPanel, Meter } from './ui/panels.js';
import { Haptics } from './ui/haptics.js';
import { installDebug } from './ui/debug.js';
import { Soundscape } from './audio/index.js';

import { clamp01, glide, smoothstep } from './core/util.js';

const $ = (sel) => document.querySelector(sel);

/** How far through the ritual we are. */
const PHASE = {
  THRESHOLD: 'threshold',
  WRITING: 'writing',
  CRESCENDO: 'crescendo',
  OFFERING: 'offering',
  BURNING: 'burning',
  AFTER: 'after',
};

class Ritual {
  constructor() {
    this.phase = PHASE.THRESHOLD;

    // Lace, grain and grime, generated once and handed to CSS as data URIs.
    installTextures();

    this.intensity = new IntensityEngine();
    this.events = new StormEvents();
    this.lighting = new LightingEngine();
    this.sound = new Soundscape();

    // --- renderers ------------------------------------------------------
    this.sky = new SkyRenderer($('#sky'), this.lighting);
    this.glass = new GlassRenderer($('#glass'), this.lighting);
    this.candle = new CandleRenderer($('#candle'), this.lighting);
    this.atmos = new AtmosRenderer($('#atmos'), this.lighting);
    this.props = new PropsRenderer($('#props'), this.lighting);
    this.burn = new BurnRenderer($('#burn'), $('#page-sheet'), {
      atmos: this.atmos,
      onDone: () => this.onBurnComplete(),
    });

    // --- the page -------------------------------------------------------
    this.lastStrokeAt = 0;
    this.paper = new Paper($('#script'), {
      onKeystroke: (velocity, len) => this.onKeystroke(velocity, len),
      onParagraph: (n) => this.onParagraph(n),
      onChange: (text) => this.onTextChange(text),
    });

    this.haptics = new Haptics();

    // --- the objects ----------------------------------------------------
    this.desk = new DeskUI({
      onInstrument: (inst) => {
        this.paper.setInstrument(inst);
        this.sound.setInstrument(inst.voice);
      },
      onInk: (ink) => this.paper.setInk(ink),
      onInkPickUp: (pitch) => {
        this.sound.clink(pitch, 0.55);
        this.lighting.disturb(0.18);
        this.haptics.tick();
      },
      onStock: (stock) => { this.paper.setStock(stock); this.syncRuling(); },
      onHand: (hand) => { this.paper.setHand(hand); this.syncRuling(); },
      onPickUp: (inst, what) => {
        // Handling things on the desk makes a noise and moves the air.
        this.sound.rustle(what === 'paper' ? 0.8 : 0.4, what === 'paper' ? 0.6 : 0.3);
        this.lighting.disturb(0.25);
        this.haptics.tick();
      },
    });

    this.sealArt = new SealArt($('#seal .seal-canvas'));
    this.seal = new Seal($('#seal'), {
      onCrescendo: () => this.beginCrescendo(),
      onCancel: () => this.cancelCrescendo(),
      onSubmit: () => this.submit(),
      onStrike: (hold) => this.crescendoStrike(hold),
    });

    this.info = new InfoPanel({
      paper: this.paper,
      sound: this.sound,
      onCalm: (calm) => { this.calm = calm; this.haptics.setMuted(calm); },
      onMeter: (on) => this.meter.setVisible(on),
    });
    this.meter = new Meter();

    this.calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('calm', this.calm);
    this.haptics.setMuted(this.calm);

    // --- loop -----------------------------------------------------------
    this.last = performance.now() / 1000;
    this.t = 0;
    this.fireLevel = 0;
    this.writingGlowTimer = 0;

    // How far the weather has established itself, 0..1. Separate from storm
    // intensity on purpose: intensity answers "how hard are you writing right
    // now", presence answers "how long has it been raining". A session opens
    // with a dry sky — the first thing you ever hear is one drop on the glass
    // after the first word — and the rain only really arrives over minutes.
    this.presence = 0;

    this.bindGlobal();
    this.syncRuling();

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    // Exposed for the debug console.
    window.ritual = this;
    // Both null unless the debug panel (ctrl+alt+d) has taken control.
    this.debugIntensity = null;
    this.debugPresence = null;
    this.viewportWasEmpty = false;
    this.debug = installDebug(this);
  }

  /* ────────────────────────────────────────────────────── lifecycle ────── */

  bindGlobal() {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.resize(), 120);
    }, { passive: true });

    $('#begin').addEventListener('click', () => this.begin());
    $('#again').addEventListener('click', () => this.again());

    // Clicking the page puts you back in the writing.
    $('#page').addEventListener('pointerdown', (e) => {
      if (this.phase !== PHASE.WRITING) return;
      if (e.target.closest('#info-tab')) return;
      requestAnimationFrame(() => this.paper.focus());
    });

    // Keep the flame aware of the pointer, so it leans away from your hand.
    window.addEventListener('pointermove', (e) => {
      const base = this.candle.flameBaseScreen();
      const d = Math.hypot(e.clientX - base.x, e.clientY - base.y);
      this.candle.setHover(clamp01(1 - d / 260));
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      // Coming back from another tab shouldn't dump a huge dt into the sim.
      if (!document.hidden) this.last = performance.now() / 1000;
    });
  }

  async begin() {
    const th = $('#threshold');
    th.classList.add('gone');
    setTimeout(() => { th.style.display = 'none'; }, 1500);
    this.phase = PHASE.WRITING;

    try {
      await this.sound.start();
      this.sound.setInstrument(this.desk.instrument.voice);
    } catch (err) {
      // Audio is a bonus, not a requirement — the storm still runs silently.
      console.warn('audio unavailable:', err);
    }

    // Open with a distant rumble, as promised.
    setTimeout(() => {
      const ev = { kind: 'thunder', distance: 0.82, level: 0.75 };
      this.fireEvent(ev);
    }, 1400);

    setTimeout(() => this.paper.focus(), 700);
  }

  resize() {
    this.sky.resize();
    this.glass.resize();
    this.candle.resize();
    this.atmos.resize();
    this.props.resize();
    this.sealArt.resize();
    this.syncRuling();
    if (this.burn.active) this.burn.prepare(this.burn.ignition.x, this.burn.ignition.y);
  }

  /** Keep the ruling on lined paper matching the line height of the hand. */
  syncRuling() {
    const script = $('#script');
    const lines = $('#page-lines');
    if (!script || !lines) return;
    const cs = getComputedStyle(script);
    const size = parseFloat(cs.fontSize) || 18;
    const lh = parseFloat(cs.lineHeight) || size * 1.6;
    lines.style.setProperty('--rule', `${lh}px`);
    // Put the rules under the baselines rather than under the line boxes. The
    // baseline sits a little above the bottom of each box, by the descender.
    const padTop = parseFloat(cs.paddingTop) || 0;
    const offset = (((padTop - lh * 0.19) % lh) + lh) % lh;
    lines.style.setProperty('--rule-offset', `${offset.toFixed(1)}px`);
  }

  /* ──────────────────────────────────────────────────────── writing ────── */

  onKeystroke(velocity, length) {
    if (this.phase !== PHASE.WRITING) return;
    this.intensity.keystroke(this.t, length);

    // Faster strokes land harder.
    const gap = this.t - this.lastStrokeAt;
    this.lastStrokeAt = this.t;
    const speed = clamp01(1 - gap / 0.45);
    this.sound.stroke(0.35 + speed * 0.65 * velocity, this.intensity.value);

    // The page lifts slightly while you are actually writing.
    this.writingGlowTimer = 1.6;
    $('#page').classList.add('writing');
  }

  onTextChange(text) {
    this.intensity.setDocLength(text.length);
    this.info.syncFromPaper(text);
    // The seal only offers itself once there is something to burn.
    this.seal.setReady(this.phase === PHASE.WRITING && text.trim().length > 12);
  }

  onParagraph(n) {
    if (this.phase !== PHASE.WRITING) return;
    const ev = this.events.paragraph(n, this.intensity.value);
    this.fireEvent(ev);
    // A new paragraph is a breath — the music marks it.
    this.sound.accent(n % 3 === 0 ? 2 : 1, 0.18);
  }

  /* ─────────────────────────────────────────────────── storm events ────── */

  fireEvent(ev) {
    if (!ev || ev.kind === 'none') return;

    const near = 1 - ev.distance;
    // Light first: you see a strike before you hear it.
    this.lighting.strike(ev.distance, ev.level);
    if (ev.kind === 'lightning') this.sky.strike(ev.distance);

    // Then the sound, delayed by how far away it is — three seconds a kilometre.
    const delay = ev.kind === 'lightning' ? ev.distance * 2.2 : ev.distance * 0.9;
    setTimeout(() => {
      this.sound.strikeThunder(ev.distance, ev.level);
      this.haptics.thunder(ev.distance, ev.level);
      this.glass.rattle(near * 1.8);
      if (near > 0.7 && !this.calm) {
        document.body.classList.add('jolt');
        setTimeout(() => document.body.classList.remove('jolt'), 460);
      }
      this.lighting.disturb(near * 0.5);
    }, delay * 1000);
  }

  /* ─────────────────────────────────────────────── crescendo & burn ────── */

  beginCrescendo() {
    if (this.phase !== PHASE.WRITING) return;
    this.phase = PHASE.CRESCENDO;
    this.intensity.beginCrescendo();
  }

  cancelCrescendo() {
    if (this.phase !== PHASE.CRESCENDO) return;
    this.phase = PHASE.WRITING;
    this.intensity.cancelCrescendo();
  }

  /**
   * The seal is being held. One distant rumble as the sky gathers, and that is
   * all — the moment is carried by the swell and by the single strike on
   * release, not by a strobe of them.
   */
  crescendoStrike() {
    this.fireEvent({ kind: 'thunder', distance: 0.66, level: 0.7, reason: 'gathering' });
  }

  submit() {
    this.phase = PHASE.OFFERING;
    this.seal.setReady(false);
    this.paper.setEnabled(false);
    this.haptics.sealComplete();

    // The one big strike: overhead, brighter and larger than anything else in
    // the session, with thunder arriving almost on top of it. Everything before
    // this was building toward it, so nothing else should have looked like it.
    this.finalStrike();

    // The release only begins once the crack has landed.
    setTimeout(() => {
      this.intensity.beginRelease();
      this.sound.release();
      this.offerToCandle();
    }, 1700);
  }

  /** The last thing the storm does. */
  finalStrike() {
    this.lighting.strike(0, 1.45, true);
    this.sky.strike(0, true);
    this.glass.rattle(2.4);
    if (!this.calm) {
      document.body.classList.add('jolt');
      setTimeout(() => document.body.classList.remove('jolt'), 520);
    }
    // Close enough that the sound is right behind the light.
    setTimeout(() => {
      this.sound.strikeThunder(0.0, 1.3, 1.9);
      this.haptics.thunder(0, 1);
      this.lighting.disturb(1.3);
    }, 230);
  }

  /** The page is carried to the flame. */
  offerToCandle() {
    const page = $('#page');
    const pageBox = page.getBoundingClientRect();
    const flame = this.candle.flameTipScreen();
    const dx = flame.x - (pageBox.left + pageBox.width * 0.86);
    const dy = flame.y - (pageBox.top + pageBox.height * 0.88);
    page.style.setProperty('--offer-x', `${dx * 0.55}px`);
    page.style.setProperty('--offer-y', `${dy * 0.5}px`);
    page.classList.remove('writing');
    page.classList.add('offering');
    this.sound.rustle(1, 0.8);

    // It catches at the corner nearest the flame.
    setTimeout(() => this.ignite(), 1100);
  }

  ignite() {
    this.phase = PHASE.BURNING;
    this.burn.start(0.94, 0.9, 7.0);
    this.sound.igniteFire();
    this.haptics.ignite();
    this.lighting.disturb(1.1);
    $('#page').classList.add('burning');
  }

  onBurnComplete() {
    this.phase = PHASE.AFTER;
    $('#page').classList.add('gone');
    this.sound.setFire(0, 0.016);
    this.sound.enterTranquility();
    // The colour comes back into the room.
    document.body.classList.add('cleared');

    const after = $('#afterward');
    after.hidden = false;

    // Staged, slowly. The whole sequence runs about eight seconds; it should
    // feel like being let go of rather than like a results screen.
    const note = $('#after-3');
    note.textContent = this.closingLine();
    const steps = [
      ['#after-1', 900],
      ['#after-2', 3400],
      ['#after-3', 6200],
      ['#again', 9200],
    ];
    this.afterTimers = steps.map(([sel, delay]) =>
      setTimeout(() => {
        const el = $(sel);
        if (el) el.classList.add('in');
      }, delay));

    requestAnimationFrame(() => after.classList.add('shown'));
  }

  /**
   * A closing line, varied so a second session does not feel like a replay.
   *
   * The register to avoid here is the self-help poster. These are meant to
   * sound like a person who happens to be in the room, not like an app being
   * pleased with you — short, plain, and slightly understated.
   */
  closingLine() {
    const lines = [
      'it feels good to let go.',
      'thanks for doing that.',
      'that took something. well done.',
      'you can put it down now.',
      'nothing leaves this room.',
      'the rain has eased off.',
      'that was yours. now it is nobody’s.',
      'go and have a cup of tea.',
      'lighter, isn’t it.',
      'whatever it was, it is behind you.',
    ];
    // Never the same line twice running.
    let pick;
    do {
      pick = lines[(Math.random() * lines.length) | 0];
    } while (lines.length > 1 && pick === this._lastClosing);
    this._lastClosing = pick;
    return pick;
  }

  again() {
    const after = $('#afterward');
    after.classList.remove('shown');
    setTimeout(() => { after.hidden = true; }, 1200);
    // Clear the staged reveal so the next ending plays from the start.
    for (const t of this.afterTimers || []) clearTimeout(t);
    this.afterTimers = [];
    for (const sel of ['#after-1', '#after-2', '#after-3', '#again']) {
      const el = $(sel);
      if (el) el.classList.remove('in');
    }
    document.body.classList.remove('cleared');

    const page = $('#page');
    page.classList.remove('offering', 'burning', 'gone');
    page.style.removeProperty('--offer-x');
    page.style.removeProperty('--offer-y');
    page.style.removeProperty('--sheet-left');

    this.haptics.stop();
    this.burn.reset();
    this.paper.setEnabled(true);
    this.paper.clear();

    // A fresh sky: the storm starts over from the drizzle.
    this.intensity = new IntensityEngine();
    this.events.reset();
    this.presence = 0;
    this.sound.music.tranquil = false;
    this.phase = PHASE.WRITING;
    setTimeout(() => this.paper.focus(), 400);
  }

  /* ─────────────────────────────────────────────────────────── loop ────── */

  loop(now) {
    // Re-armed first rather than last. The loop is the only thing keeping the
    // scene alive, so a single bad frame must not be able to freeze it for the
    // rest of the session.
    requestAnimationFrame(this.loop);

    // A hidden tab, a minimised window or a collapsed pane reports a 0x0
    // viewport. There is nothing to draw, and the renderers all divide by the
    // width somewhere — laid out against zero, the candle and the ink jar end
    // up at the same point and the shading term goes 0/0. So sit the frame
    // out, and lay the scene out again when the window comes back, because
    // everything built while hidden was built against nothing.
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw === 0 || vh === 0) { this.viewportWasEmpty = true; return; }
    if (this.viewportWasEmpty) {
      this.viewportWasEmpty = false;
      this.resize();
    }

    const tNow = now / 1000;
    let dt = tNow - this.last;
    this.last = tNow;
    // Cap the step so a tab-switch can't jump the simulation by seconds. The
    // cap doubles as a slow-motion floor, so it has to sit below the slowest
    // frame rate we still want to feel correct — at 0.05 a 12fps device ran
    // every timed animation at 60% speed.
    dt = Math.min(dt, 0.1);
    this.t += dt;

    // ---- the number everything reads --------------------------------
    const v = this.debugIntensity !== null
      ? this.debugIntensity
      : this.intensity.update(this.t, dt);

    // Presence only starts accruing once there is writing to accompany.
    const writingFor = this.intensity.startedAt === null ? 0 : this.intensity.elapsed;
    const presenceTarget = smoothstep(writingFor / 150);
    // Glides slowly, and never falls back — weather does not un-happen.
    this.presence = this.debugPresence !== null
      ? this.debugPresence
      : Math.max(this.presence, glide(this.presence, presenceTarget, 6, dt));

    this.seal.update(dt);
    // The seal is lit by the same flame as everything else, and the light comes
    // from whichever side the candle is actually on.
    this.sealArt.draw(
      this.lighting.candle.value,
      this.seal.hold,
      clamp01((this.lighting.candle.x - window.innerWidth * 0.5) / (window.innerWidth * 0.5)) * 2 - 1
    );
    this.lighting.update(dt, v);

    // ---- the world ----------------------------------------------------
    this.sky.update(dt, v, this.presence);
    this.glass.update(dt, v, this.presence);
    this.candle.update(dt, v);
    this.atmos.update(dt, v);
    this.props.update(dt, v);

    this.props.draw();
    this.sky.draw();
    this.glass.draw();
    this.candle.draw();

    // ---- the page burning ---------------------------------------------
    if (this.burn.active) {
      const heat = this.burn.update(dt);
      this.burn.draw();
      // Less sheet means less shadow. Fading it only at the end would leave a
      // dark rectangle lying on the desk under a page that is no longer there.
      $('#page').style.setProperty('--sheet-left',
        Math.max(0, 1 - this.burn.progress * 1.15).toFixed(3));
      this.fireLevel = heat;
      this.sound.setFire(heat, dt);
      // The fire takes over as the room's light source.
      this.lighting.candle.gust = Math.max(this.lighting.candle.gust, heat * 0.25);
    } else if (this.fireLevel > 0) {
      this.fireLevel = Math.max(0, this.fireLevel - dt);
      this.sound.setFire(this.fireLevel, dt);
    }

    this.atmos.draw();

    // ---- audio ---------------------------------------------------------
    this.sound.update(v, dt, this.presence);

    this.debug.update(dt);

    // ---- the hand deteriorates as the storm rises ---------------------
    if (this.phase === PHASE.WRITING || this.phase === PHASE.CRESCENDO) {
      this.paper.setAgitation(v * 0.8);
    }

    // ---- ambient weather ----------------------------------------------
    if (this.phase === PHASE.WRITING) {
      const ev = this.events.ambient(dt, v);
      if (ev.kind !== 'none') this.fireEvent(ev);
    }

    // ---- odds and ends -------------------------------------------------
    if (this.writingGlowTimer > 0) {
      this.writingGlowTimer -= dt;
      if (this.writingGlowTimer <= 0) $('#page').classList.remove('writing');
    }
    this.meter.update(dt, this.intensity);
  }
}

/**
 * Offline support, on the website only.
 *
 * Registering is skipped for `file://` (the single-file build) and for Tauri
 * (the desktop build), because both already have every asset locally and a
 * service worker there would be a cache with nothing to cache and a version to
 * keep in step for no reason.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      // Offline capability is a bonus; failing to get it must never stop the
      // app from running.
      console.warn('offline support unavailable:', err && err.message);
    });
  });
}

/**
 * Reveal the Windows download on the opening card.
 *
 * Only on http(s): in the desktop build and the single-file build the link
 * would point at a Ritual.exe that is not there, and in both cases the person
 * reading it has already downloaded the thing it is offering.
 */
function offerDesktopDownload() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) return;
  const el = document.querySelector('.th-get');
  if (el) el.hidden = false;
}

new Ritual();
registerServiceWorker();
offerDesktopDownload();
