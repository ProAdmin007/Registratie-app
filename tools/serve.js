#!/usr/bin/env node
/*
 * Testserver voor de gebouwde app (dist/Registratie).
 *   http://localhost:8080        → op deze server zelf (camera/PWA toegestaan via localhost)
 *   https://<server-ip>:8443     → vanaf een telefoon in hetzelfde netwerk (camera vereist https)
 * Het https-certificaat is self-signed en wordt aangemaakt met openssl (zit bij Git for Windows).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'dist', 'Registratie');
const CERT_DIR = path.join(ROOT, '.cert');
const CERT_CN = 'Registratie test';
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);

if (!fs.existsSync(path.join(DIR, 'index.html'))) {
  console.error('dist/ ontbreekt. Draai eerst: npm run build');
  process.exit(1);
}

const ips = Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip'
};

function handler(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/' ) rel = '/index.html';
  // De zip zelf ook aanbieden, handig om op de telefoon te downloaden.
  const file = rel === '/Registratie.zip' ? path.join(ROOT, 'dist', 'Registratie.zip') : path.join(DIR, rel);
  if (!file.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Niet gevonden');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  console.log(new Date().toLocaleTimeString('nl-NL'), req.socket.remoteAddress, req.method, rel);
}

function findOpenssl() {
  const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'ignore' }); return c; } catch (e) { /* volgende */ }
  }
  return null;
}

function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem'), crt = path.join(CERT_DIR, 'cert.pem'), stamp = path.join(CERT_DIR, 'ips.txt');
  const want = ['127.0.0.1', ...ips].join(',');
  const stampValue = CERT_CN + '|' + want; // nieuw certificaat bij andere naam of IP-adressen
  if (fs.existsSync(key) && fs.existsSync(crt) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === stampValue) {
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  }
  const openssl = findOpenssl();
  if (!openssl) return null;
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const san = ['DNS:localhost', ...want.split(',').map(ip => 'IP:' + ip)].join(',');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
    '-keyout', key, '-out', crt, '-subj', '/CN=' + CERT_CN, '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
  fs.writeFileSync(stamp, stampValue);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

module.exports = { ensureCert };
if (require.main !== module) return;

http.createServer(handler).listen(HTTP_PORT, '127.0.0.1', () => { // alleen lokaal
  console.log(`\nOp deze server:   http://localhost:${HTTP_PORT}`);
});

const tls = ensureCert();
if (tls) {
  https.createServer(tls, handler).listen(HTTPS_PORT, () => {
    console.log('Vanaf telefoon:   ' + ips.map(ip => `https://${ip}:${HTTPS_PORT}`).join('\n                  '));
    console.log(`Zip downloaden:   https://<ip>:${HTTPS_PORT}/Registratie.zip`);
    console.log('\nLet op: het certificaat is self-signed. Kies op de telefoon "Geavanceerd" > "Doorgaan naar ...".');
    console.log('Stoppen: Ctrl+C\n');
  });
} else {
  console.log('openssl niet gevonden: alleen http beschikbaar (camera werkt dan niet vanaf een telefoon).');
}
