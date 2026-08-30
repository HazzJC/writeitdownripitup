/**
 * Rain on the window pane.
 *
 * Two populations:
 *   beads    small stationary condensation that accumulates and grows
 *   runners  beads that got heavy enough to break surface tension and slide,
 *            accelerating, eating any bead they pass over, and leaving a
 *            residual trail behind them
 *
 * Trails live on a persistent layer that is erased a little each frame, so a
 * streak lingers and fades the way real water does.
 *
 * Each bead is stamped from a pre-rendered sprite rather than drawn with live
 * gradients - a few hundred radial gradients per frame is far too slow. The
 * sprite is shaded like a real droplet: dark rim from total internal
 * reflection, a bright refracted crescent low down, and a specular highlight
 * where the sky hits it.
 */

import { clamp01, lerp, rand, randInt } from '../core/util.js';

const SPRITE_STEPS = 12;   // sprite LODs across the size range
const SPRITE_MAX = 96;     // px of the largest sprite

export class GlassRenderer {
  constructor(canvas, lighting) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lighting = lighting;
    this.w = 0; this.h = 0; this.dpr = 1;

    this.beads = [];
    this.runners = [];
    this.maxBeads = 520;
    this.spawnAcc = 0;

    this.sprites = [];
    this.buildSprites();

    this.trail = document.createElement('canvas');
    this.trailCtx = this.trail.getContext('2d');

