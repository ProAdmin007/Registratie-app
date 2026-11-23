'use strict';
/*
 * End-to-end test van de gebouwde app (dist/) in echte Chrome (headless).
 * Vereist: `npm run build` en een lokale Chrome/Edge. Wordt overgeslagen als die ontbreken.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const APP_DIR = path.resolve(__dirname, '../dist/Registratie');
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const browserPath = BROWSERS.find(p => fs.existsSync(p));

let puppeteer, QRCode;
try { puppeteer = require('puppeteer-core'); QRCode = require('qrcode'); } catch (e) { /* skip */ }
const skip = !puppeteer ? 'puppeteer-core niet geïnstalleerd' :
  !browserPath ? 'geen Chrome/Edge gevonden' :
  !fs.existsSync(path.join(APP_DIR, 'index.html')) ? 'eerst `npm run build`' : false;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-e2e-'));
const MOBILE = { width: 412, height: 860, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/* ---------- Hulpjes ---------- */
// Y4M-video met een QR-code als nep-camera voor Chrome.
function qrY4m(text, file) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, W = 640, H = 480, mod = 10, quiet = 4;
  const side = (n + quiet * 2) * mod, ox = (W - side) / 2, oy = (H - side) / 2;
  const Y = Buffer.alloc(W * H, 200);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const mx = Math.floor((x - ox) / mod) - quiet, my = Math.floor((y - oy) / mod) - quiet;
    if (x >= ox && y >= oy && x < ox + side && y < oy + side) {
      Y[y * W + x] = (mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx)) ? 16 : 235;
    }
  }
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
}

function serve(dir) {
  return new Promise(resolve => {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/manifest+json', '.png': 'image/png' };
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const f = p.endsWith(path.sep) ? path.join(p, 'index.html') : p;
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function launch(extraArgs = []) {
  return puppeteer.launch({
    executablePath: browserPath, headless: true,
    args: ['--no-first-run', '--no-default-browser-check', ...extraArgs]
  });
}

async function newPage(browser, url, { init } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Elke Content-Security-Policy-overtreding laat de test falen.
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) errors.push('CSP: ' + m.text()); });
  await page.setViewport(MOBILE);
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(url, { waitUntil: 'load' });
  page.errors = errors;
  return page;
}

const visible = (page, sel) => page.$eval(sel, el => !el.hidden && el.offsetParent !== null).catch(() => false);
const text = (page, sel) => page.$eval(sel, el => el.textContent.trim());
const count = async page => Number(await text(page, '#count'));

async function manualAdd(page, qr, loc) {
  await page.click('#btnManual');
  await page.waitForSelector('#qrInput:not([hidden])');
  await page.type('#qrInput', qr);
  await page.type('#locationInput', loc);
  await page.keyboard.press('Enter');
}
async function dialogOpen(page) { return page.$eval('#dlg', d => d.open); }
async function dialogClick(page, which) {
  await page.waitForFunction(() => document.getElementById('dlg').open);
  await page.click(which === 'ok' ? '#dlgOk' : '#dlgCancel');
  await page.waitForFunction(() => !document.getElementById('dlg').open);
}

