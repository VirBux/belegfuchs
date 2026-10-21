import { isExtractable } from '../../../shared/columns';
import { normMatch } from '../../../shared/parse';
import { buildDocumentText, reservedKeys, slugKey } from '../../../shared/prompt';
import type { AiFieldSpec, Box, Column, PageData } from '../../../shared/types';
import { getDoc, saveSettings, setField, setRuntime, startReviewMode, toast, updateDoc, useStore } from '../store';
import { buildLineInfos } from './doctext';
import { runHeuristics } from './heuristics';
import { buildLayout } from './layout';
import { applyAiResult } from './mapping';
import { canvasToPng, extractTextLayer, getPdf, isTextLayerUsable, ocrScale, renderCropPng, renderPageCanvas, type RawWord } from './pdf';
import { looksLikeRecipient, suggestOwnCompany } from './recipient';

const MAX_PARALLEL = 2;
const queue: string[] = [];
let running = 0;
let token = { cancelled: false };
let batch = { done: 0, failed: 0 };
let aiWarningShown = false;
let ownCompanySuggested = false;

class Cancelled extends Error {}

export function aiAvailable(): boolean {
  return ['ready', 'loaded', 'busy', 'loading'].includes(useStore.getState().llm.state);
}

/** Feldliste für die KI; eigene Spalten erhalten einen sprechenden JSON-Schlüssel. */
export function buildAiSpecs(columns: Column[], only?: string[]): AiFieldSpec[] {
  const taken = reservedKeys();
  const specs: AiFieldSpec[] = [];
  for (const c of columns) {
    if (!c.enabled || !isExtractable(c) || c.type === 'positions') continue;
    if (only && !only.includes(c.id)) continue;
    specs.push({ key: c.builtin ? c.id : slugKey(c.label, taken), columnId: c.id, label: c.label, type: c.type, description: c.description });
  }
  return specs;
}

async function runPool(count: number, limit: number, fn: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) await fn(next++);
  });
  await Promise.all(workers);
}

async function readPages(id: string, bytes: Uint8Array, t: { cancelled: boolean }): Promise<{ pages: PageData[]; pageCount: number }> {
  const settings = useStore.getState().settings;
  const pdf = await getPdf(id, bytes);
  const count = Math.min(pdf.numPages, Math.max(1, settings.maxPages));
  const pages: PageData[] = new Array(count);
  let done = 0;
  const progress = (stage: string) => setRuntime(id, { stage, progress: 0.05 + 0.6 * (done / count) });
  await runPool(count, 2, async (i) => {
    if (t.cancelled) return;
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    let raw: RawWord[] = settings.forceOcr ? [] : await extractTextLayer(page);
    let source: PageData['source'] = 'text';
    if (settings.forceOcr || !isTextLayerUsable(raw)) {
      source = 'ocr';
      progress(`Texterkennung (OCR) Seite ${i + 1} von ${count} …`);
      const canvas = await renderPageCanvas(page, ocrScale(page));
      const png = await canvasToPng(canvas);
      const { width, height } = canvas;
      canvas.width = canvas.height = 0;
      const res = await window.belegfuchs.ocr({ png, langs: settings.ocrLangs, mode: 'page' });
      raw = res.words.map((w) => ({
        text: w.text,
        x: w.x0 / width,
        y: w.y0 / height,
        w: (w.x1 - w.x0) / width,
        h: (w.y1 - w.y0) / height,
        group: w.line,
        conf: w.conf
      }));
    }
    pages[i] = { index: i, width: vp.width, height: vp.height, source, ...buildLayout(raw) };
    page.cleanup();
    done++;
    progress(`Seite ${done} von ${count} gelesen …`);
  });
  if (t.cancelled) throw new Cancelled();
  return { pages, pageCount: pdf.numPages };
}

