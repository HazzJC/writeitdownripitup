/**
 * The candle: brass holder, wax column, and a soft-body flame.
 *
 * The flame is a spine of point masses. Each one is pulled back toward the
 * wick axis by a spring, dragged sideways by wind, and displaced more the
 * higher up it sits - so a draught whips the tip while the base stays anchored
 * on the wick. That is what makes it read as fire rather than as an animated
 * gradient.
 *
 * It is also the ignition source: `flameTipScreen()` gives the page-burning
 * code somewhere real to catch light from.
 */

import { clamp01, lerp, rand, TAU } from '../core/util.js';
import { makeNoise1D } from '../core/noise.js';

const SPINE = 14;

export class CandleRenderer {
  constructor(canvas, lighting) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lighting = lighting;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.t = 0;

    this.lit = true;
    this.extinguishing = 0;
    this.intensity = 0;

    // Flame spine: index 0 is the wick, the last index is the tip.
    this.spine = [];
    for (let i = 0; i < SPINE; i++) {
      this.spine.push({ x: 0, vx: 0, k: i / (SPINE - 1) });
    }
    this.nWind = makeNoise1D(53);
    this.nWind2 = makeNoise1D(97);

    // Wax melts a little over the session.
    this.melt = 0;
    this.drips = [];

    // Embers rising from the flame.
    this.sparks = [];
    this.sparkTimer = 0;

