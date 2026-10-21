// Manuelle Zuordnung im Prüfmodus: Klick auf ein Wort (Platzhalter) oder gezogener Rahmen.
import { wordSeparator } from '../../../shared/prompt';
import {
  amountToValue,
  detectCurrency,
  findAmounts,
  findDates,
  normalizeCurrency,
  parseAmount,
  parseDate
} from '../../../shared/parse';
import type { Box, ColumnType, PageData, Position } from '../../../shared/types';
import { findLineInfo, pageOf, rangeBox, segmentAround, unionBox, wordSpan, wordsBox, type LineInfo } from './doctext';
import { parsePositionLine, RE } from './heuristics';
import { cleanId } from './mapping';

export interface PickResult {
  value: string;
  raw: string;
  boxes: Box[];
}

const nearest = <T extends { start: number; end: number }>(items: T[], start: number, end: number): T | undefined =>
  items.find((a) => a.start < end && a.end > start) ??
  items.filter((a) => a.start >= end).sort((a, b) => a.start - b.start)[0] ??
  [...items].sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start))[0];

/** Wählt abhängig vom Spaltentyp den passenden Wert rund um ein angeklicktes Wort. */
export function pickFromWord(pages: PageData[], infos: LineInfo[], page: number, wordIdx: number, type: ColumnType): PickResult | null {
  const p = pageOf(pages, page);
  const word = p?.words[wordIdx];
  if (!p || !word) return null;
  const li = findLineInfo(infos, page, word.line);
  const span = li ? wordSpan(li, wordIdx) : null;
  if (!li || !span) return null;
  const box = (s: number, e: number) => [rangeBox(pages, li, s, e)].filter((b): b is Box => Boolean(b));

  switch (type) {
    case 'amount':
    case 'number': {
      const hit = nearest(
        findAmounts(li.text).filter((a) => !a.percent),
        span.start,
        span.end
      );
      if (hit) return { value: amountToValue(hit.value), raw: hit.text, boxes: box(hit.start, hit.end) };
      const v = parseAmount(word.text);
      return v === null ? null : { value: amountToValue(v), raw: word.text, boxes: box(span.start, span.end) };
    }
    case 'date': {
      const hit = nearest(findDates(li.text), span.start, span.end);
      return hit ? { value: hit.iso, raw: hit.text, boxes: box(hit.start, hit.end) } : null;
    }
    case 'currency': {
      const code = /^[A-Z]{3}$/.test(word.text) || /[€$£]/.test(word.text) ? normalizeCurrency(word.text) : detectCurrency(li.text);
      return code ? { value: code, raw: word.text, boxes: box(span.start, span.end) } : null;
    }
    case 'id': {
      let s = span;
      if (!/\d/.test(word.text)) {
        // Bezeichnung angeklickt ("Nr.") → nächstes Wort mit Ziffern verwenden
        const next = li.spans.find((sp) => sp.start > span.start && /\d/.test(li.text.slice(sp.start, sp.end)));
        if (next) s = { start: next.start, end: next.end };
      }
      const raw = li.text.slice(s.start, s.end);
      return { value: cleanId(raw), raw, boxes: box(s.start, s.end) };
    }
    default: {
      const seg = segmentAround(li, span.start, span.end);
      let start = seg.start;
      const label = RE.subject.exec(li.text.slice(start, seg.end));
      if (label) start += label[0].length;
      const raw = li.text.slice(start, seg.end).trim();
      return raw ? { value: raw, raw, boxes: box(start, seg.end) } : null;
    }
  }
}

export interface BoxText {
  text: string;
  /** Alle Wörter liegen vollständig im Rahmen (kein angeschnittenes Wort). */
  clean: boolean;
  boxes: Box[];
  lines: { li: LineInfo; words: number[] }[];
}

