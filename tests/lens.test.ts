import { describe, expect, it } from 'vitest';
import { cloneColumns, DEFAULT_COLUMNS } from '../src/shared/columns';
import { DEFAULT_SETTINGS } from '../src/shared/models';
import type { Box, DocMeta, PageData, Word } from '../src/shared/types';
import { buildLineInfos, wordsBox } from '../src/renderer/src/lib/doctext';
import { applyLensEdit, buildLensSteps, cropRegions, fitScale, positionParts } from '../src/renderer/src/lib/lens';

/** Baut eine Seite aus Textzeilen; Spalten werden mit "|" getrennt. */
function page(lines: string[]): PageData {
  const words: Word[] = [];
  const out: PageData['lines'] = [];
  lines.forEach((text, li) => {
    const y = 0.05 + li * 0.025;
    const idx: number[] = [];
    let x = 0.08;
    for (const col of text.split('|')) {
      for (const w of col.trim().split(/\s+/).filter(Boolean)) {
        const wd = w.length * 0.009;
        idx.push(words.length);
        words.push({ text: w, x, y, w: wd, h: 0.014, line: li });
        x += wd + 0.006;
      }
      x += 0.08;
    }
    out.push({ words: idx, x: 0.08, y, w: x - 0.08, h: 0.014 });
  });
  return { index: 0, width: 595, height: 842, source: 'text', words, lines: out };
}

const pg = page([
  'Muster Elektro AG',
  'Rechnung Nr. RE-2026-0412',
  "1 | Installationsarbeiten Elektriker | 12 Std | 98.00 | 1'176.00",
  '2 | Anfahrt pauschal | 1 | 45.00 | 45.00',
  "Total CHF | 1'221.00"
]);
const pages = [pg];
const infos = buildLineInfos(pages);
const line = (i: number) => wordsBox(pages, 0, pg.lines[i].words)!;
const word = (text: string) => {
  const i = pg.words.findIndex((w) => w.text === text);
  return wordsBox(pages, 0, [i])!;
};
const textIn = (b: Box) =>
  pg.words
    .filter((w) => w.x >= b.x - 1e-9 && w.x + w.w <= b.x + b.w + 1e-9 && w.y >= b.y - 1e-9 && w.y + w.h <= b.y + b.h + 1e-9)
    .map((w) => w.text)
    .join(' ');

const doc: DocMeta = {
  id: 'd1',
  fileName: 'test.pdf',
  fileSize: 1,
  pageCount: 1,
  status: 'scanned',
  pages,
  fields: {
    kreditor: { value: 'Muster Elektro AG', source: 'ai', boxes: [line(0)] },
    titel: { value: 'Manuell', source: 'manual', boxes: [] },
    totalbetrag: { value: '1221.00', source: 'ai', boxes: [word("1'221.00")] },
    steueranteil: { value: '1221.00', raw: "1'176.00 + 45", source: 'ai', boxes: [word("1'176.00"), word('45.00')] },
    rechnungsnummer: { value: 'RE-2026-0412', source: 'heuristic', boxes: [word('RE-2026-0412')] }
  },
  positions: [
    { id: 'p1', titel: 'Installationsarbeiten Elektriker', menge: 12, preis: 1176, boxes: [line(2)], source: 'ai' },
    { id: 'p2', titel: 'Anfahrt pauschal', menge: 1, preis: 45, boxes: [line(3)], source: 'ai' },
    { id: 'p3', titel: 'Ohne Zeile', menge: null, preis: 10, boxes: [], source: 'manual' }
  ]
};

