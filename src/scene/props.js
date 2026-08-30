/**
 * Set dressing on the desk: a jar of dried stems, a cup someone has been
 * drinking from, and the unopened post.
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

    // The pile on the left is no longer painted here. It is the paper stock
    // selector now — a real stack of notebooks and pads you take a sheet from,
    // built as DOM in src/ui/desk.js so it can be focused and labelled. Two
    // stacks of books occupying the same corner is what made the old selector
    // look like it was floating on top of the furniture.

    // --- right: a cup someone has been drinking from, and the post ------
    // Books here were four dark slabs with hard elliptical shadows that served
    // no purpose. A cup gone cold and a bundle of unopened post say far more
    // about somebody living at this desk, and both are shapes that can carry
    // real shading — a glazed rim, a shadow inside the cup, paper edges.
    this.cup = {
      x: w * 0.855,
      y: h * 0.525,
      r: unit * 0.5,
      turn: rng() * 0.5 - 0.25,
    };

    this.letters = [];
    for (let i = 0; i < 4; i++) {
      this.letters.push({
        x: w * 0.735 + rng() * unit * 0.1,
        y: h * 0.585 - i * unit * 0.05,
        w: unit * (1.32 + rng() * 0.2),
        h: unit * 0.74,
        rot: (rng() - 0.5) * 0.22,
        tone: ['#d8cbaa', '#cfc4a6', '#ded2b4', '#c9bc9c'][i % 4],
        stamped: i === 3,
      });
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
    this.drawLetters(g);
    this.drawCup(g);
  }

  /**
   * A soft contact shadow.
   *
   * The old props each had one flat 55%-black ellipse under them, which is what
   * made them look pasted on. A real shadow has two parts: a small, dark, tight
   * core where the object actually meets the wood, and a much wider, fainter
   * penumbra around it — and both are cast *away* from the light rather than
   * sitting centred underneath.
   */
  softShadow(g, x, y, rx, ry, strength = 1) {
    const L = this.lighting;
    const dx = x - L.candle.x;
    const dy = y - L.candle.y;
    const d = Math.hypot(dx, dy) || 1;
    // Longer, fainter shadows further from the flame.
    const throwBy = Math.min(rx * 1.5, d * 0.055);
    const ox = (dx / d) * throwBy;
    const oy = (dy / d) * throwBy * 0.4;
    const lit = clamp01(L.candle.value);

    g.save();
    // Penumbra.
    let gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rx * 2.1);
    gr.addColorStop(0, `rgba(0,0,0,${0.46 * strength * lit})`);
    gr.addColorStop(0.45, `rgba(0,0,0,${0.24 * strength * lit})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.save();
    g.translate(x + ox, y + oy);
    g.scale(1, (ry * 2.1) / (rx * 2.1));
    g.beginPath(); g.arc(0, 0, rx * 2.1, 0, TAU); g.fill();
    g.restore();

    // Contact core — small, tight, and much darker.
    gr = g.createRadialGradient(x, y, 0, x, y, rx * 0.9);
    gr.addColorStop(0, `rgba(0,0,0,${0.78 * strength})`);
    gr.addColorStop(0.6, `rgba(0,0,0,${0.36 * strength})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.beginPath(); g.arc(0, 0, rx * 0.9, 0, TAU); g.fill();
    g.restore();
    g.restore();
  }

  // ------------------------------------------------------------ the cup
  drawCup(g) {
    const c = this.cup;
    if (!c) return;
    const r = c.r;
    const litFront = this.shade(c.x, c.y, -1);
    const litSide = this.shade(c.x + r, c.y, 1);
    const lit = clamp01(this.lighting.candle.value);

    this.softShadow(g, c.x, c.y + r * 0.34, r * 1.5, r * 0.42, 1);

    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.turn * 0.1);

    // Saucer.
    const sr = r * 1.62;
    const sa = g.createLinearGradient(-sr, 0, sr, 0);
    sa.addColorStop(0, this.tint('#d8cdb6', litFront * 0.68));
    sa.addColorStop(0.45, this.tint('#f4ecd8', litSide * 1.02));
    sa.addColorStop(1, this.tint('#c4b79c', litSide * 0.76));
    g.fillStyle = sa;
    g.beginPath(); g.ellipse(0, r * 0.3, sr, sr * 0.34, 0, 0, TAU); g.fill();
    // The well of the saucer.
    g.fillStyle = this.tint('#b3a68c', litFront * 0.7);
    g.beginPath(); g.ellipse(0, r * 0.28, sr * 0.62, sr * 0.2, 0, 0, TAU); g.fill();

    // The handle, behind the cup body so the join is hidden.
    g.strokeStyle = this.tint('#ece2cc', litSide * 0.92);
    g.lineWidth = Math.max(2, r * 0.15);
    g.beginPath();
    g.arc(r * 0.92, -r * 0.16, r * 0.42, -1.25, 1.25);
    g.stroke();

    // Body: a slight taper, brightest where it turns toward the flame.
    const body = g.createLinearGradient(-r, 0, r, 0);
    body.addColorStop(0, this.tint('#cdc0a6', litFront * 0.56));
    body.addColorStop(0.3, this.tint('#f6efdc', litFront * 1.0));
    body.addColorStop(0.62, this.tint('#fbf5e4', litSide * 1.08));
    body.addColorStop(1, this.tint('#bbae94', litSide * 0.68));
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-r * 0.86, -r * 0.62);
    g.lineTo(-r * 0.7, r * 0.24);
    g.quadraticCurveTo(0, r * 0.5, r * 0.7, r * 0.24);
    g.lineTo(r * 0.86, -r * 0.62);
    g.closePath();
    g.fill();

    // The rim, and the shadowed inside of the cup.
    g.fillStyle = this.tint('#fdf7e6', litSide * 1.1);
    g.beginPath(); g.ellipse(0, -r * 0.62, r * 0.86, r * 0.26, 0, 0, TAU); g.fill();
    g.fillStyle = this.tint('#4a4034', litFront * 0.7);
    g.beginPath(); g.ellipse(0, -r * 0.6, r * 0.75, r * 0.2, 0, 0, TAU); g.fill();
    // What is left of the tea, gone cold.
    g.fillStyle = this.tint('#6b4a28', litFront * 0.85);
    g.beginPath(); g.ellipse(0, -r * 0.5, r * 0.6, r * 0.15, 0, 0, TAU); g.fill();
    // The flame catching the surface of it.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const tea = g.createRadialGradient(r * 0.22, -r * 0.52, 0, r * 0.22, -r * 0.52, r * 0.5);
    tea.addColorStop(0, `rgba(255, 178, 92, ${0.5 * lit})`);
    tea.addColorStop(1, 'rgba(255, 140, 60, 0)');
    g.fillStyle = tea;
    g.beginPath(); g.ellipse(0, -r * 0.5, r * 0.6, r * 0.15, 0, 0, TAU); g.fill();
    g.restore();

    // Glaze: a vertical specular streak down the side facing the candle.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createLinearGradient(r * 0.1, 0, r * 0.8, 0);
    gl.addColorStop(0, 'rgba(255, 236, 208, 0)');
    gl.addColorStop(0.5, `rgba(255, 240, 214, ${0.30 * lit})`);
    gl.addColorStop(1, 'rgba(255, 236, 208, 0)');
    g.fillStyle = gl;
    g.fillRect(r * 0.1, -r * 0.55, r * 0.7, r * 0.9);
    g.restore();

    g.restore();
  }

  // -------------------------------------------------------- the letters
  drawLetters(g) {
    if (!this.letters) return;
    for (const l of this.letters) {
      const lit = this.shade(l.x, l.y, 0);
      const litL = this.shade(l.x - l.w / 2, l.y, -1);

      this.softShadow(g, l.x, l.y + l.h * 0.34, l.w * 0.5, l.h * 0.22, 0.7);

      g.save();
      g.translate(l.x, l.y);
      g.rotate(l.rot);

      const face = g.createLinearGradient(-l.w / 2, 0, l.w / 2, 0);
      face.addColorStop(0, this.tint(l.tone, litL * 0.72));
      face.addColorStop(0.5, this.tint(l.tone, lit * 1.0));
      face.addColorStop(1, this.tint(l.tone, lit * 0.82));
      g.fillStyle = face;
      g.beginPath();
      g.moveTo(-l.w / 2, -l.h / 2);
      g.lineTo(l.w / 2, -l.h / 2 + l.h * 0.03);
      g.lineTo(l.w / 2, l.h / 2);
      g.lineTo(-l.w / 2, l.h / 2 - l.h * 0.02);
      g.closePath();
      g.fill();

      // The flap, and a darker line where it meets the body.
      g.strokeStyle = this.tint(l.tone, lit * 0.55);
      g.lineWidth = Math.max(0.8, l.h * 0.02);
      g.beginPath();
      g.moveTo(-l.w / 2, -l.h / 2);
      g.lineTo(0, l.h * 0.08);
      g.lineTo(l.w / 2, -l.h / 2 + l.h * 0.03);
      g.stroke();

      // One of them has been franked.
      if (l.stamped) {
        g.fillStyle = this.tint('#8a4a3c', lit * 1.1);
        g.fillRect(l.w * 0.24, -l.h * 0.34, l.w * 0.15, l.h * 0.3);
        g.globalAlpha = 0.5;
        g.strokeStyle = this.tint('#3a2c20', lit);
        g.lineWidth = Math.max(0.7, l.h * 0.018);
        g.beginPath();
        g.arc(l.w * 0.315, -l.h * 0.19, l.h * 0.19, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
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