    this.intensity = 0;
    this.presence = 0;
    this.t = 0;
    this.shake = 0;
    this.resize();
  }

  /** Pre-render droplet sprites at a range of sizes. */
  buildSprites() {
    this.sprites.length = 0;
    for (let i = 0; i < SPRITE_STEPS; i++) {
      const size = Math.max(6, Math.round(lerp(6, SPRITE_MAX, i / (SPRITE_STEPS - 1))));
      const cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      const g = cv.getContext('2d');
      const r = size / 2;

      // Body: the drop acts as a lens. Light arrives from above, so the
      // bottom of the drop is where the concentrated light comes out.
      const body = g.createRadialGradient(r, r * 1.22, r * 0.05, r, r, r);
      body.addColorStop(0, 'rgba(214, 232, 255, 0.60)');
      body.addColorStop(0.45, 'rgba(150, 178, 214, 0.30)');
      body.addColorStop(0.80, 'rgba(96, 120, 152, 0.22)');
      body.addColorStop(1, 'rgba(60, 78, 104, 0)');
      g.fillStyle = body;
      g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();

      // Dark rim - the edge of the meniscus reads almost black.
      const rim = g.createRadialGradient(r, r, r * 0.62, r, r, r);
      rim.addColorStop(0, 'rgba(12, 18, 30, 0)');
      rim.addColorStop(0.72, 'rgba(10, 16, 28, 0.30)');
      rim.addColorStop(0.94, 'rgba(8, 13, 24, 0.42)');
      rim.addColorStop(1, 'rgba(8, 13, 24, 0)');
      g.fillStyle = rim;
      g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();

      // Refracted crescent at the base.
      g.save();
      g.globalCompositeOperation = 'lighter';
      const cres = g.createRadialGradient(r, r * 1.38, 0, r, r * 1.38, r * 0.72);
      cres.addColorStop(0, 'rgba(224, 240, 255, 0.55)');
      cres.addColorStop(1, 'rgba(180, 210, 255, 0)');
      g.fillStyle = cres;
      g.beginPath(); g.arc(r, r, r * 0.97, 0, Math.PI * 2); g.fill();

      // Specular highlight, upper left. Kept small and restrained — a hot
      // white dot on every bead makes the pane read as falling snow.
      const spec = g.createRadialGradient(r * 0.70, r * 0.62, 0, r * 0.70, r * 0.62, r * 0.30);
      spec.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
      spec.addColorStop(0.5, 'rgba(230, 244, 255, 0.10)');
      spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = spec;
      g.beginPath(); g.arc(r * 0.68, r * 0.6, r * 0.42, 0, Math.PI * 2); g.fill();
      g.restore();

      this.sprites.push(cv);
    }
  }

  spriteFor(radius) {
    const k = clamp01((radius * 2 - 6) / (SPRITE_MAX - 6));
    return this.sprites[Math.min(SPRITE_STEPS - 1, Math.round(k * (SPRITE_STEPS - 1)))];
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.trail.width = Math.round(this.w * this.dpr);
    this.trail.height = Math.round(this.h * this.dpr);
    this.trailCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.trailCtx.clearRect(0, 0, this.w, this.h);

    this.beads.length = 0;
    this.runners.length = 0;
    // Seeded from whatever presence has already accrued, so a resize mid-storm
    // doesn't wipe the pane clean.
    const seed = Math.round(90 * (this.presence || 0));
    for (let i = 0; i < seed; i++) this.spawnBead();
  }

  spawnBead(x, y, r) {
    if (this.beads.length >= this.maxBeads) return null;
    const b = {
      x: x !== undefined ? x : Math.random() * this.w,
      y: y !== undefined ? y : Math.random() * this.h,
      r: r !== undefined ? r : rand(1.2, 3.6),
      // A drop's own threshold varies - glass is not uniformly clean.
      crit: rand(4.5, 9.5),
      wob: Math.random() * 6.283,
    };
    this.beads.push(b);
    return b;
  }

  /** Promote a bead into a sliding runner. */
  release(b) {
    const i = this.beads.indexOf(b);
    if (i >= 0) this.beads.splice(i, 1);
    this.runners.push({
      x: b.x, y: b.y, r: b.r,
      vy: rand(12, 40),
      vx: 0,
      // Where the drop wanders as it descends - glass has micro-channels.
      drift: rand(-0.5, 0.5),
      driftPhase: Math.random() * 6.283,
      lastTrail: b.y,
    });
  }

  /** A gust or a thunderclap shakes the pane. */
  rattle(amount = 1) {
    this.shake = Math.min(2.2, this.shake + amount);
  }

  update(dt, intensity, presence = 1) {
    this.t += dt;
    this.intensity = clamp01(intensity);
    this.presence = clamp01(presence);
    const s = this.intensity;
    const w = this.w, h = this.h;
    this.shake *= Math.exp(-dt / 0.16);

    // --- new water arriving ------------------------------------------
    // Impact rate rises steeply: a calm window gets the odd bead, a storm is
    // being hosed down.
    // Presence scaled: the pane starts dry, and the first bead to appear is
    // a single drop rather than a scatter.
    const rate = lerp(0.4, 95, Math.pow(s, 1.25)) * lerp(0.05, 1, this.presence);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.beads.length < this.maxBeads) {
        // Bigger drops arrive in heavier rain.
        this.spawnBead(Math.random() * w, Math.random() * h, rand(1.0, lerp(3.2, 7.5, s)));
      } else {
        // Saturated: instead of adding, fatten an existing bead.
        const b = this.beads[randInt(0, this.beads.length - 1)];
        if (b) b.r += rand(0.15, 0.6);
      }
    }

    // --- beads grow and eventually run --------------------------------
    // Wind shear tilts the run direction.
    const shear = lerp(0.02, 0.36, s) * (1 + Math.sin(this.t * 0.37) * 0.4);
    for (let i = this.beads.length - 1; i >= 0; i--) {
      const b = this.beads[i];
      // Slow accumulation of condensation.
      b.r += dt * lerp(0.05, 0.5, s) * rand(0.2, 1.0);
      if (b.r > b.crit) this.release(b);
    }

    // --- runners -------------------------------------------------------
    const g = this.trailCtx;
    for (let i = this.runners.length - 1; i >= 0; i--) {
      const rn = this.runners[i];
      // Gravity, scaled by mass: fat drops fall much faster.
      rn.vy += dt * (140 + rn.r * 46) * lerp(0.7, 1.35, s);
      rn.driftPhase += dt * 2.2;
      rn.vx = rn.drift * 26 * Math.sin(rn.driftPhase) + rn.vy * shear;

      const py = rn.y;
      rn.y += rn.vy * dt;
      rn.x += rn.vx * dt;

      // Eat beads it passes through, growing as it goes.
      for (let j = this.beads.length - 1; j >= 0; j--) {
        const b = this.beads[j];
        const dx = b.x - rn.x, dy = b.y - rn.y;
        const rr = rn.r + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          // Conserve volume rather than radius.
          rn.r = Math.cbrt(rn.r ** 3 + b.r ** 3);
          this.beads.splice(j, 1);
        }
      }

      // Lay down the trail: a thin wet channel plus residual beads.
      this.drawTrail(g, rn, py);

      // Shed mass into the trail - a runner thins as it travels.
      rn.r -= dt * lerp(0.5, 0.22, s) * (0.4 + rn.r * 0.08);

      if (rn.y - rn.r > h + 20 || rn.r < 1.1 || rn.x < -30 || rn.x > w + 30) {
        this.runners.splice(i, 1);
      }
    }

    // --- fade the trail layer ----------------------------------------
    // Faster evaporation when calm; in a downpour the glass stays wet.
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${lerp(0.055, 0.014, s)})`;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  drawTrail(g, rn, prevY) {
    const width = rn.r * 0.62;
    g.save();
    g.globalCompositeOperation = 'source-over';
    // The wet channel.
    g.strokeStyle = `rgba(150, 180, 215, ${clamp01(0.10 + rn.r * 0.012)})`;
    g.lineWidth = width * 2;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(rn.x - rn.vx * 0.008, prevY);
    g.lineTo(rn.x, rn.y);
    g.stroke();
    g.restore();

    // Residual beads pinched off along the way.
    if (rn.y - rn.lastTrail > rand(6, 22)) {
      rn.lastTrail = rn.y;
      if (this.beads.length < this.maxBeads && rn.r > 2) {
        this.spawnBead(rn.x + rand(-1.5, 1.5), rn.y - rand(2, 8), rn.r * rand(0.14, 0.34));
      }
    }
  }

  draw() {
    const g = this.ctx;
    const w = this.w, h = this.h;
    if (w < 2 || h < 2) return;
    const L = this.lighting;
    const s = this.intensity;

    g.clearRect(0, 0, w, h);

    // Pane shake from thunder.
    const sh = this.shake;
    if (sh > 0.004) {
      g.save();
      g.translate(rand(-sh, sh) * 1.6, rand(-sh, sh) * 1.6);
    }

    // How brightly the water reads: it is only visible because something is
    // behind it, so it tracks ambient light and blazes during a strike.
    const lightMul = clamp01(0.42 + L.ambient * 0.9 + L.flash * 2.4);

    // --- trails ---------------------------------------------------------
    g.save();
    g.globalAlpha = clamp01(0.34 * lightMul + 0.06);
    g.globalCompositeOperation = 'screen';
    g.drawImage(this.trail, 0, 0, w, h);
    g.restore();

    // --- beads ----------------------------------------------------------
    // Water on glass at night is mostly dark. It is legible because it
    // distorts what is behind it, not because it glows — so this stays low.
    g.save();
    g.globalAlpha = clamp01(0.12 + lightMul * 0.36);
    for (const b of this.beads) {
      const sp = this.spriteFor(b.r);
      const d = b.r * 2;
      g.drawImage(sp, b.x - b.r, b.y - b.r, d, d);
    }
    // Runners are stretched vertically by their speed.
    for (const rn of this.runners) {
      const sp = this.spriteFor(rn.r);
      const stretch = 1 + clamp01(rn.vy / 900) * 1.4;
      const dw = rn.r * 2;
      const dh = dw * stretch;
      g.drawImage(sp, rn.x - rn.r, rn.y - dh * 0.5, dw, dh);
    }
    g.restore();

    // --- specular sheen across the whole pane during a flash ------------
    if (L.flash > 0.01) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = L.flash * 0.14;
      const gr = g.createLinearGradient(0, 0, w * 0.4, h);
      gr.addColorStop(0, 'rgba(190, 214, 255, 1)');
      gr.addColorStop(1, 'rgba(120, 150, 210, 0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.restore();
    }

    if (sh > 0.004) g.restore();
  }
}