describe('Linsenmodus', () => {
  const { steps, skipped } = buildLensSteps(doc, cloneColumns(DEFAULT_COLUMNS), DEFAULT_SETTINGS, infos);

  it('zeigt nur Werte mit Fundstelle, Felder in Spaltenreihenfolge, danach Positionen', () => {
    expect(steps.map((s) => s.key)).toEqual(['f:kreditor', 'f:rechnungsnummer', 'f:totalbetrag', 'f:steueranteil', 'p:p1', 'p:p2']);
    expect(steps[2].parts[0].text).toBe('1’221.00');
    expect(steps[2].parts[0].detail).toBeUndefined();
    expect(steps[3].parts[0].detail).toBe('aus 1’176.00 + 45.00');
    expect(skipped.map((s) => s.label)).toContain('Titel');
    expect(skipped.find((s) => s.label === 'Position 3')?.reason).toBe('manuell eingegeben');
  });

  it('teilt eine Position in Titel, Menge und Preis auf', () => {
    const parts = positionParts(pages, infos, doc.positions[0], DEFAULT_SETTINGS);
    expect(parts.map((p) => p.text)).toEqual(['Installationsarbeiten Elektriker', '12', '1’176.00']);
    expect(parts.map((p) => textIn(p.boxes[0]))).toEqual(['Installationsarbeiten Elektriker', '12', "1'176.00"]);
    expect(parts.some((p) => p.wholeLine)).toBe(false);
  });

  it('nimmt als Menge nicht die Positionsnummer', () => {
    const [, menge, preis] = positionParts(pages, infos, doc.positions[1], DEFAULT_SETTINGS);
    expect(menge.boxes[0].x).toBeGreaterThan(word('pauschal').x);
    expect(preis.boxes[0].x).toBeGreaterThan(word('45.00').x);
  });

  it('zeigt die ganze Zeile, wenn ein Teil nicht gefunden wird', () => {
    const parts = positionParts(pages, infos, { ...doc.positions[0], titel: 'Ganz anderer Text' }, DEFAULT_SETTINGS);
    expect(parts[0].wholeLine).toBe(true);
    expect(parts[0].boxes).toEqual([line(2)]);
    expect(parts[2].wholeLine).toBeUndefined();
  });

  it('findet gerundete Preise und Mengen mit Dezimalkomma', () => {
    const hp = page(['Pos | Anzahl | Bezeichnung | Einheit | Menge | Einzelpreis | Gesamt', '5 | 1 | Volume | GB-Monate | 6,459 | 0,0572 € | 0,3695 €']);
    const hInfos = buildLineInfos([hp]);
    const hLine = wordsBox([hp], 0, hp.lines[1].words)!;
    const hText = (b: Box) =>
      hp.words
        .filter((w) => w.x >= b.x - 1e-9 && w.x + w.w <= b.x + b.w + 1e-9 && w.y >= b.y - 1e-9)
        .map((w) => w.text)
        .join(' ');
    for (const menge of [6.459, 6459]) {
      const parts = positionParts([hp], hInfos, { id: 'h', titel: '1 Volume', menge, preis: 0.37, boxes: [hLine], source: 'ai' }, DEFAULT_SETTINGS);
      expect(parts.some((p) => p.wholeLine)).toBe(false);
      expect(parts.map((p) => hText(p.boxes[0]))).toEqual(['1 Volume', '6,459', '0,3695']);
    }
  });

  it('übernimmt korrigierte Felder mit den bisherigen Fundstellen', () => {
    const total = { kind: 'field', columnId: 'totalbetrag', type: 'amount' } as const;
    const r = applyLensEdit(doc, total, "1'300.5");
    expect(r).toEqual({ kind: 'field', columnId: 'totalbetrag', value: { value: '1300.50', raw: "1'300.5", source: 'manual', boxes: doc.fields.totalbetrag.boxes } });
    // Der Schritt bleibt im Linsenmodus, der neue Wert erscheint formatiert
    const edited = { ...doc, fields: { ...doc.fields, totalbetrag: (r as Extract<typeof r, { kind: 'field' }>).value } };
    const after = buildLensSteps(edited, cloneColumns(DEFAULT_COLUMNS), DEFAULT_SETTINGS, infos).steps;
    expect(after.map((s) => s.key)).toEqual(steps.map((s) => s.key));
    expect(after[2].parts[0].text).toBe('1’300.50');
    expect(applyLensEdit(doc, total, '1221')).toEqual({ kind: 'none' });
    expect(applyLensEdit(doc, total, '   ')).toEqual({ kind: 'none' });
    expect(applyLensEdit(doc, total, 'zwölf')).toEqual({ kind: 'error', message: 'Keine gültige Zahl' });
    expect(applyLensEdit(doc, { kind: 'field', columnId: 'rechnungsdatum', type: 'date' }, '32.13.2026')).toEqual({ kind: 'error', message: 'Datum nicht lesbar' });
  });

  it('übernimmt Titel, Menge und Preis einer Position einzeln', () => {
    const edit = (key: 'titel' | 'menge' | 'preis', text: string) => applyLensEdit(doc, { kind: 'position', positionId: 'p1', key }, text);
    const pos = (text: string, key: 'titel' | 'menge' | 'preis') => {
      const r = edit(key, text);
      return r.kind === 'positions' ? r.positions.find((p) => p.id === 'p1') : r;
    };
    expect(pos('Elektriker', 'titel')).toMatchObject({ titel: 'Elektriker', menge: 12, preis: 1176, source: 'manual', boxes: [line(2)] });
    expect(pos('6.459', 'menge')).toMatchObject({ menge: 6.459 });
    expect(pos('6,459', 'menge')).toMatchObject({ menge: 6.459 });
    expect(pos('1’176.00', 'preis')).toEqual({ kind: 'none' });
    expect(pos('0.3695', 'preis')).toMatchObject({ preis: 0.37 });
    expect(edit('menge', 'viele')).toEqual({ kind: 'error', message: 'Keine gültige Zahl' });
    expect(edit('titel', '')).toEqual({ kind: 'none' });
    const r = edit('preis', '99');
    expect(r.kind === 'positions' && r.positions.filter((p) => p.id !== 'p1')).toEqual(doc.positions.slice(1));
  });

  it('fasst Boxen derselben Zeile zusammen und stapelt entfernte', () => {
    expect(cropRegions([word('Muster'), word('Elektro')], pages)).toHaveLength(1);
    expect(cropRegions([word('Muster'), word("1'221.00")], pages)).toHaveLength(2);
  });

  it('passt Ausschnitte in die feste Fläche ein und begrenzt die Vergrösserung', () => {
    const [r] = cropRegions([word("1'221.00")], pages);
    const s = fitScale([r], 500, 300, 60);
    expect(r.linePt * s).toBeCloseTo(60);
    expect(r.widthPt * s).toBeLessThanOrEqual(500);
    const wide = cropRegions([line(2)], pages);
    const sw = fitScale(wide, 500, 300, 60);
    expect(wide[0].widthPt * sw).toBeCloseTo(500);
  });
});