/* ---------- Tests ---------- */
test('lokaal geopend bestand (file://): volledige handmatige workflow', { skip }, async () => {
  const browser = await launch();
  try {
    const url = pathToFileURL(path.join(APP_DIR, 'index.html')).href;
    const page = await newPage(browser, url);
    assert.equal(await text(page, 'h1'), 'Registratie');
    assert.equal(await count(page), 0);

    // Toevoegen-knop pas actief met locatie
    await page.click('#btnManual');
    await page.type('#qrInput', 'ABC123');
    assert.equal(await page.$eval('#btnAdd', b => b.disabled), true);
    await page.type('#locationInput', 'Assen Noord');
    assert.equal(await page.$eval('#btnAdd', b => b.disabled), false);
    await page.click('#btnAdd');
    await page.waitForFunction(() => document.getElementById('count').textContent === '1');
    assert.equal(await visible(page, '#entry'), false, 'invoer leeg/verborgen na toevoegen');

    await manualAdd(page, 'DEF456', 'Hoofdstraat 12, "Assen"');
    await page.waitForFunction(() => document.getElementById('count').textContent === '2');

    // Dubbele QR → waarschuwing met bestaande locatie; Annuleren voegt niets toe
    await manualAdd(page, 'ABC123', 'Ergens');
    await page.waitForFunction(() => document.getElementById('dlg').open);
    assert.match(await text(page, '#dlgBody'), /ABC123[\s\S]*Assen Noord/);
    await dialogClick(page, 'cancel');
    assert.equal(await count(page), 2);
    // Toch toevoegen
    await page.click('#btnAdd');
    await dialogClick(page, 'ok');
    await page.waitForFunction(() => document.getElementById('count').textContent === '3');

    // Herladen → gegevens blijven bestaan (localStorage)
    await page.reload({ waitUntil: 'load' });
    assert.equal(await count(page), 3);

    // Bewerken
    const lis = await page.$$('#list li');
    await (await lis[2].$('button[data-act=edit]')).click();
    const loc = await page.waitForSelector('#list .edit-loc');
    await loc.evaluate(e => { e.value = ''; });
    await loc.type('Beilen');
    await page.click('#list button[data-act=save]');
    await page.waitForFunction(() => document.querySelectorAll('#list li')[2].querySelector('.rec-loc-text')?.textContent === 'Beilen');
    // Bewerken naar bestaande QR → dubbel-waarschuwing
    await (await (await page.$$('#list li'))[2].$('button[data-act=edit]')).click();
    const q = await page.waitForSelector('#list .edit-qr');
    await q.evaluate(e => { e.value = ''; }); await q.type('DEF456');
    await page.click('#list button[data-act=save]');
    await dialogClick(page, 'cancel');
    await page.click('#list button[data-act=cancel]');

    // Verwijderen (met bevestiging)
    await (await (await page.$$('#list li'))[2].$('button[data-act=delete]')).click();
    await dialogClick(page, 'ok');
    await page.waitForFunction(() => document.getElementById('count').textContent === '2');

    // CSV maken → download in map
    const dl = fs.mkdtempSync(path.join(TMP, 'dl-'));
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    const before = new Date();
    await page.click('#btnExport');
    await page.waitForSelector('#exportResult:not([hidden])');
    const name = await text(page, '#exportName');
    assert.match(name, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_registratie\.csv$/);
    const p2 = n => String(n).padStart(2, '0');
    assert.ok(name.startsWith(`${before.getFullYear()}-${p2(before.getMonth() + 1)}-${p2(before.getDate())}_`), 'lokale datum');
    const file = path.join(dl, name);
    for (let i = 0; i < 50 && !fs.existsSync(file); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(fs.existsSync(file), 'CSV gedownload');
    const bytes = fs.readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
    const lines = bytes.toString('utf8').slice(1).split('\r\n');
    assert.equal(lines[0], 'QR-code,Locatie,Datum,Tijd');
    assert.match(lines[1], /^ABC123,Assen Noord,\d{2}-\d{2}-\d{4},\d{2}:\d{2}:\d{2}$/);
    assert.match(lines[2], /^DEF456,"Hoofdstraat 12, ""Assen""",/);

    // Wijziging na export → CSV moet opnieuw gemaakt worden
    await manualAdd(page, 'XYZ789', 'Beilen');
    await page.waitForFunction(() => document.getElementById('exportResult').hidden);

    // Nieuwe scanronde: annuleren houdt data, bevestigen wist
    await page.click('#btnNewRound'); await dialogClick(page, 'cancel');
    assert.equal(await count(page), 3);
    await page.click('#btnNewRound'); await dialogClick(page, 'ok');
    await page.waitForFunction(() => document.getElementById('count').textContent === '0');
    await page.reload({ waitUntil: 'load' });
    assert.equal(await count(page), 0);

    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); }
});

