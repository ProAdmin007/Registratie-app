/*
 * Registratie – pure logica (geen DOM).
 * Wordt zowel in de browser (window.RegLogic) als in Node-tests (module.exports) gebruikt.
 */
(function (root) {
  'use strict';

  var DELIMITER = ',';
  var BOM = '﻿';
  var HEADERS = ['QR-code', 'Locatie', 'Datum', 'Tijd'];
  var STORAGE_KEY = 'registratie:v1';
  var MAIL_BODY = 'Zie bijgevoegd het overzicht van de registraties.';

  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------- Datum / tijd / namen (altijd lokale tijd van het toestel) ---------- */
  function formatDate(d) { return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear(); }
  function formatTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function csvFilename(d) {
    return isoDate(d) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '_registratie.csv';
  }
  function mailSubject(d) { return isoDate(d) + ' registratie'; }

  /* ---------- CSV ---------- */
  function csvField(value) {
    var s = value == null ? '' : String(value);
    // Beveiliging tegen CSV/formule-injectie (OWASP): een waarde die begint met = + - @ tab of CR
    // zou Excel als formule uitvoeren (bijv. een gemanipuleerde QR-code "=HYPERLINK(...)").
    // Een voorloop-apostrof laat Excel de waarde als tekst tonen.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    // Quote bij scheidingstekens (ook ; zodat wisselen van delimiter veilig blijft),
    // aanhalingstekens, regeleinden en spaties aan begin/eind.
    if (/[",;\r\n]/.test(s) || /^\s|\s$/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsv(records) {
    var lines = [HEADERS.map(csvField).join(DELIMITER)];
    (records || []).forEach(function (r) {
      lines.push([r.qr, r.location, r.date, r.time].map(csvField).join(DELIMITER));
    });
    return BOM + lines.join('\r\n') + '\r\n';
  }

  /* ---------- Records ---------- */
  function normalizeQr(s) { return String(s == null ? '' : s).trim(); }

  function findDuplicate(records, qr, ignoreId) {
    var q = normalizeQr(qr);
    if (!q) return null;
    for (var i = 0; i < (records || []).length; i++) {
      var r = records[i];
      if (r.id !== ignoreId && normalizeQr(r.qr) === q) return r;
    }
    return null;
  }

  var idCounter = 0;
  function createRecord(qr, location, now) {
    now = now || new Date();
    idCounter = (idCounter + 1) % 1e6;
    return {
      id: now.getTime().toString(36) + '-' + idCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      qr: normalizeQr(qr),
      location: String(location == null ? '' : location).trim(),
      date: formatDate(now),
      time: formatTime(now),
      ts: now.getTime()
    };
  }

  /* ---------- Opslag (localStorage, met veilige fallback) ---------- */
  function emptyState() { return { records: [], pending: null, lastExport: null }; }

  function sanitizeState(s) {
    var out = emptyState();
    if (!s || typeof s !== 'object') return out;
    if (Array.isArray(s.records)) {
      out.records = s.records.filter(function (r) {
        return r && typeof r.qr === 'string' && typeof r.location === 'string' && r.id;
      });
    }
    if (s.pending && typeof s.pending.qr === 'string') {
      out.pending = {
        qr: s.pending.qr,
        location: typeof s.pending.location === 'string' ? s.pending.location : '',
        allowDuplicate: !!s.pending.allowDuplicate,
        manual: !!s.pending.manual
      };
    }
    if (s.lastExport && typeof s.lastExport.csv === 'string' && typeof s.lastExport.filename === 'string') {
      out.lastExport = s.lastExport;
    }
    return out;
  }

  function createStore(storage) {
    var ok = false;
    try {
      if (storage) {
        storage.setItem('__da_test__', '1');
        storage.removeItem('__da_test__');
        ok = true;
      }
    } catch (e) { ok = false; }

    return {
      persistent: ok,
      load: function () {
        if (!ok) return emptyState();
        var raw;
        try {
          raw = storage.getItem(STORAGE_KEY);
          if (!raw) return emptyState();
          return sanitizeState(JSON.parse(raw));
        } catch (e) {
          // Beschadigde data niet stilletjes weggooien: bewaar een kopie.
          try { if (raw) storage.setItem(STORAGE_KEY + ':corrupt:' + Date.now(), raw); } catch (e2) { /* negeer */ }
          return emptyState();
        }
      },
      save: function (state) {
        if (!ok) return false;
        try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
      }
    };
  }

  /* ---------- Delen / e-mail ---------- */
  function canShareFiles(nav, file) {
    try {
      return !!(nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] }));
    } catch (e) { return false; }
  }

  function buildMailto(subject, body) {
    return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  // Fallback-mailtekst: als de bijlage niet automatisch kan, staan de gegevens in de tekst.
  function fallbackMailBody(filename, csv, maxLen) {
    maxLen = maxLen || 6000;
    var data = String(csv || '').replace(/^﻿/, '');
    var body = MAIL_BODY + '\n\nBestand: ' + filename + '\n\n';
    if (data.length > maxLen) {
      data = data.slice(0, maxLen) + '\n… (ingekort – zie bijlage)';
    }
    return body + data;
  }

  /* ---------- QR-decodering met jsQR ---------- */
  function decodeWithJsQR(jsQR, imageData, thorough) {
    if (typeof jsQR !== 'function' || !imageData) return null;
    var res = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert'
    });
    return res && typeof res.data === 'string' && res.data.trim() ? res.data : null;
  }

  var api = {
    DELIMITER: DELIMITER, BOM: BOM, HEADERS: HEADERS, STORAGE_KEY: STORAGE_KEY, MAIL_BODY: MAIL_BODY,
    formatDate: formatDate, formatTime: formatTime, isoDate: isoDate,
    csvFilename: csvFilename, mailSubject: mailSubject,
    csvField: csvField, buildCsv: buildCsv,
    normalizeQr: normalizeQr, findDuplicate: findDuplicate, createRecord: createRecord,
    emptyState: emptyState, sanitizeState: sanitizeState, createStore: createStore,
    canShareFiles: canShareFiles, buildMailto: buildMailto, fallbackMailBody: fallbackMailBody,
    decodeWithJsQR: decodeWithJsQR
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RegLogic = api;
})(typeof window !== 'undefined' ? window : this);
