/**
 * The wax seal, drawn on canvas.
 *
 * It sits directly beside a photographic paper scan, so a few CSS gradients and
 * a clip-path do not hold up — the eye reads the seal as flat vector art next
 * to a real surface. What sells wax is specific and physical:
 *
 *   - the blob is irregular, because molten wax spreads unevenly
 *   - the edge is *thinner* than the middle, so it is lighter and warmer where
 *     the light passes through it
 *   - the surface is minutely uneven, and that noise is what kills the
 *     "vector" feel more than anything else
 *   - the sigil is pressed *into* the wax, so it is lit from the same direction
 *     as everything else in the room: bright on the side facing the candle,
 *     shadowed on the far side
 *
 * Redrawn whenever the candle moves enough to matter, not every frame.
 */

import { clamp01, lerp, TAU } from '../core/util.js';
import { makeRng, makeNoise2D, fbm } from '../core/noise.js';

export class SealArt {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;
    this.lastKey = '';
    this.rng = makeRng(90210);
    this.noise = makeNoise2D(3311);

    // The blob outline, fixed for the session so it does not crawl.
    this.rim = [];
    const points = 72;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU;
      // Two octaves: a lopsided overall shape plus finer spread.
      const r = 1
        + Math.sin(a * 2 + 0.7) * 0.045
        + Math.sin(a * 3 + 2.1) * 0.03
        + Math.sin(a * 7 + 4.2) * 0.016
        + Math.sin(a * 11 + 1.1) * 0.009;
      this.rim.push({ a, r });
    }

    this.grain = null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const s = Math.max(24, Math.round(Math.min(rect.width, rect.height)));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (s === this.size && this.canvas.width) return;
    this.size = s;
    this.canvas.width = Math.round(s * this.dpr);
    this.canvas.height = Math.round(s * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.grain = null;
    this.lastKey = '';
  }

  /** Fine surface noise, built once per size. */
  buildGrain() {
    const s = this.size;
    const cv = document.createElement('canvas');
    cv.width = s; cv.height = s;
    const g = cv.getContext('2d');
    const img = g.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = fbm(this.noise, x / 6, y / 6, 4, 2.1, 0.55);
        const i = (y * s + x) * 4;
        // Signed: lighter where the wax stands proud, darker in the dimples.
        const c = v > 0 ? 255 : 0;
        d[i] = c; d[i + 1] = c; d[i + 2] = c;
        d[i + 3] = Math.min(255, Math.abs(v) * 150);
      }
    }
    g.putImageData(img, 0, 0);
    this.grain = cv;
  }

  path(g, cx, cy, radius) {
    g.beginPath();
    for (let i = 0; i <= this.rim.length; i++) {
      const p = this.rim[i % this.rim.length];
      const x = cx + Math.cos(p.a) * radius * p.r;
      const y = cy + Math.sin(p.a) * radius * p.r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  }

  /**
   * @param {number} candle  flame output, so the wax flickers with the room
   * @param {number} hold    0..1 while the seal is being pressed
   * @param {number} lightX  -1..1, which side the candle is on
   */
  draw(candle = 1, hold = 0, lightX = 0.6) {
    this.resize();
    const s = this.size;
    if (s < 8) return;

    // Redraw only when it would actually look different.
    const key = `${Math.round(candle * 12)},${Math.round(hold * 20)},${Math.round(lightX * 8)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (!this.grain) this.buildGrain();

    const g = this.ctx;
    const cx = s / 2, cy = s / 2;
    const R = s * 0.44;
    const lit = clamp01(0.45 + candle * 0.55);
    // Pressing warms and brightens it, as if held to the flame.
    const warm = lerp(1, 1.35, hold);

    g.clearRect(0, 0, s, s);

    // --- the shadow it casts on the desk ---------------------------------
    g.save();
    g.fillStyle = `rgba(0,0,0,${0.5 * lit})`;
    g.filter = 'blur(3px)';
    this.path(g, cx + s * 0.02, cy + s * 0.05, R * 0.98);
    g.fill();
    g.filter = 'none';
    g.restore();

    // --- the body --------------------------------------------------------
    g.save();
    this.path(g, cx, cy, R);
    g.clip();

    // Base wax. Lit from the candle side; the far side falls into deep red.
    const lx = cx - lightX * R * 0.45;
    const ly = cy - R * 0.4;
    const body = g.createRadialGradient(lx, ly, R * 0.05, cx, cy, R * 1.15);
    const tone = (r, gr, b, k) => `rgb(${Math.min(255, r * k * lit * warm) | 0}, ` +
      `${Math.min(255, gr * k * lit * warm) | 0}, ${Math.min(255, b * k * lit * warm) | 0})`;
    body.addColorStop(0, tone(162, 54, 44, 1.0));
    body.addColorStop(0.34, tone(126, 34, 32, 1.0));
    body.addColorStop(0.68, tone(88, 20, 22, 1.0));
    body.addColorStop(1, tone(48, 10, 13, 1.0));
    g.fillStyle = body;
    g.fillRect(0, 0, s, s);

    // The edge is thinner, so light gets through it. This is the single most
    // convincing thing about wax and the easiest to leave out.
    g.globalCompositeOperation = 'lighter';
    const edge = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.02);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(0.72, `rgba(150, 42, 30, ${0.22 * lit})`);
    edge.addColorStop(1, `rgba(214, 96, 58, ${0.5 * lit * warm})`);
    g.fillStyle = edge;
    g.fillRect(0, 0, s, s);

    // Surface texture.
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.5;
    g.drawImage(this.grain, 0, 0, s, s);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // --- the sigil, pressed in -------------------------------------------
    // A struck device is an indentation, so its far wall catches the light and
    // its near wall is in shadow — the opposite way round to a raised shape.
    const flame = (ox, oy, scale) => {
      g.beginPath();
      const fx = cx + ox, fy = cy + oy;
      const h = R * 0.86 * scale, w = R * 0.5 * scale;
      g.moveTo(fx, fy - h * 0.62);
      g.bezierCurveTo(fx + w * 0.75, fy - h * 0.2, fx + w * 0.5, fy + h * 0.08, fx + w * 0.42, fy + h * 0.3);
      g.bezierCurveTo(fx + w * 0.34, fy + h * 0.5, fx - w * 0.34, fy + h * 0.5, fx - w * 0.42, fy + h * 0.3);
      g.bezierCurveTo(fx - w * 0.5, fy + h * 0.08, fx - w * 0.75, fy - h * 0.2, fx, fy - h * 0.62);
      g.closePath();
    };
    const d = Math.max(1.5, s * 0.035);
    // Shadowed wall, on the side the light comes from.
    g.fillStyle = `rgba(26, 4, 7, ${0.85 * lit})`;
    flame(-lightX * d, -d * 0.7, 1);
    g.fill();
    // Lit wall, on the far side.
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(255, 168, 124, ${0.42 * lit * warm})`;
    flame(lightX * d, d * 0.7, 1);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // The floor of the impression, darker than the surface around it.
    g.fillStyle = `rgba(72, 14, 17, ${0.68 * lit})`;
    flame(0, 0, 0.94);
    g.fill();

    // --- specular --------------------------------------------------------
    g.globalCompositeOperation = 'lighter';
    const spec = g.createRadialGradient(lx, ly, 0, lx, ly, R * 0.85);
    spec.addColorStop(0, `rgba(255, 198, 168, ${0.13 * lit * warm})`);
    spec.addColorStop(0.45, `rgba(255, 150, 110, ${0.05 * lit})`);
    spec.addColorStop(1, 'rgba(255, 120, 90, 0)');
    g.fillStyle = spec;
    g.fillRect(0, 0, s, s);

    g.restore();

    // --- the pressed lip around the rim ----------------------------------
    // Wax squeezed out under the stamp stands slightly proud of the rest.
    g.save();
    g.lineWidth = Math.max(1, s * 0.012);
    this.path(g, cx, cy, R * 0.995);
    g.strokeStyle = `rgba(255, 168, 132, ${0.24 * lit * warm})`;
    g.stroke();
    this.path(g, cx, cy, R * 1.008);
    g.strokeStyle = `rgba(40, 8, 10, ${0.45 * lit})`;
    g.lineWidth = Math.max(1, s * 0.009);
    g.stroke();
    g.restore();
  }
}
