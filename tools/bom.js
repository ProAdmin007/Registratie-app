#!/usr/bin/env node
/*
 * Genereert CycloneDX 1.6 bestanden:
 *   security/sbom.cdx.json  – Software Bill of Materials (componenten, versies, licenties, hashes)
 *   security/cbom.cdx.json  – Cryptography Bill of Materials (algoritmen, protocollen, certificaten, sleutels)
 * Gebruik: npm run bom            (bouwt eerst; peilt de live TLS-verbinding van GitHub Pages)
 *          node tools/bom.js --offline   (zonder TLS-peiling)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'security');
const DIST = path.join(ROOT, 'dist', 'Registratie');
const PKG = require(path.join(ROOT, 'package.json'));
const LOCK = require(path.join(ROOT, 'package-lock.json'));
const SITE_HOST = 'proadmin007.github.io';
const SITE_URL = `https://${SITE_HOST}/Registratie-app/`;
const REPO_URL = 'https://github.com/ProAdmin007/Registratie-app';
const OFFLINE = process.argv.includes('--offline');

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sriToHash = sri => {
  const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(sri || '');
  if (!m) return null;
  const alg = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[m[1]];
  return { alg, content: Buffer.from(m[2], 'base64').toString('hex') };
};
const purl = (name, version) => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
const git = args => { try { return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };

const SPDX_IDS = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'schema', 'spdx.schema.json'), 'utf8')).enum);
function licenseOf(lic) {
  if (!lic) return undefined;
  const s = typeof lic === 'string' ? lic : lic.type;
  if (!s) return undefined;
  if (SPDX_IDS.has(s)) return [{ license: { id: s } }];
  if (/\s(OR|AND|WITH)\s|[()]/.test(s)) return [{ expression: s }];
  return [{ license: { name: s } }];
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('Eerst bouwen: npm run build'); process.exit(1); }

const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const commit = git(['rev-parse', 'HEAD']);
const toolInfo = {
  components: [{ type: 'application', name: 'tools/bom.js', version: PKG.version, description: 'Eigen generator in deze repository' }]
};
const appComponent = {
  type: 'application',
  'bom-ref': 'registratie-app',
  name: 'registratie-app',
  version: PKG.version,
  description: PKG.description,
  externalReferences: [
    { type: 'vcs', url: REPO_URL },
    { type: 'website', url: SITE_URL }
  ],
  properties: commit ? [{ name: 'git:commit', value: commit }] : undefined
};

/* =========================== SBOM =========================== */
function buildSbom() {
  const components = [];
  const deps = [];

  // 1) Meegeleverde (runtime) bibliotheek: jsQR, inline gebundeld in index.html
  const vendor = fs.readFileSync(path.join(ROOT, 'src', 'vendor', 'jsQR.js'));
  const jsqrRef = purl('jsqr', '1.4.0');
  components.push({
    type: 'library',
    'bom-ref': jsqrRef,
    name: 'jsqr',
    version: '1.4.0',
    description: 'Pure JavaScript QR-code reading library',
    scope: 'required',
    purl: jsqrRef,
    licenses: [{ license: { id: 'Apache-2.0' } }],
    hashes: [
      { alg: 'SHA-256', content: sha256(vendor) },
      // Integriteit volgens het npm-register (tarball jsqr-1.4.0.tgz)
      sriToHash('sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==')
    ],
    externalReferences: [
      { type: 'vcs', url: 'https://github.com/cozmo/jsQR' },
      { type: 'distribution', url: 'https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz' }
    ],
    properties: [
      { name: 'registratie:bundled-as', value: 'src/vendor/jsQR.js (dist/jsQR.js uit npm-pakket), inline in index.html' }
    ]
  });

  // 2) Gepubliceerde bestanden (wat er daadwerkelijk op GitHub Pages / in de zip staat)
  const fileRefs = [];
  for (const f of fs.readdirSync(DIST).sort()) {
    const buf = fs.readFileSync(path.join(DIST, f));
    const ref = 'file:' + f;
    fileRefs.push(ref);
    components.push({ type: 'file', 'bom-ref': ref, name: f, scope: 'required', hashes: [{ alg: 'SHA-256', content: sha256(buf) }] });
  }
  const zipPath = path.join(ROOT, 'dist', 'Registratie.zip');
  if (fs.existsSync(zipPath)) {
    fileRefs.push('file:Registratie.zip');
    components.push({ type: 'file', 'bom-ref': 'file:Registratie.zip', name: 'Registratie.zip', scope: 'required',
      hashes: [{ alg: 'SHA-256', content: sha256(fs.readFileSync(zipPath)) }] });
  }

  // 3) Ontwikkel-/testafhankelijkheden uit package-lock.json (niet meegeleverd → scope "excluded")
  const pkgs = LOCK.packages || {};
  const pathToRef = {};
  const seen = new Set();
  for (const [p, meta] of Object.entries(pkgs)) {
    if (!p || !meta.version) continue;
    const name = meta.name || p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const ref = purl(name, meta.version);
    pathToRef[p] = ref;
    if (seen.has(ref)) continue;
    seen.add(ref);
    let license;
    try { license = licenseOf(meta.license || require(path.join(ROOT, p, 'package.json')).license); } catch (e) { license = licenseOf(meta.license); }
    const h = sriToHash(meta.integrity);
    components.push({
      type: 'library', 'bom-ref': ref, name, version: meta.version,
      scope: meta.dev ? 'excluded' : 'required',
      purl: ref,
      licenses: license,
      hashes: h ? [h] : undefined,
      externalReferences: meta.resolved ? [{ type: 'distribution', url: meta.resolved }] : undefined,
      properties: meta.dev ? [{ name: 'cdx:npm:package:development', value: 'true' }] : undefined
    });
  }
  // Node-resolutie: zoek dependency vanaf het pakketpad omhoog
  const resolve = (from, dep) => {
    let base = from;
    while (true) {
      const cand = (base ? base + '/' : '') + 'node_modules/' + dep;
      if (pkgs[cand]) return cand;
      const i = base.lastIndexOf('/node_modules/');
      if (i === -1) { if (base === '') return null; base = ''; continue; }
      base = base.slice(0, i);
    }
  };
  const depMap = new Map();
  for (const [p, meta] of Object.entries(pkgs)) {
    if (!p) continue;
    const ref = pathToRef[p];
    if (!ref) continue;
    const names = Object.keys(Object.assign({}, meta.dependencies, meta.optionalDependencies));
    const set = depMap.get(ref) || new Set();
    for (const n of names) { const r = resolve(p, n); if (r && pathToRef[r]) set.add(pathToRef[r]); }
    depMap.set(ref, set);
  }
  const rootDevRefs = Object.keys(pkgs[''].devDependencies || {}).map(n => pathToRef['node_modules/' + n]).filter(Boolean);
  deps.push({ ref: 'registratie-app', dependsOn: [jsqrRef, ...fileRefs, ...rootDevRefs] });
  deps.push({ ref: jsqrRef, dependsOn: [] });
  for (const r of fileRefs) deps.push({ ref: r, dependsOn: [] });
  for (const [ref, set] of depMap) deps.push({ ref, dependsOn: [...set].sort() });

  return {
    bomFormat: 'CycloneDX', specVersion: '1.6',
    serialNumber: 'urn:uuid:' + crypto.randomUUID(), version: 1,
    metadata: {
      timestamp: now, tools: toolInfo, component: appComponent,
      properties: [
        { name: 'registratie:runtime-dependencies', value: 'Alleen jsqr@1.4.0 (meegebundeld). Geen CDN, geen externe scripts, geen backend.' },
        { name: 'registratie:dev-dependencies', value: 'Alleen voor tests/bouwen op de ontwikkel-pc; scope "excluded", niet in de app.' }
      ]
    },
    components, dependencies: deps
  };
}

