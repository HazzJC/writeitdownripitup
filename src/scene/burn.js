/**
 * Burning the page.
 *
 * The burn front is a scalar field over the sheet: for every cell, the moment
 * at which the fire reaches it. It is distance from the ignition point plus
 * fbm noise, so the edge advances raggedly the way paper actually goes.
 *
 * Three bands move outward together:
 *   ahead of the front   untouched paper
 *   at the front         a thin incandescent rim, brightest right on the edge
 *   behind the front     char, which darkens, curls, and then falls away
 *
 * Removing the paper itself is done with an animated radial mask on the sheet
 * rather than per-pixel alpha, because a canvas can't be used as a live CSS
 * mask. The char band is deliberately wider than the mask's feather, so the
 * smooth mask edge is always hidden underneath the ragged char.
 */

import { clamp01, lerp } from '../core/util.js';
import { makeNoise2D, fbm } from '../core/noise.js';

const CHAR_BAND = 0.26;    // how far behind the front char survives
const RIM = 0.035;         // width of the glowing edge
const DIST_W = 0.86;       // weight of the distance term in the field
const NOISE_MAX = 0.078;   // largest deviation the field's noise can produce
const DISSOLVE = 0.78;     // k at which char starts breaking up and falling
const BASE = 0.02;         // field offset, so nothing burns at t=0

export class BurnRenderer {
  constructor(canvas, sheetEl, opts = {}) {
    this.canvas = canvas;
    this.sheet = sheetEl;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;

    this.active = false;
    this.progress = 0;
    this.duration = 7.5;
    this.field = null;
    this.gw = 0; this.gh = 0;

    // The low-res buffer the field is rasterised into.
    this.buf = document.createElement('canvas');
    this.bufCtx = this.buf.getContext('2d');

    this.ignition = { x: 0.92, y: 0.9 };  // normalised, near the candle
    this.emberAcc = 0;
    this.ashAcc = 0;
  }

