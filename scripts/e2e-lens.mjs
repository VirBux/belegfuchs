// End-to-End-Test des Linsenmodus: node scripts/e2e-lens.mjs <ausgabeordner> [projekt.fuchs] [--cpu] [--ohne-ki]
// Ohne Projektdatei werden die Testrechnungen gescannt und als Projekt im Ausgabeordner gespeichert,
// damit weitere Läufe es wiederverwenden können (--cpu: KI und Darstellung ohne Grafikkarte,
// --ohne-ki: nur regelbasierte Erkennung, schnell).
// Prüft, dass Wert und Ausschnitt beim Weiterschalten an derselben Stelle bleiben
// und die nächsten Ausschnitte vorab gerendert sind.
// Prüft ausserdem die Korrektur direkt im Linsenmodus (E/F2/Klick, Enter, Esc, Tab).
// Sichert die Einstellungen des Nutzers vorher und stellt sie danach wieder her.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cpu = process.argv.includes('--cpu');
const noAi = process.argv.includes('--ohne-ki');
const out = path.resolve(args[0] ?? path.join(root, 'e2e-out-lens'));
const reuse = args[1] ? path.resolve(args[1]) : null;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const shot = (name) => path.join(out, name);
const samples = fs.readdirSync(path.join(root, 'samples')).filter((f) => f.endsWith('.pdf')).map((f) => path.join(root, 'samples', f));
const settingsFile = path.join(process.env.APPDATA, 'Belegfuchs', 'settings.json');
const settingsBackup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : null;
const restoreSettings = () => {
  if (settingsBackup) fs.writeFileSync(settingsFile, settingsBackup);
  else fs.rmSync(settingsFile, { force: true });
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restoreSettings();
    process.exit(130);
  });
}

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};

