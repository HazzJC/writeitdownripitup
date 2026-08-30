/**
 * Rasterise favicon.svg into everything the web and the desktop build need.
 *
 *     node tools/build-icons.mjs
 *
 * One source of truth — the flame device that is also struck into the wax seal
 * — so the tab icon, the installed-app icon, the taskbar and the object you
 * press to finish all agree with each other.
 *
 * The .ico is assembled here rather than pulled in as another dependency. The
 * format is a 6-byte directory header, one 16-byte entry per image, then the
 * image payloads; Windows has accepted PNG-compressed entries since Vista, so
 * each entry is simply the PNG bytes sharp already produced.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(join(ROOT, 'favicon.svg'));
const png = (size) => sharp(svg, { density: 900 })
  .resize(size, size)
  .png({ compressionLevel: 9 })
  .toBuffer();

/* ── the website ──────────────────────────────────────────────────────────── */
const web = [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]];
for (const [name, size] of web) {
  writeFileSync(join(ROOT, name), await png(size));
}
console.log('web icons:', web.map(([n]) => n).join(', '));

/* ── the desktop build ────────────────────────────────────────────────────── */
const iconDir = join(ROOT, 'src-tauri', 'icons');
mkdirSync(iconDir, { recursive: true });

const tauriPngs = [
  ['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256],
  ['icon.png', 512], ['Square150x150Logo.png', 150], ['Square44x44Logo.png', 44],
];
for (const [name, size] of tauriPngs) {
  writeFileSync(join(iconDir, name), await png(size));
}

// icon.ico — the one Windows actually uses for the exe and the taskbar.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(icoSizes.map((s) => png(s)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);                 // reserved
header.writeUInt16LE(1, 2);                 // 1 = icon
header.writeUInt16LE(images.length, 4);

const entries = [];
let offset = 6 + images.length * 16;
images.forEach((buf, i) => {
  const e = Buffer.alloc(16);
  // 0 means 256 in this field, which is why 256 is the largest an .ico holds.
  e.writeUInt8(icoSizes[i] >= 256 ? 0 : icoSizes[i], 0);
  e.writeUInt8(icoSizes[i] >= 256 ? 0 : icoSizes[i], 1);
  e.writeUInt8(0, 2);                       // palette size, 0 for truecolour
  e.writeUInt8(0, 3);                       // reserved
  e.writeUInt16LE(1, 4);                    // colour planes
  e.writeUInt16LE(32, 6);                   // bits per pixel
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  entries.push(e);
});

writeFileSync(join(iconDir, 'icon.ico'), Buffer.concat([header, ...entries, ...images]));
console.log(`desktop icons: ${tauriPngs.length} png + icon.ico (${icoSizes.join(', ')})`);
