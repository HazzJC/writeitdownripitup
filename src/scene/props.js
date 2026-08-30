/**
 * Set dressing on the desk: book stacks and a jar of dried stems.
 *
 * Drawn on canvas rather than with CSS gradients so that every surface can be
 * shaded by its actual angle to the candle. When the flame gutters, the books
 * darken on the correct side, which is most of what sells a lit room.
 *
 * Nothing here is interactive — the objects you can pick up are real DOM
 * elements so they can be focused, hovered and read by a screen reader.
 */

import { clamp01, lerp, rand, TAU } from '../core/util.js';
import { makeRng } from '../core/noise.js';

export class PropsRenderer {
  constructor(canvas, lighting) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lighting = lighting;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.t = 0;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.build();
  }

  /** Lay the objects out relative to the viewport, then freeze their randomness. */
  build() {
    const w = this.w, h = this.h;
    const rng = makeRng(8712);
    const deskY = h * 0.44;
    const unit = Math.min(w * 0.055, h * 0.075);

    // --- left stack: books lying flat, as in the reference ---------------
    this.leftStack = [];
    let y = h * 0.72;
    const covers = ['#3a2415', '#4d2f18', '#2e1c10', '#5a3a1e', '#412714'];
    for (let i = 0; i < 5; i++) {
      const bw = unit * rand(2.5, 3.4);
      const bh = unit * rand(0.28, 0.46);
      this.leftStack.push({
        x: w * 0.085 + rng() * unit * 0.5 - unit * 0.25,
        y,
        w: bw, h: bh,
        rot: (rng() - 0.5) * 0.055,
        cover: covers[i % covers.length],
        pages: `hsl(${38 + rng() * 10}, ${22 + rng() * 14}%, ${62 + rng() * 12}%)`,
      });
      y -= bh * 0.96;
    }

    // --- right: books standing, leaning together ------------------------
    this.rightStack = [];
    let x = w * 0.885;
    for (let i = 0; i < 4; i++) {
      const bw = unit * rand(0.46, 0.9);
      const bh = unit * rand(1.4, 2.2);
      this.rightStack.push({
        x, y: h * 0.60, w: bw, h: bh,
        rot: (rng() - 0.5) * 0.13 + 0.03,
        cover: covers[(i + 2) % covers.length],
      });
      x += bw * 1.04;
    }

    // --- jar of dried stems ---------------------------------------------
    this.jar = {
      x: w * 0.055,
      y: h * 0.50,
      w: unit * 1.05,
      h: unit * 1.7,
      stems: Array.from({ length: 9 }, () => ({
        angle: -Math.PI / 2 + (rng() - 0.5) * 1.15,
        len: unit * (1.5 + rng() * 1.5),
        bend: (rng() - 0.5) * 0.7,
        heads: 2 + Math.floor(rng() * 4),
      })),
    };
    this.deskY = deskY;
  }

  /**
   * How lit a surface is, given where it sits and which way it faces.
   * `facing` is -1 for a left-facing plane, +1 for right-facing, 0 for a top.
   */
  shade(x, y, facing = 0) {
    const L = this.lighting;
    const dx = L.candle.x - x;
    const dy = L.candle.y - y;
    const dist = Math.hypot(dx, dy);
    // Inverse-square would be physically right but leaves the far side of the
    // room pitch black. A softer falloff plus a bounce term stands in for the
    // light the walls throw back.
    const falloff = 1 / (1 + Math.pow(dist / (this.w * 0.42), 1.8));
    // A face pointing at the flame catches much more of it.
    const toward = dist > 1 ? clamp01(((dx / dist) * facing + 1) * 0.5) : 0.5;
    const direct = falloff * lerp(0.42, 1.3, toward) * L.candle.value;
    const bounce = 0.07 * L.candle.value;
    return clamp01(0.035 + direct * 0.8 + bounce + L.ambient * 0.13 + L.flash * 0.5);
  }

  /**
   * The pool of candlelight on the desk. Drawn here, at the flame's actual
   * screen position, rather than as a fixed CSS gradient — otherwise it drifts
   * out of register with the candle at different viewport sizes, and the
   * flicker never reaches the wood.
   */
  drawLightPool(g) {
    const L = this.lighting;
    const x = L.candle.x;
    const y = L.candle.y;
    if (!isFinite(x) || !isFinite(y)) return;
    const lit = clamp01(L.candle.value);

    g.save();
    g.globalCompositeOperation = 'lighter';
    // Elliptical, and much wider than tall: the desk is a receding plane, so
    // the pool is foreshortened.
    g.translate(x, y + this.h * 0.05);
    g.scale(1, 0.42);
    const r = this.w * lerp(0.30, 0.40, lit);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, `rgba(255, 182, 96, ${0.34 * lit})`);
    gr.addColorStop(0.18, `rgba(255, 158, 70, ${0.20 * lit})`);
    gr.addColorStop(0.45, `rgba(226, 122, 44, ${0.075 * lit})`);
    gr.addColorStop(0.75, `rgba(170, 84, 30, ${0.022 * lit})`);
    gr.addColorStop(1, 'rgba(140, 70, 24, 0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.restore();

    // Cold spill from the window, falling on the near edge of the desk.
    if (L.flash > 0.01) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      // Starts at the top of the canvas and fades in, rather than at a fill
      // boundary. Beginning the gradient at full alpha part-way down the screen
      // draws a hard horizontal edge right across the room on every strike.
      const fg = g.createLinearGradient(0, 0, 0, this.h);
      fg.addColorStop(0, 'rgba(158, 186, 240, 0)');
      fg.addColorStop(0.30, `rgba(158, 186, 240, ${L.flash * 0.09})`);
      fg.addColorStop(0.48, `rgba(150, 178, 232, ${L.flash * 0.26})`);
      fg.addColorStop(0.78, `rgba(120, 148, 200, ${L.flash * 0.09})`);
      fg.addColorStop(1, 'rgba(90, 112, 160, 0)');
      g.fillStyle = fg;
      g.fillRect(0, 0, this.w, this.h);
      g.restore();
    }
  }

  /** Multiply a hex colour by a scalar and return an rgb() string. */
  tint(hex, k, warm = 1) {
    const n = parseInt(hex.slice(1), 16);
    let r = ((n >> 16) & 255) * k;
    let g = ((n >> 8) & 255) * k;
    let b = (n & 255) * k;
    // Candlelight is orange, so lit surfaces skew warm and shadows go blue.
    const L = this.lighting;
    const wm = lerp(0.65, 1.12, clamp01(L.warmMix) * warm);
    r *= wm; g *= lerp(0.9, 1.0, wm); b *= lerp(1.25, 0.78, wm);
    return `rgb(${Math.min(255, r) | 0}, ${Math.min(255, g) | 0}, ${Math.min(255, b) | 0})`;
  }

  update(dt) { this.t += dt; }

  draw() {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    this.drawLightPool(g);
    this.drawJar(g);
    this.drawLeftStack(g);
    this.drawRightStack(g);
  }

  // ------------------------------------------------------------- books
  drawLeftStack(g) {
    for (const b of this.leftStack) {
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.rot);

      // Contact shadow underneath.
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.beginPath();
      g.ellipse(0, b.h * 0.5, b.w * 0.54, b.h * 0.3, 0, 0, TAU);
      g.fill();

      const litTop = this.shade(b.x, b.y - b.h, 0);
      const litRight = this.shade(b.x + b.w / 2, b.y, 1);
      const litLeft = this.shade(b.x - b.w / 2, b.y, -1);

      // The block of pages: a warm cream face with fine striations.
      const pg = g.createLinearGradient(-b.w / 2, 0, b.w / 2, 0);
      pg.addColorStop(0, this.tint('#9c8a68', litLeft * 0.85));
      pg.addColorStop(0.5, this.tint('#b3a179', litTop));
      pg.addColorStop(1, this.tint('#8d7c5c', litRight * 0.9));
      g.fillStyle = pg;
      g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);

      // Page edges.
      g.globalAlpha = 0.22;
      g.strokeStyle = 'rgba(60,44,26,1)';
      g.lineWidth = 0.6;
      for (let i = 1; i < 7; i++) {
        const yy = -b.h / 2 + (b.h * i) / 7;
        g.beginPath();
        g.moveTo(-b.w / 2 + 1, yy);
        g.lineTo(b.w / 2 - 1, yy);
        g.stroke();
      }
      g.globalAlpha = 1;

      // The cover, overhanging top and bottom.
      const cv = g.createLinearGradient(-b.w / 2, 0, b.w / 2, 0);
      cv.addColorStop(0, this.tint(b.cover, litLeft * 0.7));
      cv.addColorStop(0.45, this.tint(b.cover, litTop * 1.15));
      cv.addColorStop(1, this.tint(b.cover, litRight * 0.75));
      g.fillStyle = cv;
      g.fillRect(-b.w / 2 - b.w * 0.012, -b.h / 2 - b.h * 0.16, b.w * 1.024, b.h * 0.20);
      g.fillRect(-b.w / 2 - b.w * 0.012, b.h / 2 - b.h * 0.04, b.w * 1.024, b.h * 0.20);

      // A gold rule on the top board, catching the flame.
      g.globalAlpha = clamp01(litTop * 1.4);
      g.strokeStyle = 'rgba(198, 158, 84, 0.55)';
      g.lineWidth = 0.8;
      g.strokeRect(-b.w / 2 + b.w * 0.05, -b.h / 2 - b.h * 0.12, b.w * 0.9, b.h * 0.12);
      g.globalAlpha = 1;
      g.restore();
    }
  }

  drawRightStack(g) {
    for (const b of this.rightStack) {
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.rot);

      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.ellipse(0, 0, b.w * 0.9, b.w * 0.4, 0, 0, TAU);
      g.fill();

      const litL = this.shade(b.x - b.w / 2, b.y - b.h / 2, -1);
      const litR = this.shade(b.x + b.w / 2, b.y - b.h / 2, 1);

      // Spine facing us.
      const sp = g.createLinearGradient(-b.w / 2, 0, b.w / 2, 0);
      sp.addColorStop(0, this.tint(b.cover, litL * 0.55));
      sp.addColorStop(0.35, this.tint(b.cover, (litL + litR) * 0.62));
      sp.addColorStop(1, this.tint(b.cover, litR * 0.75));
      g.fillStyle = sp;
      g.fillRect(-b.w / 2, -b.h, b.w, b.h);

      // Raised bands and a gilt title block.
      const lit = (litL + litR) * 0.5;
      g.globalAlpha = clamp01(lit * 1.5);
      g.fillStyle = 'rgba(190, 152, 80, 0.5)';
      for (const f of [0.22, 0.45, 0.72]) {
        g.fillRect(-b.w / 2, -b.h * f, b.w, Math.max(1, b.h * 0.014));
      }
      g.fillStyle = 'rgba(206, 170, 96, 0.35)';
      g.fillRect(-b.w * 0.3, -b.h * 0.62, b.w * 0.6, b.h * 0.1);
      g.globalAlpha = 1;

      // Top edge of the pages.
      g.fillStyle = this.tint('#9e8c68', this.shade(b.x, b.y - b.h, 0) * 0.9);
      g.fillRect(-b.w / 2, -b.h - b.w * 0.1, b.w, b.w * 0.1);
      g.restore();
    }
  }

  // --------------------------------------------------------------- jar
  drawJar(g) {
    const j = this.jar;
    const L = this.lighting;
    const lit = this.shade(j.x, j.y, -1);
    g.save();
    g.translate(j.x, j.y);

    // Stems first, so the glass sits in front of the lower halves.
    g.lineCap = 'round';
    for (const st of j.stems) {
      const x2 = Math.cos(st.angle) * st.len;
      const y2 = Math.sin(st.angle) * st.len - j.h * 0.3;
      g.strokeStyle = this.tint('#6e5836', clamp01(lit * 1.2 + 0.05));
      g.lineWidth = Math.max(0.8, j.w * 0.035);
      g.beginPath();
      g.moveTo(0, -j.h * 0.25);
      g.quadraticCurveTo(x2 * 0.4 + st.bend * j.w, (y2 - j.h * 0.25) * 0.55, x2, y2);
      g.stroke();
      // Seed heads.
      for (let i = 0; i < st.heads; i++) {
        const p = 0.55 + (i / st.heads) * 0.45;
        const hx = x2 * p + st.bend * j.w * 0.3;
        const hy = (y2 + j.h * 0.25) * p - j.h * 0.25;
        g.fillStyle = this.tint('#8a6f45', clamp01(lit * 1.3 + 0.05));
        g.beginPath();
        g.ellipse(hx, hy, j.w * 0.030, j.w * 0.070, st.angle, 0, TAU);
        g.fill();
      }
    }

    // The glass: mostly a rim light and a specular streak. Glass at night is
    // almost entirely edges.
    const body = g.createLinearGradient(-j.w / 2, 0, j.w / 2, 0);
    body.addColorStop(0, `rgba(150, 178, 210, ${0.05 + lit * 0.18})`);
    body.addColorStop(0.18, `rgba(206, 228, 250, ${0.10 + lit * 0.30})`);
    body.addColorStop(0.42, `rgba(120, 148, 182, ${0.03 + lit * 0.08})`);
    body.addColorStop(0.72, `rgba(190, 214, 242, ${0.08 + lit * 0.24})`);
    body.addColorStop(1, `rgba(130, 158, 192, ${0.05 + lit * 0.16})`);
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-j.w / 2, -j.h * 0.55);
    g.lineTo(-j.w / 2, j.h * 0.32);
    g.quadraticCurveTo(-j.w / 2, j.h * 0.5, -j.w * 0.3, j.h * 0.5);
    g.lineTo(j.w * 0.3, j.h * 0.5);
    g.quadraticCurveTo(j.w / 2, j.h * 0.5, j.w / 2, j.h * 0.32);
    g.lineTo(j.w / 2, -j.h * 0.55);
    g.closePath();
    g.fill();

    // Water line and the warm point where the candle refracts through.
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(j.w * 0.22, j.h * 0.28, 0, j.w * 0.22, j.h * 0.28, j.w * 0.6);
    glow.addColorStop(0, `rgba(255, 186, 108, ${lit * 0.5})`);
    glow.addColorStop(1, 'rgba(255, 150, 70, 0)');
    g.fillStyle = glow;
    g.fillRect(-j.w, -j.h, j.w * 2, j.h * 2);
    g.restore();
  }
}