/* =========================== CBOM =========================== */
const TLS13_IDS = { TLS_AES_128_GCM_SHA256: ['0x13', '0x01'], TLS_AES_256_GCM_SHA384: ['0x13', '0x02'], TLS_CHACHA20_POLY1305_SHA256: ['0x13', '0x03'] };

function alg(ref, name, props, oid, extra) {
  return Object.assign({ type: 'cryptographic-asset', 'bom-ref': ref, name,
    cryptoProperties: Object.assign({ assetType: 'algorithm', algorithmProperties: props }, oid ? { oid } : {}) }, extra || {});
}

function probeTls() {
  return new Promise(resolve => {
    if (OFFLINE) return resolve(null);
    const s = tls.connect({ host: SITE_HOST, port: 443, servername: SITE_HOST, timeout: 10000 }, () => {
      const c = s.getPeerX509Certificate();
      const r = {
        protocol: s.getProtocol(), cipher: s.getCipher(), group: s.getEphemeralKeyInfo(),
        cert: {
          subject: c.subject.replace(/\n/g, ', '), issuer: c.issuer.replace(/\n/g, ', '),
          from: c.validFromDate.toISOString().replace(/\.\d{3}Z$/, 'Z'), to: c.validToDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          keyType: c.publicKey.asymmetricKeyType, keyBits: (c.publicKey.asymmetricKeyDetails || {}).modulusLength,
          curve: (c.publicKey.asymmetricKeyDetails || {}).namedCurve,
          sigAlg: c.signatureAlgorithm, sigOid: c.signatureAlgorithmOid, fp: c.fingerprint256
        }
      };
      s.end(); resolve(r);
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

function certComponents(prefix, label, c, extraProps) {
  const sigRef = 'crypto/algorithm/' + (c.sigAlg || 'unknown').toLowerCase();
  const keyAlgRef = c.keyType === 'rsa' ? `crypto/algorithm/rsa-${c.keyBits}` : `crypto/algorithm/ecdsa-${c.curve}`;
  const keyRef = `${prefix}/public-key`;
  return {
    refs: { cert: `${prefix}/certificate`, sigRef, keyAlgRef, keyRef },
    components: [
      { type: 'cryptographic-asset', 'bom-ref': `${prefix}/certificate`, name: label,
        cryptoProperties: { assetType: 'certificate', certificateProperties: {
          subjectName: c.subject, issuerName: c.issuer, notValidBefore: c.from, notValidAfter: c.to,
          signatureAlgorithmRef: sigRef, subjectPublicKeyRef: keyRef, certificateFormat: 'X.509', certificateExtension: 'pem' } },
        properties: extraProps },
      { type: 'cryptographic-asset', 'bom-ref': keyRef, name: `${label} – publieke sleutel`,
        cryptoProperties: { assetType: 'related-crypto-material', relatedCryptoMaterialProperties: {
          type: 'public-key', algorithmRef: keyAlgRef, size: c.keyBits || undefined, format: 'SubjectPublicKeyInfo' } } }
    ]
  };
}

async function buildCbom() {
  const t = await probeTls();
  const components = [];
  const deps = [];
  const add = c => { if (!components.some(x => x['bom-ref'] === c['bom-ref'])) components.push(c); };

  // ---- Algoritmen (gedeeld) ----
  add(alg('crypto/algorithm/sha-256', 'SHA-256', { primitive: 'hash', parameterSetIdentifier: '256', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['digest'], classicalSecurityLevel: 128, nistQuantumSecurityLevel: 2 }, '2.16.840.1.101.3.4.2.1'));
  add(alg('crypto/algorithm/sha-512', 'SHA-512', { primitive: 'hash', parameterSetIdentifier: '512', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['digest'], classicalSecurityLevel: 256, nistQuantumSecurityLevel: 5 }, '2.16.840.1.101.3.4.2.3',
    { properties: [{ name: 'registratie:usage', value: 'npm-integriteit (package-lock.json, Subresource-Integrity-formaat) van ontwikkelpakketten' }] }));
  add(alg('crypto/algorithm/sha-1', 'SHA-1', { primitive: 'hash', parameterSetIdentifier: '160', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['digest'], classicalSecurityLevel: 0, nistQuantumSecurityLevel: 0 }, '1.3.14.3.2.26',
    { properties: [{ name: 'registratie:usage', value: 'Git object-ID\'s (repository en gh-pages-deploy). Git gebruikt SHA-1 met collision-detectie; niet gebruikt voor beveiliging van gebruikersgegevens.' }] }));
  add(alg('crypto/algorithm/sha256withrsaencryption', 'sha256WithRSAEncryption', { primitive: 'signature', padding: 'pkcs1v15', parameterSetIdentifier: '2048', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['sign', 'verify'], classicalSecurityLevel: 112, nistQuantumSecurityLevel: 0 }, '1.2.840.113549.1.1.11'));
  add(alg('crypto/algorithm/rsa-2048', 'RSA-2048', { primitive: 'pke', parameterSetIdentifier: '2048', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['keygen'], classicalSecurityLevel: 112, nistQuantumSecurityLevel: 0 }, '1.2.840.113549.1.1.1'));

  const appDeps = [];

  // ---- TLS van GitHub Pages (transport naar de telefoon) ----
  if (t) {
    const suite = t.cipher.standardName || t.cipher.name;
    const suiteAlgs = [];
    if (/AES_128_GCM/.test(suite)) { add(alg('crypto/algorithm/aes-128-gcm', 'AES-128-GCM', { primitive: 'ae', mode: 'gcm', parameterSetIdentifier: '128', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['encrypt', 'decrypt'], classicalSecurityLevel: 128, nistQuantumSecurityLevel: 1 }, '2.16.840.1.101.3.4.1.6')); suiteAlgs.push('crypto/algorithm/aes-128-gcm'); }
    if (/AES_256_GCM/.test(suite)) { add(alg('crypto/algorithm/aes-256-gcm', 'AES-256-GCM', { primitive: 'ae', mode: 'gcm', parameterSetIdentifier: '256', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['encrypt', 'decrypt'], classicalSecurityLevel: 256, nistQuantumSecurityLevel: 5 }, '2.16.840.1.101.3.4.1.46')); suiteAlgs.push('crypto/algorithm/aes-256-gcm'); }
    if (/CHACHA20/.test(suite)) { add(alg('crypto/algorithm/chacha20-poly1305', 'ChaCha20-Poly1305', { primitive: 'ae', parameterSetIdentifier: '256', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['encrypt', 'decrypt'], classicalSecurityLevel: 256, nistQuantumSecurityLevel: 5 })); suiteAlgs.push('crypto/algorithm/chacha20-poly1305'); }
    const hashName = /SHA384$/.test(suite) ? 'SHA-384' : 'SHA-256';
    add(alg(`crypto/algorithm/hkdf-${hashName.toLowerCase()}`, `HKDF-${hashName}`, { primitive: 'kdf', parameterSetIdentifier: hashName.slice(4), executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['keyderive'], classicalSecurityLevel: hashName === 'SHA-384' ? 192 : 128, nistQuantumSecurityLevel: hashName === 'SHA-384' ? 3 : 1 }));
    suiteAlgs.push(`crypto/algorithm/hkdf-${hashName.toLowerCase()}`);

    const group = (t.group && t.group.name) || 'unknown';
    const groupRefs = [];
    if (/X25519/i.test(group)) {
      add(alg('crypto/algorithm/x25519', 'X25519', { primitive: 'key-agree', curve: 'Curve25519', parameterSetIdentifier: '255', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['keygen', 'other'], classicalSecurityLevel: 128, nistQuantumSecurityLevel: 0 }, '1.3.101.110'));
      groupRefs.push('crypto/algorithm/x25519');
    }
    if (/MLKEM768/i.test(group)) {
      add(alg('crypto/algorithm/ml-kem-768', 'ML-KEM-768', { primitive: 'kem', parameterSetIdentifier: '768', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['keygen', 'encapsulate', 'decapsulate'], classicalSecurityLevel: 192, nistQuantumSecurityLevel: 3 }, '2.16.840.1.101.3.4.4.2',
        { properties: [{ name: 'registratie:standard', value: 'NIST FIPS 203 (post-quantum)' }] }));
      groupRefs.push('crypto/algorithm/ml-kem-768');
    }
    if (groupRefs.length > 1) {
      add(alg('crypto/algorithm/' + group.toLowerCase(), group, { primitive: 'combiner', executionEnvironment: 'software-plain-ram', implementationPlatform: 'generic', cryptoFunctions: ['keygen', 'encapsulate', 'decapsulate'], classicalSecurityLevel: 128, nistQuantumSecurityLevel: 3 }, null,
        { properties: [{ name: 'registratie:note', value: 'Hybride sleuteluitwisseling (klassiek X25519 + post-quantum ML-KEM-768): beschermt ook tegen "harvest now, decrypt later".' }] }));
      deps.push({ ref: 'crypto/algorithm/' + group.toLowerCase(), dependsOn: groupRefs });
      groupRefs.unshift('crypto/algorithm/' + group.toLowerCase());
    }

    const cert = certComponents('crypto/github-pages', `TLS-certificaat ${SITE_HOST}`, t.cert,
      [{ name: 'registratie:sha256-fingerprint', value: t.cert.fp }, { name: 'registratie:managed-by', value: 'GitHub (automatische vernieuwing)' }]);
    cert.components.forEach(add);
    deps.push({ ref: cert.refs.cert, dependsOn: [cert.refs.sigRef, cert.refs.keyRef] });
    deps.push({ ref: cert.refs.keyRef, dependsOn: [cert.refs.keyAlgRef] });

    const version = (t.protocol || '').replace(/^TLSv/, '');
    add({ type: 'cryptographic-asset', 'bom-ref': 'crypto/protocol/tls-github-pages', name: `TLS ${version} (GitHub Pages)`,
      cryptoProperties: { assetType: 'protocol', protocolProperties: {
        type: 'tls', version,
        cipherSuites: [{ name: suite, algorithms: suiteAlgs, identifiers: TLS13_IDS[suite] }],
        cryptoRefArray: [...groupRefs, cert.refs.cert] } },
      properties: [
        { name: 'registratie:endpoint', value: `${SITE_HOST}:443` },
        { name: 'registratie:key-exchange-group', value: group },
        { name: 'registratie:observed-at', value: now },
        { name: 'registratie:observed-with', value: `Node.js ${process.version} / OpenSSL ${process.versions.openssl}` },
        { name: 'registratie:note', value: 'Waargenomen met de scan-client. Chrome op Android (versie 131+) onderhandelt doorgaans dezelfde hybride groep; oudere browsers vallen terug op X25519.' }
      ] });
    deps.push({ ref: 'crypto/protocol/tls-github-pages', dependsOn: [...suiteAlgs, ...groupRefs, cert.refs.cert] });
    appDeps.push('crypto/protocol/tls-github-pages');
  }

  // ---- Lokaal testcertificaat (alleen ontwikkel-pc, tools/serve.js) ----
  const devCertPath = path.join(ROOT, '.cert', 'cert.pem');
  const devComp = { type: 'application', 'bom-ref': 'tools/serve.js', name: 'Testserver (tools/serve.js)', scope: 'excluded',
    description: 'Alleen voor testen op het eigen netwerk; maakt een self-signed certificaat met openssl.' };
  const devDeps = [];
  if (fs.existsSync(devCertPath)) {
    const c = new crypto.X509Certificate(fs.readFileSync(devCertPath));
    const info = { subject: c.subject.replace(/\n/g, ', '), issuer: c.issuer.replace(/\n/g, ', '),
      from: c.validFromDate.toISOString().replace(/\.\d{3}Z$/, 'Z'), to: c.validToDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      keyType: c.publicKey.asymmetricKeyType, keyBits: (c.publicKey.asymmetricKeyDetails || {}).modulusLength,
      curve: (c.publicKey.asymmetricKeyDetails || {}).namedCurve, sigAlg: c.signatureAlgorithm };
    const cert = certComponents('crypto/dev-server', 'Self-signed testcertificaat (Registratie test)', info,
      [{ name: 'registratie:scope', value: 'Alleen lokaal (.cert/, staat in .gitignore, nooit gecommit of gepubliceerd)' }]);
    cert.components.forEach(add);
    add({ type: 'cryptographic-asset', 'bom-ref': 'crypto/dev-server/private-key', name: 'Self-signed testcertificaat – privésleutel',
      cryptoProperties: { assetType: 'related-crypto-material', relatedCryptoMaterialProperties: {
        type: 'private-key', algorithmRef: cert.refs.keyAlgRef, size: info.keyBits, format: 'PKCS#8 PEM',
        securedBy: { mechanism: 'None (onversleuteld bestand, -nodes); alleen lokaal op de ontwikkel-pc' } } } });
    deps.push({ ref: cert.refs.cert, dependsOn: [cert.refs.sigRef, cert.refs.keyRef] });
    deps.push({ ref: cert.refs.keyRef, dependsOn: [cert.refs.keyAlgRef] });
    deps.push({ ref: 'crypto/dev-server/private-key', dependsOn: [cert.refs.keyAlgRef] });
    devDeps.push(cert.refs.cert, 'crypto/dev-server/private-key');
  }
  add(devComp);
  deps.push({ ref: 'tools/serve.js', dependsOn: devDeps });

  // ---- Integriteit van afhankelijkheden en broncode ----
  deps.push({ ref: 'registratie-app', dependsOn: [...appDeps, 'crypto/algorithm/sha-512', 'crypto/algorithm/sha-1', 'tools/serve.js'] });
  const allRefs = new Set(components.map(c => c['bom-ref']).concat('registratie-app'));
  for (const r of allRefs) if (!deps.some(d => d.ref === r)) deps.push({ ref: r, dependsOn: [] });

  return {
    bomFormat: 'CycloneDX', specVersion: '1.6',
    serialNumber: 'urn:uuid:' + crypto.randomUUID(), version: 1,
    metadata: {
      timestamp: now, tools: toolInfo, component: appComponent,
      properties: [
        { name: 'registratie:app-runtime-crypto', value: 'Geen. De app (index.html) gebruikt geen Web Crypto API, geen eigen versleuteling en geen sleutels. Gegevens staan onversleuteld in localStorage op het toestel; bescherming in rust komt van de apparaatversleuteling van Android.' },
        { name: 'registratie:non-cryptographic', value: 'CRC-32 (zip/png in tools/build.js), Reed-Solomon (QR-foutcorrectie in jsQR) en Math.random (record-ID\'s) zijn niet-cryptografisch en worden niet voor beveiliging gebruikt.' },
        { name: 'registratie:tls-probe', value: t ? 'live gemeten' : 'overgeslagen (--offline of geen verbinding)' }
      ]
    },
    components, dependencies: deps
  };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const clean = o => JSON.parse(JSON.stringify(o)); // verwijdert undefined-velden
  const sbom = clean(buildSbom());
  const cbom = clean(await buildCbom());
  fs.writeFileSync(path.join(OUT_DIR, 'sbom.cdx.json'), JSON.stringify(sbom, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'cbom.cdx.json'), JSON.stringify(cbom, null, 2) + '\n');
  console.log(`SBOM: security/sbom.cdx.json (${sbom.components.length} componenten)`);
  console.log(`CBOM: security/cbom.cdx.json (${cbom.components.length} cryptografische items)`);
})();
