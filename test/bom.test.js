'use strict';
/* Valideert security/sbom.cdx.json en cbom.cdx.json tegen het officiële CycloneDX 1.6-schema. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SEC = path.join(ROOT, 'security');
const SCHEMA = path.join(__dirname, 'schema');
let Ajv, addFormats;
try { Ajv = require('ajv'); addFormats = require('ajv-formats'); } catch (e) { /* skip */ }
const skip = !Ajv ? 'ajv niet geïnstalleerd' : !fs.existsSync(path.join(SEC, 'sbom.cdx.json')) ? 'eerst `npm run bom`' : false;

function validator() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of ['spdx.schema.json', 'jsf-0.82.schema.json']) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA, f), 'utf8')), f);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(SCHEMA, 'bom-1.6.schema.json'), 'utf8')));
}
const load = f => JSON.parse(fs.readFileSync(path.join(SEC, f), 'utf8'));
const refsOk = bom => {
  const refs = new Set(bom.components.map(c => c['bom-ref']).concat(bom.metadata.component['bom-ref']));
  for (const d of bom.dependencies) {
    assert.ok(refs.has(d.ref), 'onbekende ref ' + d.ref);
    for (const r of d.dependsOn || []) assert.ok(refs.has(r), `onbekende dependsOn ${r} (in ${d.ref})`);
  }
  assert.equal(refs.size, bom.components.length + 1, 'bom-refs uniek');
};

test('SBOM is geldig CycloneDX 1.6 en klopt met de broncode', { skip }, () => {
  const bom = load('sbom.cdx.json');
  const validate = validator();
  assert.ok(validate(bom), JSON.stringify(validate.errors, null, 1));
  refsOk(bom);
  const jsqr = bom.components.find(c => c.name === 'jsqr');
  assert.equal(jsqr.scope, 'required');
  const vendorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/vendor/jsQR.js'))).digest('hex');
  assert.equal(jsqr.hashes.find(h => h.alg === 'SHA-256').content, vendorHash, 'hash van meegebundelde jsQR');
  const runtime = bom.components.filter(c => c.type === 'library' && c.scope !== 'excluded');
  assert.deepEqual(runtime.map(c => c.name), ['jsqr'], 'enige runtime-bibliotheek');
});

test('CBOM is geldig CycloneDX 1.6 en volledig', { skip }, () => {
  const bom = load('cbom.cdx.json');
  const validate = validator();
  assert.ok(validate(bom), JSON.stringify(validate.errors, null, 1));
  refsOk(bom);
  const crypto = bom.components.filter(c => c.type === 'cryptographic-asset');
  assert.ok(crypto.length >= 5);
  for (const c of crypto) {
    const ap = c.cryptoProperties.algorithmProperties;
    if (ap) assert.ok(Number.isInteger(ap.nistQuantumSecurityLevel), c.name + ' heeft quantum-niveau');
  }
  for (const c of crypto.filter(c => c.cryptoProperties.assetType === 'certificate')) {
    const p = c.cryptoProperties.certificateProperties;
    const ids = new Set(crypto.map(x => x['bom-ref']));
    assert.ok(ids.has(p.signatureAlgorithmRef) && ids.has(p.subjectPublicKeyRef), c.name + ' verwijzingen');
  }
});
