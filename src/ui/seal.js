/**
 * The wax seal: the Crescendo, and then the Release.
 *
 * Hovering (after a short dwell, so brushing past doesn't set the sky off) or
 * pressing begins the crescendo — storm intensity is overridden and force-ramped
 * to 1.0 over 1.5s while lightning fires in quick succession.
 *
 * Letting go once the ramp has completed submits: the heavy weather is cut, the
 * page goes to the candle, and what follows is quiet.
 */

import { clamp01 } from '../core/util.js';

export class Seal {
  /**
   * @param {HTMLElement} el
   * @param {object} opts { onCrescendo, onCancel, onSubmit, onStrike }
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.ready = false;
    this.armed = false;       // crescendo running
    this.pressed = false;
    this.hold = 0;            // 0..1
    this.dwell = 0;           // hover dwell timer
    this.hovering = false;
    this.rumbled = false;
    this.rampSeconds = 2.4;
    this.complete = false;   // the hold ran to completion
    this.pressStartedAt = null;
    this.blocked = false;    // a cancelled hold locks out re-arming until leave

    this.bind();
  }

  bind() {
    const el = this.el;

    el.addEventListener('pointerenter', () => { this.hovering = true; });
    el.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.dwell = 0;
      // Leaving clears the lockout, so a fresh approach can arm again.
      this.blocked = false;
      if (!this.pressed) this.disarm();
    });

    el.addEventListener('pointerdown', (e) => {
      if (!this.ready) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.pressed = true;
      this.pressStartedAt = performance.now();
      this.arm();
    });

    const release = (e) => {
      if (!this.pressed) return;
      this.pressed = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      this.finish();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    // Keyboard: hold Enter or Space.
    el.addEventListener('keydown', (e) => {
      if (!this.ready) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!this.pressed) { this.pressed = true; this.pressStartedAt = performance.now(); this.arm(); }
      }
    });
    el.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.pressed) { this.pressed = false; this.finish(); }
      }
    });
    el.addEventListener('blur', () => {
      if (this.pressed) { this.pressed = false; this.disarm(); }
    });
  }

  setReady(ready) {
    if (this.ready === ready) return;
    this.ready = ready;
    this.el.classList.toggle('ready', ready);
    this.el.tabIndex = ready ? 0 : -1;
  }

  arm() {
    if (this.armed) return;
    this.armed = true;
    this.pressStartedAt = performance.now();
    this.rumbled = false;
    this.el.classList.add('holding');
    if (this.opts.onCrescendo) this.opts.onCrescendo();
  }

  disarm() {
    if (!this.armed) return;
    this.armed = false;
    this.hold = 0;
    this.complete = false;
    this.pressStartedAt = null;
    this.el.classList.remove('holding');
    this.el.style.setProperty('--hold', '0');
    if (this.opts.onCancel) this.opts.onCancel();
  }

  /**
   * Released. Only a hold that ran to completion submits — otherwise letting go
   * early would burn the page by accident.
   *
   * The threshold is a little under 1 on purpose: the gauge advances on rAF, so
   * insisting on a full 1.0 makes a legitimate hold fail whenever a frame is
   * dropped right at the end.
   */
  finish() {
    if (!this.armed) return;
    if (this.complete) {
      this.armed = false;
      this.complete = false;
      this.el.classList.remove('holding', 'ready');
      this.el.style.setProperty('--hold', '0');
      this.ready = false;
      if (this.opts.onSubmit) this.opts.onSubmit();
    } else {
      // Not held long enough. Reset the gauge and lock out re-arming until the
      // pointer leaves, so a cancelled hold doesn't instantly restart itself.
      this.blocked = true;
      this.disarm();
    }
  }

  update(dt) {
    // Dwelling on it with the pointer starts the crescendo too, per the brief —
    // but only after a moment, so brushing past doesn't set the sky off.
    if (this.ready && this.hovering && !this.armed && !this.pressed && !this.blocked) {
      this.dwell += dt;
      if (this.dwell > 0.25) this.arm();
    }

    if (!this.armed) return;

    // The gauge only fills while you are actually pressing. Hovering winds up
    // the storm; committing to the burn takes a deliberate hold.
    if (this.pressed) {
      // Measured against the clock, not accumulated frame steps: "hold for a
      // second and a half" has to mean a second and a half even on a device
      // that is only managing a handful of frames a second.
      if (this.pressStartedAt == null) this.pressStartedAt = performance.now();
      const held = (performance.now() - this.pressStartedAt) / 1000;
      this.hold = clamp01(held / this.rampSeconds);
      if (this.hold >= 0.94) this.complete = true;
      this.el.style.setProperty('--hold', this.hold.toFixed(3));
    }

    // One distant rumble as the sky gathers, and then nothing. Firing a strike
    // every fifth of a second turned the most deliberate moment in the app into
    // a strobe; the single close strike on release does the work instead.
    if (!this.rumbled && this.hold > 0.28) {
      this.rumbled = true;
      if (this.opts.onStrike) this.opts.onStrike(this.hold);
    }
  }
}
