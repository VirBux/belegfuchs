// Startet die gebaute App, lädt die Testrechnungen, scannt sie und macht Screenshots.
// Aufruf: node scripts/e2e-smoke.mjs <ausgabeordner>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'e2e-out'));
fs.mkdirSync(out, { recursive: true });
const shot = (name) => path.join(out, name);
const samples = fs.readdirSync(path.join(root, 'samples')).filter((f) => f.endsWith('.pdf')).map((f) => path.join(root, 'samples', f));

const app = await electron.launch({ args: [root], env: { ...process.env, BELEGFUCHS_E2E_OUT: out } });
const win = await app.firstWindow();
win.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[renderer:${m.type()}]`, m.text()));
win.on('pageerror', (e) => console.log('[pageerror]', e.message));
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1500, 940);
  w.center();
});
await win.waitForSelector('.topbar', { timeout: 30000 });
await win.waitForTimeout(800);
await win.screenshot({ path: shot('01-start.png') });

// Datei-Dialog im Hauptprozess durch feste Auswahl ersetzen
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
}, samples);
await win.click('text=PDFs hinzufügen');
await win.waitForSelector('table.grid tbody tr');
await win.waitForTimeout(500);
await win.screenshot({ path: shot('02-added.png') });

const t0 = Date.now();
await win.click('button.btn-primary:has-text("scannen")');
await win.waitForFunction(
  () => {
    const s = window.__belegfuchs.useStore.getState();
    return s.docs.length > 0 && s.docs.every((d) => d.status === 'scanned' || d.status === 'error' || d.status === 'verified');
  },
  null,
  { timeout: 15 * 60 * 1000, polling: 1000 }
);
console.log(`Scan aller Dokumente: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await win.waitForTimeout(600);
await win.screenshot({ path: shot('03-scanned.png') });

const state = await win.evaluate(() => {
  const s = window.__belegfuchs.useStore.getState();
  return s.docs.map((d) => ({
    file: d.fileName,
    status: d.status,
    error: d.error,
    ai: d.aiModel,
    sources: [...new Set(d.pages.map((p) => p.source))],
    fields: Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, `${v.value} [${v.source}${v.boxes.length ? '' : ', ohne Box'}]`])),
    positions: d.positions.map((p) => `${p.titel} | ${p.menge ?? '-'} | ${p.preis ?? '-'}${p.boxes.length ? '' : ' (ohne Box)'}`)
  }));
});
fs.writeFileSync(shot('state.json'), JSON.stringify(state, null, 2));
for (const d of state) {
  console.log(`\n== ${d.file} [${d.status}] ${d.ai ?? 'ohne KI'} ${d.sources.join('+')} ${d.error ?? ''}`);
  for (const [k, v] of Object.entries(d.fields)) console.log(`   ${k}: ${v}`);
  for (const p of d.positions) console.log(`   - ${p}`);
}

// Prüfansicht des ersten Dokuments
await win.click('table.grid tbody tr >> nth=0');
await win.waitForSelector('.pdf-page canvas');
await win.waitForTimeout(1500);
await win.screenshot({ path: shot('04-review.png') });

await app.close();
