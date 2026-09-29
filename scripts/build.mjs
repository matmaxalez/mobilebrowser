// Packs extension/ into dist/mobile-emulator-v<version>.zip (Chrome Web Store
// upload / manual install). Dependency-free ZIP writer.
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'extension');
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const out = join(root, 'dist', `mobile-emulator-v${manifest.version}.zip`);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function walk(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const p = join(dir, name);
    if (name.startsWith('.')) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const local = [];
const central = [];
let offset = 0;
// Fixed timestamp keeps builds reproducible (2026-01-01 00:00).
const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

for (const file of walk(src)) {
  const name = Buffer.from(relative(src, file).split(sep).join('/'));
  const data = readFileSync(file);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
  head.writeUInt16LE(8, 8); head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12);
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
  local.push(head, name, comp);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10); cen.writeUInt16LE(dosTime, 12);
  cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20);
  cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += head.length + name.length + comp.length;
}

const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(out, Buffer.concat([...local, cenBuf, end]));
console.log(`${relative(root, out)} (${central.length / 2} files)`);