    this.hover = 0;      // 0..1, pointer proximity
    this.resize();
  }

  resize() {
    this._rect = null;
    const rect = this.canvas.getBoundingClientRect();
    this._rect = rect;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layout();
  }

  layout() {
    const w = this.w, h = this.h;
    // The canvas is deliberately much larger than the candle so the flame's
    // halo has room to fall off before it reaches the edge.
    this.cx = w * 0.5;
    this.baseY = h * 0.90;                       // bottom of the holder
    this.candleW = Math.min(w * 0.19, h * 0.115);
    this.candleH = h * 0.30;
    this.waxTop = this.baseY - h * 0.11 - this.candleH;
    this.wickH = Math.max(5, h * 0.017);
    this.wickY = this.waxTop - this.wickH;
    this.flameH = h * 0.145;
  }

  /**
   * The canvas rect, cached.
   *
   * `getBoundingClientRect` forces a synchronous style-and-layout flush, and
   * the lighting engine rewrites custom properties on :root every frame — so
   * calling this per frame makes the browser re-resolve styles for the entire
   * document, every glyph on the page included, before it can answer. On a long
   * entry that alone tripled frame cost. The rect only moves on resize.
   */
  rect() {
    if (!this._rect) this._rect = this.canvas.getBoundingClientRect();
    return this._rect;
  }

  /** Screen-space position of the flame tip, for the burn to ignite from. */
  flameTipScreen() {
    const rect = this.rect();
    const sx = rect.width / this.w, sy = rect.height / this.h;
    const tip = this.spine[SPINE - 1];
    return {
      x: rect.left + (this.cx + (tip ? tip.x : 0)) * sx,
      y: rect.top + (this.wickY - this.flameH * 0.75) * sy,
    };
  }

  /** Where the flame base is, in screen px. */
  flameBaseScreen() {
    const rect = this.rect();
    const sx = rect.width / this.w, sy = rect.height / this.h;
    return { x: rect.left + this.cx * sx, y: rect.top + this.wickY * sy };
  }

  setHover(v) { this.hover = clamp01(v); }

  blowOut() {
    if (!this.lit) return;
    this.lit = false;
    this.extinguishing = 1;
    this.lighting.setCandleLit(false);
  }

  relight() {
    this.lit = true;
    this.extinguishing = 0;
    this.lighting.setCandleLit(true);
  }

  update(dt, intensity) {
    this.t += dt;
    this.intensity = clamp01(intensity);
    const L = this.lighting;

    if (this.extinguishing > 0) this.extinguishing = Math.max(0, this.extinguishing - dt / 1.4);

    // --- wind acting on the flame -------------------------------------
    // Two noise fields at different rates, plus the gust impulse from the
    // lighting engine, plus a nudge from a hovering pointer.
    const stormWind = lerp(0.25, 1.6, this.intensity);
    const w1 = this.nWind(this.t * 2.6) * stormWind;
    const w2 = this.nWind2(this.t * 6.1) * stormWind * 0.45;
    const gust = L.candle.gust * rand(0.7, 1.3);
    const wind = (w1 + w2) * 26 + gust * 90 * Math.sign(this.nWind(this.t * 1.1) || 1)
      + this.hover * 34 * Math.sin(this.t * 8);

    for (let i = 0; i < SPINE; i++) {
      const p = this.spine[i];
      // Higher points are far more susceptible; the base is pinned to the wick.
      const susceptibility = Math.pow(p.k, 1.9);
      const force = wind * susceptibility;
      // Spring back toward the axis, softer near the tip.
      const spring = -p.x * lerp(90, 26, p.k);
      const damping = -p.vx * lerp(9, 4.5, p.k);
      p.vx += (force + spring + damping) * dt;
      p.x += p.vx * dt;
      // Hard limit so a violent gust can't fling the flame off the wick.
      const lim = this.flameH * 0.55 * p.k;
      if (p.x > lim) { p.x = lim; p.vx *= -0.3; }
      if (p.x < -lim) { p.x = -lim; p.vx *= -0.3; }
    }

    // --- wax and drips -------------------------------------------------
    this.melt = Math.min(1, this.melt + dt * 0.0016);
    if (Math.random() < dt * 0.09 && this.drips.length < 5) {
      this.drips.push({
        side: Math.random() < 0.5 ? -1 : 1,
        x: rand(0.25, 0.85),
        y: 0,
        len: rand(0.1, 0.36),
        speed: rand(0.004, 0.014),
        w: rand(0.05, 0.11),
      });
    }
    for (const d of this.drips) {
      if (d.y < d.len) d.y = Math.min(d.len, d.y + d.speed * dt * 60 * 0.02);
    }

    // --- sparks --------------------------------------------------------
    this.sparkTimer -= dt;
    const flameAgitation = clamp01(Math.abs(this.spine[SPINE - 1].vx) / 120 + L.candle.gust);
    if (this.sparkTimer <= 0 && this.lit) {
      this.sparkTimer = lerp(0.6, 0.06, flameAgitation);
      const tip = this.spine[SPINE - 1];
      this.sparks.push({
        x: this.cx + tip.x + rand(-3, 3),
        y: this.wickY - this.flameH * rand(0.6, 0.95),
        vx: rand(-14, 14) + tip.vx * 0.25,
        vy: rand(-46, -18),
        life: 1, decay: rand(0.5, 1.3), size: rand(0.6, 1.9),
      });
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life -= dt * sp.decay;
      if (sp.life <= 0) { this.sparks.splice(i, 1); continue; }
      sp.vy += -22 * dt;           // hot air keeps lifting it
      sp.vx += rand(-24, 24) * dt; // turbulence
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
    }

    // Report our position so the lighting engine can place the glow.
    const base = this.flameBaseScreen();
    L.setCandlePosition(base.x, base.y);
  }

  draw() {
    const g = this.ctx;
    const w = this.w, h = this.h;
    if (w < 2 || h < 2) return;
    const L = this.lighting;
    g.clearRect(0, 0, w, h);

    const flameLevel = this.lit ? L.candle.flicker : this.extinguishing;

    this.drawGlow(g, flameLevel);
    this.drawHolder(g);
    this.drawWax(g, flameLevel);
    if (this.lit || this.extinguishing > 0) {
      this.drawFlame(g, flameLevel);
      this.drawSparks(g);
    } else {
      this.drawSmoke(g);
    }
  }

  // ------------------------------------------------------------------ glow
  drawGlow(g, level) {
    const x = this.cx, y = this.wickY - this.flameH * 0.4;
    // Clamp the halo so it always finishes inside the canvas — a gradient cut
    // off by the bitmap edge shows up as a hard rectangle over the scene.
    // The room-scale glow is CSS's job (#lightwash); this is only the local
    // bloom around the flame itself.
    const fit = Math.min(x, this.w - x, y, this.h - y);
    const r = Math.min(this.flameH * lerp(3.2, 4.6, clamp01(level)), Math.max(1, fit));
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = clamp01(level) * 0.5;
    gr.addColorStop(0, `rgba(255, 196, 108, ${a * 0.55})`);
    gr.addColorStop(0.22, `rgba(255, 150, 58, ${a * 0.26})`);
    gr.addColorStop(0.55, `rgba(210, 104, 30, ${a * 0.09})`);
    gr.addColorStop(1, 'rgba(150, 70, 20, 0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }

  // ---------------------------------------------------------------- holder
  drawHolder(g) {
    const L = this.lighting;
    const cx = this.cx;
    const y = this.baseY;
    const w = this.candleW;
    const lit = clamp01(0.25 + L.candle.value * 0.75);

    // Brass dish.
    const dishW = w * 2.05;
    const dishH = this.h * 0.045;
    const dishY = y - dishH * 0.5;

    g.save();
    // The underside shadow grounds it on the desk.
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.ellipse(cx, y + dishH * 0.35, dishW * 0.62, dishH * 0.5, 0, 0, TAU);
    g.fill();

    const brass = (a, b, c) => {
      const gr = g.createLinearGradient(cx - dishW / 2, 0, cx + dishW / 2, 0);
      gr.addColorStop(0, a); gr.addColorStop(0.28, b);
      gr.addColorStop(0.52, c); gr.addColorStop(0.78, b); gr.addColorStop(1, a);
      return gr;
    };
    const L1 = (v) => `rgb(${(v * 148) | 0}, ${(v * 112) | 0}, ${(v * 48) | 0})`;
    g.fillStyle = brass(L1(lit * 0.45), L1(lit * 1.25), L1(lit * 0.7));
    g.beginPath();
    g.ellipse(cx, dishY, dishW / 2, dishH * 0.62, 0, 0, TAU);
    g.fill();

    // Inner well.
    g.fillStyle = brass(L1(lit * 0.3), L1(lit * 0.85), L1(lit * 0.5));
    g.beginPath();
    g.ellipse(cx, dishY - dishH * 0.12, dishW * 0.31, dishH * 0.34, 0, 0, TAU);
    g.fill();

    // Handle loop on the right, as in the reference.
    g.strokeStyle = brass(L1(lit * 0.4), L1(lit * 1.15), L1(lit * 0.6));
    g.lineWidth = Math.max(2, this.h * 0.011);
    g.beginPath();
    g.arc(cx + dishW * 0.56, dishY - dishH * 0.1, dishW * 0.16, -1.1, 2.4);
    g.stroke();

    // A specular streak that tracks the flame.
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = clamp01(L.candle.value) * 0.5;
    const spec = g.createLinearGradient(cx - dishW * 0.2, 0, cx + dishW * 0.2, 0);
    spec.addColorStop(0, 'rgba(255,214,150,0)');
    spec.addColorStop(0.5, 'rgba(255,232,190,0.75)');
    spec.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = spec;
    g.beginPath();
    g.ellipse(cx, dishY - dishH * 0.2, dishW * 0.42, dishH * 0.16, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  // ------------------------------------------------------------------- wax
  drawWax(g, level) {
    const L = this.lighting;
    const cx = this.cx;
    const w = this.candleW;
    const top = this.waxTop + this.melt * this.candleH * 0.1;
    const bot = this.baseY - this.h * 0.02;
    const hgt = bot - top;
    const lit = clamp01(0.18 + L.candle.value * 0.9);

    g.save();

    // Body. Wax is translucent: it is brightest just under the flame and the
    // glow bleeds several centimetres down the column.
    const body = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    const shade = (v) => `rgb(${(v * 252) | 0}, ${(v * 236) | 0}, ${(v * 198) | 0})`;
    body.addColorStop(0, shade(lit * 0.30));
    body.addColorStop(0.22, shade(lit * 0.72));
    body.addColorStop(0.45, shade(lit * 0.95));
    body.addColorStop(0.72, shade(lit * 0.62));
    body.addColorStop(1, shade(lit * 0.26));
    g.fillStyle = body;
    // The wax outline, kept as a path so the subsurface glow can be clipped to
    // it. Filling that glow as a plain rectangle draws a visible warm box
    // hanging above the candle, which is not what wax does.
    const waxPath = () => {
      g.beginPath();
      g.moveTo(cx - w / 2, bot);
      g.lineTo(cx - w / 2, top + hgt * 0.02);
      g.quadraticCurveTo(cx, top - hgt * 0.03, cx + w / 2, top + hgt * 0.02);
      g.lineTo(cx + w / 2, bot);
      g.closePath();
    };
    waxPath();
    g.fill();

    // Subsurface scattering from the flame down into the wax. Clipped to the
    // wax, and starting from transparent so there is no edge at the top.
    g.save();
    waxPath();
    g.clip();
    g.globalCompositeOperation = 'lighter';
    const sss = g.createLinearGradient(0, top - hgt * 0.05, 0, top + hgt * 0.5);
    const a = clamp01(level) * 0.55;
    sss.addColorStop(0, `rgba(255, 176, 92, ${a})`);
    sss.addColorStop(0.35, `rgba(255, 142, 60, ${a * 0.35})`);
    sss.addColorStop(1, 'rgba(255, 120, 40, 0)');
    g.fillStyle = sss;
    g.fillRect(cx - w, top - hgt * 0.1, w * 2, hgt * 0.7);
    g.restore();
    g.globalCompositeOperation = 'source-over';

    // Melted rim and pool at the top.
    const rimY = top + hgt * 0.012;
    g.fillStyle = shade(lit * 1.05);
    g.beginPath();
    g.ellipse(cx, rimY, w / 2, w * 0.13, 0, 0, TAU);
    g.fill();
    g.fillStyle = `rgba(${(lit * 214) | 0}, ${(lit * 186) | 0}, ${(lit * 140) | 0}, 1)`;
    g.beginPath();
    g.ellipse(cx, rimY + w * 0.02, w * 0.36, w * 0.085, 0, 0, TAU);
    g.fill();

    // Drips down the side.
    for (const d of this.drips) {
      const dx = cx + (d.side * w * 0.5);
      const dy = rimY + hgt * 0.02;
      const dw = w * d.w;
      g.fillStyle = shade(lit * (d.side < 0 ? 0.5 : 0.72));
      g.beginPath();
      g.moveTo(dx - dw * 0.5, dy);
      g.lineTo(dx + dw * 0.5, dy);
      g.lineTo(dx + dw * 0.35, dy + hgt * d.y);
      g.quadraticCurveTo(dx, dy + hgt * d.y + dw * 0.7, dx - dw * 0.35, dy + hgt * d.y);
      g.closePath();
      g.fill();
    }

    // Wick.
    const tipX = this.spine[0] ? this.spine[0].x : 0;
    g.strokeStyle = `rgba(${(28 + lit * 30) | 0}, ${(22 + lit * 22) | 0}, ${(18 + lit * 16) | 0}, 1)`;
    g.lineWidth = Math.max(1.4, this.h * 0.005);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, rimY - w * 0.02);
    g.quadraticCurveTo(cx + tipX * 0.3, this.wickY + this.wickH * 0.4, cx + tipX * 0.6, this.wickY);
    g.stroke();
    // The ember at the wick tip.
    if (level > 0.02) {
      g.globalCompositeOperation = 'lighter';
      const eg = g.createRadialGradient(cx + tipX * 0.6, this.wickY, 0, cx + tipX * 0.6, this.wickY, w * 0.16);
      eg.addColorStop(0, `rgba(255, 220, 160, ${clamp01(level)})`);
      eg.addColorStop(1, 'rgba(255, 120, 40, 0)');
      g.fillStyle = eg;
      g.beginPath();
      g.arc(cx + tipX * 0.6, this.wickY, w * 0.16, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  // ----------------------------------------------------------------- flame
  /** Build the outline from the spine, with a teardrop width profile. */
  flameOutline(scale = 1, widthMul = 1) {
    const left = [], right = [];
    const baseW = this.candleW * 0.30 * widthMul;
    for (let i = 0; i < SPINE; i++) {
      const p = this.spine[i];
      const k = p.k;
      const y = this.wickY - this.flameH * k * scale;
      // Widest at ~30% height, tapering to a point.
      const profile = Math.sin(Math.pow(k, 0.62) * Math.PI) * (1 - k * 0.22);
      const halfW = baseW * profile + baseW * 0.12 * (1 - k);
      left.push({ x: this.cx + p.x - halfW, y });
      right.push({ x: this.cx + p.x + halfW, y });
    }
    return { left, right };
  }

  strokeFlamePath(g, outline) {
    const { left, right } = outline;
    g.beginPath();
    g.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) {
      const prev = left[i - 1], cur = left[i];
      g.quadraticCurveTo(prev.x, (prev.y + cur.y) / 2, cur.x, cur.y);
    }
    for (let i = right.length - 1; i >= 0; i--) {
      const cur = right[i];
      const prev = right[Math.min(right.length - 1, i + 1)];
      g.quadraticCurveTo(prev.x, (prev.y + cur.y) / 2, cur.x, cur.y);
    }
    g.closePath();
  }

  drawFlame(g, level) {
    const lv = clamp01(level);
    g.save();
    g.globalCompositeOperation = 'lighter';

    // Outer envelope: the dim orange halo of burning gas. Filled with a
    // gradient that fades out before it reaches the path, not a flat colour —
    // a solid fill through a flame-shaped path draws a hard tan outline around
    // the flame, which is the one thing burning gas does not have.
    g.globalAlpha = lv * 0.55;
    const hx = this.cx + (this.spine[3] ? this.spine[3].x : 0);
    const hy = this.wickY - this.flameH * 0.42;
    const halo = g.createRadialGradient(hx, hy, 0, hx, hy, this.flameH * 0.92);
    halo.addColorStop(0, 'rgba(255, 138, 44, 0.55)');
    halo.addColorStop(0.45, 'rgba(255, 116, 30, 0.30)');
    halo.addColorStop(0.78, 'rgba(238, 96, 22, 0.09)');
    halo.addColorStop(1, 'rgba(220, 84, 18, 0)');
    g.fillStyle = halo;
    this.strokeFlamePath(g, this.flameOutline(1.18, 1.5));
    g.fill();

    // Main body.
    const outline = this.flameOutline(1, 1);
    const topY = this.wickY - this.flameH;
    const grad = g.createLinearGradient(0, this.wickY, 0, topY);
    grad.addColorStop(0, `rgba(90, 130, 255, ${lv * 0.75})`);   // blue base
    grad.addColorStop(0.14, `rgba(255, 176, 60, ${lv * 0.95})`);
    grad.addColorStop(0.45, `rgba(255, 214, 118, ${lv})`);
    grad.addColorStop(0.78, `rgba(255, 172, 66, ${lv * 0.85})`);
    grad.addColorStop(1, `rgba(240, 110, 30, 0)`);
    g.globalAlpha = 1;
    g.fillStyle = grad;
    this.strokeFlamePath(g, outline);
    g.fill();

    // White-hot core.
    g.globalAlpha = lv;
    const core = this.flameOutline(0.62, 0.42);
    const cg = g.createLinearGradient(0, this.wickY, 0, this.wickY - this.flameH * 0.62);
    cg.addColorStop(0, 'rgba(180, 210, 255, 0.9)');
    cg.addColorStop(0.3, 'rgba(255, 250, 226, 0.95)');
    cg.addColorStop(1, 'rgba(255, 226, 150, 0)');
    g.fillStyle = cg;
    this.strokeFlamePath(g, core);
    g.fill();

    g.restore();
  }

  drawSparks(g) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const sp of this.sparks) {
      const a = clamp01(sp.life) * 0.8;
      const r = sp.size * (0.6 + sp.life * 0.8);
      const gr = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r * 3);
      gr.addColorStop(0, `rgba(255, 226, 168, ${a})`);
      gr.addColorStop(0.4, `rgba(255, 148, 52, ${a * 0.5})`);
      gr.addColorStop(1, 'rgba(255, 110, 30, 0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(sp.x, sp.y, r * 3, 0, TAU); g.fill();
    }
    g.restore();
  }

  drawSmoke(g) {
    // A thin ribbon of smoke for a while after it goes out.
    const age = this.t;
    g.save();
    g.globalAlpha = 0.16;
    g.strokeStyle = 'rgba(190, 190, 200, 1)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.cx, this.wickY);
    for (let i = 1; i <= 12; i++) {
      const k = i / 12;
      const y = this.wickY - this.flameH * 1.6 * k;
      const x = this.cx + Math.sin(age * 1.4 + k * 5) * this.candleW * 0.4 * k;
      g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }
}