async function scanDocument(id: string, t: { cancelled: boolean }): Promise<void> {
  const doc = getDoc(id);
  const bytes = useStore.getState().pdfBytes[id];
  if (!doc || !bytes) return;
  updateDoc(id, { status: 'scanning', error: undefined }, false);
  setRuntime(id, { stage: 'PDF wird gelesen …', progress: 0.03 });
  try {
    const { pages, pageCount } = await readPages(id, bytes, t);
    const { settings, columns } = useStore.getState();
    const infos = buildLineInfos(pages);
    const heur = runHeuristics(infos, pages, { ownCompany: settings.ownCompany, defaultCurrency: settings.defaultCurrency });
    let fields = heur.fields;
    let positions = heur.positions;
    let aiModel: string | undefined;
    const withPositions = columns.some((c) => c.type === 'positions' && c.enabled);

    if (aiAvailable() && infos.length) {
      const llm = useStore.getState().llm;
      setRuntime(id, { stage: llm.state === 'ready' || llm.state === 'loading' ? 'KI-Modell wird geladen …' : 'KI analysiert den Inhalt …', progress: 0.72 });
      const specs = buildAiSpecs(columns);
      // Antwortlänge grob schätzen: Grundfelder plus eine Zeile je Positionskandidat
      const expected = 500 + specs.length * 60 + (withPositions ? Math.max(3, heur.positions.length) * 110 : 0);
      const offProgress = window.belegfuchs.llm.onProgress(({ requestId, chars }) => {
        if (requestId !== id) return;
        setRuntime(id, { stage: 'KI analysiert den Inhalt …', progress: 0.74 + 0.24 * Math.min(1, chars / expected) });
      });
      const res = await window.belegfuchs.llm
        .extract({
          requestId: id,
          text: buildDocumentText(pages),
          fields: specs,
          withPositions,
          ownCompany: settings.ownCompany
        })
        .finally(offProgress);
      if (t.cancelled) throw new Cancelled();
      if (res.ok && res.result) {
        const applied = applyAiResult(res.result, specs, infos, pages);
        fields = { ...fields, ...applied.fields };
        // Hat die KI den Empfänger als Kreditor erwischt, gilt das Ergebnis der Regeln
        const aiCreditor = applied.fields.kreditor?.value;
        const ruleCreditor = heur.fields.kreditor;
        if (
          aiCreditor &&
          ruleCreditor &&
          normMatch(aiCreditor) !== normMatch(ruleCreditor.value) &&
          looksLikeRecipient(aiCreditor, infos, settings.ownCompany) &&
          !looksLikeRecipient(ruleCreditor.value, infos, settings.ownCompany)
        ) {
          fields.kreditor = { ...ruleCreditor, note: `KI-Vorschlag «${aiCreditor}» ist der Empfänger` };
        } else if (aiCreditor && settings.ownCompany && normMatch(aiCreditor).includes(normMatch(settings.ownCompany))) {
          // Die eigene Firma ist nie der Kreditor – lieber leer lassen, damit die Kontrolle es meldet
          delete fields.kreditor;
        }
        if (withPositions && (applied.positions.length || !positions.length)) positions = applied.positions;
        aiModel = res.modelId;
      } else if (res.error && res.error !== 'Abgebrochen' && !aiWarningShown) {
        aiWarningShown = true;
        toast('warn', `KI-Analyse nicht möglich – es wird die regelbasierte Erkennung verwendet. (${res.error})`);
      }
    }

    updateDoc(id, {
      status: 'scanned',
      pageCount,
      pages,
      fields,
      positions: withPositions ? positions : [],
      scanDate: new Date().toISOString(),
      aiModel,
      verifiedAt: undefined,
      error: undefined
    });
    batch.done++;
  } catch (err) {
    if (err instanceof Cancelled || t.cancelled) {
      const d = getDoc(id);
      updateDoc(id, { status: d?.scanDate ? 'scanned' : 'new' }, false);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      updateDoc(id, { status: 'error', error: message });
      batch.failed++;
      toast('error', `${doc.fileName}: ${message}`);
    }
  } finally {
    setRuntime(id, null);
  }
}

/** Ersetzt Kreditoren, die der eigenen Firma entsprechen, durch die regelbasierte Erkennung. */
function fixCreditors(ownCompany: string): number {
  let fixed = 0;
  const { docs, settings } = useStore.getState();
  for (const d of docs) {
    const current = d.fields.kreditor?.value;
    if (!current || !d.pages.length || normMatch(current) !== normMatch(ownCompany)) continue;
    const infos = buildLineInfos(d.pages);
    const heur = runHeuristics(infos, d.pages, { ownCompany, defaultCurrency: settings.defaultCurrency });
    setField(d.id, 'kreditor', heur.fields.kreditor ?? null);
    fixed++;
  }
  return fixed;
}

