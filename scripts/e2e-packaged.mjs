// Prüft die gepackte App: node scripts/e2e-packaged.mjs <ausgabeordner>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'e2e-out'));
fs.mkdirSync(out, { recursive: true });
const exe = path.join(root, 'release', 'win-unpacked', 'Belegfuchs.exe');
const samples = ['01_Muster_Elektro_CH.pdf', '06_Scan_Malerbetrieb_Huber.pdf'].map((f) => path.join(root, 'samples', f));
const settingsFile = path.join(process.env.APPDATA, 'Belegfuchs', 'settings.json');
const backup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : null;

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};

const app = await electron.launch({ executablePath: exe, env: { ...process.env, BELEGFUCHS_E2E_OUT: out } });
try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  win.on('console', (m) => m.type() === 'error' && console.log('[renderer:error]', m.text()));
  await win.waitForSelector('.topbar', { timeout: 30000 });
  const info = await win.evaluate(() => window.belegfuchs.app.info());
  check(info.packaged, `gepackt, Version ${info.version}`);
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, samples);
  await win.click('text=PDFs hinzufügen');
  await win.waitForFunction(() => window.__belegfuchs.useStore.getState().docs.length === 2);
  const t0 = Date.now();
  await win.click('button.btn-primary:has-text("scannen")');
  await win.waitForFunction(
    () => window.__belegfuchs.useStore.getState().docs.every((d) => d.status === 'scanned' || d.status === 'error'),
    null,
    { timeout: 600000, polling: 500 }
  );
  console.log(`  Scan: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const s = await win.evaluate(() => {
    const st = window.__belegfuchs.useStore.getState();
    return { docs: st.docs, llm: st.llm };
  });
  const [ch, scan] = s.docs;
  check(ch.status === 'scanned' && scan.status === 'scanned', 'beide Dokumente gescannt');
  check(Boolean(ch.aiModel && scan.aiModel), `KI genutzt (${ch.aiModel}) auf ${s.llm.gpu ? `GPU ${s.llm.gpuName}` : 'CPU'}`);
  check(scan.pages[0]?.source === 'ocr' && scan.fields.totalbetrag?.value === '2425.75', `OCR im Paket: Total ${scan.fields.totalbetrag?.value}`);
  check(ch.fields.kreditor?.value === 'Muster Elektro AG', `Kreditor ${ch.fields.kreditor?.value} [${ch.fields.kreditor?.source}]`);
  // Drag & Drop einer weiteren PDF simulieren
  await win.evaluate(async (file) => {
    const [picked] = await window.belegfuchs.readFiles([file]);
    const dt = new DataTransfer();
    dt.items.add(new File([picked.bytes], picked.name, { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, path.join(root, 'samples', '02_Druckerei_Schmidt_DE.pdf'));
  await win.waitForFunction(() => window.__belegfuchs.useStore.getState().docs.length === 3, null, { timeout: 10000 }).catch(() => undefined);
  const afterDrop = await win.evaluate(() => window.__belegfuchs.useStore.getState().docs.map((d) => d.fileName));
  check(afterDrop.includes('02_Druckerei_Schmidt_DE.pdf'), `Drag & Drop: ${afterDrop.length} Dokumente`);

  await win.click('table.grid tbody tr >> nth=0');
  await win.waitForSelector('.pdf-page canvas');
  await win.waitForTimeout(1500);
  await win.keyboard.press('6');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(out, 'packaged-review.png') });
} finally {
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
  if (backup) fs.writeFileSync(settingsFile, backup);
  else fs.rmSync(settingsFile, { force: true });
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
