#!/usr/bin/env node
/*
 * Publiceert dist/Registratie (+ de zip) naar de gh-pages-branch → GitHub Pages.
 * Gebruik: npm run deploy   (bouwt eerst opnieuw)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'dist', 'Registratie');
const ZIP = path.join(ROOT, 'dist', 'Registratie.zip');
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

if (!fs.existsSync(path.join(SITE, 'index.html'))) { console.error('Eerst bouwen: npm run build'); process.exit(1); }
const remote = git(['remote', 'get-url', 'origin'], ROOT);
const commit = git(['rev-parse', '--short', 'HEAD'], ROOT);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-pages-'));
try {
  fs.cpSync(SITE, tmp, { recursive: true });
  fs.copyFileSync(ZIP, path.join(tmp, 'Registratie.zip'));
  fs.writeFileSync(path.join(tmp, '.nojekyll'), '');
  git(['init', '-q', '-b', 'gh-pages'], tmp);
  git(['add', '-A'], tmp);
  // Zelfde auteur als de repository (bijv. het afgeschermde noreply-adres), niet de globale git-instelling.
  const name = git(['config', 'user.name'], ROOT), email = git(['config', 'user.email'], ROOT);
  git(['-c', 'user.name=' + name, '-c', 'user.email=' + email, 'commit', '-q', '-m', `Deploy ${commit}`], tmp);
  git(['push', '-q', '-f', remote, 'gh-pages'], tmp);
  console.log('Gepubliceerd naar gh-pages (bron ' + commit + ').');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
