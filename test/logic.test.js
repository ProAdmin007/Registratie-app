'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

const D = new Date(2026, 10, 19, 14, 35, 7); // 19-11-2026 14:35:07 lokale tijd

test('datum, tijd, bestandsnaam en onderwerp', () => {
  assert.equal(L.formatDate(D), '19-11-2026');
  assert.equal(L.formatTime(D), '14:35:07');
  assert.equal(L.csvFilename(D), '2026-11-19_14-35_registratie.csv');
  assert.equal(L.mailSubject(D), '2026-11-19 registratie');
  const early = new Date(2027, 0, 3, 4, 5, 6);
  assert.equal(L.csvFilename(early), '2027-01-03_04-05_registratie.csv');
  assert.equal(L.formatDate(early), '03-01-2027');
  assert.equal(L.formatTime(early), '04:05:06');
});

test('CSV escaping', () => {
  assert.equal(L.csvField('ABC123'), 'ABC123');
  assert.equal(L.csvField('Hoofdstraat 12, Assen'), '"Hoofdstraat 12, Assen"');
  assert.equal(L.csvField('Kast "Noord"'), '"Kast ""Noord"""');
  assert.equal(L.csvField('regel1\nregel2'), '"regel1\nregel2"');
  assert.equal(L.csvField('a;b'), '"a;b"');
  assert.equal(L.csvField(' spatie'), '" spatie"');
  assert.equal(L.csvField('Café Ëlst – ß'), 'Café Ëlst – ß');
  assert.equal(L.csvField(null), '');
  assert.equal(L.csvField(42), '42');
});

