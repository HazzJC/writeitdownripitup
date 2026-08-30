/**
 * The debug overlay — Ctrl+Alt+D, or ?debug in the URL.
 *
 * Everything in Ritual hangs off two numbers: `intensity`, which the writing
 * drives, and `presence`, which only time drives. That makes the whole thing
 * hard to check by hand, because reaching intensity 0.9 honestly means writing
 * hard for several minutes, and reaching presence 1.0 means writing for a
 * hundred and fifty seconds no matter what you do. This panel lets you pin
 * both and watch every subsystem respond, so the range of each is verifiable
 * in seconds rather than by playing through.
 *
 * It builds its own DOM and styles on first open. Nothing here touches
 * index.html or the stylesheets, and nothing runs at all until you open it.
 *
 * Ctrl+Alt+D rather than the more obvious Ctrl+Shift+D: the latter is
 * "bookmark all tabs" in Chrome and Edge, and a page cannot preventDefault a
 * browser-level shortcut, so it would fire the panel *and* spray bookmarks.
 */

import { clamp01 } from '../core/util.js';
import { HANDS, INSTRUMENTS, INKS, STOCKS } from '../write/hands.js';

const SAMPLES = 260;

const CSS = `
#dbg {
  position: fixed; top: 10px; left: 10px; z-index: 9999;
  width: 268px; max-height: calc(100vh - 20px); overflow-y: auto;
  font: 11px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color: #c8d4e4; background: rgba(8, 11, 17, 0.93);
  border: 1px solid rgba(150, 180, 225, 0.22); border-radius: 6px;
  padding: 9px 10px 11px; backdrop-filter: blur(7px);
  box-shadow: 0 8px 34px rgba(0, 0, 0, 0.6);
  -webkit-user-select: none; user-select: none;
}
#dbg h4 {
  margin: 11px 0 5px; font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.13em; text-transform: uppercase; color: #6f88ab;
}
#dbg h4:first-of-type { margin-top: 7px; }
#dbg .dbg-top { display: flex; align-items: baseline; justify-content: space-between; }
#dbg .dbg-title { font-size: 10px; letter-spacing: 0.14em; color: #8fa6c6; text-transform: uppercase; }
#dbg .dbg-hint { font-size: 9px; color: #4f627c; }
#dbg canvas { display: block; width: 100%; height: 46px; margin: 5px 0 2px;
  border: 1px solid rgba(150, 180, 225, 0.14); border-radius: 3px; background: rgba(0,0,0,0.3); }
#dbg .dbg-legend { display: flex; gap: 10px; font-size: 9px; color: #6f88ab; margin-bottom: 3px; }
#dbg .dbg-legend i { font-style: normal; }
#dbg pre { margin: 0; font: inherit; color: #9fb3cd; white-space: pre; }
#dbg .row { display: flex; align-items: center; gap: 5px; margin: 3px 0; }
#dbg .row > label { flex: 0 0 54px; color: #8fa6c6; }
#dbg input[type=range] { flex: 1; min-width: 0; accent-color: #d8a24a; height: 14px; }
#dbg input[type=range]:disabled { opacity: 0.35; }
#dbg .val { flex: 0 0 30px; text-align: right; color: #e2c58a; }
#dbg select { width: 100%; background: #121722; color: #c8d4e4; font: inherit;
  border: 1px solid rgba(150,180,225,0.2); border-radius: 3px; padding: 2px 3px; }
#dbg button {
  font: inherit; color: #c8d4e4; background: #18202e; cursor: pointer;
  border: 1px solid rgba(150, 180, 225, 0.22); border-radius: 3px; padding: 3px 6px;
}
#dbg button:hover { background: #222d40; border-color: rgba(150, 180, 225, 0.4); }
#dbg button.on { background: #6b4c14; border-color: #d8a24a; color: #f3dcae; }
#dbg .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
#dbg .grid.two { grid-template-columns: repeat(2, 1fr); }
#dbg .lock { flex: 0 0 auto; padding: 2px 5px; font-size: 9px; }
`;

/** One labelled slider with its own auto/lock button. */
class Override {
  /**
   * @param {string} label
   * @param {(v: number|null) => void} apply called with null to hand control back
   */
  constructor(label, apply) {
    this.apply = apply;
    this.locked = false;

    this.el = document.createElement('div');
    this.el.className = 'row';

    const name = document.createElement('label');
    name.textContent = label;

    this.lock = document.createElement('button');
    this.lock.className = 'lock';
    this.lock.textContent = 'auto';
    this.lock.title = 'Take control of this value';
    this.lock.addEventListener('click', () => this.setLocked(!this.locked));

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0'; this.slider.max = '1'; this.slider.step = '0.005';
    this.slider.value = '0';
    this.slider.disabled = true;
    this.slider.addEventListener('input', () => {
      // Dragging the slider is itself a request to take control.
      if (!this.locked) this.setLocked(true);
      else this.push();
    });

    this.read = document.createElement('span');
    this.read.className = 'val';
    this.read.textContent = '0.00';

    this.el.append(name, this.lock, this.slider, this.read);
  }