const app = await electron.launch({ args: cpu ? ['--disable-gpu', root] : [root], env: { ...process.env, BELEGFUCHS_E2E_OUT: out } });
const mainLog = path.join(out, 'main.log');
app.process().stdout?.on('data', (d) => fs.appendFileSync(mainLog, d));
app.process().stderr?.on('data', (d) => fs.appendFileSync(mainLog, d));
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
  const getState = () => win.evaluate(() => window.__belegfuchs.useStore.getState());
  const waitFor = (fn, arg, timeout = 120000) => win.waitForFunction(fn, arg, { timeout, polling: 200 });

  if (reuse) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, reuse);
    await win.keyboard.press('Control+o');
    await waitFor(() => window.__belegfuchs.useStore.getState().docs.length > 0);
    check(true, `Projekt geladen: ${path.basename(reuse)}`);
  } else {
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    }, samples);
    if (cpu) await win.evaluate(async () => window.__belegfuchs.useStore.setState({ settings: await window.belegfuchs.settings.set({ gpu: 'cpu' }) }));
    if (noAi) await win.evaluate(() => window.__belegfuchs.useStore.setState((s) => ({ llm: { ...s.llm, state: 'missing' } })));
    await win.click('text=PDFs hinzufügen');
    await waitFor((n) => window.__belegfuchs.useStore.getState().docs.length === n, samples.length);
    const t0 = Date.now();
    await win.click('button.btn-primary:has-text("scannen")');
    // Fortschritt ausgeben, damit ein hängender Scan erkennbar ist
    for (let last = ''; ; ) {
      const p = await win.evaluate(() => {
        const s = window.__belegfuchs.useStore.getState();
        return { done: s.docs.every((d) => d.status === 'scanned' || d.status === 'error'), text: `${s.docs.map((d) => d.status).join(',')} | ${Object.values(s.runtime).map((r) => r.stage).join(', ')} | KI ${s.llm.state}` };
      });
      if (p.done) break;
      if (p.text !== last) console.log(`  … ${Math.round((Date.now() - t0) / 1000)} s: ${(last = p.text)}`);
      if (Date.now() - t0 > 2700000) throw new Error('Scan dauert länger als 45 Minuten');
      await win.waitForTimeout(1000);
    }
    console.log(`  Scan: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await win.keyboard.press('Control+s');
    await waitFor(() => !window.__belegfuchs.useStore.getState().dirty, null, 20000);
    check(true, `gescannt und gespeichert: ${fs.readdirSync(out).find((x) => x.endsWith('.fuchs'))}`);
  }
  const loaded = await getState();
  check(loaded.docs.every((d) => d.status === 'scanned' || d.status === 'verified'), 'alle Dokumente gescannt');

  /** Lage aller Flächen im Dialog, um Verschiebungen zwischen den Schritten zu erkennen. */
  const geometry = () =>
    win.evaluate(() => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
      };
      return {
        count: document.querySelector('.lens-head .count')?.textContent ?? '',
        name: document.querySelector('.lens-head .name')?.textContent ?? '',
        lens: r(document.querySelector('.lens')),
        next: r(document.querySelector('.lens-foot .btn-primary, .lens-foot .btn-success')),
        rows: [...document.querySelectorAll('.lens-row')].map((row) => {
          const panes = row.querySelectorAll('.lens-pane');
          return {
            tag: row.querySelector('.lens-pane .lens-tag')?.textContent ?? '',
            text: row.querySelector('.lens-value')?.textContent ?? '',
            left: r(panes[0]),
            right: r(panes[1]),
            value: r(row.querySelector('.lens-value')),
            stack: r(row.querySelector('.lens-stack')),
            crops: [...row.querySelectorAll('.lens-crop')].map((c) => r(c))
          };
        })
      };
    });
  /** Weiterschalten wie per Taste und im ersten gezeichneten Bild prüfen, ob alle Ausschnitte schon da sind. */
  const stepAndProbe = () =>
    win.evaluate(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((res) => requestAnimationFrame(res));
      const crops = [...document.querySelectorAll('.lens-crop')];
      return { total: crops.length, drawn: crops.filter((c) => c.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 255).length };
    });
  const same = (a, b, tol = 0.5) => a && b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
  const centered = (inner, outer, tol = 1.5) => inner && outer && Math.abs(inner.cx - outer.cx) <= tol && Math.abs(inner.cy - outer.cy) <= tol;
  const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;

  /** Läuft durch alle Schritte des aktuellen Dokuments und prüft die Lage. */
  async function walk(prefix) {
    await win.keyboard.press('l');
    await win.waitForSelector('.lens');
    await win.waitForTimeout(900);
    const steps = [];
    let probes = [];
    for (let i = 0; i < 60; i++) {
      const g = await geometry();
      steps.push(g);
      if (i < 30) await win.screenshot({ path: shot(`${prefix}-${String(i + 1).padStart(2, '0')}.png`) });
      if (!g.rows.length) break; // Zusammenfassung erreicht
      await win.waitForTimeout(450);
      probes.push(await stepAndProbe());
    }
    const summary = steps[steps.length - 1];
    const valueSteps = steps.slice(0, -1);
    console.log(`  ${prefix}: ${valueSteps.length} Schritte – ${valueSteps.map((s) => `${s.name}=${s.rows.map((r) => r.text).join('/')}`).join(' · ')}`);
    check(valueSteps.length > 0 && summary.rows.length === 0 && summary.name === 'Zusammenfassung', `${prefix}: bis zur Zusammenfassung durchgeschaltet`);
    check(steps.every((s) => same(s.lens, steps[0].lens)), `${prefix}: Dialog bleibt in Lage und Grösse gleich`);
    check(steps.every((s) => same(s.next, steps[0].next)), `${prefix}: Knopf «Stimmt»/«Geprüft & weiter» bleibt an derselben Stelle`);
    for (const rows of [1, 3]) {
      const group = valueSteps.filter((s) => s.rows.length === rows);
      if (!group.length) continue;
      const ref = group[0].rows;
      const stable = group.every((s) => s.rows.every((r, k) => same(r.left, ref[k].left) && same(r.right, ref[k].right)));
      check(stable, `${prefix}: Flächen ${rows === 1 ? 'der Felder' : 'der Positionen'} verschieben sich nicht (${group.length} Schritte)`);
      const centeredAll = group.every((s) => s.rows.every((r) => centered(r.value, r.left) && (!r.stack || centered(r.stack, r.right))));
      check(centeredAll, `${prefix}: Wert und Ausschnitt jeweils mittig in ihrer Fläche`);
      const fits = group.every((s) => s.rows.every((r) => inside(r.value, r.left) && r.crops.every((c) => inside(c, r.right))));
      check(fits, `${prefix}: Wert und Ausschnitt passen in die feste Fläche`);
    }
    const pos = valueSteps.filter((s) => s.rows.length === 3);
    if (pos.length) check(pos.every((s) => s.rows.map((r) => r.tag).join('/') === 'Titel/Menge/Preis'), `${prefix}: Positionen zeigen Titel, Menge und Preis`);
    // Die ersten Ausschnitte rendert der Dialog beim Öffnen, danach müssen sie vorab bereitliegen
    probes = probes.slice(0, -1);
    const late = probes.filter((p) => p.drawn < p.total);
    check(!late.length, `${prefix}: Ausschnitte beim Weiterschalten sofort da (${probes.length - late.length}/${probes.length} Schritte)`);
    return valueSteps;
  }

  // Dokument 1 im Prüfmodus
  await win.click('table.grid tbody tr >> nth=0');
  await win.waitForSelector('.pdf-page canvas');
  await win.waitForTimeout(1200);
  await win.screenshot({ path: shot('00-review.png') });
  const doc1Steps = await walk('doc1');

  // Zurück mit ←, dann «Korrigieren» (K) und wieder öffnen (L) → gleicher Schritt
  await win.keyboard.press('ArrowLeft');
  await win.keyboard.press('ArrowLeft');
  const before = await geometry();
  check(before.rows.length > 0, `← geht zurück zu ${before.count} «${before.name}»`);
  await win.keyboard.press('k');
  await win.waitForSelector('.lens', { state: 'detached' });
  const afterCorrect = await getState();
  const target = afterCorrect.active;
  check(Boolean(target), `«Korrigieren» schliesst den Dialog und aktiviert ${JSON.stringify(target)}`);
  await win.waitForTimeout(500);
  await win.screenshot({ path: shot('doc1-korrigieren.png') });
  await win.keyboard.press('Escape');
  await win.keyboard.press('l');
  await win.waitForSelector('.lens');
  const resumed = await geometry();
  check(resumed.count === before.count, `Linsenmodus setzt bei ${resumed.count} fort`);

  // Wert direkt im Linsenmodus korrigieren: E, tippen, Enter – Store, Anzeige und Flächen prüfen
  {
    const st = await getState();
    const docNow = st.docs.find((d) => d.id === st.currentDocId);
    const amountCol = st.columns.find((c) => c.enabled && c.type === 'amount' && docNow.fields[c.id]?.value && docNow.fields[c.id].boxes.length);
    if (!amountCol) check(false, 'Dokument 1 hat einen Betrag mit Fundstelle zum Bearbeiten');
    else {
      for (let i = 0; i < 60 && (await geometry()).name !== amountCol.label; i++) await win.keyboard.press(i < 30 ? 'ArrowLeft' : 'ArrowRight');
      const g0 = await geometry();
      const orig = docNow.fields[amountCol.id];
      const editGeo = () =>
        win.evaluate(() => {
          const input = document.querySelector('.lens-input');
          const b = input?.getBoundingClientRect();
          return {
            focused: Boolean(input) && document.activeElement === input,
            value: input?.value ?? null,
            invalid: Boolean(document.querySelector('.lens-pane.invalid')),
            input: b ? { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, x: b.x, y: b.y } : null
          };
        });
      const unshifted = (g) => same(g.lens, g0.lens) && same(g.next, g0.next) && g.rows.every((r, k) => same(r.left, g0.rows[k].left) && same(r.right, g0.rows[k].right));
      check(g0.name === amountCol.label, `Schritt «${g0.name}» (${g0.rows[0]?.text}) zum Bearbeiten gefunden`);

      await win.keyboard.press('e');
      await win.waitForSelector('.lens-input');
      const e1 = await editGeo();
      const g1 = await geometry();
      check(e1.focused && e1.value === g0.rows[0].text, `E öffnet das Eingabefeld mit «${e1.value}»`);
      check(unshifted(g1) && centered(e1.input, g1.rows[0].left, 2), 'Eingabefeld liegt mittig in derselben Fläche, nichts verschiebt sich');
      await win.screenshot({ path: shot('doc1-bearbeiten.png') });
      // Während des Tippens greifen die Tasten des Dialogs nicht
      await win.keyboard.press('ArrowRight');
      await win.keyboard.press('k');
      const e2 = await editGeo();
      check((await geometry()).count === g0.count && e2.focused && (await win.$('.lens')) !== null, '→ und K wirken beim Tippen nicht auf den Dialog');

      // Ungültige Eingabe wird markiert und nicht übernommen, Esc verwirft nur die Bearbeitung
      await win.keyboard.press('Control+a');
      await win.keyboard.type('zwölf');
      await win.keyboard.press('Enter');
      const e3 = await editGeo();
      const s3 = await getState();
      check(e3.invalid && e3.value === 'zwölf' && s3.docs.find((d) => d.id === docNow.id).fields[amountCol.id].value === orig.value, 'ungültige Eingabe ist markiert und nicht übernommen');
      await win.screenshot({ path: shot('doc1-ungueltig.png') });
      await win.keyboard.press('Escape');
      const e4 = await editGeo();
      check(e4.value === null && (await win.$('.lens')) !== null && (await geometry()).rows[0].text === g0.rows[0].text, 'Esc verwirft die Bearbeitung, der Dialog bleibt offen');

      // Gültiger Wert: Enter übernimmt, bleibt auf dem Schritt und zeigt den Wert neu formatiert
      await win.keyboard.press('F2');
      await win.waitForSelector('.lens-input');
      await win.keyboard.press('Control+a');
      await win.keyboard.type('1234,5');
      await win.keyboard.press('Enter');
      await win.waitForSelector('.lens-input', { state: 'detached' });
      await win.waitForTimeout(150);
      const g5 = await geometry();
      const f5 = (await getState()).docs.find((d) => d.id === docNow.id).fields[amountCol.id];
      check(f5.value === '1234.50' && f5.source === 'manual' && JSON.stringify(f5.boxes) === JSON.stringify(orig.boxes), `Store: ${amountCol.label} = ${f5.value}, Quelle ${f5.source}, Fundstellen behalten`);
      check(g5.count === g0.count && g5.rows[0].text.replace(/\D/g, '') === '123450' && g5.rows[0].text !== '1234,5', `Anzeige bleibt auf ${g5.count} und zeigt «${g5.rows[0].text}»`);
      check(unshifted(g5) && g5.rows[0].crops.length === g0.rows[0].crops.length, 'nach dem Übernehmen sind Flächen und Ausschnitt unverändert');
      await win.screenshot({ path: shot('doc1-uebernommen.png') });
      await win.keyboard.press('Enter');
      check((await geometry()).count !== g0.count, 'zweites Enter geht weiter zum nächsten Schritt');

      // Position: Menge per Klick bearbeiten, Tab springt zum Preis
      for (let i = 0; i < 60 && (await geometry()).rows.length !== 3; i++) await win.keyboard.press('ArrowRight');
      const p0 = await geometry();
      if (p0.rows.length === 3) {
        const posBefore = (await getState()).docs.find((d) => d.id === docNow.id).positions;
        await win.mouse.click(p0.rows[1].left.cx, p0.rows[1].left.cy);
        await win.waitForSelector('.lens-input');
        await win.keyboard.press('Control+a');
        await win.keyboard.type('6,459');
        await win.keyboard.press('Tab');
        const e6 = await editGeo();
        check(e6.focused && Math.abs(e6.input.cy - p0.rows[2].left.cy) < 2,'Tab übernimmt die Menge und bearbeitet den Preis');
        await win.keyboard.press('Escape');
        const p1 = await geometry();
        const posAfter = (await getState()).docs.find((d) => d.id === docNow.id).positions;
        const changed = posAfter.find((p, k) => p.menge !== posBefore[k].menge);
        check(changed?.menge === 6.459 && JSON.stringify(changed.boxes) === JSON.stringify(posBefore.find((p) => p.id === changed.id).boxes), `Position: Menge 6,459 als ${changed?.menge} gespeichert, Fundstelle behalten`);
        check(p1.count === p0.count && p1.rows[1].text === '6.459' && unshifted({ ...p1, rows: [] }) && p1.rows.every((r, k) => same(r.left, p0.rows[k].left) && same(r.right, p0.rows[k].right)), `Position bleibt auf ${p1.count}, Menge zeigt «${p1.rows[1].text}», Flächen unverändert`);
      }
    }
  }

  // Zusammenfassung: Enter markiert als geprüft und geht zum nächsten Dokument
  for (let i = 0; i < doc1Steps.length && (await geometry()).rows.length; i++) await win.keyboard.press('Enter');
  await win.waitForTimeout(300);
  await win.screenshot({ path: shot('doc1-summary.png') });
  const firstId = (await getState()).currentDocId;
  await win.keyboard.press('Enter');
  await win.waitForSelector('.lens', { state: 'detached' });
  const afterVerify = await getState();
  const first = afterVerify.docs.find((d) => d.id === firstId);
  check(first.status === 'verified' && afterVerify.currentDocId !== firstId && !afterVerify.lens, 'Enter in der Zusammenfassung: geprüft und weiter zum nächsten Dokument');

  // Mehrseitiges und gescanntes Dokument
  for (const [label, name] of [
    ['doc4', '04_'],
    ['doc6', '06_']
  ]) {
    const id = afterVerify.docs.find((d) => d.fileName.startsWith(name))?.id;
    if (!id) continue;
    await win.evaluate((docId) => window.__belegfuchs.useStore.setState({ currentDocId: docId, active: null }), id);
    await win.waitForSelector('.pdf-page canvas');
    await win.waitForTimeout(1200);
    await walk(label);
    await win.keyboard.press('Escape');
    await win.waitForSelector('.lens', { state: 'detached' });
  }
} finally {
  // Hängt der Main-Prozess (z.B. im Grafiktreiber), den Prozess hart beenden
  const exited = await Promise.race([app.evaluate(({ app }) => app.exit(0)).then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
  if (!exited) app.process().kill();
  restoreSettings();
}
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