test('CSV: bescherming tegen formule-injectie (Excel)', () => {
  assert.equal(L.csvField('=HYPERLINK("http://x","klik")'), '"\'=HYPERLINK(""http://x"",""klik"")"');
  assert.equal(L.csvField('+31 6 1234'), "'+31 6 1234");
  assert.equal(L.csvField('-2+3'), "'-2+3");
  assert.equal(L.csvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(L.csvField('\t=1'), "'\t=1");
  assert.equal(L.csvField('A=1'), 'A=1', 'alleen het eerste teken telt');
  assert.equal(L.csvField('ABC-123'), 'ABC-123');
  const csv = L.buildCsv([L.createRecord('=cmd|calc', 'Assen', D)]);
  assert.ok(csv.includes("\r\n'=cmd|calc,Assen,"));
});

test('CSV opbouw: BOM, kop, CRLF, UTF-8', () => {
  const recs = [
    L.createRecord('CODE-123456', 'Hoofdstraat 12 Assen', D),
    L.createRecord('X"Y', 'Café, "De Brink"', D)
  ];
  const csv = L.buildCsv(recs);
  assert.ok(csv.startsWith('﻿'), 'begint met BOM');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'QR-code,Locatie,Datum,Tijd,Breedtegraad,Lengtegraad,Nauwkeurigheid (m)');
  assert.equal(lines[1], 'CODE-123456,Hoofdstraat 12 Assen,19-11-2026,14:35:07,,,');
  assert.equal(lines[2], '"X""Y","Café, ""De Brink""",19-11-2026,14:35:07,,,');
  assert.equal(lines[3], '');

  const bytes = Buffer.from(csv, 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM bytes');
  assert.ok(bytes.includes(Buffer.from('Café', 'utf8')));
});

test('GPS in record en CSV', () => {
  const r = L.createRecord('Q1', 'Assen', D, { lat: 52.99301234, lon: 6.56491234, acc: 4.4, ts: 1 });
  assert.deepEqual(r.gps, { lat: 52.99301234, lon: 6.56491234, acc: 4.4, ts: 1 });
  const lines = L.buildCsv([r]).slice(1).split('\r\n');
  assert.equal(lines[1], 'Q1,Assen,19-11-2026,14:35:07,52.993012,6.564912,4');
  // Zuid/west: negatieve getallen blijven gewone getallen (geen formule-apostrof)
  const sw = L.createRecord('Q2', 'Londen-west', D, { lat: -33.8688197, lon: -0.1275862, acc: 12.6, ts: 1 });
  assert.equal(L.buildCsv([sw]).slice(1).split('\r\n')[1], 'Q2,Londen-west,19-11-2026,14:35:07,-33.868820,-0.127586,13');
  assert.equal(L.formatGps(r.gps), '52.993012, 6.564912 (±4 m)');
  assert.equal(L.createRecord('Q3', 'x', D).gps, null);
  assert.equal(L.csvField('-1.5'), '-1.5');
  assert.equal(L.csvField('-1+1'), "'-1+1");
});

test('GPS: validatie en keuze van de beste meting', () => {
  assert.equal(L.validGps({ lat: 91, lon: 0, acc: 1 }), false);
  assert.equal(L.validGps({ lat: 0, lon: 181, acc: 1 }), false);
  assert.equal(L.validGps({ lat: NaN, lon: 0, acc: 1 }), false);
  assert.equal(L.validGps({ lat: 0, lon: 0, acc: -1 }), false);
  assert.equal(L.validGps(null), false);
  assert.equal(L.fixFromPosition({ coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 9 }).ts, 9);
  assert.equal(L.fixFromPosition({}), null);
  const a = { lat: 1, lon: 1, acc: 30, ts: 100 }, b = { lat: 1, lon: 1, acc: 5, ts: 200 }, c = { lat: 1, lon: 1, acc: 50, ts: 300 };
  assert.equal(L.betterFix(null, a, 0), a);
  assert.equal(L.betterFix(a, b, 0), b, 'nauwkeuriger wint');
  assert.equal(L.betterFix(b, c, 0), b, 'minder nauwkeurig verliest');
  assert.equal(L.betterFix(null, a, 150), null, 'meting van vóór de scan telt niet');
  const b2 = { lat: 2, lon: 2, acc: 5, ts: 400 };
  assert.equal(L.betterFix(b, b2, 0), b2, 'gelijk → nieuwste');
  assert.equal(L.betterFix(b, { lat: 999, lon: 0, acc: 1, ts: 500 }, 0), b, 'ongeldig genegeerd');
});

test('GPS overleeft opslaan/laden; ongeldige GPS wordt null', () => {
  const s = L.sanitizeState({
    records: [{ id: '1', qr: 'A', location: 'B', gps: { lat: 52, lon: 6, acc: 3, ts: 5 } }, { id: '2', qr: 'C', location: 'D', gps: { lat: 'x' } }],
    pending: { qr: 'P', gps: { lat: 52.1, lon: 6.1, acc: 8, ts: 7 }, gpsSince: 6 }
  });
  assert.deepEqual(s.records[0].gps, { lat: 52, lon: 6, acc: 3, ts: 5 });
  assert.equal(s.records[1].gps, null);
  assert.equal(s.pending.gps.acc, 8);
  assert.equal(s.pending.gpsSince, 6);
});

test('CSV als Blob (zoals in de browser) houdt BOM en UTF-8', async () => {
  const csv = L.buildCsv([L.createRecord('Q', 'Één', D)]);
  const buf = Buffer.from(await new Blob([csv], { type: 'text/csv;charset=utf-8' }).arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(buf.toString('utf8').includes('Één'));
});

test('CSV round-trip met een eenvoudige RFC 4180-parser', () => {
  const tricky = ['a,b', 'q"uote', 'nieuw\nregel', 'ü ö ä', '  trim  '];
  const recs = tricky.map((loc, i) => L.createRecord('QR' + i, loc, D));
  // createRecord trimt locaties
  const expected = tricky.map(s => s.trim());
  const rows = parseCsv(L.buildCsv(recs).slice(1));
  assert.deepEqual(rows[0], L.HEADERS);
  rows.slice(1).forEach((r, i) => assert.equal(r[1], expected[i]));
});

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; }
    else f += c;
  }
  return rows;
}

test('dubbele QR-detectie', () => {
  const recs = [L.createRecord('ABC123', 'Assen Noord', D), L.createRecord('DEF456', 'Assen Zuid', D)];
  assert.equal(L.findDuplicate(recs, 'ABC123').location, 'Assen Noord');
  assert.equal(L.findDuplicate(recs, '  ABC123 ').location, 'Assen Noord', 'witruimte telt niet mee');
  assert.equal(L.findDuplicate(recs, 'abc123'), null, 'exact: hoofdlettergevoelig');
  assert.equal(L.findDuplicate(recs, 'XYZ'), null);
  assert.equal(L.findDuplicate(recs, ''), null);
  assert.equal(L.findDuplicate(recs, 'ABC123', recs[0].id), null, 'eigen record negeren bij bewerken');
});