  setLocked(on) {
    this.locked = on;
    this.lock.textContent = on ? 'lock' : 'auto';
    this.lock.classList.toggle('on', on);
    this.slider.disabled = !on;
    this.push();
  }

  push() {
    this.apply(this.locked ? Number(this.slider.value) : null);
  }

  /** Jump to a value, taking control if it does not already have it. */
  set(v) {
    this.slider.value = String(clamp01(v));
    if (!this.locked) this.setLocked(true); else this.push();
  }

  /** Show the live value while unlocked, so the slider tracks reality. */
  follow(v) {
    if (this.locked) { this.read.textContent = Number(this.slider.value).toFixed(2); return; }
    this.slider.value = String(clamp01(v));
    this.read.textContent = v.toFixed(2);
  }
}

export class DebugPanel {
  /** @param {object} app the Ritual instance — read and written directly */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.built = false;
    this.acc = 0;
    // Ring buffers for the graph.
    this.iHist = new Float32Array(SAMPLES);
    this.pHist = new Float32Array(SAMPLES);
    this.head = 0;
    this.sweep = null;
  }

  toggle() { this.open ? this.hide() : this.show(); }

  show() {
    if (!this.built) this.build();
    this.open = true;
    this.el.hidden = false;
  }

  hide() {
    this.open = false;
    if (this.el) this.el.hidden = true;
  }

  /* ── construction ─────────────────────────────────────────────────────── */

  build() {
    this.built = true;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'dbg';
    el.hidden = true;

    const h = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const heading = (t) => h('h4', null, t);
    const btn = (label, title, fn) => {
      const b = h('button', null, label);
      if (title) b.title = title;
      b.addEventListener('click', fn);
      return b;
    };

    const top = h('div', 'dbg-top');
    top.append(h('span', 'dbg-title', 'ritual · debug'), h('span', 'dbg-hint', 'ctrl+alt+d'));
    el.append(top);

    /* --- the tracker --------------------------------------------------- */
    this.canvas = document.createElement('canvas');
    this.canvas.width = 268 * 2;
    this.canvas.height = 46 * 2;
    this.gfx = this.canvas.getContext('2d');
    el.append(this.canvas);

    const legend = h('div', 'dbg-legend');
    const key = (colour, label) => {
      const s = h('i', null, `■ ${label}`);
      s.style.color = colour;
      return s;
    };
    legend.append(key('#d8a24a', 'intensity'), key('#5fa8d3', 'presence'));
    el.append(legend);

    this.readout = h('pre');
    el.append(this.readout);

    /* --- overrides ------------------------------------------------------ */
    el.append(heading('override'));
    this.oIntensity = new Override('intensity', (v) => { this.app.debugIntensity = v; });
    this.oPresence = new Override('presence', (v) => { this.app.debugPresence = v; });
    el.append(this.oIntensity.el, this.oPresence.el);

    const snaps = h('div', 'grid');
    snaps.append(
      btn('min', 'Pin both to 0 — the world at its calmest', () => this.pin(0)),
      btn('max', 'Pin both to 1 — every effect at full', () => this.pin(1)),
      btn('sweep', 'Ramp both 0 → 1 over 10s, then hand control back', () => this.startSweep()),
    );
    el.append(snaps);

    const release = h('div', 'grid');
    release.append(
      btn('release', 'Hand both values back to the app', () => {
        this.sweep = null;
        this.oIntensity.setLocked(false);
        this.oPresence.setLocked(false);
      }),
      btn('½', 'Pin both to the midpoint', () => this.pin(0.5)),
    );
    release.className = 'grid two';
    el.append(release);

    /* --- one-shot events ------------------------------------------------ */
    el.append(heading('trigger'));
    const trig = h('div', 'grid');
    const fire = (kind, distance, level) => () =>
      this.app.fireEvent({ kind, distance, level, reason: 'debug' });
    trig.append(
      btn('⚡ near', 'Lightning overhead', fire('lightning', 0.12, 1)),
      btn('⚡ far', 'Lightning on the horizon', fire('lightning', 0.9, 0.7)),
      btn('rumble', 'Thunder with no flash', fire('thunder', 0.7, 0.8)),
    );
    el.append(trig);

    /* --- the tools ------------------------------------------------------ */
    el.append(heading('tools'));
    this.selects = {};
    const chooser = (label, list, onPick) => {
      const row = h('div', 'row');
      row.append(h('label', null, label));
      const sel = document.createElement('select');
      list.forEach((item, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = item.name || item.id;
        sel.append(o);
      });
      sel.addEventListener('change', () => onPick(list[Number(sel.value)], Number(sel.value)));
      row.append(sel);
      el.append(row);
      return sel;
    };

    const desk = () => this.app.desk;
    this.selects.hand = chooser('hand', HANDS, (_h, i) => desk() && desk().selectHand(i));
    this.selects.instrument = chooser('pen', INSTRUMENTS, (it) => desk() && desk().selectInstrument(it));
    this.selects.ink = chooser('ink', INKS, (it) => desk() && desk().selectInk(it));
    this.selects.stock = chooser('paper', STOCKS, (it) => desk() && desk().selectStock(it));

    document.body.appendChild(el);
    this.el = el;

    // Reflect whatever the desk already has selected.
    this.syncTools();
  }

  /* ── control ──────────────────────────────────────────────────────────── */

  pin(v) {
    this.sweep = null;
    this.oIntensity.set(v);
    this.oPresence.set(v);
  }

  startSweep() {
    this.oIntensity.set(0);
    this.oPresence.set(0);
    this.sweep = 0;
  }

  syncTools() {
    const d = this.app.desk;
    if (!d || !this.selects) return;
    const at = (list, id) => Math.max(0, list.findIndex((x) => x.id === id));
    if (d.handIndex !== undefined) this.selects.hand.value = String(d.handIndex);
    if (d.instrument) this.selects.instrument.value = String(at(INSTRUMENTS, d.instrument.id));
    if (d.ink) this.selects.ink.value = String(at(INKS, d.ink.id));
    if (d.stock) this.selects.stock.value = String(at(STOCKS, d.stock.id));
  }

  /* ── per frame ────────────────────────────────────────────────────────── */

  update(dt) {
    if (!this.open) return;
    const app = this.app;

    if (this.sweep !== null) {
      this.sweep += dt / 10;
      if (this.sweep >= 1) { this.sweep = null; }
      else {
        this.oIntensity.set(this.sweep);
        this.oPresence.set(this.sweep);
      }
    }

    // The graph wants every frame; the text does not.
    const iv = app.intensity ? app.intensity.value : 0;
    this.iHist[this.head] = iv;
    this.pHist[this.head] = app.presence || 0;
    this.head = (this.head + 1) % SAMPLES;

    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;

    this.drawGraph();
    this.oIntensity.follow(iv);
    this.oPresence.follow(app.presence || 0);

    const d = app.intensity.debug();
    const L = app.lighting;
    const n = (x, p = 2) => (x === undefined || x === null ? '—' : Number(x).toFixed(p));
    const mm = Math.floor(d.elapsed / 60);
    const ss = String(Math.floor(d.elapsed % 60)).padStart(2, '0');

    this.readout.textContent =
      `value  ${n(d.value)}  target ${n(d.target)}\n` +
      `floor  ${n(d.floor)}  surge  ${n(d.surge)}\n` +
      `warmth ${n(d.warmth)}  press  ${n(app.presence)}\n` +
      `rate   ${Math.round(d.instant)} c/m   avg ${Math.round(d.session)} c/m\n` +
      `chars  ${d.chars}  time ${mm}:${ss}  ${d.mode}\n` +
      `phase  ${app.phase}  fire ${n(app.fireLevel)}\n` +
      `candle ${n(L.candle.value)}  gust ${n(L.candle.gust)}\n` +
      `flash  ${n(L.flash)}  ambient ${n(L.ambient)}\n` +
      `drops  ${app.sky.activeDrops}/${app.sky.maxDrops}` +
      `  bead ${app.glass.beads.length} run ${app.glass.runners.length}\n` +
      `flame  ${n(app.candle.flameH, 1)}  motes ${app.atmos.motes.length}` +
      `  emb ${app.atmos.embers.length}\n` +
      `pen    ${n(app.sound.writing ? app.sound.writing.activity : 0)}` +
      `  audio ${app.sound.started ? 'on' : 'off'}`;
  }

  drawGraph() {
    const g = this.gfx;
    const w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);

    // Quarter gridlines, so the eye can read a level off the trace.
    g.strokeStyle = 'rgba(150,180,225,0.10)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round(h * (i / 4)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    const trace = (buf, colour) => {
      g.strokeStyle = colour;
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < SAMPLES; i++) {
        // Oldest sample first: the head is the next slot to be written.
        const v = buf[(this.head + i) % SAMPLES];
        const x = (i / (SAMPLES - 1)) * w;
        const y = h - clamp01(v) * (h - 3) - 1.5;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    trace(this.pHist, '#5fa8d3');
    trace(this.iHist, '#d8a24a');
  }
}

/**
 * Wire the shortcut up. Returns the panel so the loop can drive it.
 * Registered in the capture phase so it works with the caret in the page.
 */
export function installDebug(app) {
  const panel = new DebugPanel(app);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      panel.toggle();
    }
  }, true);
  if (/[?&]debug\b/.test(location.search)) panel.show();
  return panel;
}
