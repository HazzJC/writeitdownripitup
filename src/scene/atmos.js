/**
 * Atmosphere: the dust in the air, and the embers once the page is alight.
 *
 * Dust only exists because the candle is there to catch it, so every mote is
 * lit by distance from the flame. It is a cheap effect that does a lot of work
 * for the sense of a real, occupied room.
 */

import { clamp01, lerp, rand, TAU } from '../core/util.js';

export class AtmosRenderer {
  constructor(canvas, lighting) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lighting = lighting;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.motes = [];
    this.embers = [];
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

    const count = Math.round(clamp01(this.w * this.h / 2000000) * 90) + 55;
    this.motes.length = 0;
    for (let i = 0; i < count; i++) this.motes.push(this.makeMote(true));
  }

  makeMote(initial) {
    return {
      x: Math.random() * this.w,
      y: initial ? Math.random() * this.h : this.h + rand(0, 40),
      z: rand(0.2, 1),                 // depth: size and speed
      vx: rand(-6, 6),
      vy: rand(-13, -2),
      phase: Math.random() * TAU,
      spin: rand(0.3, 1.4),
      size: rand(0.5, 1.9),
    };
  }

  /** Throw embers from a point — used while the page burns. */
  emitEmber(x, y, count = 1, heat = 1) {
    for (let i = 0; i < count; i++) {
      this.embers.push({
        x: x + rand(-6, 6),
        y: y + rand(-4, 4),
        vx: rand(-26, 26),
        vy: rand(-95, -34) * heat,
        life: 1,
        decay: rand(0.28, 0.7),
        size: rand(0.8, 2.6),
        heat,
        wob: Math.random() * TAU,
      });
      if (this.embers.length > 420) this.embers.shift();
    }
  }

  /** Falling ash, cooler and slower than embers. */
  emitAsh(x, y, count = 1) {
    for (let i = 0; i < count; i++) {
      this.embers.push({
        x: x + rand(-14, 14),
        y: y + rand(-8, 8),
        vx: rand(-16, 16),
        vy: rand(-24, 6),
        life: 1,
        decay: rand(0.12, 0.3),
        size: rand(1.2, 3.6),
        heat: 0,
        ash: true,
        wob: Math.random() * TAU,
      });
      if (this.embers.length > 420) this.embers.shift();
    }
  }

  update(dt, intensity) {
    this.t += dt;
    const L = this.lighting;
    const draught = lerp(0.3, 2.4, clamp01(intensity));

    for (const m of this.motes) {
      m.phase += dt * m.spin;
      // Convection above the candle plus a general draught from the window.
      const toFlameX = (L.candle.x - m.x) / this.w;
      const nearFlame = clamp01(1 - Math.hypot(L.candle.x - m.x, L.candle.y - m.y) / (this.h * 0.45));
      m.x += (m.vx * draught * 0.4 + Math.sin(m.phase) * 9 - toFlameX * 6 * nearFlame) * dt;
      m.y += (m.vy * (0.5 + nearFlame * 1.9) - nearFlame * 22) * dt;
      if (m.y < -20 || m.x < -30 || m.x > this.w + 30) Object.assign(m, this.makeMote(false));
    }

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.life -= dt * e.decay;
      if (e.life <= 0) { this.embers.splice(i, 1); continue; }
      e.wob += dt * 5;
      if (e.ash) {
        e.vy += 34 * dt;               // ash settles
        e.vx += Math.sin(e.wob) * 22 * dt;
        e.vx *= 0.985;
      } else {
        e.vy += -26 * dt;              // embers keep rising while hot
        e.vy *= 0.99;
        e.vx += Math.sin(e.wob * 1.7) * 34 * dt;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }

  draw() {
    const g = this.ctx;
    const L = this.lighting;
    g.clearRect(0, 0, this.w, this.h);

    // --- dust ---------------------------------------------------------
    g.save();
    g.globalCompositeOperation = 'lighter';
    const reach = this.h * 0.5;
    for (const m of this.motes) {
      const d = Math.hypot(L.candle.x - m.x, L.candle.y - m.y);
      const lit = clamp01(1 - d / reach) * L.candle.value;
      const a = lit * lit * 0.5 * m.z + L.flash * 0.1 * m.z;
      if (a < 0.004) continue;
      const r = m.size * m.z * 1.6;
      g.fillStyle = `rgba(255, ${(206 + lit * 40) | 0}, ${(150 + lit * 60) | 0}, ${a})`;
      g.beginPath(); g.arc(m.x, m.y, r, 0, TAU); g.fill();
    }
    g.restore();

    // --- embers and ash -------------------------------------------------
    if (this.embers.length) {
      g.save();
      for (const e of this.embers) {
        const life = clamp01(e.life);
        if (e.ash) {
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = `rgba(${(40 + life * 30) | 0}, ${(36 + life * 26) | 0}, ${(34 + life * 22) | 0}, ${life * 0.55})`;
          g.save();
          g.translate(e.x, e.y);
          g.rotate(e.wob);
          g.fillRect(-e.size, -e.size * 0.4, e.size * 2, e.size * 0.8);
          g.restore();
        } else {
          g.globalCompositeOperation = 'lighter';
          const r = e.size * (0.5 + life);
          const gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 3.4);
          gr.addColorStop(0, `rgba(255, ${(210 + life * 40) | 0}, 150, ${life * 0.95})`);
          gr.addColorStop(0.35, `rgba(255, ${(130 + life * 50) | 0}, 46, ${life * 0.45})`);
          gr.addColorStop(1, 'rgba(220, 90, 24, 0)');
          g.fillStyle = gr;
          g.beginPath(); g.arc(e.x, e.y, r * 3.4, 0, TAU); g.fill();
        }
      }
      g.restore();
    }
  }
}
