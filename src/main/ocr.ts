import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OEM, PSM, createScheduler, createWorker, type Page, type Scheduler, type Worker } from 'tesseract.js';
import type { OcrRequest, OcrResult, OcrWordRaw } from '../shared/types';

const SUPPORTED = new Set(['deu', 'eng', 'fra', 'ita']);
/** Obergrenze für den Start eines Workers samt Laden der Sprachdaten */
const INIT_TIMEOUT_MS = 60_000;

let pageScheduler: Scheduler | null = null;
let pageLangs = '';
let pageInit: Promise<Scheduler> | null = null;
let blockWorker: Worker | null = null;
let blockLangs = '';
let blockInit: Promise<Worker> | null = null;

function tessdataDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : path.join(app.getAppPath(), 'resources', 'tessdata');
}

function langList(langs: string[]): string[] {
  const list = langs.filter((l) => SUPPORTED.has(l));
  return list.length ? list : ['deu', 'eng'];
}

function hasGzipHeader(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(2);
      return fs.readSync(fd, head, 0, 2, 0) === 2 && head[0] === 0x1f && head[1] === 0x8b;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Sprachdaten vorab prüfen – fehlen sie, wartet tesseract.js sonst endlos auf den Worker. */
function checkLangData(langs: string[]): string {
  const dir = tessdataDir();
  const file = (l: string) => path.join(dir, `${l}.traineddata.gz`);
  const missing = langs.filter((l) => !fs.existsSync(file(l)));
  // Leere oder fremde Dateien gar nicht erst laden: Ein fehlgeschlagenes Init meldet tesseract.js
  // doppelt (reject und resolve), was im Main-Prozess als unbehandelter Fehler mit Dialog endet
  const broken = langs.filter((l) => !missing.includes(l) && !hasGzipHeader(file(l)));
  const hint = app.isPackaged ? 'bitte Belegfuchs neu installieren' : 'bitte «npm run assets» ausführen';
  if (missing.length) throw new Error(`OCR-Sprachdaten fehlen (${missing.join(', ')} in resources/tessdata) – ${hint}.`);
  if (broken.length) throw new Error(`OCR-Sprachdaten beschädigt (${broken.join(', ')} in resources/tessdata) – ${hint}.`);
  return dir;
}

async function makeWorker(langs: string[], psm: PSM): Promise<Worker> {
  const langPath = checkLangData(langs);
  let fail: (err: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  const timer = setTimeout(
    () => fail(new Error(`Texterkennung ließ sich nicht starten (keine Antwort nach ${INIT_TIMEOUT_MS / 1000} s).`)),
    INIT_TIMEOUT_MS
  );
  const starting = (async () => {
    const worker = await createWorker(langs, OEM.LSTM_ONLY, {
      langPath,
      cachePath: path.join(app.getPath('userData'), 'tesscache'),
      cacheMethod: 'none',
      gzip: true,
      // Ohne errorHandler wirft tesseract.js Ladefehler unbehandelt, und createWorker kehrt nie zurück
      errorHandler: (err: unknown) => fail(new Error(`Texterkennung ließ sich nicht starten (${String(err).replace(/^Error: /, '')}).`))
    });
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      user_defined_dpi: '300',
      preserve_interword_spaces: '0'
    });
    return worker;
  })();
  try {
    return await Promise.race([starting, failed]);
  } catch (err) {
    // Kommt der Worker später doch noch hoch, gleich wieder beenden
    void starting.then(
      (w) => w.terminate(),
      () => {}
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getPageScheduler(langs: string[]): Promise<Scheduler> {
  const key = langs.join('+');
  if (pageScheduler && pageLangs === key) return pageScheduler;
  if (pageInit && pageLangs === key) return pageInit;
  if (pageScheduler) await pageScheduler.terminate();
  pageScheduler = null;
  pageLangs = key;
  const count = Math.min(4, Math.max(1, Math.floor(os.cpus().length / 4)));
  pageInit = (async () => {
    const results = await Promise.allSettled(Array.from({ length: count }, () => makeWorker(langs, PSM.AUTO)));
    const workers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) {
      // Schon gestartete Worker nicht verwaist zurücklassen
      await Promise.all(workers.map((w) => w.terminate()));
      throw failure.reason;
    }
    const scheduler = createScheduler();
    for (const w of workers) scheduler.addWorker(w);
    pageScheduler = scheduler;
    return scheduler;
  })();
  try {
    return await pageInit;
  } finally {
    pageInit = null;
  }
}

async function getBlockWorker(langs: string[]): Promise<Worker> {
  const key = langs.join('+');
  if (blockWorker && blockLangs === key) return blockWorker;
  if (blockInit && blockLangs === key) return blockInit;
  if (blockWorker) await blockWorker.terminate();
  blockWorker = null;
  blockLangs = key;
  blockInit = makeWorker(langs, PSM.SINGLE_BLOCK).then((w) => (blockWorker = w));
  try {
    return await blockInit;
  } finally {
    blockInit = null;
  }
}

function flatten(page: Page): OcrResult {
  const words: OcrWordRaw[] = [];
  let lineNo = 0;
  for (const block of page.blocks ?? []) {
    for (const par of block.paragraphs) {
      for (const line of par.lines) {
        for (const w of line.words) {
          const text = w.text.trim();
          if (!text) continue;
          // Kaum lesbare Fragmente (Logos, Linien) verwerfen
          if (w.confidence < 15 && !/[\p{L}\d]{2,}/u.test(text)) continue;
          words.push({ text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence, line: lineNo });
        }
        lineNo++;
      }
    }
  }
  return { words, text: page.text };
}

export async function recognize(req: OcrRequest): Promise<OcrResult> {
  const langs = langList(req.langs);
  const image = Buffer.from(req.png);
  if (req.mode === 'block') {
    const worker = await getBlockWorker(langs);
    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
    return flatten(data);
  }
  const scheduler = await getPageScheduler(langs);
  const { data } = await scheduler.addJob('recognize', image, {}, { blocks: true, text: true });
  return flatten(data);
}

export async function shutdownOcr(): Promise<void> {
  try {
    await pageScheduler?.terminate();
    await blockWorker?.terminate();
  } catch {
    // beim Beenden egal
  }
  pageScheduler = null;
  blockWorker = null;
}
