// End-to-End-Test der Bedienung: node scripts/e2e-flow.mjs <ausgabeordner>
// Sichert die Einstellungen des Nutzers vorher und stellt sie danach wieder her.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'e2e-out'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const shot = (name) => path.join(out, name);
const samples = fs.readdirSync(path.join(root, 'samples')).filter((f) => f.endsWith('.pdf')).map((f) => path.join(root, 'samples', f));
const settingsFile = path.join(process.env.APPDATA, 'Belegfuchs', 'settings.json');
const settingsBackup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : null;

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};

const app = await electron.launch({ args: [root], env: { ...process.env, BELEGFUCHS_E2E_OUT: out } });
try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  win.on('console', (m) => m.type() === 'error' && console.log('[renderer:error]', m.text()));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 980);
    w.center();
  });
  await win.waitForSelector('.topbar');
  const state = (fn) => win.evaluate(fn);
  const getState = () => state(() => window.__belegfuchs.useStore.getState());
  const doc = async (i) => (await getState()).docs[i];
  const waitFor = (fn, arg, timeout = 120000) => win.waitForFunction(fn, arg, { timeout, polling: 300 });

  // Dateien hinzufügen und scannen
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, samples);
  await win.click('text=PDFs hinzufügen');
  await waitFor(() => window.__belegfuchs.useStore.getState().docs.length === 6);
  check(true, '6 PDFs hinzugefügt');
  const t0 = Date.now();
  await win.click('button.btn-primary:has-text("scannen")');
  await waitFor(() => window.__belegfuchs.useStore.getState().docs.every((d) => d.status === 'scanned' || d.status === 'error'), null, 900000);
  console.log(`  Scan: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const scanned = await getState();
  check(scanned.docs.every((d) => d.status === 'scanned'), 'alle Dokumente gescannt');
  check(scanned.docs[0].fields.kreditor?.value === 'Muster Elektro AG', `Kreditor Dok. 1 = ${scanned.docs[0].fields.kreditor?.value}`);
  check(scanned.docs[5].pages[0].source === 'ocr', 'gescannte PDF per OCR gelesen');

  // Vorschlag "eigene Firma"
  const suggestion = win.locator('.toast .act:has-text("Als eigene Firma festlegen")');
  await suggestion.waitFor({ timeout: 5000 }).catch(() => undefined);
  const hasSuggestion = (await suggestion.count()) > 0;
  check(hasSuggestion, 'Vorschlag «eigene Firma» erscheint');
  if (hasSuggestion) {
    await suggestion.click();
    await waitFor(() => window.__belegfuchs.useStore.getState().settings.ownCompany === 'Belegfuchs GmbH');
    check(true, 'eigene Firma gespeichert');
  }
  await win.screenshot({ path: shot('01-overview.png') });

  // Prüfansicht Dokument 1
  await win.click('table.grid tbody tr >> nth=0');
  await win.waitForSelector('.pdf-page canvas');
  await win.waitForTimeout(1200);

  /** Bildschirmkoordinaten eines Wortes im PDF. */
  const wordPoint = async (text, fx = 0.5, fy = 0.5) =>
    win.evaluate(
      ({ text, fx, fy }) => {
        const s = window.__belegfuchs.useStore.getState();
        const d = s.docs.find((x) => x.id === s.currentDocId);
        for (const p of d.pages) {
          const w = p.words.find((x) => x.text === text);
          if (!w) continue;
          const el = document.querySelector(`[data-page="${p.index}"]`);
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + (w.x + w.w * fx) * r.width, y: r.top + (w.y + w.h * fy) * r.height, w: w.w * r.width, h: w.h * r.height };
        }
        return null;
      },
      { text, fx, fy }
    );
  const field = async (id) => (await doc(0)).fields[id];

  // Klick-Auswahl: Totalbetrag auf das Zwischentotal setzen
  await win.keyboard.press('6');
  await win.waitForSelector('.assign-hint');
  let pt = await wordPoint("1'697.70");
  await win.mouse.move(pt.x, pt.y);
  await win.waitForTimeout(150);
  await win.screenshot({ path: shot('02-assign-hover.png') });
  await win.mouse.click(pt.x, pt.y);
  await win.waitForTimeout(200);
  let f = await field('totalbetrag');
  check(f.value === '1697.70' && f.source === 'pick', `Klick-Auswahl → Totalbetrag ${f.value} [${f.source}]`);

  // Rahmen um den echten Total ziehen (Wörter sauber im Rahmen → kein OCR nötig)
  await win.keyboard.press('6');
  pt = await wordPoint("1'835.20");
  await win.mouse.move(pt.x - pt.w / 2 - 8, pt.y - pt.h);
  await win.mouse.down();
  await win.mouse.move(pt.x + pt.w / 2 + 8, pt.y + pt.h, { steps: 8 });
  await win.mouse.up();
  await waitFor(() => {
    const s = window.__belegfuchs.useStore.getState();
    return s.docs[0].fields.totalbetrag?.source === 'box';
  }, null, 30000);
  f = await field('totalbetrag');
  check(f.value === '1835.20', `Rahmen → Totalbetrag ${f.value} [${f.source}]`);

  // Rahmen, der ein Wort anschneidet → Texterkennung des Ausschnitts
  await win.keyboard.press('7');
  pt = await wordPoint('137.50');
  const before = await wordPoint('8.1%');
  await win.mouse.move(before.x, pt.y - pt.h);
  await win.mouse.down();
  await win.mouse.move(pt.x + pt.w / 2 + 10, pt.y + pt.h * 1.1, { steps: 8 });
  await win.mouse.up();
  await waitFor(() => window.__belegfuchs.useStore.getState().docs[0].fields.steueranteil?.source === 'box', null, 60000);
  f = await field('steueranteil');
  check(f.value === '137.50', `Rahmen mit OCR → Steueranteil ${f.value} [${f.source}]`);

  // Manuelle Eingabe
  const titleInput = win.locator('.field-row:has(.field-label:has-text("Titel")) input');
  await titleInput.click();
  await titleInput.fill('Testtitel manuell');
  await titleInput.press('Enter');
  await win.waitForTimeout(150);
  f = await field('titel');
  check(f.value === 'Testtitel manuell' && f.source === 'manual' && f.boxes.length === 0, `manuelle Eingabe → ${f.value} [${f.source}]`);

  // Positionen: alle löschen, dann per Rahmen um die Tabelle neu erfassen
  await win.click('button[title="Alle Positionen entfernen"]');
  check((await doc(0)).positions.length === 0, 'Positionen gelöscht');
  await win.keyboard.press('9');
  const p1 = await wordPoint('Installationsarbeiten');
  const p4 = await wordPoint('pauschal');
  const lastAmount = await wordPoint('45.00');
  await win.mouse.move(p1.x - 60, p1.y - 10);
  await win.mouse.down();
  await win.mouse.move(Math.max(lastAmount.x, p4.x) + 160, p4.y + 10, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const pos = (await doc(0)).positions;
  check(pos.length === 4 && pos[0].preis === 1176 && pos[3].preis === 45, `Positionen per Rahmen: ${pos.map((p) => `${p.titel}=${p.preis}`).join('; ')}`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await win.screenshot({ path: shot('03-review-doc1.png') });

  // Gescanntes Dokument ansehen
  await win.evaluate(() => {
    const s = window.__belegfuchs.useStore.getState();
    window.__belegfuchs.useStore.setState({ currentDocId: s.docs[5].id });
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: shot('04-review-scan.png') });

  // Alles prüfen: Ctrl+Enter bis zurück in der Übersicht
  await win.evaluate(() => {
    const s = window.__belegfuchs.useStore.getState();
    window.__belegfuchs.useStore.setState({ currentDocId: s.docs[0].id });
  });
  for (let i = 0; i < 8; i++) {
    if ((await getState()).view !== 'review') break;
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(350);
  }
  const afterVerify = await getState();
  check(afterVerify.view === 'overview' && afterVerify.docs.every((d) => d.status === 'verified'), 'alle Dokumente geprüft, zurück in der Übersicht');

  // Eigene Spalte hinzufügen und von der KI suchen lassen
  await win.click('button:has-text("Spalten")');
  await win.click('button:has-text("Eigene Spalte")');
  const items = win.locator('.col-item');
  const last = items.nth((await items.count()) - 1);
  await last.locator('input.input').first().fill('Kundennummer');
  await last.locator('input.desc').fill('Kundennummer des Empfängers beim Lieferanten (Kunden-Nr.)');
  await win.click('button:has-text("Übernehmen")');
  await win.click('.modal button:has-text("Jetzt suchen")');
  await waitFor(() => {
    const s = window.__belegfuchs.useStore.getState();
    const col = s.columns.find((c) => c.label === 'Kundennummer');
    return col && Object.keys(s.runtime).length === 0 && s.docs.some((d) => d.fields[col.id]);
  }, null, 300000);
  const custom = await state(() => {
    const s = window.__belegfuchs.useStore.getState();
    const col = s.columns.find((c) => c.label === 'Kundennummer');
    return s.docs.map((d) => d.fields[col.id]?.value ?? '');
  });
  check(custom[0] === 'K-10442' && custom[1] === 'K-55120', `eigene Spalte gefunden: ${custom.join(' | ')}`);
  await win.waitForTimeout(400);
  await win.screenshot({ path: shot('05-custom-column.png') });

  // Export Excel + CSV (ohne Dialog in den Testordner)
  for (const fmt of ['xlsx', 'csv']) {
    await win.click('button:has-text("Export")');
    if (fmt === 'csv') await win.click('.option-card:has-text("CSV")');
    await win.click('.modal-foot button.btn-primary');
    await win.waitForSelector('.modal', { state: 'detached' });
  }
  const files = fs.readdirSync(out);
  const xlsx = files.find((x) => x.endsWith('.xlsx'));
  const csv = files.find((x) => x.endsWith('.csv'));
  check(Boolean(xlsx && csv), `Exportdateien: ${xlsx}, ${csv}`);
  if (xlsx) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(out, xlsx));
    const ws = wb.getWorksheet('Rechnungen');
    const header = ws.getRow(1).values.slice(1);
    const row2 = ws.getRow(2).values.slice(1);
    console.log('  Kopfzeile:', header.join(' | '));
    console.log('  Zeile 2:', row2.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)).join(' | '));
    const totalIdx = header.indexOf('Totalbetrag');
    const posIdx = header.indexOf('Positionen');
    check(typeof row2[totalIdx] === 'number' && row2[totalIdx] === 1835.2, 'Excel: Totalbetrag als Zahl');
    const posJson = JSON.parse(row2[posIdx]);
    check(posJson.pos1?.titel === 'Installationsarbeiten Elektriker' && posJson.pos1?.preis === 1176, `Excel: Positionen-JSON ${row2[posIdx].slice(0, 90)}…`);
    check(Boolean(wb.getWorksheet('Positionen')), 'Excel: Blatt «Positionen» vorhanden');
  }
  if (csv) {
    const text = fs.readFileSync(path.join(out, csv), 'utf8');
    console.log('  CSV:', text.split('\r\n').slice(0, 2).join('\n       '));
    check(text.startsWith('﻿') && text.split('\r\n').length >= 7, 'CSV mit BOM und 6 Datenzeilen');
  }

  // Projekt speichern, neues Projekt, wieder öffnen
  await win.keyboard.press('Control+s');
  await waitFor(() => !window.__belegfuchs.useStore.getState().dirty, null, 20000);
  const fuchs = fs.readdirSync(out).find((x) => x.endsWith('.fuchs'));
  check(Boolean(fuchs), `Projekt gespeichert: ${fuchs}`);
  await win.keyboard.press('Control+n');
  await waitFor(() => window.__belegfuchs.useStore.getState().docs.length === 0);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path.join(out, fuchs));
  await win.keyboard.press('Control+o');
  await waitFor(() => window.__belegfuchs.useStore.getState().docs.length === 6);
  const reopened = await getState();
  check(
    reopened.docs.every((d) => d.status === 'verified') && reopened.columns.some((c) => c.label === 'Kundennummer') && reopened.docs[0].positions.length === 4,
    'Projekt wieder geöffnet: Status, eigene Spalte und Positionen erhalten'
  );
  await win.click('table.grid tbody tr >> nth=0');
  await win.waitForSelector('.pdf-page canvas');
  await win.waitForTimeout(1200);
  await win.screenshot({ path: shot('06-reopened.png') });
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  if (settingsBackup) fs.writeFileSync(settingsFile, settingsBackup);
  else fs.rmSync(settingsFile, { force: true });
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
