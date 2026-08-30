/**
 * The objects on the desk.
 *
 * There is no settings menu. You choose an instrument by picking it out of the
 * tray, an ink by opening a bottle, a stock by taking a sheet off the stack,
 * and a hand by flipping the little specimen booklet. Each control is the thing
 * it controls.
 *
 * They are real buttons underneath, grouped as radios, so they are focusable
 * and announce properly — skeuomorphism shouldn't cost you the keyboard.
 */

import { HANDS, INSTRUMENTS, INKS, STOCKS } from '../write/hands.js';

const el = (tag, cls, attrs) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export class DeskUI {
  /**
   * @param {object} opts  { onInstrument, onInk, onStock, onHand, onPickUp }
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.instrument = INSTRUMENTS[2];   // the fountain pen, to start
    this.ink = INKS[0];
    this.stock = STOCKS[0];
    this.handIndex = 0;

    this.buildTray();
    this.buildInks();
    this.buildStock();
    this.buildSpecimen();

    this.selectInstrument(this.instrument, true);
    this.selectInk(this.ink, true);
    this.selectStock(this.stock, true);
    this.selectHand(this.handIndex, true);
  }

  /* ─────────────────────────────────────────────────────── the tray ────── */

  buildTray() {
    const tray = document.getElementById('tray');
    tray.innerHTML = '';
    this.penNodes = new Map();

    for (const inst of INSTRUMENTS) {
      const b = el('button', `obj pen ${inst.id}`, {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': `${inst.name} — ${inst.note}`,
      });
      b.appendChild(el('span', 'body'));
      b.appendChild(el('span', 'tip'));
      const cap = el('span', 'cap');
      cap.textContent = inst.name;
      b.appendChild(cap);

      b.addEventListener('click', () => this.selectInstrument(inst));
      b.addEventListener('keydown', (e) => this.arrowNav(e, tray));
      tray.appendChild(b);
      this.penNodes.set(inst.id, b);
    }
  }

  selectInstrument(inst, silent = false) {
    this.instrument = inst;
    for (const [id, node] of this.penNodes) {
      node.setAttribute('aria-checked', id === inst.id ? 'true' : 'false');
      node.tabIndex = id === inst.id ? 0 : -1;
    }
    // A pencil and charcoal carry their own colour; the bottles go dim.
    const forced = !!inst.forcesInk;
    const inks = document.getElementById('inks');
    if (inks) {
      inks.style.opacity = forced ? '.42' : '1';
      inks.style.pointerEvents = forced ? 'none' : 'auto';
      inks.setAttribute('aria-disabled', forced ? 'true' : 'false');
    }
    if (!silent && this.opts.onPickUp) this.opts.onPickUp(inst);
    if (this.opts.onInstrument) this.opts.onInstrument(inst);
  }

  /* ────────────────────────────────────────────────────── the inks ─────── */

  buildInks() {
    const wrap = document.getElementById('inks');
    wrap.innerHTML = '';
    this.inkNodes = new Map();

    for (const ink of INKS) {
      const b = el('button', 'obj bottle', {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': `${ink.name} ink`,
      });
      b.style.setProperty('--ink-body', ink.hex);
      b.style.setProperty('--ink-glass', ink.glass);
      b.appendChild(el('span', 'glass'));
      b.appendChild(el('span', 'label'));
      b.appendChild(el('span', 'cap-metal'));
      const cap = el('span', 'cap');
      cap.textContent = ink.name;
      b.appendChild(cap);

      b.addEventListener('click', () => this.selectInk(ink));
      b.addEventListener('keydown', (e) => this.arrowNav(e, wrap));
      wrap.appendChild(b);
      this.inkNodes.set(ink.id, b);
    }
  }

  selectInk(ink, silent = false) {
    this.ink = ink;
    for (const [id, node] of this.inkNodes) {
      node.setAttribute('aria-checked', id === ink.id ? 'true' : 'false');
      node.tabIndex = id === ink.id ? 0 : -1;
    }
    if (this.opts.onInk) this.opts.onInk(ink);
    this.refreshSpecimen();
  }

  /* ───────────────────────────────────────────────────── the stock ─────── */

  buildStock() {
    const wrap = document.getElementById('stock');
    wrap.innerHTML = '';
    this.stockNodes = new Map();

    for (const st of STOCKS) {
      const b = el('button', 'obj sheet', {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': `${st.name} — ${st.note}`,
      });
      b.style.setProperty('--sheet-tint', st.tint);
      b.appendChild(el('span', 'edge'));
      const cap = el('span', 'cap');
      cap.textContent = st.name;
      b.appendChild(cap);

      b.addEventListener('click', () => this.selectStock(st));
      b.addEventListener('keydown', (e) => this.arrowNav(e, wrap));
      wrap.appendChild(b);
      this.stockNodes.set(st.id, b);
    }
  }

  selectStock(stock, silent = false) {
    this.stock = stock;
    for (const [id, node] of this.stockNodes) {
      node.setAttribute('aria-checked', id === stock.id ? 'true' : 'false');
      node.tabIndex = id === stock.id ? 0 : -1;
    }
    this.applyStock(stock);
    if (!silent && this.opts.onPickUp) this.opts.onPickUp(null, 'paper');
    if (this.opts.onStock) this.opts.onStock(stock);
  }

  /** Push the chosen stock onto the page's CSS variables. */
  applyStock(stock) {
    const sheet = document.getElementById('page-sheet');
    const lines = document.getElementById('page-lines');
    if (!sheet) return;
    const s = sheet.style;
    // A url() inside a custom property is resolved against the stylesheet that
    // *uses* it, not the element it is set on — so a bare relative path would
    // be looked up under /styles/. Resolve against the document instead.
    const abs = (p) => new URL(p, document.baseURI).href;
    s.setProperty('--stock-tint', stock.tint);
    s.setProperty('--stock-image', `url('${abs(stock.texture)}')`);
    s.setProperty('--stock-crease', `url('${abs(stock.crease)}')`);
    s.setProperty('--stock-grain', String(stock.grain));
    s.setProperty('--age', String(stock.ageing));
    // Deckle only belongs on handmade stock; a notebook page is cut square.
    sheet.style.setProperty('--deckle-on', stock.deckle > 0.2 ? '1' : '0');
    sheet.classList.toggle('cut', stock.deckle <= 0.2);

    if (lines) {
      lines.className = '';
      if (stock.ruled === 'grid') lines.classList.add('grid');
      else if (stock.ruled) lines.classList.add('ruled');
      if (stock.margin) lines.classList.add('margin');
    }
  }

  /* ─────────────────────────────────────────────── the specimen book ───── */

  buildSpecimen() {
    const root = document.getElementById('specimen');
    if (!root) return;
    this.specSample = root.querySelector('.spec-sample');
    this.specName = root.querySelector('.spec-name');

    root.querySelector('.prev').addEventListener('click', () => this.flipHand(-1));
    root.querySelector('.next').addEventListener('click', () => this.flipHand(1));

    // The page itself is a target too — clicking it turns forward.
    const page = root.querySelector('.spec-page');
    page.addEventListener('click', () => this.flipHand(1));
    page.style.cursor = 'pointer';
    page.setAttribute('role', 'button');
    page.setAttribute('tabindex', '0');
    page.setAttribute('aria-label', 'Turn to the next hand');
    page.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.flipHand(1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.flipHand(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.flipHand(-1); }
    });
  }

  flipHand(dir) {
    const n = HANDS.length;
    this.selectHand((this.handIndex + dir + n) % n);
    if (this.opts.onPickUp) this.opts.onPickUp(null, 'page-turn');
  }

  selectHand(index, silent = false) {
    this.handIndex = index;
    const hand = HANDS[index];
    this.refreshSpecimen();
    if (this.opts.onHand) this.opts.onHand(hand);
  }

  refreshSpecimen() {
    const hand = HANDS[this.handIndex];
    if (!this.specSample) return;
    const root = document.getElementById('specimen');
    root.style.setProperty('--spec-family', hand.family);
    root.style.setProperty('--spec-size', `calc(${hand.size} * clamp(18px, 2vw, 32px))`);
    root.style.setProperty('--spec-slant', `${hand.slant}deg`);
    this.specName.textContent = hand.name;
    // Re-trigger the fade so a flip reads as a page turning.
    this.specSample.animate(
      [{ opacity: 0, transform: 'translateX(6px) skewX(var(--spec-slant, 0deg))' },
       { opacity: 1, transform: 'translateX(0) skewX(var(--spec-slant, 0deg))' }],
      { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
  }

  /* ───────────────────────────────────────────────────────── keys ──────── */

  /** Left/right arrows move between objects in a group, as radios should. */
  arrowNav(e, group) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(group.querySelectorAll('.obj'));
    const i = items.indexOf(e.currentTarget);
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
    const next = items[(i + dir + items.length) % items.length];
    next.focus();
    next.click();
  }

  get hand() { return HANDS[this.handIndex]; }
}
