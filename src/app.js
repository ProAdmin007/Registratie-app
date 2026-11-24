/* Registratie – UI */
(function () {
  'use strict';
  var L = window.RegLogic;
  var $ = function (id) { return document.getElementById(id); };
  // Klein aanhaakpunt (o.a. voor tests) om externe links zoals mailto: te openen.
  var RegApp = window.RegApp = { openUrl: function (url) { window.location.href = url; } };

  var el = {
    banner: $('banner'), btnScan: $('btnScan'), btnManual: $('btnManual'), btnPhoto: $('btnPhoto'),
    photoInput: $('photoInput'), scanner: $('scanner'), video: $('video'), btnStopScan: $('btnStopScan'),
    entry: $('entry'), qrValue: $('qrValue'), qrInput: $('qrInput'), locationInput: $('locationInput'),
    btnAdd: $('btnAdd'), btnCancelEntry: $('btnCancelEntry'), gpsBox: $('gpsBox'), gpsText: $('gpsText'),
    count: $('count'), emptyText: $('emptyText'), list: $('list'),
    btnExport: $('btnExport'), exportResult: $('exportResult'), exportName: $('exportName'),
    btnShare: $('btnShare'), shareHint: $('shareHint'), btnDownloadAgain: $('btnDownloadAgain'),
    btnNewRound: $('btnNewRound'), status: $('status'),
    dlg: $('dlg'), dlgTitle: $('dlgTitle'), dlgBody: $('dlgBody'), dlgOk: $('dlgOk'), dlgCancel: $('dlgCancel')
  };

  /* ================= Status & state ================= */
  var store = L.createStore(safeLocalStorage());
  var state = store.load();
  var editingId = null;

  function safeLocalStorage() { try { return window.localStorage; } catch (e) { return null; } }

  var saveWarned = false;
  function persist() {
    if (store.save(state)) return;
    if (store.persistent && !saveWarned) {
      saveWarned = true;
      setStatus('Let op: opslaan op het toestel mislukt. Maak tussentijds een CSV.', 'err');
    }
  }

  var statusTimer = null;
  function setStatus(msg, type) {
    clearTimeout(statusTimer);
    el.status.textContent = msg;
    el.status.className = 'status ' + (type || '');
    el.status.hidden = false;
    statusTimer = setTimeout(function () { el.status.hidden = true; }, type === 'err' ? 7000 : 3500);
  }

  /* ================= Dialoog ================= */
  function ask(opts) {
    // opts: title, body (string | Node), ok, cancel, okClass
    return new Promise(function (resolve) {
      var dlg = el.dlg;
      if (!dlg || typeof dlg.showModal !== 'function') {
        var txt = opts.title + '\n\n' + (typeof opts.body === 'string' ? opts.body : opts.body.textContent);
        resolve(window.confirm(txt));
        return;
      }
      el.dlgTitle.textContent = opts.title;
      el.dlgBody.textContent = '';
      if (typeof opts.body === 'string') { var p = document.createElement('p'); p.textContent = opts.body; el.dlgBody.appendChild(p); }
      else if (opts.body) el.dlgBody.appendChild(opts.body);
      el.dlgOk.textContent = opts.ok || 'OK';
      el.dlgOk.className = 'btn ' + (opts.okClass || 'btn-primary');
      el.dlgCancel.textContent = opts.cancel || 'Annuleren';
      el.dlgCancel.hidden = opts.cancel === false;
      dlg.returnValue = 'cancel';
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok');
      });
      dlg.showModal();
    });
  }

  function dupBody(qr, existing, intro) {
    var wrap = document.createElement('div');
    var p = document.createElement('p'); p.textContent = intro || 'Deze QR-code is al geregistreerd:'; wrap.appendChild(p);
    var box = document.createElement('div'); box.className = 'dup-box';
    var q = document.createElement('span'); q.className = 'rec-qr'; q.textContent = 'QR: ' + qr; box.appendChild(q);
    var loc = document.createElement('span'); loc.textContent = 'Locatie: ' + existing.location; box.appendChild(loc);
    var t = document.createElement('div'); t.className = 'muted small'; t.textContent = existing.date + ' ' + existing.time; box.appendChild(t);
    wrap.appendChild(box);
    return wrap;
  }

  function confirmDuplicate(qr, existing) {
    return ask({ title: '⚠ Dubbele QR-code', body: dupBody(qr, existing), ok: 'Toch toevoegen', cancel: 'Annuleren', okClass: 'btn-danger' });
  }

  /* ================= Mogelijkheden van de browser ================= */
  // Een lokaal geopend bestand (file:// of content://) krijgt van Chrome op Android geen live camera:
  // dan direct de camera-app (foto-modus) gebruiken.
  var isLocalFile = location.protocol === 'file:' || location.protocol === 'content:';
  var hasLiveCamera = !isLocalFile && !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  var cameraBlocked = false; // na een weigering voortaan foto-modus
  var canShare = (function () {
    try { return L.canShareFiles(navigator, new File(['x'], 'test.csv', { type: 'text/csv' })); } catch (e) { return false; }
  })();
  var detector = null;
  var detectorReady = (function () {
    if (!('BarcodeDetector' in window)) return Promise.resolve();
    try {
      return window.BarcodeDetector.getSupportedFormats().then(function (f) {
        if (f.indexOf('qr_code') !== -1) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  })();

  function renderBanner() {
    var items = [];
    if (!store.persistent) items.push('Gegevens worden niet bewaard bij herladen. Maak regelmatig een CSV.');
    if (!hasLiveCamera || cameraBlocked) items.push('Live camera niet beschikbaar: "Scan QR-code" opent de camera-app om een foto van de QR-code te maken.');
    if (!canShare) items.push('Bestanden delen wordt niet ondersteund: bij e-mailen moet je de CSV uit Downloads zelf als bijlage toevoegen (de gegevens staan ook in de mailtekst).');
    if (typeof window.jsQR !== 'function' && !detector) items.push('QR-herkenning is niet beschikbaar in deze browser. Gebruik "handmatig invoeren".');
    if (!geo.supported) items.push('GPS niet beschikbaar: de kolommen met coördinaten blijven leeg.');
    if (!items.length) { el.banner.hidden = true; return; }
    el.banner.textContent = '';
    el.banner.appendChild(icon('info'));
    var box = mk('div');
    box.appendChild(mk('b', null, 'Beperkte modus'));
    box.appendChild(document.createTextNode(' (bijv. omdat de app als lokaal bestand is geopend)'));
    var ul = mk('ul');
    items.forEach(function (t) { ul.appendChild(mk('li', null, t)); });
    box.appendChild(ul);
    el.banner.appendChild(box);
    el.banner.hidden = false;
  }

  /* ================= Scanner ================= */
  var stream = null, scanning = false, scanTimer = null;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  function startScan() {
    if (scanning) return;
    gpsBegin(); // positie meten vanaf de tik op Scan
    if (!hasLiveCamera || cameraBlocked) { openPhotoCapture(); return; }
    el.btnPhoto.hidden = true;
    el.btnScan.disabled = true;
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(function (s) {
      stream = s;
      el.video.srcObject = s;
      el.scanner.hidden = false;
      scanning = true;
      el.scanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return el.video.play().catch(function () {}).then(function () { return detectorReady; });
    }).then(function () {
      if (scanning) tick();
    }).catch(function (err) {
      stopScan();
      cameraError(err);
    }).then(function () { el.btnScan.disabled = false; });
  }

  function cameraError(err) {
    var name = err && err.name;
    var msg;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      cameraBlocked = true;
      setStatus('Live camera niet toegestaan – de camera-app wordt gebruikt: maak een foto van de QR-code.', 'warn');
      renderBanner();
      // Binnen de tik van de gebruiker meteen de camera-app openen (lukt dat niet, dan via de knop).
      var active = !navigator.userActivation || navigator.userActivation.isActive;
      if (active) openPhotoCapture();
      return;
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      msg = 'Geen camera gevonden.';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      msg = 'Camera is in gebruik door een andere app. Sluit die app en probeer opnieuw.';
    } else {
      msg = 'Camera kon niet worden gestart' + (err && err.message ? ': ' + err.message : '.');
    }
    setStatus(msg, 'err');
    el.btnPhoto.hidden = false; // fallback: foto via camera-app
  }

  function stopScan() {
    scanning = false;
    clearTimeout(scanTimer);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    el.video.srcObject = null;
    el.scanner.hidden = true;
  }

  function grabFrame(source, srcW, srcH, maxDim) {
    var scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    var w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale));
    canvas.width = w; canvas.height = h;
    ctx.drawImage(source, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function tick() {
    if (!scanning) return;
    var v = el.video;
    var p;
    if (v.readyState >= 2 && v.videoWidth) {
      if (detector) {
        p = detector.detect(v).then(function (codes) {
          return codes && codes.length ? codes[0].rawValue : null;
        }).catch(function () { detector = null; return null; }); // val terug op jsQR
      } else {
        p = Promise.resolve(L.decodeWithJsQR(window.jsQR, grabFrame(v, v.videoWidth, v.videoHeight, 800), false));
      }
    } else {
      p = Promise.resolve(null);
    }
    p.then(function (text) {
      if (!scanning) return;
      if (text && L.normalizeQr(text)) { onDecoded(text); return; }
      scanTimer = setTimeout(tick, detector ? 100 : 180);
    });
  }

  function openPhotoCapture() {
    el.photoInput.value = '';
    el.photoInput.click();
  }

  function loadImage(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).catch(function () { return loadImageEl(file); });
    }
    return loadImageEl(file);
  }
  function loadImageEl(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Afbeelding kon niet worden geladen')); };
      img.src = url;
    });
  }

  function decodeImageFile(file) {
    return Promise.all([loadImage(file), detectorReady]).then(function (r) {
      var img = r[0];
      var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      var viaDetector = detector ? detector.detect(img).then(function (c) { return c && c.length ? c[0].rawValue : null; }).catch(function () { return null; }) : Promise.resolve(null);
      return viaDetector.then(function (text) {
        if (text) return text;
        var sizes = [1000, 1600, 600, 2400];
        for (var i = 0; i < sizes.length; i++) {
          text = L.decodeWithJsQR(window.jsQR, grabFrame(img, w, h, sizes[i]), true);
          if (text) return text;
        }
        return null;
      });
    });
  }

  el.photoInput.addEventListener('change', function () {
    var file = el.photoInput.files && el.photoInput.files[0];
    if (!file) return;
    setStatus('QR-code zoeken…');
    decodeImageFile(file).then(function (text) {
      if (text) onDecoded(text);
      else setStatus('QR-code niet leesbaar. Probeer opnieuw: dichterbij, recht ervoor en met goed licht.', 'err');
    }).catch(function () {
      setStatus('Foto kon niet worden verwerkt. Probeer opnieuw.', 'err');
    });
  });

  function onDecoded(raw) {
    stopScan();
    var qr = L.normalizeQr(raw);
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch (e) { /* negeer */ } }
    var existing = L.findDuplicate(state.records, qr);
    if (existing) {
      confirmDuplicate(qr, existing).then(function (yes) {
        if (yes) showEntry(qr, { allowDuplicate: true });
        else setStatus('Scan geannuleerd (dubbele QR-code).', 'warn');
      });
      return;
    }
    showEntry(qr, { allowDuplicate: false });
  }

  /* ================= GPS ================= */
  // De positie wordt gemeten vanaf het moment dat de monteur op "Scan" tikt (dan staat hij bij het station)
  // tot "Toevoegen"; de nauwkeurigste meting in dat venster wordt opgeslagen.
  var GPS_GOOD_M = 20;              // groen bij ≤ 20 m nauwkeurigheid
  var GPS_IDLE_MS = 3 * 60 * 1000;  // GPS uit na 3 minuten zonder scan (batterij)
  var geo = {
    supported: !!(navigator.geolocation && typeof navigator.geolocation.watchPosition === 'function'),
    watchId: null, since: 0, best: null, last: null, error: null, denied: false, idleTimer: null
  };

  function gpsBegin() {
    // Nieuw meetvenster voor het volgende station
    geo.since = Date.now();
    // Een zeer recente meting (≤ 5 s oud) telt meteen mee; anders begint het zoeken opnieuw.
    geo.best = L.betterFix(null, geo.last, geo.since - 5000);
    // Meting opnieuw starten: een stilstaande telefoon stuurt anders niet altijd uit zichzelf een update.
    gpsStop();
    gpsStart();
    gpsIdleLater(); // stopt vanzelf als er geen scan volgt
  }
  function gpsStart() {
    clearTimeout(geo.idleTimer);
    if (!geo.supported || geo.denied || geo.watchId != null) return;
    try {
      geo.watchId = navigator.geolocation.watchPosition(onGpsPos, onGpsErr,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
    } catch (e) {
      geo.error = 'GPS kon niet worden gestart.';
      renderGps();
    }
  }
  function gpsStop() {
    if (geo.watchId == null) return;
    try { navigator.geolocation.clearWatch(geo.watchId); } catch (e) { /* negeer */ }
    geo.watchId = null;
  }
  function gpsIdleLater() {
    clearTimeout(geo.idleTimer);
    geo.idleTimer = setTimeout(function () { if (!state.pending) gpsStop(); }, GPS_IDLE_MS);
  }
  function onGpsPos(pos) {
    var fix = L.fixFromPosition(pos);
    if (!fix) return;
    geo.error = null;
    geo.last = fix;
    // 5 s marge: een meting van vlak vóór de tik op "Scan" is ook bij dit station.
    geo.best = L.betterFix(geo.best, fix, geo.since - 5000);
    var p = state.pending;
    if (p && geo.best !== p.gps) { p.gps = geo.best; persist(); }
    renderGps();
  }
  function onGpsErr(err) {
    var code = err && err.code;
    if (code === 1) {
      geo.denied = true;
      geo.error = 'Locatietoegang geweigerd – zonder coördinaten. Sta locatie toe via het slotje in de adresbalk.';
      gpsStop();
    } else if (code === 2) {
      geo.error = 'Geen positie beschikbaar. Staat Locatie aan op de telefoon?';
    } else {
      geo.error = null; // time-out: blijft zoeken
    }
    renderGps();
  }
  function renderGps() {
    var p = state.pending;
    if (!p) return;
    var st, txt;
    if (p.gps) {
      st = p.gps.acc <= GPS_GOOD_M ? 'ok' : 'weak';
      txt = L.formatGps(p.gps) + (st === 'weak' ? ' – even stilstaan maakt hem nauwkeuriger' : '');
    } else if (!geo.supported) {
      st = 'error'; txt = 'GPS niet beschikbaar in deze browser.';
    } else if (geo.error) {
      st = 'error'; txt = geo.error;
    } else {
      st = 'searching'; txt = 'Zoeken…';
    }
    el.gpsBox.dataset.state = st;
    el.gpsText.textContent = txt;
  }
  function askNoGps() {
    // Geen stille registraties zonder coördinaten terwijl de GPS nog zoekt.
    if (state.pending.gps || !geo.supported || geo.denied) return Promise.resolve(true);
    return ask({
      title: 'Nog geen GPS-positie',
      body: geo.error || 'De telefoon zoekt nog naar de positie. Meestal duurt dat enkele seconden (buiten, vrij zicht op de lucht).',
      ok: 'Zonder GPS toevoegen', cancel: 'Wachten'
    });
  }

  /* ================= Invoer ================= */
  function showEntry(qr, opts) {
    opts = opts || {};
    if (!geo.since) gpsBegin();
    state.pending = {
      qr: qr || '', location: opts.location || '', allowDuplicate: !!opts.allowDuplicate, manual: !!opts.manual,
      gps: geo.best, gpsSince: geo.since
    };
    persist();
    gpsStart();
    renderEntry(true);
  }

  function renderEntry(focus) {
    var p = state.pending;
    if (!p) { el.entry.hidden = true; return; }
    el.entry.hidden = false;
    el.qrValue.hidden = p.manual;
    el.qrInput.hidden = !p.manual;
    el.qrValue.textContent = p.qr;
    el.qrInput.value = p.qr;
    el.locationInput.value = p.location || '';
    renderGps();
    updateAddButton();
    if (focus) {
      el.entry.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(focusEntry, 50);
    }
  }

  function focusEntry() {
    var p = state.pending;
    if (!p || el.entry.hidden) return;
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT' && el.entry.contains(a)) return; // gebruiker typt al
    var target = p.manual && !el.qrInput.value.trim() ? el.qrInput : el.locationInput;
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }
  // Na terugkeer uit de camera-app (foto-modus) de focus opnieuw op het invoerveld zetten.
  window.addEventListener('focus', function () { setTimeout(focusEntry, 50); });

  function updateAddButton() {
    var p = state.pending;
    var qr = p ? (p.manual ? el.qrInput.value : p.qr) : '';
    el.btnAdd.disabled = !(L.normalizeQr(qr) && el.locationInput.value.trim());
  }

  el.locationInput.addEventListener('input', function () {
    if (state.pending) { state.pending.location = el.locationInput.value; persist(); }
    updateAddButton();
  });
  el.qrInput.addEventListener('input', function () {
    if (state.pending) { state.pending.qr = el.qrInput.value; state.pending.allowDuplicate = false; persist(); }
    updateAddButton();
  });
  el.qrInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.locationInput.focus(); } });
  el.locationInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addRecord(); }
  });

  function addRecord() {
    var p = state.pending;
    if (!p) return;
    var qr = L.normalizeQr(p.manual ? el.qrInput.value : p.qr);
    var location = el.locationInput.value.trim();
    if (!qr) { setStatus('Vul een QR-code in.', 'err'); el.qrInput.focus(); return; }
    if (!location) { setStatus('Vul eerst een locatie in.', 'err'); el.locationInput.focus(); return; }

    var existing = L.findDuplicate(state.records, qr);
    var go = (existing && !p.allowDuplicate) ? confirmDuplicate(qr, existing) : Promise.resolve(true);
    go.then(function (yes) {
      if (!yes) { setStatus('Niet toegevoegd (dubbele QR-code).', 'warn'); return false; }
      return askNoGps().then(function (ok) {
        if (!ok) { setStatus('GPS zoekt verder… tik daarna op Toevoegen.', 'warn'); }
        return ok;
      });
    }).then(function (yes) {
      if (!yes || state.pending !== p) return;
      state.records.push(L.createRecord(qr, location, undefined, p.gps));
      state.pending = null;
      geo.since = 0; // volgende scan = nieuw meetvenster
      gpsIdleLater();
      state.lastExport = null; // lijst gewijzigd → CSV opnieuw maken
      persist();
      el.locationInput.blur();
      render();
      setStatus('✔ Toegevoegd: ' + qr, 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      try { el.btnScan.focus({ preventScroll: true }); } catch (e) { /* negeer */ }
    });
  }

  el.btnAdd.addEventListener('click', addRecord);
  el.btnCancelEntry.addEventListener('click', function () {
    state.pending = null; geo.since = 0; persist(); renderEntry(false); gpsIdleLater();
  });

  /* ================= Overzicht ================= */
  function render() {
    renderEntry(false);
    renderList();
    renderExport();
  }

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }
  function iconButton(cls, iconName, label, act) {
    var b = mk('button', 'btn btn-sm ' + cls);
    b.type = 'button'; b.dataset.act = act;
    b.appendChild(icon(iconName)); b.appendChild(document.createTextNode(label));
    return b;
  }
  function meta(cls, iconName, textCls, text) {
    var d = mk('div', 'rec-meta ' + cls);
    d.appendChild(icon(iconName));
    d.appendChild(mk('span', textCls, text));
    return d;
  }

  function renderList() {
    var recs = state.records;
    el.count.textContent = recs.length;
    el.emptyText.hidden = recs.length > 0;
    el.list.textContent = '';
    var focusAfter = null;
    recs.forEach(function (r, i) {
      var li = mk('li');
      li.dataset.id = r.id;
      if (editingId === r.id) {
        li.className = 'rec-edit';
        var f1 = mk('div', 'field'); f1.appendChild(mk('label', null, 'QR-code'));
        var qi = mk('input'); qi.type = 'text'; qi.value = r.qr; qi.className = 'edit-qr'; qi.spellcheck = false; f1.appendChild(qi);
        var f2 = mk('div', 'field'); f2.appendChild(mk('label', null, 'Locatie'));
        var li2 = mk('input'); li2.type = 'text'; li2.value = r.location; li2.className = 'edit-loc'; f2.appendChild(li2);
        var acts = mk('div', 'rec-actions');
        acts.appendChild(iconButton('btn-success', 'check', 'Opslaan', 'save'));
        acts.appendChild(iconButton('btn-outline', 'x', 'Annuleren', 'cancel'));
        li.appendChild(f1); li.appendChild(f2); li.appendChild(acts);
        focusAfter = li2;
      } else {
        li.appendChild(mk('span', 'rec-num', String(i + 1)));
        var body = mk('div', 'rec-body');
        body.appendChild(mk('div', 'rec-qr', r.qr));
        body.appendChild(meta('rec-loc', 'pin', 'rec-loc-text', r.location));
        body.appendChild(meta('rec-time', 'clock', null, r.date + ' · ' + r.time));
        body.appendChild(meta('rec-gps' + (r.gps ? '' : ' missing'), 'gps', 'rec-gps-text', r.gps ? L.formatGps(r.gps) : 'Geen GPS-positie'));
        var a = mk('div', 'rec-actions');
        a.appendChild(iconButton('btn-outline', 'edit', 'Bewerken', 'edit'));
        a.appendChild(iconButton('btn-danger-ghost', 'trash', 'Verwijderen', 'delete'));
        body.appendChild(a);
        li.appendChild(body);
      }
      el.list.appendChild(li);
    });
    if (focusAfter) focusAfter.focus();
  }

  el.list.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var li = btn.closest('li');
    var id = li.dataset.id;
    var rec = state.records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var act = btn.dataset.act;

    if (act === 'edit') { editingId = id; renderList(); return; }
    if (act === 'cancel') { editingId = null; renderList(); return; }
    if (act === 'delete') {
      ask({ title: 'Verwijderen?', body: 'QR: ' + rec.qr + '\nLocatie: ' + rec.location, ok: 'Verwijderen', okClass: 'btn-danger' })
        .then(function (yes) {
          if (!yes) return;
          state.records = state.records.filter(function (r) { return r.id !== id; });
          state.lastExport = null;
          persist(); render();
          setStatus('Verwijderd: ' + rec.qr, 'ok');
        });
      return;
    }
    if (act === 'save') {
      var newQr = L.normalizeQr(li.querySelector('.edit-qr').value);
      var newLoc = li.querySelector('.edit-loc').value.trim();
      if (!newQr || !newLoc) { setStatus('QR-code en locatie mogen niet leeg zijn.', 'err'); return; }
      var dup = newQr !== rec.qr ? L.findDuplicate(state.records, newQr, id) : null;
      (dup ? confirmDuplicate(newQr, dup) : Promise.resolve(true)).then(function (yes) {
        if (!yes) return;
        rec.qr = newQr; rec.location = newLoc;
        editingId = null;
        state.lastExport = null;
        persist(); render();
        setStatus('✔ Opgeslagen', 'ok');
      });
    }
  });

  el.list.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    var save = e.target.closest('li').querySelector('button[data-act=save]');
    if (save) save.click();
  });

  /* ================= CSV & e-mail ================= */
  function downloadCsv(filename, csv) {
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportCsv() {
    if (!state.records.length) { setStatus('Nog niets gescand.', 'warn'); return; }
    var now = new Date();
    state.lastExport = {
      filename: L.csvFilename(now),
      subject: L.mailSubject(now),
      csv: L.buildCsv(state.records),
      count: state.records.length
    };
    persist();
    var ok = downloadCsv(state.lastExport.filename, state.lastExport.csv);
    renderExport();
    if (ok) setStatus('✔ CSV opgeslagen in Downloads', 'ok');
    else setStatus('CSV kon niet worden opgeslagen. Je kunt de CSV nog wel via e-mail versturen.', 'err');
    el.exportResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderExport() {
    var x = state.lastExport;
    el.exportResult.hidden = !x;
    if (!x) return;
    el.exportName.textContent = x.filename;
    el.shareHint.hidden = canShare;
    el.shareHint.textContent = canShare ? '' :
      'Deze browser kan het bestand niet automatisch als bijlage meegeven. Er opent een e-mail met onderwerp en de gegevens in de tekst; voeg ' +
      x.filename + ' uit Downloads zelf toe als bijlage.';
  }

  function shareCsv() {
    var x = state.lastExport;
    if (!x) return;
    var file;
    try { file = new File([x.csv], x.filename, { type: 'text/csv' }); } catch (e) { file = null; }
    if (file && L.canShareFiles(navigator, file)) {
      navigator.share({ files: [file], title: x.subject, text: L.MAIL_BODY })
        .then(function () { setStatus('✔ Gedeeld', 'ok'); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') { setStatus('Delen geannuleerd.', 'warn'); return; }
          mailFallback(x, 'Delen van het bestand is mislukt (' + (err && err.name || 'fout') + ').');
        });
      return;
    }
    mailFallback(x, 'Deze browser ondersteunt het delen van bestanden niet.');
  }

  function mailFallback(x, reason) {
    var body = document.createElement('div');
    var p1 = document.createElement('p'); p1.textContent = reason; body.appendChild(p1);
    var p2 = document.createElement('p');
    p2.textContent = 'Er wordt een nieuwe e-mail geopend met het onderwerp "' + x.subject +
      '" en de gegevens in de tekst. Voeg het bestand ' + x.filename + ' uit de map Downloads zelf toe als bijlage (paperclip).';
    body.appendChild(p2);
    ask({ title: 'Bijlage handmatig toevoegen', body: body, ok: 'E-mail openen' }).then(function (yes) {
      if (!yes) return;
      RegApp.openUrl(L.buildMailto(x.subject, L.fallbackMailBody(x.filename, x.csv)));
    });
  }

  el.btnExport.addEventListener('click', exportCsv);
  el.btnShare.addEventListener('click', shareCsv);
  el.btnDownloadAgain.addEventListener('click', function () {
    var x = state.lastExport;
    if (x && downloadCsv(x.filename, x.csv)) setStatus('✔ Opnieuw gedownload', 'ok');
    else setStatus('CSV kon niet worden opgeslagen.', 'err');
  });

  el.btnNewRound.addEventListener('click', function () {
    var n = state.records.length;
    if (!n && !state.pending) { setStatus('Er is nog niets geregistreerd.', 'warn'); return; }
    ask({
      title: 'Nieuwe scanronde?',
      body: 'Alle ' + n + ' registratie(s) worden van dit toestel gewist. Verstuur eerst de CSV als je dat nog niet hebt gedaan.',
      ok: 'Alles wissen', okClass: 'btn-danger'
    }).then(function (yes) {
      if (!yes) return;
      stopScan();
      state = L.emptyState();
      editingId = null;
      persist(); render();
      setStatus('Nieuwe scanronde gestart.', 'ok');
    });
  });

  /* ================= Knoppen & levenscyclus ================= */
  el.btnScan.addEventListener('click', startScan);
  el.btnPhoto.addEventListener('click', function () { gpsBegin(); openPhotoCapture(); });
  el.btnStopScan.addEventListener('click', stopScan);
  el.btnManual.addEventListener('click', function () { stopScan(); gpsBegin(); showEntry('', { manual: true }); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && scanning) stopScan(); // camera vrijgeven op de achtergrond
    if (document.hidden) gpsStop(); else if (state.pending) gpsStart(); // GPS niet op de achtergrond
  });
  window.addEventListener('beforeunload', function (e) {
    if (!store.persistent && state.records.length) { e.preventDefault(); e.returnValue = ''; }
  });

  // PWA: alleen bij hosting via https/localhost (niet bij een lokaal geopend bestand).
  var hosted = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (hosted) {
    var link = document.createElement('link'); link.rel = 'manifest'; link.href = 'manifest.json';
    document.head.appendChild(link);
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
    }
  }

  detectorReady.then(renderBanner);
  render();
  if (state.pending) {
    // Na herladen: meetvenster en beste positie van de openstaande scan herstellen.
    geo.since = state.pending.gpsSince || Date.now();
    geo.best = state.pending.gps;
    gpsStart();
    renderEntry(true);
  }
})();
