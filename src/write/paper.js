/**
 * The writing surface.
 *
 * A controlled `contenteditable`: the JS string is the single source of truth,
 * and the DOM is rebuilt from it. That is what makes per-character handwriting
 * possible — every glyph is its own inline-block with its own rotation, offset,
 * scale and ink density.
 *
 * Two things make it feel written rather than typeset:
 *
 *   Deterministic jitter  Each character's wobble is derived from a hash of its
 *                         index and the session seed, so it is stable. Re-render
 *                         the same text and the same letters wobble the same way;
 *                         nothing shimmers as you type.
 *
 *   Line-local drift      Neighbouring characters share a slow noise, so words
 *                         ride up and down together instead of each letter
 *                         jittering independently. Random per-letter noise looks
 *                         like a ransom note; correlated noise looks like a hand.
 *
 * Rendering is per-line and cached, so typing at the end of a long entry only
 * rebuilds the line being written.
 */

import { clamp01, clamp, lerp } from '../core/util.js';
import { HANDS, INSTRUMENTS, INKS, STOCKS } from './hands.js';

/** Cheap deterministic hash → 0..1. */
function hash01(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise from the hash, for correlated drift. */
function smoothHash(i, seed, scale) {
  const x = i / scale;
  const i0 = Math.floor(x);
  const f = x - i0;
  const t = f * f * (3 - 2 * f);
  return lerp(hash01(i0, seed), hash01(i0 + 1, seed), t) * 2 - 1;
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Paper {
  /**
   * @param {HTMLElement} el          the contenteditable
   * @param {object}      opts        callbacks
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;

    this.text = '';
    this.seed = (Math.random() * 100000) | 0;
    this.composing = false;
    this.enabled = true;

    // Style state
    this.hand = HANDS[0];
    this.instrument = INSTRUMENTS[2];
    this.ink = INKS[0];
    this.stock = STOCKS[0];
    this.styleVersion = 0;

    // How agitated the writing is right now — driven by the storm, so the hand
    // deteriorates as the session intensifies.
    this.agitation = 0;

    // Per-line render cache: parallel arrays of source line and its DOM node.
    this.lineCache = [];

    // Undo, because a controlled contenteditable loses the browser's own.
    this.undoStack = [];
    this.redoStack = [];
    this.lastUndoPush = 0;

    this.paragraphCount = 1;

    this.bind();
    this.applyStyle();
    this.render();
  }

  /* ──────────────────────────────────────────────────────── events ─────── */

  bind() {
    const el = this.el;

    el.addEventListener('compositionstart', () => { this.composing = true; });
    el.addEventListener('compositionend', () => {
      this.composing = false;
      this.sync();
    });

    el.addEventListener('input', () => {
      if (this.composing) return;
      this.sync();
    });

    el.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Paste as plain text — a pasted <b> has no place in handwriting.
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      this.insertAtCaret(t.replace(/\r\n?/g, '\n'));
    });

    el.addEventListener('drop', (e) => e.preventDefault());
  }

  onKeyDown(e) {
    if (!this.enabled) { e.preventDefault(); return; }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    // Enter is handled by hand so the paragraph model stays ours.
    if (e.key === 'Enter') {
      e.preventDefault();
      this.insertAtCaret('\n');
      return;
    }
    if (e.key === 'Tab') {
      // Let focus move on — trapping Tab in a text box is hostile.
      return;
    }
  }

  /** Pull the (possibly mangled) DOM back into the model and re-render. */
  sync() {
    const caret = this.getCaretOffset();
    const text = this.readDom();
    this.setText(text, caret, true);
  }

  /* ─────────────────────────────────────────────── text <-> DOM ────────── */

  /** Serialise the contenteditable to plain text with \n between blocks. */
  readDom() {
    const out = [];
    const walk = (node, top) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out.push(child.data);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (tag === 'BR') {
            out.push('\n');
          } else {
            const block = tag === 'DIV' || tag === 'P';
            // A block that isn't the first sibling starts a new line.
            if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
            walk(child, false);
            if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
          }
        }
      }
    };
    walk(this.el, true);
    let s = out.join('');
    // A trailing newline from the last block wrapper is an artefact, not content.
    s = s.replace(/\n$/, '');
    return s.replace(/ /g, ' ');
  }

  /** Absolute character offset of the caret, counting \n between lines. */
  getCaretOffset() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return this.text.length;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.endContainer)) return this.text.length;

    let offset = 0;
    let found = false;
    const walk = (node) => {
      if (found) return;
      for (const child of node.childNodes) {
        if (found) return;
        if (child === range.endContainer && child.nodeType === Node.TEXT_NODE) {
          offset += range.endOffset;
          found = true;
          return;
        }
        if (child.nodeType === Node.TEXT_NODE) {
          offset += child.data.length;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child === range.endContainer) {
            // Caret sits between this element's children.
            let n = 0;
            for (let i = 0; i < range.endOffset && i < child.childNodes.length; i++) {
              n += (child.childNodes[i].textContent || '').length;
            }
            offset += n;
            found = true;
            return;
          }
          if (child.tagName === 'BR') { offset += 1; continue; }
          const before = offset;
          walk(child);
          if (found) return;
          // If the walk didn't find it, the element contributed its text length.
          if (offset === before) offset += (child.textContent || '').length;
          if (child.classList && child.classList.contains('ln')) {
            // Lines are separated by a newline in the model.
            const isLast = child === node.lastElementChild;
            if (!isLast) offset += 1;
          }
        }
      }
    };
    walk(this.el);
    return found ? offset : this.text.length;
  }

  /** Put the caret at an absolute character offset. */
  setCaretOffset(target) {
    target = clamp(target, 0, this.text.length);
    const sel = window.getSelection();
    if (!sel) return;

    let remaining = target;
    const lines = this.el.querySelectorAll(':scope > .ln');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const len = this.lineLengths[li] ?? 0;
      if (remaining <= len) {
        // Find the text node inside this line at `remaining`.
        const range = document.createRange();
        let acc = 0;
        let placed = false;
        const tw = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) {
          const l = n.data.length;
          if (acc + l >= remaining) {
            range.setStart(n, remaining - acc);
            placed = true;
            break;
          }
          acc += l;
        }
        if (!placed) {
          // Empty line, or past the end: sit inside the line element.
          range.selectNodeContents(line);
          range.collapse(false);
        } else {
          range.collapse(true);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len + 1; // +1 for the newline
    }
    // Fell off the end.
    const range = document.createRange();
    range.selectNodeContents(this.el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  insertAtCaret(str) {
    const sel = window.getSelection();
    let start = this.getCaretOffset();
    let end = start;
    // Replace the selection, if there is one.
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
      const r = sel.getRangeAt(0);
      const a = this.offsetOfPoint(r.startContainer, r.startOffset);
      const b = this.offsetOfPoint(r.endContainer, r.endOffset);
      start = Math.min(a, b);
      end = Math.max(a, b);
    }
    const next = this.text.slice(0, start) + str + this.text.slice(end);
    this.setText(next, start + str.length);
  }

  /** Offset of an arbitrary DOM point, used for selection ranges. */
  offsetOfPoint(container, off) {
    const sel = window.getSelection();
    const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const r = document.createRange();
    try {
      r.setStart(container, off);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      const v = this.getCaretOffset();
      if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
      return v;
    } catch (_) {
      return this.text.length;
    }
  }

  /* ─────────────────────────────────────────────────────── model ───────── */

  /**
   * @param {string}  text
   * @param {number}  caret     where to leave the caret
   * @param {boolean} fromInput true when the browser already applied the edit
   */
  setText(text, caret = null, fromInput = false) {
    const prev = this.text;
    if (text === prev) {
      if (caret !== null && !fromInput) this.setCaretOffset(caret);
      return;
    }

    // Coalesce rapid typing into one undo entry.
    const now = performance.now();
    if (now - this.lastUndoPush > 700 || Math.abs(text.length - prev.length) > 1) {
      this.undoStack.push({ text: prev, caret: this.caret ?? prev.length });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.lastUndoPush = now;
      this.redoStack.length = 0;
    }

    this.text = text;
    this.caret = caret ?? text.length;
    this.render();
    // Only reclaim the caret if the page already had focus. When the edit came
    // from the plain-text box in the info sheet, moving the document selection
    // here would drag focus off the textarea mid-word.
    if (this.hasFocus()) {
      this.setCaretOffset(this.caret);
      this.scrollCaretIntoView();
    }

    // --- tell the storm what happened ---------------------------------
    const added = text.length - prev.length;
    if (added > 0 && this.opts.onKeystroke) {
      // A burst (paste) counts as many strokes but shouldn't fake a sprint.
      const strokes = Math.min(added, 4);
      for (let i = 0; i < strokes; i++) this.opts.onKeystroke(added === 1 ? 1 : 0.5, text.length);
    }
    if (this.opts.onChange) this.opts.onChange(text);

    // --- paragraphs ----------------------------------------------------
    const paras = text.length === 0 ? 1 : text.split('\n').filter((l, i, a) => l.length > 0 || i < a.length - 1).length;
    const n = Math.max(1, text.split('\n').length);
    if (n > this.paragraphCount) {
      const opened = n;
      this.paragraphCount = n;
      if (this.opts.onParagraph) this.opts.onParagraph(opened);
    } else if (n < this.paragraphCount) {
      this.paragraphCount = n;
    }

    this.updatePlaceholder();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ text: this.text, caret: this.caret });
    this.text = entry.text;
    this.caret = clamp(entry.caret, 0, entry.text.length);
    this.render();
    if (this.hasFocus()) this.setCaretOffset(this.caret);
    this.updatePlaceholder();
    if (this.opts.onChange) this.opts.onChange(this.text);
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ text: this.text, caret: this.caret });
    this.text = entry.text;
    this.caret = clamp(entry.caret, 0, entry.text.length);
    this.render();
    if (this.hasFocus()) this.setCaretOffset(this.caret);
    this.updatePlaceholder();
    if (this.opts.onChange) this.opts.onChange(this.text);
  }

  clear() {
    this.text = '';
    this.caret = 0;
    this.paragraphCount = 1;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lineCache.length = 0;
    this.seed = (Math.random() * 100000) | 0;
    this.render();
    this.updatePlaceholder();
    if (this.opts.onChange) this.opts.onChange('');
  }

  /** True when the contenteditable itself holds focus. */
  hasFocus() {
    return document.activeElement === this.el || this.el.contains(document.activeElement);
  }

  updatePlaceholder() {
    const ph = document.getElementById('placeholder');
    if (ph) ph.style.opacity = this.text.length === 0 ? '1' : '0';
  }

  scrollCaretIntoView() {
    const sheet = this.el.parentElement;
    if (!sheet) return;
    // The sheet is a fixed width and never scrolls sideways. Belt and braces:
    // the browser will still scroll a too-wide line into view even under
    // overflow-x: hidden, which shifts every other line off the page with it.
    if (this.el.scrollLeft !== 0) this.el.scrollLeft = 0;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const rects = r.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : this.el.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    if (rect.bottom > box.bottom - 8) {
      this.el.scrollTop += rect.bottom - box.bottom + 24;
    } else if (rect.top < box.top + 8) {
      this.el.scrollTop -= box.top - rect.top + 24;
    }
  }

  /* ─────────────────────────────────────────────────────── style ───────── */

  setHand(hand) { this.hand = hand; this.applyStyle(); this.invalidate(); }
  setInstrument(i) { this.instrument = i; this.applyStyle(); this.invalidate(); }
  setInk(ink) { this.ink = ink; this.applyStyle(); this.invalidate(); }
  setStock(s) { this.stock = s; this.applyStyle(); }

  /** How ragged the hand is right now, 0..1 — driven by storm intensity. */
  setAgitation(v) {
    const next = clamp01(v);
    // Re-rendering every frame would be wasteful; only when it moves enough
    // to actually change how the glyphs sit.
    if (Math.abs(next - this.agitation) > 0.08) {
      this.agitation = next;
      this.invalidate();
    } else {
      this.agitation = next;
    }
  }

  invalidate() {
    this.styleVersion++;
    this.lineCache.length = 0;
    this.render();
    if (this.hasFocus()) this.setCaretOffset(this.caret ?? this.text.length);
  }

  applyStyle() {
    const h = this.hand;
    const inst = this.instrument;
    const inkHex = inst.forcesInk || this.ink.hex;
    const s = this.el.style;
    s.setProperty('--hand-family', h.family);
    s.setProperty('--hand-size', h.size);
    s.setProperty('--hand-line', h.line);
    s.setProperty('--hand-slant', `${h.slant}deg`);
    s.setProperty('--hand-weight', h.weight);
    s.setProperty('--hand-tracking', `${h.tracking}em`);
    s.setProperty('--ink', inkHex);
    s.setProperty('--ink-bleed', String(inst.flow.bleed));
    s.setProperty('--stroke-weight', String(inst.weightMul));
    s.setProperty('--grain', String(inst.grain));
    // The per-glyph bleed shadow is only worth its cost on a wet nib.
    this.el.classList.toggle('wet', inst.flow.bleed > 0.25);
    document.documentElement.style.setProperty('--ink-current', inkHex);
  }

  /* ────────────────────────────────────────────────────── rendering ────── */

  /**
   * Per-character presentation for absolute index `i`.
   * Everything derives from the hash so it is stable across re-renders.
   */
  glyphStyle(i, lineIndex, colIndex, prevWasBreak) {
    const h = this.hand;
    const inst = this.instrument;
    const seed = this.seed;
    // Agitation makes the hand deteriorate as the storm rises.
    const ag = 1 + this.agitation * 0.85;

    const j = h.jitter * ag;

    // Correlated drift so words ride together, plus a per-letter tremor.
    const drift = smoothHash(colIndex, seed + lineIndex * 31, 5.5) * h.drift;
    const tremor = (hash01(i, seed) * 2 - 1);

    const dy = (drift * 0.055 + tremor * 0.020 * j).toFixed(4);
    const dx = ((hash01(i, seed + 7) * 2 - 1) * 0.012 * j).toFixed(4);
    const rot = (drift * 1.1 * j + tremor * 1.3 * j).toFixed(2);
    const scale = (1 + (hash01(i, seed + 13) * 2 - 1) * 0.035 * j).toFixed(3);

    // --- ink flow -------------------------------------------------------
    const f = inst.flow;
    let flow = f.base + smoothHash(i, seed + 41, 9) * f.variance;
    // A quill runs dry and is recharged every so often.
    if (inst.dips) {
      const period = 46 + Math.floor(hash01(Math.floor(i / 46), seed) * 34);
      const since = i % period;
      flow *= lerp(1.25, 0.45, since / period);
    }
    // Ink pools where a stroke starts after a lift.
    if (prevWasBreak) flow += f.pooling;
    flow = clamp(flow, 0.22, 1.35);

    return { dx, dy, rot, scale, flow };
  }

  /** Build the HTML for one line. */
  renderLine(line, startOffset, lineIndex) {
    if (line.length === 0) return '<span class="c-empty"><br></span>';

    const parts = [];
    let col = 0;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ') {
        parts.push('<span class="sp"> </span>');
        i++; col++;
        continue;
      }
      // Collect a word so it can't be broken mid-glyph by wrapping.
      let word = '';
      let start = i;
      while (i < line.length && line[i] !== ' ') { word += line[i]; i++; }

      const wordRot = ((hash01(startOffset + start, this.seed + 3) * 2 - 1)
        * 0.9 * this.hand.jitter * (1 + this.agitation * 0.6)).toFixed(2);

      // Words are wrapped in a `nowrap` span so a line break can never land
      // between two letters of the same word. That is right for words, and
      // catastrophic for a single unbroken string of a hundred characters:
      // nothing can break it, so it runs off the sheet and drags the rest of
      // the page sideways with it.
      //
      // So past a plausible word length, the run is emitted as several spans
      // instead of one. They share a rotation, so it still reads as one piece
      // of writing, but the browser can now break between the chunks.
      const CHUNK_AT = 18;
      const chunk = word.length > CHUNK_AT ? 3 : word.length;

      for (let c0 = 0; c0 < word.length; c0 += chunk) {
        parts.push(`<span class="w" style="--wr:${wordRot}deg">`);
        const end = Math.min(word.length, c0 + chunk);
        for (let k = c0; k < end; k++) {
          const abs = startOffset + start + k;
          const g = this.glyphStyle(abs, lineIndex, col + k, k === 0);
          parts.push(
            `<span class="c" style="--dx:${g.dx}em;--dy:${g.dy}em;--r:${g.rot}deg;` +
            `--s:${g.scale};--f:${g.flow.toFixed(3)}">${escapeHtml(word[k])}</span>`
          );
        }
        parts.push('</span>');
      }
      col += word.length;
    }
    return parts.join('');
  }

  /** Rebuild only the lines that actually changed. */
  render() {
    const lines = this.text.split('\n');
    this.lineLengths = lines.map((l) => l.length);

    const el = this.el;
    const existing = Array.from(el.children);

    // Offsets shift when a line's length changes, which changes downstream
    // jitter — so recompute offsets and compare against the cache.
    let offset = 0;
    const offsets = [];
    for (const l of lines) { offsets.push(offset); offset += l.length + 1; }

    for (let i = 0; i < lines.length; i++) {
      const cached = this.lineCache[i];
      const same = cached
        && cached.text === lines[i]
        && cached.offset === offsets[i]
        && cached.version === this.styleVersion;

      if (same && existing[i]) continue;

      const html = this.renderLine(lines[i], offsets[i], i);
      let node = existing[i];
      if (!node || !node.classList.contains('ln')) {
        node = document.createElement('div');
        node.className = 'ln';
        if (existing[i]) el.replaceChild(node, existing[i]);
        else el.appendChild(node);
      }
      node.innerHTML = html;
      this.lineCache[i] = { text: lines[i], offset: offsets[i], version: this.styleVersion };
    }

    // Drop any surplus lines.
    while (el.children.length > lines.length) el.removeChild(el.lastChild);
    this.lineCache.length = lines.length;
  }

  /* ───────────────────────────────────────────────────────── misc ──────── */

  focus() {
    this.el.focus();
    this.setCaretOffset(this.caret ?? this.text.length);
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.setAttribute('contenteditable', on ? 'true' : 'false');
  }

  get wordCount() {
    const t = this.text.trim();
    return t ? t.split(/\s+/).length : 0;
  }
}
