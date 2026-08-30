/**
 * The info sheet (which carries the plain-text box), and the intensity meter
 * rendered as a brass barometer.
 *
 * The plain-text box is a real textarea kept in two-way sync with the page, so
 * anyone who finds the handwriting hard to read — or who simply wants to type —
 * has a completely ordinary place to write.
 */

import { clamp01 } from '../core/util.js';

export class InfoPanel {
  /**
   * @param {object} opts { paper, sound, onCalm, onMeter }
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.sheet = document.getElementById('info-sheet');
    this.tab = document.getElementById('info-tab');
    this.closeBtn = document.getElementById('info-close');
    this.textarea = document.getElementById('plain-text');
    this.open = false;
    this.syncing = false;
    this.lastFocus = null;

    this.bind();
  }

  bind() {
    this.tab.addEventListener('click', () => this.toggle());
    this.closeBtn.addEventListener('click', () => this.close());
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.close(); }
    });

    // Plain text -> page
    this.textarea.addEventListener('input', () => {
      if (this.syncing) return;
      const paper = this.opts.paper;
      if (!paper) return;
      this.syncing = true;
      paper.setText(this.textarea.value, this.textarea.selectionStart);
      this.syncing = false;
    });

    // Controls
    const vol = document.getElementById('vol');
    vol.addEventListener('input', () => {
      if (this.opts.sound) this.opts.sound.setVolume(Number(vol.value) / 100);
    });

    const calm = document.getElementById('reduce-motion');
    calm.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('calm', calm.checked);
    calm.addEventListener('change', () => {
      document.body.classList.toggle('calm', calm.checked);
      if (this.opts.onCalm) this.opts.onCalm(calm.checked);
    });

    const meterToggle = document.getElementById('show-meter');
    meterToggle.addEventListener('change', () => {
      if (this.opts.onMeter) this.opts.onMeter(meterToggle.checked);
    });
  }

  /** Page -> plain text. */
  syncFromPaper(text) {
    if (this.syncing) return;
    if (this.textarea.value === text) return;
    this.syncing = true;
    const pos = this.textarea.selectionStart;
    this.textarea.value = text;
    if (this.open && document.activeElement === this.textarea) {
      this.textarea.setSelectionRange(pos, pos);
    }
    this.syncing = false;
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.lastFocus = document.activeElement;
    this.sheet.hidden = false;
    this.open = true;
    if (this.opts.paper) this.syncFromPaper(this.opts.paper.text);
    // Focus the close button rather than the textarea, so opening the sheet
    // doesn't immediately steal what you were writing.
    requestAnimationFrame(() => this.closeBtn.focus());
  }

  close() {
    this.sheet.hidden = true;
    this.open = false;
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
    else if (this.opts.paper) this.opts.paper.focus();
  }
}

export class Meter {
  constructor() {
    this.el = document.getElementById('meter');
    this.needle = this.el.querySelector('.meter-needle');
    this.read = this.el.querySelector('.meter-read');
    this.detail = this.el.querySelector('.meter-detail');
    this.visible = false;
    this.acc = 0;
  }

  setVisible(v) {
    this.visible = v;
    this.el.hidden = !v;
  }

  update(dt, engine) {
    if (!this.visible) return;
    // Ten updates a second is plenty; the needle has its own CSS transition.
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;

    const d = engine.debug();
    this.needle.style.setProperty('--needle', clamp01(d.value).toFixed(3));
    this.read.textContent = d.value.toFixed(2);
    this.detail.textContent =
      `floor   ${d.floor.toFixed(2)}\n` +
      `surge   ${d.surge.toFixed(2)}\n` +
      `warmth  ${d.warmth.toFixed(2)}\n` +
      `now     ${Math.round(d.instant)} c/m\n` +
      `avg     ${Math.round(d.session)} c/m\n` +
      `chars   ${d.chars}\n` +
      `time    ${Math.floor(d.elapsed / 60)}:${String(Math.floor(d.elapsed % 60)).padStart(2, '0')}\n` +
      `mode    ${d.mode}`;
  }
}