  /** Build the burn field for the current page size. */
  prepare(ignitionX = 0.92, ignitionY = 0.9) {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width));
    const h = Math.max(2, Math.round(rect.height));
    this.canvas.width = w;
    this.canvas.height = h;
    this.cw = w; this.ch = h;
    this.screenRect = rect;

    // A third of the display size is plenty — the front is organic, so the
    // upscale reads as softness rather than as blur.
    this.gw = Math.max(24, Math.round(w / 3));
    this.gh = Math.max(24, Math.round(h / 3));
    this.buf.width = this.gw;
    this.buf.height = this.gh;
    this.image = this.bufCtx.createImageData(this.gw, this.gh);

    this.ignition = { x: ignitionX, y: ignitionY };

    const n = makeNoise2D((Math.random() * 9999) | 0);
    const field = new Float32Array(this.gw * this.gh);
    const ix = ignitionX * this.gw;
    const iy = ignitionY * this.gh;
    const maxD = Math.hypot(
      Math.max(ix, this.gw - ix),
      Math.max(iy, this.gh - iy)
    );

    let i = 0;
    for (let y = 0; y < this.gh; y++) {
      for (let x = 0; x < this.gw; x++, i++) {
        const d = Math.hypot(x - ix, y - iy) / maxD;
        // Large-scale wander plus fine ragged detail. The amplitude is capped
        // at NOISE_MAX on purpose: the paper is removed by a *circular* CSS
        // mask, and a circle cannot track a wildly irregular front. Keeping the
        // noise inside this bound guarantees the mask edge always falls under
        // opaque char. The ragged look comes back in `draw`, where it costs
        // nothing because it never has to agree with the mask.
        const coarse = fbm(n, x / 22, y / 22, 3, 2.0, 0.55) * 0.056;
        const fine = fbm(n, x / 6.5, y / 6.5, 2, 2.0, 0.5) * 0.022;
        // Fire climbs: it runs upward faster than down.
        const rise = (iy - y) / this.gh * 0.10;
        field[i] = clamp01(d * DIST_W + coarse + fine - rise + BASE);
      }
    }
    this.field = field;

    // A stable per-cell random, so embers crawling in the char twinkle
    // independently. Deriving this from the linear index instead would alias
    // into horizontal bands, because the index increments along x.
    const spark = new Float32Array(this.gw * this.gh);
    for (let k = 0; k < spark.length; k++) spark[k] = Math.random();
    this.spark = spark;

    // The mask that actually removes the paper. Its centre matches ignition,
    // and its radius is expressed as a percentage of the distance to the
    // farthest corner — which is exactly what `maxD` measures, so the two
    // coordinate systems line up.
    this.sheet.style.setProperty('--burn-x', `${ignitionX * 100}%`);
    this.sheet.style.setProperty('--burn-y', `${ignitionY * 100}%`);
    this.setMask(0);
  }

  /**
   * The hole in the paper.
   *
   * It is placed at the field value where char begins to break up, pushed out
   * by NOISE_MAX so the circle is always at least as large as the true contour.
   * That way the mask edge can only ever fall somewhere the char is still
   * opaque — never on bare paper, and never ahead of the fire.
   */
  setMask(p) {
    const fieldAtHole = p - CHAR_BAND * DISSOLVE + NOISE_MAX;
    const rNorm = (fieldAtHole - BASE) / DIST_W;
    // Quantised to half-percent steps. Changing a mask forces the whole masked
    // subtree to be re-composited, and on a long entry that subtree is a
    // thousand-odd individually positioned glyphs. Half a percent of the page
    // diagonal is well under a pixel of movement in the burn front, so this
    // costs nothing visually and halves the number of times that happens.
    const hole = Math.max(0, Math.round(rNorm * 200) / 2);
    if (hole === this._lastHole) return;
    this._lastHole = hole;
    this.sheet.style.setProperty('--burn-hole', `${hole}%`);
    // Barely any feather: a wide gradient would show as translucent paper.
    this.sheet.style.setProperty('--burn-feather', `${hole + 1.5}%`);
  }

  start(ignitionX, ignitionY, duration = 7.5) {
    this._lastHole = undefined;
    this.prepare(ignitionX, ignitionY);
    this.duration = duration;
    this.progress = 0;
    this.active = true;
    this.sheet.classList.add('burning');
  }

  /** @returns {number} 0..1 how much of the page is alight right now */
  update(dt) {
    if (!this.active) return 0;
    this.progress += dt / this.duration;

    // The fire is at its fiercest mid-burn, when the most edge is exposed.
    const heat = Math.sin(clamp01(this.progress) * Math.PI) ** 0.6;

    if (this.progress >= 1 + CHAR_BAND) {
      this.active = false;
      this.progress = 1 + CHAR_BAND;
      if (this.opts.onDone) this.opts.onDone();
      return 0;
    }

    this.setMask(this.progress);
    this.emit(dt, heat);
    return heat;
  }

  /** Throw embers off the burning edge, and ash from what has already gone. */
  emit(dt, heat) {
    if (!this.opts.atmos) return;
    // Cached at prepare(): reading it per frame forces a layout flush.
    const rect = this.screenRect;
    if (!rect) return;

    this.emberAcc += dt * lerp(6, 48, heat);
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      const p = this.pointOnFront();
      if (p) {
        this.opts.atmos.emitEmber(
          rect.left + p.x * rect.width,
          rect.top + p.y * rect.height,
          1, 0.6 + heat * 0.7
        );
      }
    }

    this.ashAcc += dt * lerp(2, 16, heat);
    while (this.ashAcc >= 1) {
      this.ashAcc -= 1;
      const p = this.pointOnFront(true);
      if (p) {
        this.opts.atmos.emitAsh(
          rect.left + p.x * rect.width,
          rect.top + p.y * rect.height,
          1
        );
      }
    }
  }

  /** Find a random cell currently on (or just behind) the burning edge. */
  pointOnFront(behind = false) {
    if (!this.field) return null;
    const target = behind ? this.progress - CHAR_BAND * 0.6 : this.progress;
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = (Math.random() * this.field.length) | 0;
      if (Math.abs(this.field[i] - target) < 0.03) {
        return {
          x: (i % this.gw) / this.gw,
          y: Math.floor(i / this.gw) / this.gh,
        };
      }
    }
    return null;
  }

  draw() {
    if (!this.active || !this.field) return;
    const img = this.image;
    const data = img.data;
    const p = this.progress;
    const field = this.field;

    for (let i = 0, j = 0; i < field.length; i++, j += 4) {
      const d = p - field[i];

      if (d <= 0) {
        // Paper the fire hasn't reached. A scorch runs ahead of it, and this is
        // where the raggedness lives now — it sits on intact paper, so it can
        // be as irregular as it likes without the mask having to agree.
        const s = this.spark[i];
        const reach = 0.05 + s * 0.075;
        const pre = d > -reach ? (d + reach) / reach : 0;
        if (pre > 0) {
          data[j] = 92; data[j + 1] = 64; data[j + 2] = 34;
          data[j + 3] = pre * pre * (90 + s * 90);
        } else {
          data[j + 3] = 0;
        }
        continue;
      }

      if (d >= CHAR_BAND) {
        // Burnt through: the char has broken up and fallen.
        data[j + 3] = 0;
        continue;
      }

      const k = d / CHAR_BAND;         // 0 at the edge, 1 where it falls away

      const s = this.spark[i];
      // The rim wavers cell by cell, which is what makes the burning line look
      // ragged even though the underlying field is fairly smooth.
      const rim = RIM * (0.5 + s * 1.3);

      if (d < rim) {
        // The incandescent rim. White-hot right on the line, cooling back.
        const g = 1 - d / rim;
        data[j] = 255;
        data[j + 1] = 150 + g * 95;
        data[j + 2] = 40 + g * 150;
        data[j + 3] = 255;
      } else {
        // Char. Embers keep crawling in it just behind the rim, then it goes
        // cold: black and brittle.
        const glow = Math.max(0, 1 - (d - rim) / (0.05 + s * 0.06));
        // Each cell pulses at its own rate and phase.
        const twinkle = 0.5 + 0.5 * Math.sin(p * (18 + s * 44) + s * 6.283);
        const crawl = glow * glow * twinkle * (0.35 + s * 0.65);
        const base = 15 + (1 - k) * 9;
        data[j] = base + crawl * 210;
        data[j + 1] = base * 0.66 + crawl * 74;
        data[j + 2] = base * 0.55 + crawl * 18;

        // Char stays fully opaque until it starts to crumble, then breaks up
        // cell by cell rather than fading — burnt paper falls away in flakes,
        // it does not become translucent. Staying opaque up to DISSOLVE is also
        // what lets the mask hide underneath it.
        if (k < DISSOLVE) {
          data[j + 3] = 255;
        } else {
          const t = (k - DISSOLVE) / (1 - DISSOLVE);
          data[j + 3] = s > t ? 255 : 0;
        }
      }
    }

    this.bufCtx.putImageData(img, 0, 0);

    const g = this.ctx;
    g.clearRect(0, 0, this.cw, this.ch);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.buf, 0, 0, this.cw, this.ch);

    // Bloom over the burning edge, so it throws light rather than just glowing.
    // A blur filter across the full-size canvas is by far the most expensive
    // operation in the burn; drawing the small buffer up through an even
    // smaller intermediate gives the same softness for nothing.
    if (!this.bloom) {
      this.bloom = document.createElement('canvas');
      this.bloomCtx = this.bloom.getContext('2d');
    }
    const bw = Math.max(8, this.gw >> 1);
    const bh = Math.max(8, this.gh >> 1);
    if (this.bloom.width !== bw || this.bloom.height !== bh) {
      this.bloom.width = bw; this.bloom.height = bh;
    }
    this.bloomCtx.clearRect(0, 0, bw, bh);
    this.bloomCtx.imageSmoothingEnabled = true;
    this.bloomCtx.drawImage(this.buf, 0, 0, bw, bh);

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5;
    g.drawImage(this.bloom, 0, 0, this.cw, this.ch);
    g.restore();
  }

  reset() {
    this.active = false;
    this.progress = 0;
    this.field = null;
    this.sheet.classList.remove('burning');
    this._lastHole = undefined;
    this.sheet.style.removeProperty('--burn-hole');
    this.sheet.style.removeProperty('--burn-feather');
    if (this.ctx && this.cw) this.ctx.clearRect(0, 0, this.cw, this.ch);
  }
}
