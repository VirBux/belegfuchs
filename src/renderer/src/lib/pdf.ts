import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Box } from '../../../shared/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Wort in normierten Seitenkoordinaten; group = Textlauf (PDF) bzw. Zeile (OCR). */
export interface RawWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  group: number;
  conf?: number;
}

const cache = new Map<string, { task: pdfjs.PDFDocumentLoadingTask; promise: Promise<PDFDocumentProxy> }>();

export function getPdf(docId: string, bytes: Uint8Array): Promise<PDFDocumentProxy> {
  let entry = cache.get(docId);
  if (!entry) {
    // pdf.js überträgt den Puffer an den Worker – deshalb eine Kopie übergeben
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
    entry = { task, promise: task.promise };
    cache.set(docId, entry);
    entry.promise.catch(() => cache.delete(docId));
  }
  return entry.promise;
}

export async function releasePdf(docId: string): Promise<void> {
  const entry = cache.get(docId);
  cache.delete(docId);
  await entry?.task.destroy().catch(() => undefined);
}

export function releaseAllPdfs(): void {
  for (const id of [...cache.keys()]) void releasePdf(id);
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
    measureCtx.font = '100px Arial, sans-serif';
  }
  return measureCtx.measureText(text).width;
}

/** Liest den eingebetteten Textlayer und zerlegt ihn in Wörter mit Position. */
export async function extractTextLayer(page: PDFPageProxy): Promise<RawWord[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: RawWord[] = [];
  let group = 0;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const dirLen = Math.hypot(a, b) || 1;
    const fontSize = Math.hypot(c, d) || item.height || 10;
    const [x0, y0] = viewport.convertToViewportPoint(e, f);
    const [x1, y1] = viewport.convertToViewportPoint(e + (a / dirLen) * item.width, f + (b / dirLen) * item.width);
    // Senkrechter oder gedrehter Text wird ignoriert
    if (Math.abs(y1 - y0) > Math.abs(x1 - x0) * 0.2 + 1) continue;
    const left = Math.min(x0, x1);
    const width = Math.max(Math.abs(x1 - x0), fontSize * 0.3 * str.length);
    const top = y0 - fontSize * 0.82;
    const height = fontSize * 1.06;
    const total = measure(str) || str.length;
    for (const m of str.matchAll(/\S+/g)) {
      const start = measure(str.slice(0, m.index)) / total;
      const end = measure(str.slice(0, m.index + m[0].length)) / total;
      out.push({
        text: m[0],
        x: (left + width * start) / viewport.width,
        y: top / viewport.height,
        w: (width * (end - start)) / viewport.width,
        h: height / viewport.height,
        group
      });
    }
    group++;
  }
  return out;
}

/** Prüft, ob der Textlayer brauchbar ist (sonst OCR). */
export function isTextLayerUsable(words: RawWord[]): boolean {
  const text = words.map((w) => w.text).join(' ');
  const alnum = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  if (alnum < 40) return false;
  const odd = (text.match(/[^\p{L}\p{N}\p{P}\p{S}\s]/gu) || []).length;
  const replacement = (text.match(/�/g) || []).length;
  return odd / text.length < 0.05 && replacement / text.length < 0.02;
}

export function ocrScale(page: PDFPageProxy): number {
  const vp = page.getViewport({ scale: 1 });
  // ca. 300 DPI, aber nicht grösser als 3600 px
  return Math.min(300 / 72, 3600 / Math.max(vp.width, vp.height));
}

export async function renderPageCanvas(page: PDFPageProxy, scale: number, canvas?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const target = canvas ?? document.createElement('canvas');
  target.width = Math.floor(viewport.width);
  target.height = Math.floor(viewport.height);
  const ctx = target.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.width, target.height);
  await page.render({ canvas: target, canvasContext: ctx, viewport }).promise;
  return target;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Bild konnte nicht erzeugt werden.'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

/** Rendert einen Seitenausschnitt in hoher Auflösung (für die OCR eines gezogenen Rahmens). */
export async function renderCropPng(page: PDFPageProxy, box: Box): Promise<Uint8Array> {
  const base = page.getViewport({ scale: 1 });
  // Kleine Ausschnitte stärker vergrössern, damit Tesseract genug Pixel pro Zeichen hat
  const heightPt = box.h * base.height;
  const scale = Math.min(8, Math.max(4, 120 / Math.max(heightPt, 1)));
  const viewport = page.getViewport({ scale });
  const pad = 12;
  const x = box.x * viewport.width - pad;
  const y = box.y * viewport.height - pad;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.ceil(box.w * viewport.width + pad * 2));
  canvas.height = Math.max(8, Math.ceil(box.h * viewport.height + pad * 2));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -x, -y] }).promise;
  return canvasToPng(canvas);
}
