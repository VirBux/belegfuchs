import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { OEM, PSM, createScheduler, createWorker, type Page, type Scheduler, type Worker } from 'tesseract.js';
import type { OcrRequest, OcrResult, OcrWordRaw } from '../shared/types';

const SUPPORTED = new Set(['deu', 'eng', 'fra', 'ita']);

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

async function makeWorker(langs: string[], psm: PSM): Promise<Worker> {
  const worker = await createWorker(langs, OEM.LSTM_ONLY, {
    langPath: tessdataDir(),
    cachePath: path.join(app.getPath('userData'), 'tesscache'),
    cacheMethod: 'none',
    gzip: true
  });
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    user_defined_dpi: '300',
    preserve_interword_spaces: '0'
  });
  return worker;
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
    const scheduler = createScheduler();
    const workers = await Promise.all(Array.from({ length: count }, () => makeWorker(langs, PSM.AUTO)));
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
