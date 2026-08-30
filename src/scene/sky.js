/**
 * What you see through the window.
 *
 * Layers, back to front:
 *   sky        a night gradient that the storm bruises purple
 *   clouds     two fbm-generated strips scrolling at different speeds
 *   landscape  hills, a treeline, and a neighbour's cottage with lit windows
 *   rain       falling streaks, sheared by the wind
 *   bolt       the lightning itself, drawn only during a strike
 *
 * The landscape is a cached silhouette, but it is *relit* every frame: a strike
 * throws it into cold backlit relief and rims the trees, which is the whole
 * reason it is drawn here rather than being a photograph.
 */

import { clamp01, lerp, rand, TAU } from '../core/util.js';
import { makeNoise2D, makeRng, fbm } from '../core/noise.js';

export class SkyRenderer {
  constructor(canvas, lighting) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lighting = lighting;
    this.w = 0; this.h = 0; this.dpr = 1;

    this.noise = makeNoise2D(4242);
    this.rng = makeRng(99);

    this.clouds = null;
    this.landLayers = null;
    this.cloudOffset = 0;
    this.cloudOffset2 = 0;

    this.drops = [];
    this.maxDrops = 900;
    this.bolt = null;
    this.boltAge = 0;

    this.intensity = 0;
    this.presence = 0;
    this.sway = 0;
    this.windPhase = Math.random() * 100;
    this.t = 0;
    this.resize();
  }

  resize() {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.buildClouds();
    this.buildLandscape();
    this.seedRain();
  }

  // ---------------------------------------------------------------- clouds
  /**
   * Two scrolling cloud strips.
   *
   * Straight fbm gives long horizontal streaks, which read as smears rather
   * than as weather. Domain warping — sampling the noise at coordinates that
   * are themselves noise — is what turns streaks into billows.
   */
  buildClouds() {
    const w = 768, h = 320;
    const make = (seed, scale, contrast, warp) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      const img = cx.createImageData(w, h);
      const n = makeNoise2D(seed);
      for (let y = 0; y < h; y++) {
        const yy = (y / h) * scale * 2.2;
        for (let x = 0; x < w; x++) {
          // Wrap horizontally so the strip can scroll forever.
          const a = (x / w) * TAU;
          const nx = Math.cos(a) * scale;
          const ny = Math.sin(a) * scale;

          // Two rounds of warping: enough for billows, cheap enough to build
          // at load without a visible stall.
          const qx = fbm(n, nx + 1.7, ny + yy + 9.2, 3, 2.0, 0.5);
          const qy = fbm(n, nx + 8.3, ny + yy + 2.8, 3, 2.0, 0.5);
          const rx = fbm(n, nx + warp * qx + 4.1, ny + yy + warp * qy + 1.3, 3, 2.0, 0.5);
          const ry = fbm(n, nx + warp * qx + 7.7, ny + yy + warp * qy + 6.5, 3, 2.0, 0.5);
          let v = fbm(n, nx + warp * rx, ny + yy + warp * ry, 4, 2.1, 0.55);

          v = (v + 1) * 0.5;
          v = Math.pow(clamp01(v * contrast), 1.6);
          // Thin out toward the bottom so cloud sits in the upper sky.
          v *= 1 - Math.pow(y / h, 1.8) * 0.9;
          const i = (y * w + x) * 4;
          img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
          img.data[i + 3] = clamp01(v) * 255;
        }
      }
      cx.putImageData(img, 0, 0);
      return cv;
    };
    this.clouds = make(777, 1.9, 1.45, 1.6);
    this.clouds2 = make(313, 3.2, 1.2, 1.1);
  }

  // ------------------------------------------------------------- landscape
  /**
   * The view, built as separate depth layers rather than one silhouette.
   *
   * A single black cutout is what made this read as a stage flat. Distance at
   * night is carried almost entirely by *contrast*: the far ridge sits only a
   * shade darker than the sky it is against, and each nearer layer is darker
   * and sharper than the one behind it. Splitting it up is also what lets a
   * lightning strike rim the near trees while the far ones merely glow.
   *
   * Each layer is drawn flat black and recoloured at draw time by its depth.
   */
  buildLandscape() {
    const w = this.w, h = this.h;
    if (w < 2 || h < 2) return;
    const rng = makeRng(20250829);

    const layer = (depth) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.fillStyle = '#000';
      g.strokeStyle = '#000';
      // Each layer keeps its own recoloured copy, rebuilt only when the light
      // falling on it actually changes — see the draw loop.
      const tinted = document.createElement('canvas');
      tinted.width = w; tinted.height = h;
      // How far this layer bends. The foreground tree moves most; the far
      // ridge is too distant for its movement to read at all.
      const swayAmount = depth < 0.15 ? 1 : depth < 0.4 ? 0.45 : depth < 0.7 ? 0.12 : 0;
      return { cv, g, depth, tinted, tctx: tinted.getContext('2d'), lastKey: '', swayAmount };
    };

    const ridge = (g, baseY, amp, freq, phase, rough = 1) => {
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, baseY);
      for (let x = 0; x <= w; x += 4) {
        const y = baseY
          + Math.sin(x * freq + phase) * amp
          + Math.sin(x * freq * 2.7 + phase * 1.7) * amp * 0.36 * rough
          + Math.sin(x * freq * 6.1 + phase * 0.6) * amp * 0.13 * rough;
        g.lineTo(x, y);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };

    const conifer = (g, x, base, height, width, lean = 0) => {
      const tiers = 6;
      g.beginPath();
      for (let i = 0; i < tiers; i++) {
        const p = i / tiers;
        const ty = base - height * (1 - p);
        const tw = width * (0.22 + p * 0.9);
        const sway = lean * height * (1 - p) * 0.12;
        g.moveTo(x - tw + sway, ty + height * 0.12);
        g.lineTo(x + sway * 1.4, ty - height * 0.09);
        g.lineTo(x + tw + sway, ty + height * 0.12);
        g.closePath();
      }
      g.fill();
      g.fillRect(x - width * 0.06, base - height * 0.08, width * 0.12, height * 0.09);
    };

    /** A round-crowned deciduous tree, in leaf. */
    const bushy = (g, x, base, height, width) => {
      g.lineWidth = Math.max(1, width * 0.13);
      g.beginPath();
      g.moveTo(x, base);
      g.lineTo(x + width * 0.06, base - height * 0.45);
      g.stroke();
      // The crown is a cluster of blobs, so its outline is broken rather than
      // a clean ellipse.
      const blobs = 9 + Math.floor(rng() * 6);
      for (let i = 0; i < blobs; i++) {
        const a = rng() * TAU;
        const rr = rng();
        const bx = x + Math.cos(a) * width * 0.5 * rr;
        const by = base - height * 0.68 + Math.sin(a) * height * 0.2 * rr;
        g.beginPath();
        g.ellipse(bx, by, width * (0.2 + rng() * 0.22), height * (0.12 + rng() * 0.13),
          rng() * TAU, 0, TAU);
        g.fill();
      }
    };

    const branch = (g, x, y, angle, len, width, depth) => {
      if (depth <= 0 || len < 2) return;
      const x2 = x + Math.cos(angle) * len;
      const y2 = y + Math.sin(angle) * len;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      const n = rng() < 0.25 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        branch(g, x2, y2, angle + (rng() - 0.5) * 1.5 - 0.05,
          len * (0.62 + rng() * 0.2), width * 0.62, depth - 1);
      }
    };

    // -- L1: the far ridge, barely darker than the sky behind it ----------
    const far = layer(0.88);
    ridge(far.g, h * 0.60, h * 0.045, 0.0032, 1.2, 0.5);
    for (let i = 0; i < 34; i++) {
      const x = rng() * w;
      conifer(far.g, x, h * 0.66, h * (0.035 + rng() * 0.035), w * (0.004 + rng() * 0.005));
    }

    // -- L2: the middle distance: hills, the cottage, a hedgerow ----------
    const mid = layer(0.6);
    ridge(mid.g, h * 0.70, h * 0.05, 0.0055, 3.4, 0.8);
    this.buildCottage(mid.g, w, h, rng);
    // A hedgerow running along the field boundary.
    for (let x = -10; x < w + 10; x += w * 0.006) {
      const hh = h * (0.022 + Math.abs(Math.sin(x * 0.03)) * 0.014 + rng() * 0.01);
      mid.g.beginPath();
      mid.g.ellipse(x, h * 0.775, w * 0.009, hh, 0, 0, TAU);
      mid.g.fill();
    }
    for (let i = 0; i < 12; i++) {
      const x = rng() * w;
      if (Math.abs(x - w * 0.795) < w * 0.1) continue;
      if (rng() < 0.5) {
        conifer(mid.g, x, h * 0.79, h * (0.07 + rng() * 0.07), w * (0.008 + rng() * 0.009));
      } else {
        bushy(mid.g, x, h * 0.79, h * (0.06 + rng() * 0.06), w * (0.03 + rng() * 0.03));
      }
    }

    // -- L3: the near field: fence posts and the closer treeline ----------
    const near = layer(0.28);
    ridge(near.g, h * 0.855, h * 0.016, 0.011, 0.4, 1.2);
    const fenceY = h * 0.845;
    near.g.lineWidth = Math.max(1.2, w * 0.0022);
    for (let i = 0; i < 26; i++) {
      const x = -w * 0.05 + (i / 25) * w * 1.1;
      const ph = h * (0.032 + rng() * 0.008);
      near.g.fillRect(x, fenceY - ph, Math.max(1.5, w * 0.0035), ph);
    }
    near.g.beginPath();
    near.g.moveTo(-w * 0.05, fenceY - h * 0.022);
    near.g.lineTo(w * 1.05, fenceY - h * 0.026);
    near.g.stroke();
    for (let i = 0; i < 7; i++) {
      const x = rng() * w;
      conifer(near.g, x, h * 0.9, h * (0.12 + rng() * 0.1), w * (0.014 + rng() * 0.014),
        (rng() - 0.5) * 0.5);
    }

    // -- L4: the foreground: the bare tree, and weeds at the sill ---------
    const fore = layer(0.04);
    // Trunks run off the bottom of the frame, so they read as trees standing
    // just outside rather than as branches hanging in the sky.
    branch(fore.g, w * 0.085, h * 1.06, -Math.PI / 2 - 0.06, h * 0.34, w * 0.016, 7);
    branch(fore.g, w * 0.955, h * 1.08, -Math.PI / 2 + 0.08, h * 0.26, w * 0.012, 6);
    // Grass and seed heads breaking the bottom edge.
    fore.g.lineWidth = Math.max(1, w * 0.0016);
    for (let i = 0; i < 90; i++) {
      const x = rng() * w;
      const hgt = h * (0.02 + rng() * 0.075);
      const lean = (rng() - 0.5) * w * 0.02;
      fore.g.beginPath();
      fore.g.moveTo(x, h + 2);
      fore.g.quadraticCurveTo(x + lean * 0.4, h - hgt * 0.6, x + lean, h - hgt);
      fore.g.stroke();
      if (rng() < 0.16) {
        fore.g.beginPath();
        fore.g.arc(x + lean, h - hgt, w * 0.004, 0, TAU);
        fore.g.fill();
      }
    }

    this.landLayers = [far, mid, near, fore];
  }

  /**
   * The cottage across the field — geometry only.
   *
   * The silhouette goes into the mid layer so it occludes the hill behind it,
   * but nothing is punched out of it. The building is *drawn lit* in the draw
   * pass instead (see `drawCottage`), because a hole in a silhouette gives you
   * a lit rectangle floating in the dark with no building around it — which is
   * exactly what it looked like. A wall you can see, with light spilling down
   * it from its own windows, is what makes the windows read as windows.
   */
  buildCottage(g, w, h, rng) {
    // Right of centre: the page sits over the middle of the window for the
    // whole session, and a cottage nobody can see is wasted detail.
    const cx = w * 0.795;
    const cy = h * 0.715;
    const cw = w * 0.155, ch = h * 0.195;

    const body = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(cx - cw / 2, cy + ch);
      ctx.lineTo(cx - cw / 2, cy + ch * 0.36);
      ctx.lineTo(cx - cw * 0.6, cy + ch * 0.36);
      ctx.lineTo(cx - cw * 0.08, cy - ch * 0.26);      // ridge, off-centre
      ctx.lineTo(cx + cw * 0.62, cy + ch * 0.36);
      ctx.lineTo(cx + cw / 2, cy + ch * 0.36);
      ctx.lineTo(cx + cw / 2, cy + ch);
      ctx.closePath();
    };
    const lean = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(cx + cw * 0.5, cy + ch);
      ctx.lineTo(cx + cw * 0.5, cy + ch * 0.58);
      ctx.lineTo(cx + cw * 0.92, cy + ch * 0.72);
      ctx.lineTo(cx + cw * 0.92, cy + ch);
      ctx.closePath();
    };

    body(g); g.fill();
    lean(g); g.fill();
    g.fillRect(cx - cw * 0.34, cy - ch * 0.2, cw * 0.09, ch * 0.4);   // chimney

    // Smoke, leaning downwind.
    g.lineWidth = Math.max(1, w * 0.0016);
    g.beginPath();
    g.moveTo(cx - cw * 0.3, cy - ch * 0.22);
    g.quadraticCurveTo(cx - cw * 0.08, cy - ch * 0.52, cx + cw * 0.28, cy - ch * 0.66);
    g.stroke();

    this.cottage = { x: cx, y: cy, w: cw, h: ch, body, lean };

    // Openings, in the same coordinate space. Different sizes at different
    // heights: two identical rectangles side by side read as a pair of eyes.
    this.windows = [
      // [x frac, y frac, w frac, h frac, warmth, bars]
      [-0.30, 0.50, 0.20, 0.19, 1.00, true],   // big downstairs window
      [0.13, 0.56, 0.11, 0.13, 0.62, true],    // smaller, lower, to the right
      [-0.13, 0.02, 0.085, 0.10, 0.34, false], // gable light under the ridge
      [0.66, 0.70, 0.075, 0.25, 0.85, false],  // the open door in the lean-to
    ].map(([fx, fy, fw, fh, warm, bars]) => ({
      x: cx + cw * fx, y: cy + ch * fy,
      w: cw * fw, h: ch * fh, warm, bars,
    }));
  }

  /**
   * The cottage, lit.
   *
   * Drawn after its layer so the walls can be brighter than the silhouette,
   * and so the light coming out of the windows can fall on the wall around
   * them. That spill is the whole trick: without it the openings are just
   * bright rectangles, and with it there is obviously a building there.
   */
  drawCottage(g, flash) {
    const c = this.cottage;
    if (!c) return;
    const L = this.lighting;
    const hz = this.horizon || [24, 30, 46];
    const flick = 0.8 + Math.sin(this.t * 1.7) * 0.05 + Math.sin(this.t * 4.3) * 0.03;
    const warm = flick * lerp(1, 0.4, flash);

    const rgb = (k, wr, wg, wb) => 'rgb(' +
      Math.min(255, hz[0] * k + wr).toFixed(0) + ',' +
      Math.min(255, hz[1] * k + wg).toFixed(0) + ',' +
      Math.min(255, hz[2] * k + wb).toFixed(0) + ')';

    g.save();

    // The building sits *on* the field, so there is dark under it.
    const base = g.createLinearGradient(0, c.y + c.h * 0.86, 0, c.y + c.h * 1.28);
    base.addColorStop(0, 'rgba(0,0,0,0)');
    base.addColorStop(0.5, 'rgba(6, 5, 4, 0.5)');
    base.addColorStop(1, 'rgba(6, 5, 4, 0)');
    g.fillStyle = base;
    g.fillRect(c.x - c.w * 0.9, c.y + c.h * 0.86, c.w * 2, c.h * 0.42);

    // --- walls -----------------------------------------------------------
    // Lighter than the hill behind, and warmed from within by its own lamps.
    g.save();
    c.body(g);
    g.clip();
    const wall = g.createLinearGradient(c.x - c.w / 2, 0, c.x + c.w / 2, 0);
    wall.addColorStop(0, rgb(0.62, 6 * warm, 3 * warm, 0));
    wall.addColorStop(0.45, rgb(1.05, 26 * warm, 15 * warm, 2));
    wall.addColorStop(1, rgb(0.7, 9 * warm, 4 * warm, 0));
    g.fillStyle = wall;
    g.fillRect(c.x - c.w, c.y - c.h, c.w * 2, c.h * 2.2);
    g.restore();

    // --- roof ------------------------------------------------------------
    // Slate faces the sky, so it is the lightest part of the building on a
    // night like this — and it is cold where the walls are warm.
    g.save();
    g.beginPath();
    g.moveTo(c.x - c.w * 0.6, c.y + c.h * 0.36);
    g.lineTo(c.x - c.w * 0.08, c.y - c.h * 0.26);
    g.lineTo(c.x + c.w * 0.62, c.y + c.h * 0.36);
    g.closePath();
    g.clip();
    const roof = g.createLinearGradient(0, c.y - c.h * 0.26, 0, c.y + c.h * 0.36);
    roof.addColorStop(0, rgb(2.35 + flash * 3.4, 0, 2, 14));
    roof.addColorStop(1, rgb(1.45 + flash * 1.8, 0, 0, 6));
    g.fillStyle = roof;
    g.fillRect(c.x - c.w, c.y - c.h, c.w * 2, c.h * 2);
    // Courses of slate.
    g.globalAlpha = 0.3;
    g.strokeStyle = rgb(0.75, 0, 0, 0);
    g.lineWidth = Math.max(0.6, c.h * 0.012);
    for (let i = 1; i < 6; i++) {
      const y = c.y - c.h * 0.26 + (c.h * 0.62 * i) / 6;
      g.beginPath(); g.moveTo(c.x - c.w, y); g.lineTo(c.x + c.w, y); g.stroke();
    }
    g.restore();

    // The eaves overhang, so there is a hard shadow line under them. Without
    // it the roof and the wall read as one flat shape.
    g.fillStyle = 'rgba(6, 5, 4, 0.5)';
    g.fillRect(c.x - c.w * 0.6, c.y + c.h * 0.34, c.w * 1.22, Math.max(1, c.h * 0.035));

    // --- the lean-to -----------------------------------------------------
    g.save();
    c.lean(g);
    g.clip();
    g.fillStyle = rgb(0.62, 8 * warm, 4 * warm, 0);
    g.fillRect(c.x, c.y, c.w * 1.2, c.h * 1.2);
    g.restore();

    // --- windows ---------------------------------------------------------
    for (const win of this.windows) {
      const wm = win.warm * warm;
      const cxw = win.x + win.w / 2, cyw = win.y + win.h / 2;

      // Light on the wall around the opening. This is what makes it a window
      // in a building rather than a lit rectangle in the dark.
      g.save();
      g.globalCompositeOperation = 'lighter';
      const spill = g.createRadialGradient(cxw, cyw, 0, cxw, cyw, Math.max(win.w, win.h) * 3.4);
      spill.addColorStop(0, `rgba(255, 176, 88, ${0.34 * wm})`);
      spill.addColorStop(0.3, `rgba(236, 142, 54, ${0.13 * wm})`);
      spill.addColorStop(1, 'rgba(190, 100, 34, 0)');
      g.fillStyle = spill;
      const r = Math.max(win.w, win.h) * 3.4;
      g.fillRect(cxw - r, cyw - r, r * 2, r * 2);
      g.restore();

      // A recess: the reveal is in shadow on one side.
      g.fillStyle = 'rgba(10, 8, 6, 0.55)';
      g.fillRect(win.x - win.w * 0.08, win.y - win.h * 0.08,
        win.w * 1.16, win.h * 1.16);

      // The pane.
      const pane = g.createLinearGradient(0, win.y, 0, win.y + win.h);
      pane.addColorStop(0, `rgba(255, 214, 150, ${0.95 * wm})`);
      pane.addColorStop(1, `rgba(248, 176, 96, ${0.8 * wm})`);
      g.fillStyle = pane;
      g.fillRect(win.x, win.y, win.w, win.h);

      // Glazing bars, and a cill under it.
      if (win.bars && win.w > 5) {
        g.fillStyle = `rgba(38, 24, 12, ${0.62 * wm})`;
        g.fillRect(win.x + win.w * 0.47, win.y, Math.max(0.8, win.w * 0.06), win.h);
        g.fillRect(win.x, win.y + win.h * 0.44, win.w, Math.max(0.8, win.h * 0.08));
      }
      g.fillStyle = rgb(1.1, 5 * wm, 3 * wm, 2);
      g.fillRect(win.x - win.w * 0.12, win.y + win.h * 1.06,
        win.w * 1.24, Math.max(1, win.h * 0.1));

      // And light thrown down onto the ground below.
      g.save();
      g.globalCompositeOperation = 'lighter';
      const floorLit = g.createRadialGradient(cxw, win.y + win.h * 2.6, 0,
        cxw, win.y + win.h * 2.6, win.w * 2.4);
      floorLit.addColorStop(0, `rgba(226, 146, 60, ${0.14 * wm})`);
      floorLit.addColorStop(1, 'rgba(190, 100, 34, 0)');
      g.fillStyle = floorLit;
      g.fillRect(cxw - win.w * 2.4, win.y, win.w * 4.8, win.h * 4);
      g.restore();
    }

    g.restore();
  }

  // ------------------------------------------------------------------ rain
  seedRain() {
    this.drops.length = 0;
    for (let i = 0; i < this.maxDrops; i++) {
      this.drops.push(this.makeDrop(true));
    }
  }

  makeDrop(initial = false) {
    return {
      x: rand(-0.25, 1.25) * this.w,
      y: initial ? rand(0, 1) * this.h : rand(-0.3, -0.02) * this.h,
      len: rand(8, 34),
      speed: rand(900, 1900),
      // Depth: far drops are dimmer, thinner and slower.
      z: rand(0.25, 1),
    };
  }

  // ------------------------------------------------------------- lightning
  /**
   * Build a jagged bolt with branches.
   * @param {number}  distance 0 = overhead
   * @param {boolean} grand    the single strike on release: wider, more
   *                           branched, and it stays in frame noticeably longer
   */
  makeBolt(distance, grand = false) {
    const w = this.w, h = this.h;
    const near = 1 - clamp01(distance);
    const startX = rand(0.12, 0.88) * w;
    const endX = startX + rand(-0.18, 0.18) * w;
    const endY = h * rand(0.55, 0.75);

    const segs = [];
    const build = (x0, y0, x1, y1, width, depth) => {
      const points = [{ x: x0, y: y0 }];
      const steps = 10 + Math.floor(rand(0, 8));
      for (let i = 1; i <= steps; i++) {
        const p = i / steps;
        const jitter = (1 - p) * w * 0.055 * rand(0.4, 1.4);
        points.push({
          x: lerp(x0, x1, p) + (Math.random() - 0.5) * jitter,
          y: lerp(y0, y1, p) + (Math.random() - 0.5) * h * 0.012,
        });
      }
      segs.push({ points, width });
      if (depth > 0) {
        const branches = 1 + Math.floor(rand(0, 2.4));
        for (let b = 0; b < branches; b++) {
          const idx = 2 + Math.floor(Math.random() * (points.length - 4));
          const p = points[idx];
          if (!p) continue;
          build(p.x, p.y,
            p.x + rand(-0.2, 0.2) * w,
            p.y + rand(0.1, 0.35) * h,
            width * 0.5, depth - 1);
        }
      }
    };
    build(startX, -h * 0.05, endX, endY, lerp(1.1, 3.4, near) * (grand ? 1.9 : 1), grand ? 3 : 2);
    if (grand) {
      // A second fork, because the big one should not look like the others.
      build(startX + rand(-0.1, 0.1) * w, -h * 0.05,
        endX + rand(-0.3, 0.3) * w, endY + rand(-0.1, 0.1) * h,
        lerp(1.1, 3.4, near) * 1.2, 2);
    }
    this.bolt = { segs, near, born: this.t, grand };
    this.boltAge = 0;
  }

  strike(distance, grand = false) {
    // Only ~70% of ordinary strikes show a bolt in frame; the rest light the
    // cloud from within. The final one is always drawn.
    if (grand || Math.random() < 0.72) this.makeBolt(distance, grand);
    else this.bolt = null;
  }

  // ------------------------------------------------------------------ draw
  update(dt, intensity, presence = 1) {
    this.t += dt;
    this.intensity = clamp01(intensity);
    this.presence = clamp01(presence);
    const s = this.intensity;

    // The wind that bends the trees. Two incommensurate rates plus a slow gust
    // envelope, so it never settles into a visible loop.
    this.windPhase += dt * lerp(0.35, 1.5, s);
    const gust = 0.55 + 0.45 * Math.sin(this.windPhase * 0.23) * Math.sin(this.windPhase * 0.61);
    this.sway = (Math.sin(this.windPhase) * 0.7 + Math.sin(this.windPhase * 2.37 + 1.1) * 0.3)
      * gust * lerp(2, 38, Math.pow(s, 1.2));

    this.cloudOffset = (this.cloudOffset + dt * lerp(4, 34, s)) % 768;
    this.cloudOffset2 = (this.cloudOffset2 + dt * lerp(2, 19, s)) % 768;

    // Rain: how many drops are live, how fast, and how far the wind shears them.
    // Scaled by presence, so the sky outside starts genuinely empty.
    const active = Math.floor(lerp(0, this.maxDrops, Math.pow(s, 0.75)) * this.presence);
    const shear = lerp(0.08, 0.62, s) * (1 + Math.sin(this.t * 0.31) * 0.25);
    const speedMul = lerp(0.55, 1.5, s);
    for (let i = 0; i < active; i++) {
      const d = this.drops[i];
      const v = d.speed * speedMul * (0.5 + d.z * 0.5);
      d.y += v * dt;
      d.x += v * shear * dt;
      if (d.y > this.h * 1.05 || d.x > this.w * 1.3) {
        Object.assign(d, this.makeDrop(false));
      }
    }
    this.activeDrops = active;
    this.shear = shear;

    if (this.bolt) {
      this.boltAge += dt;
      if (this.boltAge > (this.bolt.grand ? 1.1 : 0.55)) this.bolt = null;
    }
  }

  draw() {
    const g = this.ctx;
    const w = this.w, h = this.h;
    const L = this.lighting;
    const s = this.intensity;
    const flash = L.flash;
    if (w < 2 || h < 2) return;

    g.clearRect(0, 0, w, h);

    // --- sky ------------------------------------------------------------
    const sky = g.createLinearGradient(0, 0, 0, h);
    // Calm: deep blue evening. Storm: bruised near-black with a violet cast.
    // Kept genuinely dark — the drama has to come from the lightning, and it
    // can't if the resting sky is already bright.
    const topL = lerp(0.10, 0.02, s), midL = lerp(0.17, 0.05, s);
    sky.addColorStop(0, `rgb(${(11 + topL * 44) | 0}, ${(16 + topL * 52) | 0}, ${(30 + topL * 76) | 0})`);
    sky.addColorStop(0.5, `rgb(${(15 + midL * 46) | 0}, ${(22 + midL * 54) | 0}, ${(38 + midL * 72) | 0})`);
    // A hint of skyglow low down, where a town would be.
    sky.addColorStop(0.82, `rgb(${(18 + midL * 40) | 0}, ${(23 + midL * 42) | 0}, ${(34 + midL * 52) | 0})`);
    sky.addColorStop(1, `rgb(${(9 + midL * 22) | 0}, ${(12 + midL * 24) | 0}, ${(19 + midL * 30) | 0})`);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // The colour of the sky down at the horizon. The land layers are shaded
    // relative to this: a hill is only ever legible as a *contrast* against the
    // sky behind it, so tinting them against a fixed guess made the middle
    // distance vanish whenever the sky drifted to match it.
    this.horizon = [
      18 + midL * 40,
      23 + midL * 42,
      34 + midL * 52,
    ];

    // Lightning lights the sky itself, brightest at the top.
    if (flash > 0.002) {
      const fg = g.createLinearGradient(0, 0, 0, h * 0.9);
      fg.addColorStop(0, `rgba(196, 214, 255, ${flash * 0.85})`);
      fg.addColorStop(0.5, `rgba(150, 172, 226, ${flash * 0.45})`);
      fg.addColorStop(1, `rgba(110, 130, 180, 0)`);
      g.fillStyle = fg;
      g.fillRect(0, 0, w, h);
    }

    // --- clouds ---------------------------------------------------------
    // Storm cloud at night is mostly *darker* than the sky behind it. It is
    // only revealed by skyglow along its edges, and then blown wide open by a
    // strike. So: an occluding pass first, then a lit pass on top.
    const layers = [
      [this.clouds, this.cloudOffset, 0.66, 1.0],
      [this.clouds2, this.cloudOffset2, 0.48, 0.72],
    ];
    const dw = w * 1.7;

    g.save();
    // 1. occlusion — the mass of the cloud blotting out the sky
    g.globalCompositeOperation = 'source-over';
    for (const [strip, off, scaleY, weight] of layers) {
      if (!strip) continue;
      g.globalAlpha = lerp(0.30, 0.80, s) * weight;
      const dh = h * scaleY;
      for (let k = -1; k <= 1; k++) {
        g.drawImage(strip, -((off / 768) * dw) + k * dw, -h * 0.12, dw, dh);
      }
    }
    // The strip is white, so paint it dark through its own alpha.
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 1;
    const cd = lerp(0.20, 0.06, s);
    g.fillStyle = `rgba(${(20 + cd * 90) | 0}, ${(26 + cd * 100) | 0}, ${(42 + cd * 120) | 0}, 0.92)`;
    g.fillRect(0, 0, w, h);
    g.restore();

    // 2. illumination — skyglow on the tops, and the flash from within
    const cloudLight = clamp01(L.ambient * 0.42 + flash * 2.6);
    if (cloudLight > 0.01) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const [strip, off, scaleY, weight] of layers) {
        if (!strip) continue;
        g.globalAlpha = clamp01(cloudLight * weight * 0.85);
        const dh = h * scaleY;
        for (let k = -1; k <= 1; k++) {
          g.drawImage(strip, -((off / 768) * dw) + k * dw, -h * 0.12, dw, dh);
        }
      }
      g.restore();
    }
    g.globalAlpha = 1;

    // --- the bolt (behind the landscape so trees silhouette against it) ---
    if (this.bolt) this.drawBolt(g);

    // --- landscape ------------------------------------------------------
    // Back to front, each layer recoloured by its depth. Recolouring happens on
    // a scratch layer because tinting in place would repaint the sky too, which
    // is already opaque underneath.
    if (this.landLayers) {
      for (const L2 of this.landLayers) {
        // Far layers sit close to the sky colour; near ones go almost black.
        // A strike lifts everything, but lifts the near layers most, because
        // they are what the light actually reaches.
        const haze = Math.pow(L2.depth, 1.4);
        // Scaled against the sky at the horizon: the far ridge sits a shade
        // *above* it (haze scatters light toward you), everything nearer sits
        // well below it, and the foreground is near black.
        const shade = lerp(0.13, 1.22, haze);
        const hz = this.horizon || [24, 30, 46];
        // A strike reaches the near layers hardest — they are what the light
        // actually falls on; the far ones only glow.
        const litByFlash = flash * lerp(150, 40, haze);
        const amb = L.ambient * lerp(6, 26, haze);

        const cr = Math.min(255, hz[0] * shade + amb + litByFlash) | 0;
        const cg = Math.min(255, hz[1] * shade + amb + litByFlash * 1.04) | 0;
        const cb = Math.min(255, hz[2] * shade + amb + litByFlash * 1.12) | 0;

        // Recolouring means four full-canvas operations per layer. Doing that
        // every frame for every layer costs more than everything else in the
        // scene put together, and the colour barely moves between frames — so
        // the tinted copy is cached and only rebuilt when it would visibly
        // differ. During a strike that is every frame; the rest of the time it
        // is almost never.
        // Quantised: an exact match would rebuild on a one-level change, which
        // means every frame during a fade even though the result is
        // indistinguishable. Steps of four levels are invisible and turn a
        // continuous fade from four rebuilds a frame into a handful in total.
        const key = `${cr >> 2},${cg >> 2},${cb >> 2}`;
        if (key !== L2.lastKey) {
          L2.lastKey = key;
          const tc = L2.tctx;
          tc.globalCompositeOperation = 'source-over';
          tc.clearRect(0, 0, w, h);
          tc.fillStyle = `rgb(${cr},${cg},${cb})`;
          tc.fillRect(0, 0, w, h);
          tc.globalCompositeOperation = 'destination-in';
          tc.drawImage(L2.cv, 0, 0, w, h);
          tc.globalCompositeOperation = 'source-over';
        }
        // Trees do not stand still in a gale. The layer is a cached bitmap, so
        // the bend is a horizontal skew: full displacement at the top of the
        // frame, none at the bottom, which pivots the trunks about their roots
        // instead of sliding the whole picture sideways.
        //
        // Drawing it as a stack of shifted horizontal bands gives a truer
        // curved flex, but it costs a drawImage per band per layer per frame
        // and roughly doubled the frame budget. At this distance the difference
        // between a linear lean and a curved one is not visible; the cost is.
        const sway = this.sway * L2.swayAmount;
        if (Math.abs(sway) < 0.3) {
          g.drawImage(L2.tinted, 0, 0, w, h);
        } else {
          g.save();
          g.transform(1, 0, -sway / h, 1, sway, 0);
          g.drawImage(L2.tinted, 0, 0, w, h);
          g.restore();
        }

        // Rain hangs in the air between the layers, so each one is veiled a
        // little by the depth in front of it. This is what actually reads as
        // distance once the storm is up.
        const veil = haze * lerp(0.0, 0.26, s) * (0.5 + this.presence * 0.5);
        if (veil > 0.004) {
          g.save();
          g.globalAlpha = veil;
          const vg = g.createLinearGradient(0, h * 0.35, 0, h);
          vg.addColorStop(0, `rgba(${(26 + flash * 120) | 0}, ${(34 + flash * 130) | 0}, ${(52 + flash * 150) | 0}, 1)`);
          vg.addColorStop(1, `rgba(${(18 + flash * 90) | 0}, ${(24 + flash * 100) | 0}, ${(38 + flash * 120) | 0}, 0.35)`);
          g.fillStyle = vg;
          g.fillRect(0, h * 0.3, w, h * 0.7);
          g.restore();
        }
      }

      this.drawCottage(g, flash);
    }

    // --- falling rain ----------------------------------------------------
    const n = this.activeDrops || 0;
    const shear = this.shear || 0.2;
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      const len = d.len * lerp(0.6, 1.5, s) * (0.4 + d.z * 0.6);
      // Rain catches whatever light there is; a flash makes the whole sheet glow.
      const a = (0.05 + d.z * 0.16) * lerp(0.5, 1.1, s) + flash * 0.5 * d.z;
      g.strokeStyle = `rgba(190, 212, 245, ${clamp01(a)})`;
      g.lineWidth = 0.4 + d.z * 1.0;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x - len * shear, d.y - len);
      g.stroke();
    }
    g.restore();
  }

  drawBolt(g) {
    const bolt = this.bolt;
    // The bolt is only visible for the first instant; the flash outlives it.
    const age = this.boltAge;
    const life = clamp01(1 - age / (bolt.grand ? 0.5 : 0.22));
    if (life <= 0) return;
    const a = Math.pow(life, 1.6) * lerp(0.35, 1, bolt.near);

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Three passes: wide cold glow, mid, then a white-hot core.
    for (const [mul, col, alpha] of [
      [9, 'rgba(120, 156, 255, ', 0.16],
      [3.2, 'rgba(180, 205, 255, ', 0.40],
      [1, 'rgba(245, 250, 255, ', 1.0],
    ]) {
      for (const seg of bolt.segs) {
        g.strokeStyle = col + (a * alpha).toFixed(3) + ')';
        g.lineWidth = seg.width * mul;
        g.beginPath();
        g.moveTo(seg.points[0].x, seg.points[0].y);
        for (let i = 1; i < seg.points.length; i++) g.lineTo(seg.points[i].x, seg.points[i].y);
        g.stroke();
      }
    }
    g.restore();
  }
}
