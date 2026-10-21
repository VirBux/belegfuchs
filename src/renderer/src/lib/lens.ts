// Linsenmodus: erfasste Werte Schritt für Schritt mit dem vergrösserten Ausschnitt aus dem PDF vergleichen.
import { isFieldColumn } from '../../../shared/columns';
import { findAmounts, formatAmount, parseAmount } from '../../../shared/parse';
import type { Box, Column, DocMeta, FieldSource, PageData, Position, Settings } from '../../../shared/types';
import { normalizeWithMap, rangeBox, segmentAround, unionBox, type LineInfo } from './doctext';
import { formatFieldValue } from './format';
import { wordsInBox } from './pick';

/** Ein Wertepaar: links der erfasste Text, rechts die Fundstellen im PDF. */
export interface LensPart {
  label: string;
  text: string;
  boxes: Box[];
  /** Keine eigene Fundstelle gefunden – es wird die ganze Zeile gezeigt. */
  wholeLine?: boolean;
  /** Summanden, wenn der Wert aus mehreren Fundstellen zusammengezählt ist (z.B. zwei MWST-Beträge). */
  detail?: string;
}

export interface LensStep {
  key: string;
  target: { kind: 'field'; columnId: string } | { kind: 'positions'; positionId: string };
  label: string;
  color: string;
  source: FieldSource;
  note?: string;
  parts: LensPart[];
}

/** Übersprungene Felder (leer oder ohne Fundstelle) für die Zusammenfassung. */
export interface LensSkip {
  label: string;
  reason: string;
}

/** Felder in Spaltenreihenfolge, danach die Positionen – jeweils nur Werte mit Fundstelle im PDF. */
export function buildLensSteps(doc: DocMeta, columns: Column[], settings: Settings, infos: LineInfo[]): { steps: LensStep[]; skipped: LensSkip[] } {
  const steps: LensStep[] = [];
  const skipped: LensSkip[] = [];
  for (const col of columns) {
    if (!col.enabled || !isFieldColumn(col)) continue;
    const f = doc.fields[col.id];
    if (!f?.value || !f.boxes.length) {
      skipped.push({ label: col.label, reason: !f?.value ? 'leer' : f.source === 'manual' ? 'manuell eingegeben' : 'ohne Fundstelle' });
      continue;
    }
    steps.push({
      key: `f:${col.id}`,
      target: { kind: 'field', columnId: col.id },
      label: col.label,
      color: col.color,
      source: f.source,
      note: f.note,
      parts: [{ label: col.label, text: formatFieldValue(col.type, f.value, settings), boxes: f.boxes, detail: sumDetail(f.raw, f.boxes.length, settings) }]
    });
  }
  const posCol = columns.find((c) => c.type === 'positions');
  if (posCol?.enabled) {
    doc.positions.forEach((p, i) => {
      if (!p.boxes.length) {
        skipped.push({ label: `Position ${i + 1}`, reason: p.source === 'manual' ? 'manuell eingegeben' : 'ohne Fundstelle' });
        return;
      }
      steps.push({
        key: `p:${p.id}`,
        target: { kind: 'positions', positionId: p.id },
        label: `Position ${i + 1}`,
        color: posCol.color,
        source: p.source,
        parts: positionParts(doc.pages, infos, p, settings)
      });
    });
  }
  return { steps, skipped };
}

function sumDetail(raw: string | undefined, boxes: number, settings: Settings): string | undefined {
  const parts = boxes > 1 && raw?.includes(' + ') ? raw.split(' + ').map((t) => parseAmount(t)) : [];
  return parts.length > 1 && parts.every((v) => v !== null) ? `aus ${parts.map((v) => formatAmount(v, settings.numberFormat)).join(' + ')}` : undefined;
}

type Range = { start: number; end: number };

function titleRange(li: LineInfo, titel: string): Range | null {
  const t = normalizeWithMap(titel).norm;
  if (!t) return null;
  const { norm, map } = normalizeWithMap(li.text);
  let i = norm.indexOf(t);
  if (i >= 0) return { start: map[i], end: map[i + t.length - 1] + 1 };
  // Titel über mehrere Zeilen oder nachträglich angepasst: Anfang suchen und bis zum Spaltenende nehmen
  const head = t.slice(0, 12);
  i = head.length >= 4 ? norm.indexOf(head) : -1;
  return i >= 0 ? segmentAround(li, map[i], map[i + head.length - 1] + 1) : null;
}

function matchLine(li: LineInfo, pos: Position): { titel: Range | null; menge: Range | null; preis: Range | null } {
  const amounts = findAmounts(li.text).filter((a) => !a.percent);
  const preis = pos.preis === null ? null : (amounts.filter((a) => Math.abs(a.value - pos.preis!) < 0.005).pop() ?? null);
  const titel = titleRange(li, pos.titel);
  let menge: Range | null = null;
  if (pos.menge !== null) {
    const hits = amounts.filter((a) => Math.abs(a.value - pos.menge!) < 1e-6 && a !== preis && (!preis || a.end <= preis.start));
    // Positionsnummer am Zeilenanfang überspringen: bevorzugt nach dem Titel, sonst direkt vor dem Preis
    menge = (titel ? hits.find((a) => a.start >= titel.end) : undefined) ?? hits[hits.length - 1] ?? null;
  }
  return { titel, menge, preis };
}

