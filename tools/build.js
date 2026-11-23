#!/usr/bin/env node
/*
 * Bouwt de app:
 *   dist/Registratie/index.html   ← volledig zelfstandig (CSS, JS en QR-bibliotheek inline)
 *   dist/Registratie/{manifest.json, sw.js, icon-*.png}  ← alleen nodig bij https-hosting (PWA)
 *   dist/Registratie.zip
 * Geen externe dependencies nodig.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT_NAME = 'Registratie';
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, OUT_NAME);
const VERSION = require(path.join(ROOT, 'package.json')).version;
// Reproduceerbaar: vaste datum in de zip (of SOURCE_DATE_EPOCH), niet 'nu' of de commitdatum –
// anders verandert de zip-hash zodra de SBOM zelf gecommit wordt.
const BUILD_DATE = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000) : new Date(2026, 0, 1);

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/* ---------- index.html met alles inline ---------- */
function buildHtml() {
  let html = read('index.html');
  const scriptHashes = [];
  html = html.replace(/<!-- @inline ([\w./-]+) -->/g, (_, file) => {
    const content = read(file);
    if (file.endsWith('.css')) return `<style>\n${content}\n</style>`;
    // Voorkom dat inline JS de <script>-tag voortijdig afsluit.
    const body = `\n${content.replace(/<\/script/gi, '<\\/script')}\n`;
    scriptHashes.push(`'sha256-${require('crypto').createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    return `<script>${body}</script>`;
  });
  // CSP: alleen exact deze scripts mogen draaien (hash), geen 'unsafe-inline' voor scripts.
  if (!html.includes("script-src 'unsafe-inline'")) throw new Error('CSP-placeholder script-src ontbreekt in src/index.html');
  html = html.replace("script-src 'unsafe-inline'", 'script-src ' + scriptHashes.join(' '));
  return html.replace('<head>', `<head>\n<!-- Registratie v${VERSION} -->`);
}

/* ---------- PNG-iconen (zonder dependencies) ---------- */
function png(width, height, rgbaAt) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaAt(x, y);
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

function icon(size) {
  // QR-achtig symbool, binnen de "maskable" veilige zone (midden 60%).
  const N = 21;
  const modules = new Set();
  const finder = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const ring = x === 0 || y === 0 || x === 6 || y === 6;
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (ring || core) modules.add((oy + y) * N + ox + x);
    }
  };
  finder(0, 0); finder(14, 0); finder(0, 14);
  let seed = 7;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inFinder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    if (!inFinder && (seed >> 16) % 2 === 0) modules.add(y * N + x);
  }
  const area = size * 0.58, start = (size - area) / 2, m = area / N;
  const pad = m * 1.2;
  return png(size, size, (x, y) => {
    const blue = [0x0b, 0x3d, 0x91, 255], white = [255, 255, 255, 255], dark = [0x0d, 0x11, 0x17, 255];
    if (x < start - pad || y < start - pad || x >= start + area + pad || y >= start + area + pad) return blue;
    const mx = Math.floor((x - start) / m), my = Math.floor((y - start) / m);
    if (mx < 0 || my < 0 || mx >= N || my >= N) return white;
    return modules.has(my * N + mx) ? dark : white;
  });
}

/* ---------- Minimale ZIP-schrijver (deflate) ---------- */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const d = BUILD_DATE; // vaste datum → reproduceerbare zip
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/* ---------- Bouwen ---------- */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Cache-versie van de service worker volgt de inhoud: nieuwe inhoud → nieuwe cache.
const html = buildHtml();
const htmlHash = require('crypto').createHash('sha256').update(html).digest('hex').slice(0, 12);

const files = {
  'index.html': Buffer.from(html, 'utf8'),
  'manifest.json': Buffer.from(read('manifest.json'), 'utf8'),
  'sw.js': Buffer.from(read('sw.js').replace('__VERSION__', VERSION + '-' + htmlHash), 'utf8'),
  'icon-192.png': icon(192),
  'icon-512.png': icon(512),
  'LEESMIJ.txt': Buffer.from(fs.readFileSync(path.join(ROOT, 'LEESMIJ.txt'), 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8'),
  'jsQR-LICENSE.txt': Buffer.from(read('vendor/jsQR-LICENSE.txt'), 'utf8')
};

for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), data);
const zipPath = path.join(DIST, OUT_NAME + '.zip');
fs.writeFileSync(zipPath, zip(Object.entries(files).map(([name, data]) => ({ name: OUT_NAME + '/' + name, data }))));

console.log('Gebouwd:', path.relative(ROOT, OUT));
console.log('ZIP:    ', path.relative(ROOT, zipPath), `(${Math.round(fs.statSync(zipPath).size / 1024)} kB)`);