/** Liefert die Wörter innerhalb eines gezogenen Rahmens. */
export function wordsInBox(pages: PageData[], infos: LineInfo[], box: Box): BoxText {
  const p = pageOf(pages, box.page);
  if (!p) return { text: '', clean: false, boxes: [], lines: [] };
  const inside: number[] = [];
  let clean = true;
  p.words.forEach((w, i) => {
    const ix = Math.max(0, Math.min(w.x + w.w, box.x + box.w) - Math.max(w.x, box.x));
    const iy = Math.max(0, Math.min(w.y + w.h, box.y + box.h) - Math.max(w.y, box.y));
    const ratio = (ix * iy) / Math.max(w.w * w.h, 1e-9);
    if (ratio >= 0.6) inside.push(i);
    else if (ratio > 0.15) clean = false;
  });
  const byLine = new Map<number, number[]>();
  for (const i of inside) {
    const l = p.words[i].line;
    byLine.set(l, [...(byLine.get(l) ?? []), i]);
  }
  const aspect = p.height / p.width;
  const lines: BoxText['lines'] = [];
  const texts: string[] = [];
  for (const [lineIdx, idx] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = idx.sort((a, b) => p.words[a].x - p.words[b].x);
    let t = '';
    sorted.forEach((wi, k) => {
      if (k > 0) t += wordSeparator(p.words[sorted[k - 1]], p.words[wi], aspect);
      t += p.words[wi].text;
    });
    texts.push(t);
    const li = findLineInfo(infos, box.page, lineIdx);
    if (li) lines.push({ li, words: sorted });
  }
  const b = wordsBox(pages, box.page, inside);
  return { text: texts.join('\n'), clean, boxes: b ? [b] : [], lines };
}

/** Interpretiert freien Text (aus Rahmen oder OCR) gemäss Spaltentyp. */
export function valueFromText(text: string, type: ColumnType): { value: string; raw: string } | null {
  const raw = text.replace(/\s*\n\s*/g, ' ').trim();
  if (!raw) return null;
  switch (type) {
    case 'amount':
    case 'number': {
      const amounts = findAmounts(raw).filter((a) => !a.percent);
      const money = amounts.filter((a) => a.hasDecimals);
      const hit = money[money.length - 1] ?? amounts[amounts.length - 1];
      if (hit) return { value: amountToValue(hit.value), raw: hit.text };
      const v = parseAmount(raw);
      return v === null ? null : { value: amountToValue(v), raw };
    }
    case 'date': {
      const iso = parseDate(raw);
      return iso ? { value: iso, raw } : null;
    }
    case 'currency': {
      const code = detectCurrency(raw) ?? normalizeCurrency(raw);
      return code ? { value: code, raw } : null;
    }
    case 'id': {
      const tok = /[A-Z0-9][A-Z0-9\-/._]*\d[A-Z0-9\-/._]*/i.exec(cleanId(raw));
      return { value: tok ? tok[0] : cleanId(raw), raw };
    }
    default:
      return { value: raw.replace(/^(betreff|betrifft|objet|oggetto|subject)\s*:\s*/i, ''), raw };
  }
}

/** Positionen aus den Zeilen innerhalb eines Rahmens (oder aus einer einzelnen Zeile). */
export function positionsFromLines(pages: PageData[], lines: { li: LineInfo; words: number[] }[]): Position[] {
  const result: Position[] = [];
  for (const { li, words } of lines) {
    const p = pageOf(pages, li.page);
    if (!p) continue;
    const aspect = p.height / p.width;
    // Teil-Zeile nur aus den Wörtern im Rahmen aufbauen
    let text = '';
    const spans: LineInfo['spans'] = [];
    words.forEach((wi, k) => {
      if (k > 0) text += wordSeparator(p.words[words[k - 1]], p.words[wi], aspect);
      spans.push({ start: text.length, end: text.length + p.words[wi].text.length, word: wi });
      text += p.words[wi].text;
    });
    if (!findAmounts(text).some((a) => a.hasDecimals && !a.percent)) continue;
    const pos = parsePositionLine({ ...li, text, spans }, pages);
    if (pos) result.push({ ...pos, source: 'box' });
  }
  return result;
}

/** Positionen aus OCR-Text eines Rahmens (ohne Wortpositionen). */
export function positionsFromText(text: string, box: Box): Position[] {
  const result: Position[] = [];
  for (const line of text.split(/\n+/)) {
    const fake: LineInfo = { page: box.page, line: -1, ref: '', text: line.trim(), spans: [] };
    if (!findAmounts(fake.text).some((a) => a.hasDecimals && !a.percent)) continue;
    const pos = parsePositionLine(fake, []);
    if (pos) result.push({ ...pos, boxes: [box], source: 'box' });
  }
  return result;
}

export function boxUnion(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return unionBox(boxes[0].page, boxes.filter((b) => b.page === boxes[0].page));
}