/** Teilt die Zeile einer Position in Titel, Menge und Preis auf, damit jeder Teil einzeln vergrössert werden kann. */
export function positionParts(pages: PageData[], infos: LineInfo[], pos: Position, settings: Settings): LensPart[] {
  const lines: LineInfo[] = [];
  for (const b of pos.boxes) for (const { li } of wordsInBox(pages, infos, b).lines) if (!lines.includes(li)) lines.push(li);
  let best: { li: LineInfo; m: ReturnType<typeof matchLine>; n: number } | null = null;
  for (const li of lines) {
    const m = matchLine(li, pos);
    const n = Number(Boolean(m.titel)) + Number(Boolean(m.menge)) + Number(Boolean(m.preis));
    if (!best || n > best.n) best = { li, m, n };
  }
  const part = (label: string, text: string, range: Range | null | undefined): LensPart => {
    const b = best && range ? rangeBox(pages, best.li, range.start, range.end) : null;
    if (b) return { label, text, boxes: [b] };
    return text ? { label, text, boxes: pos.boxes, wholeLine: true } : { label, text, boxes: [] };
  };
  return [
    part('Titel', pos.titel, best?.m.titel),
    part('Menge', pos.menge === null ? '' : String(pos.menge), best?.m.menge),
    part('Preis', pos.preis === null ? '' : formatAmount(pos.preis, settings.numberFormat), best?.m.preis)
  ];
}

/** Ausschnitt in normierten Seitenkoordinaten samt Grösse in PDF-Punkten. */
export interface CropRegion {
  box: Box;
  /** Fundstelle innerhalb des Ausschnitts (ohne Rand). */
  focus: Box;
  widthPt: number;
  heightPt: number;
  /** Höhe einer Textzeile im Ausschnitt (für die Vergrösserung). */
  linePt: number;
}

const pageSize = (pages: PageData[], index: number) => {
  const p = pages.find((x) => x.index === index);
  return p ? { w: p.width, h: p.height } : { w: 595, h: 842 };
};

/** Fasst nahe beieinanderliegende Boxen (gleiche oder Nachbarzeile) zusammen und ergänzt einen Rand. */
export function cropRegions(boxes: Box[], pages: PageData[]): CropRegion[] {
  const sorted = [...boxes].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const groups: Box[][] = [];
  for (const b of sorted) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (last && last.page === b.page) {
      const { w, h } = pageSize(pages, b.page);
      const lineH = Math.min(last.h, b.h) * h;
      const gapY = (b.y - (last.y + last.h)) * h;
      const gapX = Math.max(0, b.x - (last.x + last.w), last.x - (b.x + b.w)) * w;
      if (gapY < lineH * 0.8 && gapX < lineH * 4) {
        g.push(b);
        continue;
      }
    }
    groups.push([b]);
  }
  return groups.map((g) => {
    const { w, h } = pageSize(pages, g[0].page);
    const u = unionBox(g[0].page, g)!;
    const linePt = Math.min(...g.map((b) => b.h)) * h;
    // Wenig Rand oben/unten (dichte Zeilen), etwas mehr seitlich
    const grow = (padX: number, padY: number): Box => {
      const x0 = Math.max(0, u.x - padX / w);
      const y0 = Math.max(0, u.y - padY / h);
      const x1 = Math.min(1, u.x + u.w + padX / w);
      const y1 = Math.min(1, u.y + u.h + padY / h);
      return { page: u.page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const box = grow(Math.min(16, Math.max(3, linePt * 0.6)), Math.min(8, Math.max(2, linePt * 0.25)));
    return { box, focus: grow(linePt * 0.1, linePt * 0.1), widthPt: box.w * w, heightPt: box.h * h, linePt };
  });
}

/**
 * Gemeinsamer Massstab (CSS-Pixel pro PDF-Punkt), mit dem alle Ausschnitte untereinander in die Fläche passen.
 * Textzeilen werden höchstens auf linePx vergrössert, damit kleine Werte nicht riesig erscheinen.
 */
export function fitScale(regions: CropRegion[], width: number, height: number, linePx: number, gap = 12): number {
  if (!regions.length || width <= 0 || height <= 0) return 0;
  const maxW = Math.max(...regions.map((r) => r.widthPt));
  const sumH = regions.reduce((s, r) => s + r.heightPt, 0);
  const minLine = Math.min(...regions.map((r) => r.linePt));
  return Math.max(0, Math.min(width / maxW, (height - gap * (regions.length - 1)) / sumH, linePx / Math.max(minLine, 1)));
}
