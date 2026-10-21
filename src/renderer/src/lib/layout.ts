import type { Line, Word } from '../../../shared/types';
import type { RawWord } from './pdf';

interface Group {
  words: RawWord[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cy: number;
  h: number;
}

interface Row {
  groups: Group[];
  cy: number;
  h: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Fasst Wörter zu visuellen Zeilen zusammen. Ausgangspunkt sind Gruppen (Textläufe des PDFs bzw.
 * Tesseract-Zeilen); Gruppen auf gleicher Höhe – z.B. Tabellenspalten – werden zu einer Zeile vereint,
 * damit Bezeichnung und Betrag zusammen stehen.
 */
export function buildLayout(raw: RawWord[]): { words: Word[]; lines: Line[] } {
  const byGroup = new Map<number, RawWord[]>();
  for (const w of raw) {
    if (!w.text.trim() || w.w <= 0 || w.h <= 0) continue;
    const list = byGroup.get(w.group);
    if (list) list.push(w);
    else byGroup.set(w.group, [w]);
  }
  const groups: Group[] = [...byGroup.values()].map((words) => {
    const y0 = Math.min(...words.map((w) => w.y));
    const y1 = Math.max(...words.map((w) => w.y + w.h));
    const h = median(words.map((w) => w.h));
    return {
      words,
      x0: Math.min(...words.map((w) => w.x)),
      x1: Math.max(...words.map((w) => w.x + w.w)),
      y0,
      y1,
      cy: median(words.map((w) => w.y + w.h / 2)),
      h
    };
  });
  groups.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);

  const rows: Row[] = [];
  for (const g of groups) {
    let best: Row | null = null;
    let bestDist = Infinity;
    // Nur die letzten Zeilen prüfen – Gruppen sind nach Höhe sortiert
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 6; i--) {
      const r = rows[i];
      const dist = Math.abs(g.cy - r.cy);
      const tol = Math.min(g.h, r.h) * 0.55;
      if (dist > tol) continue;
      const overlapsHorizontally = r.groups.some(
        (o) => Math.min(o.x1, g.x1) - Math.max(o.x0, g.x0) > Math.min(o.x1 - o.x0, g.x1 - g.x0) * 0.3
      );
      if (overlapsHorizontally) continue;
      if (dist < bestDist) {
        best = r;
        bestDist = dist;
      }
    }
    if (best) {
      const n = best.groups.length;
      best.groups.push(g);
      best.cy = (best.cy * n + g.cy) / (n + 1);
      best.h = (best.h * n + g.h) / (n + 1);
    } else rows.push({ groups: [g], cy: g.cy, h: g.h });
  }
  rows.sort((a, b) => a.cy - b.cy);

  const words: Word[] = [];
  const lines: Line[] = [];
  for (const row of rows) {
    const rowWords = row.groups.flatMap((g) => g.words).sort((a, b) => a.x - b.x);
    const lineIndex = lines.length;
    const indices: number[] = [];
    for (const w of rowWords) {
      indices.push(words.length);
      words.push({ text: w.text, x: w.x, y: w.y, w: w.w, h: w.h, line: lineIndex, conf: w.conf });
    }
    const x0 = Math.min(...rowWords.map((w) => w.x));
    const y0 = Math.min(...rowWords.map((w) => w.y));
    const x1 = Math.max(...rowWords.map((w) => w.x + w.w));
    const y1 = Math.max(...rowWords.map((w) => w.y + w.h));
    lines.push({ words: indices, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return { words, lines };
}