test('Web Share API: CSV als bestand gedeeld met onderwerp en tekst', { skip }, async () => {
  const browser = await launch();
  try {
    const url = pathToFileURL(path.join(APP_DIR, 'index.html')).href;
    const page = await newPage(browser, url, {
      init: () => {
        localStorage.clear();
        window.__shared = null;
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: d => !!(d && d.files && d.files.every(f => f.type === 'text/csv')) });
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async d => { window.__shared = { title: d.title, text: d.text, files: await Promise.all(d.files.map(async f => ({ name: f.name, type: f.type, body: await f.text(), bytes: [...new Uint8Array(await f.arrayBuffer()).slice(0, 3)] }))) }; }
        });
      }
    });
    assert.doesNotMatch(await text(page, '#banner'), /bijlage/, 'geen melding over bijlage nodig');
    await manualAdd(page, 'CODE-123456', 'Hoofdstraat 12 Assen');
    await page.click('#btnExport');
    await page.waitForSelector('#exportResult:not([hidden])');
    assert.equal(await visible(page, '#shareHint'), false);
    await page.click('#btnShare');
    await page.waitForFunction(() => window.__shared);
    const s = await page.evaluate(() => window.__shared);
    const name = await text(page, '#exportName');
    assert.match(s.title, /^\d{4}-\d{2}-\d{2} registratie$/);
    assert.equal(s.title, name.slice(0, 10) + ' registratie');
    assert.equal(s.text, 'Zie bijgevoegd het overzicht van de registraties.');
    assert.equal(s.files.length, 1);
    assert.equal(s.files[0].name, name);
    assert.equal(s.files[0].type, 'text/csv');
    assert.deepEqual(s.files[0].bytes, [0xef, 0xbb, 0xbf]);
    assert.ok(s.files[0].body.includes('CODE-123456,Hoofdstraat 12 Assen'));
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); }
});

test('Fallback zonder bestanden delen: uitleg + mailto met onderwerp en gegevens', { skip }, async () => {
  const browser = await launch();
  try {
    const url = pathToFileURL(path.join(APP_DIR, 'index.html')).href;
    const page = await newPage(browser, url, {
      init: () => {
        localStorage.clear();
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      }
    });
    await page.evaluate(() => { window.RegApp.openUrl = u => { window.__opened = u; }; });
    assert.equal(await visible(page, '#banner'), true);
    assert.match(await text(page, '#banner'), /bijlage/);
    await manualAdd(page, 'Q1', 'Café "De Brink", Assen');
    await page.click('#btnExport');
    await page.waitForSelector('#exportResult:not([hidden])');
    assert.equal(await visible(page, '#shareHint'), true);
    await page.click('#btnShare');
    await page.waitForFunction(() => document.getElementById('dlg').open);
    assert.match(await text(page, '#dlgBody'), /Downloads/);
    await dialogClick(page, 'ok');
    await page.waitForFunction(() => window.__opened);
    const mail = await page.evaluate(() => window.__opened);
    const name = await text(page, '#exportName');
    assert.ok(mail.startsWith('mailto:?subject=' + encodeURIComponent(name.slice(0, 10) + ' registratie') + '&body='));
    const body = decodeURIComponent(mail.split('&body=')[1]);
    assert.ok(body.startsWith('Zie bijgevoegd het overzicht van de registraties.'));
    assert.ok(body.includes('Q1,"Café ""De Brink"", Assen"'));
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); }
});

test('QR scannen via foto (fallback zonder live camera) met jsQR', { skip }, async () => {
  const browser = await launch();
  try {
    const url = pathToFileURL(path.join(APP_DIR, 'index.html')).href;
    const page = await newPage(browser, url, {
      init: () => {
        localStorage.clear();
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
        if ('BarcodeDetector' in window) delete window.BarcodeDetector;
      }
    });
    assert.match(await text(page, '#banner'), /foto/);
    const png = path.join(TMP, 'qr.png');
    // Foto-achtig: groot, met marge en grijze achtergrond
    await QRCode.toFile(png, 'CODE-FOTO-42', { width: 1800, margin: 8, color: { dark: '#111111', light: '#dddddd' } });
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#btnScan')]);
    await chooser.accept([png]);
    await page.waitForSelector('#entry:not([hidden])');
    assert.equal(await text(page, '#qrValue'), 'CODE-FOTO-42');
    await page.waitForFunction(() => document.activeElement.id === 'locationInput', { timeout: 3000 }); // locatie krijgt focus

    // Onleesbare foto → duidelijke foutmelding, geen crash
    await page.click('#btnCancelEntry');
    const blank = path.join(TMP, 'blank.png');
    fs.writeFileSync(blank, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const [c2] = await Promise.all([page.waitForFileChooser(), page.click('#btnScan')]);
    await c2.accept([blank]);
    await page.waitForFunction(() => /niet leesbaar/.test(document.getElementById('status').textContent));
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); }
});

