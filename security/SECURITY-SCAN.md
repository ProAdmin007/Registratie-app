# Securityscan – Registratie-app

**Datum:** 23-11-2026 · **Versie:** 1.0.0 · **Scope:** broncode (`src/`, `tools/`), meegebundelde bibliotheek, ontwikkelafhankelijkheden, git-geschiedenis, gepubliceerde site op GitHub Pages.

## Samenvatting

| | Resultaat |
|---|---|
| Kwetsbaarheden in runtime-afhankelijkheden | **0** – enige runtime-bibliotheek is jsQR 1.4.0 (geen bekende CVE's in OSV, nieuwste versie) |
| Kwetsbaarheden in ontwikkelafhankelijkheden | 9 × *high* gevonden → **opgelost** (puppeteer-core 23 → 25); `npm audit`: 0 |
| Geheimen in code of git-geschiedenis | **Geen** |
| Bevindingen in de app zelf | 1 × middel, 1 × laag, 2 × info → **alle opgelost** |
| Gegevens die het toestel verlaten | **Geen** – technisch afgedwongen met Content-Security-Policy |

## Werkwijze

1. **Afhankelijkheden:** `npm audit`, OSV-database (api.osv.dev) voor `jsqr@1.4.0`, controle van de SHA-256 van het meegebundelde bestand tegen het npm-pakket.
2. **Geheimen:** patroonscan (GitHub-/AWS-/Google-/Slack-tokens, private keys, wachtwoorden) over werkmap én volledige git-geschiedenis; controle op gecommitte `.pem`/`.env`/credential-bestanden.
3. **Handmatige code-review** van `src/app.js`, `src/logic.js`, `src/sw.js`, `src/index.html` en `tools/*.js` op: XSS/DOM-injectie, CSV-injectie, onveilige navigatie, gegevensuitstroom, service-worker-gedrag, padtraversal en command-injectie in de tooling.
4. **Dynamische controle** in headless Chrome: pogingen tot gegevensuitstroom (fetch, image-beacon, extern script, WebSocket) en script-injectie (inline script, `onerror`-handler) tegen de gebouwde app.
5. **Regressietests:** 26 geautomatiseerde tests (unit + end-to-end); elke CSP-overtreding laat een test falen.

## Bevindingen

| # | Ernst | Bevinding | Status |
|---|---|---|---|
| F1 | **Middel** | **CSV/formule-injectie.** Een QR-code die begint met `=`, `+`, `-` of `@` (bijv. een gemanipuleerde sticker met `=HYPERLINK("https://…","klik")`) werd ongewijzigd in de CSV gezet en door Excel bij de ontvanger als formule uitgevoerd. | **Opgelost** in `src/logic.js`: zulke waarden krijgen een voorloop-apostrof (OWASP-advies), Excel toont ze als tekst. Test toegevoegd. |
| F2 | Laag | **Geen Content-Security-Policy.** Niets hield technisch tegen dat (bij een toekomstige bug of aangepaste code) gegevens naar een externe server gaan of geïnjecteerde scripts draaien. | **Opgelost:** strikte CSP in `index.html`: `default-src 'none'`, scripts alleen via SHA-256-hash van exact de eigen scripts, `connect-src 'self'`, geen externe afbeeldingen/scripts, `base-uri`/`form-action 'none'`, plus `referrer: no-referrer`. Geverifieerd: fetch, beacon, extern script, geïnjecteerd inline script en `onerror`-handler worden geblokkeerd. |
| F3 | Info | `innerHTML` in de waarschuwingsbalk (alleen vaste tekst, geen gebruikersinvoer – niet uitbuitbaar). | **Opgelost:** vervangen door DOM-opbouw met `textContent`. Er staat geen `innerHTML`, `eval` of `new Function` meer in de app-code. |
| F4 | Info | Testserver (`tools/serve.js`) luisterde met http op alle netwerkkaarten. | **Opgelost:** http alleen op `127.0.0.1`. (https op 8443 blijft bewust op het netwerk voor telefoon-tests.) |
| F5 | Hoog (alleen ontwikkeltools) | 9 kwetsbaarheden in transitieve afhankelijkheden van `puppeteer-core@23` (o.a. `extract-zip` path traversal, `basic-ftp` DoS). Niet in de app; alleen relevant op de ontwikkel-pc tijdens testen. | **Opgelost:** `puppeteer-core@25`; `npm audit` meldt 0. |

### Wat goed is (geen actie nodig)
- **XSS:** QR-inhoud en locaties worden uitsluitend via `textContent` getoond; dialogen en lijst bouwen DOM-knooppunten op.
- **Geen QR-navigatie:** de app opent nooit de inhoud van een QR-code (geen phishing via een QR-URL).
- **Geen uitstroom:** de app doet na het laden geen netwerkverzoeken; de service worker haalt alleen eigen bestanden (same-origin GET) op.
- **mailto-fallback:** onderwerp en tekst worden met `encodeURIComponent` gecodeerd.
- **Tooling:** `build.js`/`deploy.js` gebruiken `execFileSync` met argumentlijsten (geen shell-injectie); `serve.js` blokkeert padtraversal via `path.join`-normalisatie + prefixcontrole.
- **Geheimen:** de lokale testsleutel `.cert/key.pem` staat in `.gitignore` en is nooit gecommit.
- **Reproduceerbare build:** dezelfde broncode geeft bit-voor-bit dezelfde `index.html` en zip; de hashes in de SBOM zijn daardoor controleerbaar.
- **Transport:** GitHub Pages levert via TLS 1.3 met hybride post-quantum sleuteluitwisseling (X25519MLKEM768) – zie CBOM.

## Restrisico's en aanbevelingen

| Onderwerp | Toelichting | Aanbeveling |
|---|---|---|
| Locatiegegevens (AVG) | Sinds versie met GPS bevat elke registratie de coördinaten van de monteur op dat moment. De app meet alleen tussen *Scan* en *Toevoegen* (niet op de achtergrond; uit na 3 min zonder scan) en verstuurt niets zelf. | Informeer monteurs dat de positie per registratie wordt vastgelegd; bewaar de CSV's volgens het eigen bewaarbeleid. |
| Gegevens in rust | Registraties staan onversleuteld in `localStorage` van de browser. Beschermd door de schermvergrendeling/versleuteling van Android. | Telefoons met pincode/biometrie; na versturen **Nieuwe scanronde** gebruiken. |
| `style-src 'unsafe-inline'` | Nodig voor de ene-bestand-opzet. Stijl-injectie kan geen scripts uitvoeren of gegevens versturen (CSP blokkeert dat). | Acceptabel. |
| Clickjacking | GitHub Pages ondersteunt geen `frame-ancestors`-header; via `<meta>` kan dat niet. De app heeft geen account of gevoelige acties. | Acceptabel. |
| Toeleveringsketen / account | Wie schrijfrechten op de repository heeft, kan via `npm run deploy` de app voor alle gebruikers vervangen. | GitHub-account met 2FA; overweeg branch protection op `main`. |
| Openbare git-metadata | Het e-mailadres van de commit-auteur is zichtbaar in de openbare geschiedenis. | Zet in GitHub "Keep my email addresses private" aan en gebruik het `@users.noreply.github.com`-adres voor nieuwe commits. |
| CSV-apostrof | Waarden die met `=`, `+`, `-` of `@` beginnen krijgen in de CSV een `'` ervoor (zichtbaar in Excel/teksteditor). | Bewuste afweging (veiligheid boven exacte weergave). |

## SBOM en CBOM

| Bestand | Inhoud |
|---|---|
| [`sbom.cdx.json`](sbom.cdx.json) | CycloneDX 1.6 SBOM: 1 runtime-bibliotheek (jsQR, Apache-2.0), 8 gepubliceerde bestanden met SHA-256, 58 ontwikkelpakketten (scope `excluded`) met licenties en SHA-512-integriteit. Licenties: MIT, ISC, Apache-2.0, BSD-3-Clause – geen copyleft. |
| [`cbom.cdx.json`](cbom.cdx.json) | CycloneDX 1.6 CBOM: TLS 1.3 van GitHub Pages (live gemeten), cipher suite, sleuteluitwisseling, certificaat met algoritmen; het lokale testcertificaat; hashalgoritmen in de toolchain. Per algoritme klassiek en NIST post-quantum beveiligingsniveau. |

**Cryptografie in de app zelf: geen.** De app gebruikt geen Web Crypto, geen sleutels en geen eigen versleuteling. Alle cryptografie zit in het transport (HTTPS) en in de ontwikkeltooling.

| Item | Waar | Quantum-bestendig? |
|---|---|---|
| TLS 1.3, `TLS_AES_128_GCM_SHA256` | GitHub Pages → telefoon | AES-128: NIST-niveau 1 ✔ |
| X25519MLKEM768 (hybride) | sleuteluitwisseling | ✔ ML-KEM-768 (FIPS 203, niveau 3) |
| RSA-2048 + sha256WithRSAEncryption | certificaat `*.github.io` (Let's Encrypt), beheerd door GitHub | ✘ – migratie ligt bij GitHub/CA's |
| RSA-2048 self-signed | lokaal testcertificaat, niet gepubliceerd | ✘ – alleen voor testen |
| SHA-512 / SHA-256 | npm-integriteit, SBOM-hashes, CSP-hashes | ✔ |
| SHA-1 | git object-ID's | ✘ – niet gebruikt voor beveiliging van gegevens |

Validatie: beide bestanden worden in de testsuite (`test/bom.test.js`) gecontroleerd tegen het officiële CycloneDX 1.6 JSON-schema, inclusief verwijzingsintegriteit en de hash van de meegebundelde jsQR.

## Opnieuw uitvoeren

```bash
npm audit                 # kwetsbaarheden in afhankelijkheden
npm run bom               # bouwt en genereert security/sbom.cdx.json + cbom.cdx.json
npm test                  # 26 tests: logica, e2e in Chrome (incl. CSP), schema-validatie SBOM/CBOM
```
