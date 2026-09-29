// Generates the extension icons (phone glyph) as PNG without dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../extension/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

// Signed distance to a rounded rectangle (unit square coordinates).
function roundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - cx) - hx, dy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

// Colour at a point in [0,1]^2 (null = transparent).
function shade(u, v) {
  // Phone body (blue gradient)
  if (roundRect(u, v, 0.22, 0.04, 0.78, 0.96, 0.12) > 0) return null;
  const t = v;
  let col = [37 + (79 - 37) * t, 99 + (70 - 99) * t, 235 + (229 - 235) * t];
  // Screen
  if (roundRect(u, v, 0.28, 0.14, 0.72, 0.82, 0.04) <= 0) {
    col = [240, 246, 255];
    // Simple "mobile layout" bars on the screen
    if (roundRect(u, v, 0.33, 0.2, 0.67, 0.3, 0.02) <= 0) col = [96, 165, 250];
    else if (roundRect(u, v, 0.33, 0.36, 0.67, 0.42, 0.02) <= 0) col = [148, 163, 184];
    else if (roundRect(u, v, 0.33, 0.48, 0.6, 0.54, 0.02) <= 0) col = [148, 163, 184];
    else if (roundRect(u, v, 0.33, 0.6, 0.67, 0.76, 0.02) <= 0) col = [22, 163, 74];
  }
  // Home indicator
  if (roundRect(u, v, 0.42, 0.87, 0.58, 0.9, 0.015) <= 0) col = [255, 255, 255];
  return col;
}

for (const size of [16, 32, 48, 128]) {
  const S = 4; // supersampling
  const buf = png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = shade((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    if (!a) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (S * S)) * 255)];
  });
  writeFileSync(new URL(`icon${size}.png`, OUT), buf);
  console.log(`icon${size}.png`);
}