test('records krijgen unieke ids, ook binnen dezelfde milliseconde', () => {
  const ids = new Set(Array.from({ length: 500 }, () => L.createRecord('x', 'y', D).id));
  assert.equal(ids.size, 500);
});

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m
  };
}

test('persistentie: opslaan en opnieuw laden (herladen pagina)', () => {
  const storage = memStorage();
  const s1 = L.createStore(storage);
  assert.equal(s1.persistent, true);
  const state = L.emptyState();
  state.records.push(L.createRecord('ABC', 'Beilen', D));
  state.pending = { qr: 'DEF', location: 'half getyp', allowDuplicate: false, manual: false };
  assert.equal(s1.save(state), true);

  const s2 = L.createStore(storage); // "nieuwe pagina"
  const loaded = s2.load();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0].location, 'Beilen');
  assert.equal(loaded.pending.qr, 'DEF');
  assert.equal(loaded.pending.location, 'half getyp');
});

test('persistentie: beschadigde data → lege staat + backup', () => {
  const storage = memStorage();
  storage.setItem(L.STORAGE_KEY, '{kapot');
  const st = L.createStore(storage).load();
  assert.deepEqual(st, L.emptyState());
  assert.ok([...storage._map.keys()].some(k => k.includes(':corrupt:')));
});

test('persistentie: geen/geblokkeerde storage → werkt in geheugen zonder crash', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} };
  for (const s of [null, undefined, blocked]) {
    const st = L.createStore(s);
    assert.equal(st.persistent, false);
    assert.deepEqual(st.load(), L.emptyState());
    assert.equal(st.save(L.emptyState()), false);
  }
});

test('persistentie: opslag vol → save geeft false', () => {
  const storage = memStorage();
  const st = L.createStore(storage);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(st.save(L.emptyState()), false);
});

test('sanitizeState filtert ongeldige records', () => {
  const s = L.sanitizeState({ records: [{ id: '1', qr: 'A', location: 'B' }, { qr: 5 }, null], pending: { qr: 1 } });
  assert.equal(s.records.length, 1);
  assert.equal(s.pending, null);
});

test('Web Share detectie', () => {
  const file = new File(['x'], 'a.csv', { type: 'text/csv' });
  assert.equal(L.canShareFiles({ share() {}, canShare: o => o.files.length === 1 }, file), true);
  assert.equal(L.canShareFiles({ share() {}, canShare: () => false }, file), false);
  assert.equal(L.canShareFiles({ share() {} }, file), false, 'geen canShare');
  assert.equal(L.canShareFiles({}, file), false);
  assert.equal(L.canShareFiles({ share() {}, canShare() { throw new TypeError(); } }, file), false);
  assert.equal(L.canShareFiles(undefined, file), false);
});

test('mailto-fallback: onderwerp, tekst en gegevens', () => {
  const csv = L.buildCsv([L.createRecord('ABC', 'Assen & Co', D)]);
  const body = L.fallbackMailBody('f.csv', csv);
  assert.ok(body.startsWith(L.MAIL_BODY));
  assert.ok(!body.includes('﻿'), 'geen BOM in mailtekst');
  assert.ok(body.includes('ABC,Assen & Co'));
  const url = L.buildMailto('2026-11-19 registratie', body);
  assert.ok(url.startsWith('mailto:?subject=2026-11-19%20registratie&body='));
  assert.ok(url.includes('%26'), '& is ge-encodeerd');
  assert.equal(decodeURIComponent(url.split('&body=')[1]), body);
  const long = L.fallbackMailBody('f.csv', 'x'.repeat(10000), 100);
  assert.ok(long.length < 400 && long.includes('ingekort'));
});

test('jsQR-wrapper', () => {
  const img = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  assert.equal(L.decodeWithJsQR(() => ({ data: 'CODE-1' }), img), 'CODE-1');
  assert.equal(L.decodeWithJsQR(() => null, img), null);
  assert.equal(L.decodeWithJsQR(() => ({ data: '   ' }), img), null);
  assert.equal(L.decodeWithJsQR(undefined, img), null);
  let opts; L.decodeWithJsQR((d, w, h, o) => { opts = o; return null; }, img, true);
  assert.equal(opts.inversionAttempts, 'attemptBoth');
});
