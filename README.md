# Registratie

[![Open de app](https://img.shields.io/badge/app-openen-0b4bb3)](https://proadmin007.github.io/Registratie-app/)
![Geen installatie](https://img.shields.io/badge/installatie-niet%20nodig-0b7d3e)
![Privacy](https://img.shields.io/badge/data-blijft%20op%20toestel-0b7d3e)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-steun-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/proadmin007)

Eenvoudige mobiele webapp voor monteurs: **QR-code scannen → locatie invullen → volgende**.
Als je klaar bent maakt de app een CSV-bestand en verstuurt het via het Android-deelmenu (Outlook/Gmail) als bijlage.

**👉 App openen: https://proadmin007.github.io/Registratie-app/**

## Gebruik op Android
1. Open de link hierboven in **Chrome**.
2. Optioneel: menu **⋮ → Toevoegen aan startscherm** – daarna werkt de app als een gewone app, ook offline.
3. **Scan QR-code** → **Locatie** invullen → **Toevoegen** → herhalen.
4. **Klaar - CSV maken** → het bestand komt in *Downloads*.
5. **CSV via e-mail versturen** → kies Outlook of Gmail; de CSV zit als bijlage in een nieuwe mail.

Liever zonder internetadres? Download [Registratie.zip](https://proadmin007.github.io/Registratie-app/Registratie.zip),
pak uit en open `index.html` met Chrome. Dan opent de camera-app (foto maken) in plaats van live scannen
en moet de bijlage handmatig worden toegevoegd – zie `LEESMIJ.txt` in de zip.

## Privacy
- Alle registraties blijven **alleen op het toestel** (localStorage). Er is geen server, database, account, tracking of analytics.
- GitHub Pages levert alleen de app-bestanden; scangegevens worden nooit verstuurd.
- De CSV gaat via de eigen mail-app van de gebruiker naar de ontvanger.

## Security
Zie [security/SECURITY-SCAN.md](security/SECURITY-SCAN.md) voor de securityscan, plus de
[SBOM](security/sbom.cdx.json) en [CBOM](security/cbom.cdx.json) (CycloneDX 1.6). Opnieuw genereren: `npm run bom`.

## CSV-formaat
`QR-code,Locatie,Datum,Tijd` – UTF-8 met BOM (Excel-vriendelijk), correcte escaping van komma's, quotes en regeleinden.
Bestandsnaam: `JJJJ-MM-DD_UU-mm_registratie.csv`, mailonderwerp: `JJJJ-MM-DD registratie`.

## Ontwikkeling
Vanilla HTML/CSS/JS, geen framework. QR-herkenning via de BarcodeDetector API met [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) als fallback, lokaal meegebundeld.

| Map/bestand | Inhoud |
|---|---|
| `src/` | broncode (`index.html`, `styles.css`, `logic.js`, `app.js`, `sw.js`, `manifest.json`) |
| `tools/build.js` | bouwt `dist/` met één zelfstandige `index.html` + zip |
| `tools/serve.js` | lokale testserver (http :8080, https :8443 met self-signed certificaat) |
| `tools/deploy.js` | publiceert naar GitHub Pages (`gh-pages`-branch) |
| `test/` | unit-tests en end-to-end tests in headless Chrome |

```bash
npm install        # alleen nodig voor de e2e-tests (puppeteer-core, qrcode)
npm run build      # dist/
npm test           # unit + e2e
npm start          # bouwen + testserver
npm run deploy     # bouwen + publiceren naar GitHub Pages
```

## ☕ Support
<a href="https://ko-fi.com/proadmin007"><img alt="Buy me a coffee on Ko-fi" src="https://ko-fi.com/img/githubbutton_sm.svg"></a>