test('Live camera scannen (https/localhost), stopt na scan, dubbel-waarschuwing, PWA offline', { skip }, async () => {
  const y4m = path.join(TMP, 'qr.y4m');
  qrY4m('CODE-LIVE-1', y4m);
  const srv = await serve(APP_DIR);
  const browser = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`]);
  try {
    const url = `http://localhost:${srv.address().port}/index.html`;
    const page = await newPage(browser, url, { init: () => { if (!sessionStorage.getItem('init')) { localStorage.clear(); sessionStorage.setItem('init', '1'); } } });
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    await page.click('#btnScan');
    await page.waitForSelector('#entry:not([hidden])', { timeout: 15000 });
    assert.equal(await text(page, '#qrValue'), 'CODE-LIVE-1');
    assert.equal(await visible(page, '#scanner'), false, 'scanner gestopt');
    assert.equal(await page.evaluate(() => document.getElementById('video').srcObject), null, 'camera vrijgegeven');
    await page.type('#locationInput', 'Assen');
    await page.click('#btnAdd');
    await page.waitForFunction(() => document.getElementById('count').textContent === '1');

    // Dezelfde code nogmaals scannen → waarschuwing direct na scan
    await page.click('#btnScan');
    await page.waitForFunction(() => document.getElementById('dlg').open, { timeout: 15000 });
    assert.match(await text(page, '#dlgBody'), /CODE-LIVE-1[\s\S]*Assen/);
    await dialogClick(page, 'cancel');
    assert.equal(await visible(page, '#entry'), false);
    assert.equal(await count(page), 1);

    // Service worker + offline
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), { timeout: 10000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' }); // nu onder controle van de SW
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'SW actief');
    assert.ok(await page.$('link[rel=manifest]'), 'manifest gekoppeld');
    srv.close();
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    assert.equal(await text(page, 'h1'), 'Registratie');
    assert.equal(await count(page), 1, 'gegevens ook offline aanwezig');
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); srv.close(); }
});

test('Camera geweigerd → automatisch foto-modus', { skip }, async () => {
  const srv = await serve(APP_DIR);
  const browser = await launch();
  try {
    const page = await newPage(browser, `http://localhost:${srv.address().port}/index.html`, {
      init: () => {
        window.__gum = 0;
        navigator.mediaDevices.getUserMedia = () => { window.__gum++; return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); };
      }
    });
    page.on('filechooser', c => c.cancel().catch(() => {})); // automatisch geopende camera-app negeren
    await page.click('#btnScan');
    await page.waitForFunction(() => /niet toegestaan/.test(document.getElementById('status').textContent));
    assert.match(await text(page, '#banner'), /foto/);
    // Volgende tik: direct de camera-app, zonder opnieuw live camera te proberen
    page.removeAllListeners('filechooser');
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('#btnScan')]);
    await chooser.cancel();
    assert.equal(await page.evaluate(() => window.__gum), 1);
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); srv.close(); }
});

test('Geen camera gevonden → duidelijke melding', { skip }, async () => {
  const srv = await serve(APP_DIR);
  const browser = await launch();
  try {
    const page = await newPage(browser, `http://localhost:${srv.address().port}/index.html`, {
      init: () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })); }
    });
    await page.click('#btnScan');
    await page.waitForFunction(() => /Geen camera gevonden/.test(document.getElementById('status').textContent));
    assert.equal(await visible(page, '#btnPhoto'), true);
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); srv.close(); }
});

test('Lokaal bestand met camera aanwezig → Scan opent direct de camera-app', { skip }, async () => {
  const browser = await launch();
  try {
    const page = await newPage(browser, pathToFileURL(path.join(APP_DIR, 'index.html')).href, {
      init: () => { window.__gum = 0; if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__gum++; return new Promise(() => {}); }; }
    });
    assert.match(await text(page, '#banner'), /camera-app/);
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('#btnScan')]);
    await chooser.cancel();
    assert.equal(await page.evaluate(() => window.__gum), 0, 'geen live camera geprobeerd');
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); }
});
