import { lineRef, wordSeparator } from '../../../shared/prompt';
import type { Box, PageData } from '../../../shared/types';

/** Eine Textzeile mit Zuordnung Zeichenbereich → Wort, um Treffer auf Wortboxen abzubilden. */
export interface LineInfo {
  page: number;
  line: number;
  ref: string;
  text: string;
  spans: { start: number; end: number; word: number }[];
}

export function buildLineInfos(pages: PageData[]): LineInfo[] {
  const out: LineInfo[] = [];
  for (const p of pages) {
    const aspect = p.height / p.width;
    p.lines.forEach((line, li) => {
      let text = '';
      const spans: LineInfo['spans'] = [];
      line.words.forEach((wi, k) => {
        const w = p.words[wi];
        if (k > 0) text += wordSeparator(p.words[line.words[k - 1]], w, aspect);
        spans.push({ start: text.length, end: text.length + w.text.length, word: wi });
        text += w.text;
      });
      out.push({ page: p.index, line: li, ref: lineRef(p.index, li), text, spans });
    });
  }
  return out;
}

export function pageOf(pages: PageData[], index: number): PageData | undefined {
  return pages.find((p) => p.index === index);
}

export function unionBox(page: number, rects: { x: number; y: number; w: number; h: number }[]): Box | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function wordsBox(pages: PageData[], page: number, wordIdx: number[]): Box | null {
  const p = pageOf(pages, page);
  if (!p) return null;
  return unionBox(page, wordIdx.map((i) => p.words[i]).filter(Boolean));
}

/** Box der Wörter, die den Zeichenbereich [start, end) der Zeile überdecken. */
export function rangeBox(pages: PageData[], li: LineInfo, start: number, end: number): Box | null {
  const idx = li.spans.filter((s) => s.end > start && s.start < end).map((s) => s.word);
  return wordsBox(pages, li.page, idx);
}

export function lineBox(pages: PageData[], li: LineInfo): Box | null {
  return wordsBox(
    pages,
    li.page,
    li.spans.map((s) => s.word)
  );
}

/** Zeichenbereich eines Wortes innerhalb seiner Zeile. */
export function wordSpan(li: LineInfo, wordIdx: number): { start: number; end: number } | null {
  const s = li.spans.find((sp) => sp.word === wordIdx);
  return s ? { start: s.start, end: s.end } : null;
}

export function findLineInfo(infos: LineInfo[], page: number, line: number): LineInfo | undefined {
  return infos.find((li) => li.page === page && li.line === line);
}

/** Segment (zusammenhängende Wörter ohne Spaltenlücke) um einen Zeichenbereich. */
export function segmentAround(li: LineInfo, start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s > 0 && !li.text.slice(Math.max(0, s - 3), s).includes('   ')) s--;
  while (e < li.text.length && !li.text.slice(e, e + 3).includes('   ')) e++;
  while (li.text[s] === ' ') s++;
  while (e > s && li.text[e - 1] === ' ') e--;
  return { start: s, end: e };
}

/** Text normalisieren und dabei die Zuordnung normierter Index → Originalindex merken. */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) continue;
    let n = c.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/['’`´ʼ]/.test(n)) n = "'";
    if (/[‐‑‒–—−]/.test(n)) n = '-';
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}