function maybeSuggestOwnCompany(): void {
  const { docs, settings } = useStore.getState();
  if (ownCompanySuggested || settings.ownCompany) return;
  const name = suggestOwnCompany(docs);
  if (!name) return;
  ownCompanySuggested = true;
  toast('info', `«${name}» steht auf fast allen Rechnungen – ist das eure eigene Firma? Sie wird dann nie als Kreditor erkannt.`, {
    sticky: true,
    action: {
      label: 'Als eigene Firma festlegen',
      run: () =>
        void saveSettings({ ownCompany: name }).then(() => {
          const n = fixCreditors(name);
          toast('success', `Eigene Firma gespeichert${n ? ` – Kreditor in ${n} Dokument${n === 1 ? '' : 'en'} korrigiert` : ''}.`);
        })
    }
  });
}

function onQueueDrained(): void {
  const { done, failed } = batch;
  batch = { done: 0, failed: 0 };
  if (token.cancelled || done === 0) return;
  toast('success', `Scan abgeschlossen: ${done} Dokument${done === 1 ? '' : 'e'}${failed ? `, ${failed} mit Fehler` : ''}.`, {
    action: { label: 'Prüfmodus starten', run: () => startReviewMode() },
    timeout: 8000
  });
  maybeSuggestOwnCompany();
}

function pump(): void {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift()!;
    running++;
    const t = token;
    void scanDocument(id, t).finally(() => {
      running--;
      if (running === 0 && queue.length === 0) onQueueDrained();
      pump();
    });
  }
}

export function enqueueScan(ids: string[]): void {
  // Nach einem Abbruch neue Scans mit frischem Token starten; laufende behalten ihren alten
  if (token.cancelled) token = { cancelled: false };
  aiWarningShown = false;
  const docs = useStore.getState().docs;
  for (const id of ids) {
    const d = docs.find((x) => x.id === id);
    if (!d || d.status === 'scanning' || d.status === 'queued' || queue.includes(id)) continue;
    queue.push(id);
    updateDoc(id, { status: 'queued', error: undefined }, false);
    setRuntime(id, { stage: 'Wartet …', progress: 0 });
  }
  // Modell schon laden, während die Texterkennung läuft
  if (useStore.getState().llm.state === 'ready') void window.belegfuchs.llm.load();
  pump();
}

export function cancelScans(): void {
  token.cancelled = true;
  for (const id of queue.splice(0)) {
    const d = getDoc(id);
    updateDoc(id, { status: d?.scanDate ? 'scanned' : 'new' }, false);
    setRuntime(id, null);
  }
  void window.belegfuchs.llm.cancel();
  toast('info', 'Scan abgebrochen.');
}

/** Sucht neu definierte Spalten in bereits gescannten Dokumenten (nur KI, ohne erneute Texterkennung). */
export async function scanColumns(columnIds: string[]): Promise<void> {
  const state = useStore.getState();
  if (!aiAvailable()) {
    toast('warn', 'Für eigene Spalten wird das KI-Modell benötigt (Einstellungen → KI-Modell).');
    return;
  }
  const specs = buildAiSpecs(state.columns, columnIds);
  if (!specs.length) return;
  const targets = state.docs.filter((d) => (d.status === 'scanned' || d.status === 'verified') && d.pages.length);
  let found = 0;
  for (const d of targets) {
    setRuntime(d.id, { stage: 'KI sucht neue Spalten …', progress: 0.6 });
    const res = await window.belegfuchs.llm.extract({
      text: buildDocumentText(d.pages),
      fields: specs,
      withPositions: false,
      ownCompany: state.settings.ownCompany
    });
    if (res.ok && res.result) {
      const applied = applyAiResult(res.result, specs, buildLineInfos(d.pages), d.pages);
      found += Object.keys(applied.fields).length;
      updateDoc(d.id, (doc) => ({ fields: { ...doc.fields, ...applied.fields } }));
    }
    setRuntime(d.id, null);
  }
  toast('success', `Neue Spalten gesucht: ${found} Wert${found === 1 ? '' : 'e'} in ${targets.length} Dokument${targets.length === 1 ? '' : 'en'} gefunden.`);
}

/** OCR eines gezogenen Rahmens in hoher Auflösung. */
export async function ocrBox(docId: string, box: Box): Promise<string> {
  const state = useStore.getState();
  const pdf = await getPdf(docId, state.pdfBytes[docId]);
  const page = await pdf.getPage(box.page + 1);
  const png = await renderCropPng(page, box);
  const res = await window.belegfuchs.ocr({ png, langs: state.settings.ocrLangs, mode: 'block' });
  return res.text.replace(/[ \t]+/g, ' ').trim();
}
