import { describe, expect, it } from 'vitest';
import { buildSchema, buildUserPrompt, parseLineRef, schemaToGbnf, slugKey } from '../src/shared/prompt';
import type { PageData, Word } from '../src/shared/types';
import { buildLineInfos } from '../src/renderer/src/lib/doctext';
import { runHeuristics } from '../src/renderer/src/lib/heuristics';
import { applyAiResult, locateAmount } from '../src/renderer/src/lib/mapping';
import { looksLikeRecipient, suggestOwnCompany } from '../src/renderer/src/lib/recipient';

/** Baut eine Seite aus Textzeilen; Spalten werden mit "|" getrennt. */
function page(lines: string[], index = 0): PageData {
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
  return { index, width: 595, height: 842, source: 'text', words, lines: out };
}

const invoice = page([
  'Muster Elektro AG | Bahnhofstrasse 12 | 8001 Zürich',
  'Belegfuchs GmbH',
  'Seestrasse 5',
  'Zürich, 14. Oktober 2026',
  'Rechnung Nr. RE-2026-0412',
  'Betreff: Elektroinstallation Büro 2. OG',
  'Pos | Bezeichnung | Menge | Preis | Betrag CHF',
  "1 | Installationsarbeiten Elektriker | 12 Std | 98.00 | 1'176.00",
  '2 | Kabel NYM-J 3x1.5 mm2 | 150 m | 1.85 | 277.50',
  "Zwischentotal | CHF | 1'453.50",
  'MWST 8.1% | CHF | 117.75',
  "Total CHF | 1'571.25",
  'Zahlbar innert 30 Tagen netto.',
  'Zahlbar durch',
  'Belegfuchs GmbH'
]);

describe('Regelbasierte Erkennung', () => {
  const infos = buildLineInfos([invoice]);
  const r = runHeuristics(infos, [invoice], { ownCompany: '', defaultCurrency: 'CHF' });
  it('findet die Kernfelder', () => {
    expect(r.fields.kreditor?.value).toBe('Muster Elektro AG');
    expect(r.fields.rechnungsnummer?.value).toBe('RE-2026-0412');
    expect(r.fields.rechnungsdatum?.value).toBe('2026-10-14');
    expect(r.fields.zahlungsdatum?.value).toBe('2026-11-13');
    expect(r.fields.zahlungsdatum?.source).toBe('computed');
    expect(r.fields.totalbetrag?.value).toBe('1571.25');
    expect(r.fields.steueranteil?.value).toBe('117.75');
    expect(r.fields.titel?.value).toBe('Elektroinstallation Büro 2. OG');
    expect(r.fields.waehrung?.value).toBe('CHF');
  });
  it('liefert Boxen für Markierungen', () => {
    expect(r.fields.totalbetrag?.boxes).toHaveLength(1);
  });
  it('erkennt Positionen', () => {
    expect(r.positions.map((p) => [p.titel, p.menge, p.preis])).toEqual([
      ['Installationsarbeiten Elektriker', 12, 1176],
      ['Kabel NYM-J 3x1.5 mm2', 150, 277.5]
    ]);
  });
  it('erkennt den Empfänger', () => {
    expect(looksLikeRecipient('Belegfuchs GmbH', infos, '')).toBe(true);
    expect(looksLikeRecipient('Muster Elektro AG', infos, '')).toBe(false);
  });
});

/** Seite mit frei positionierten Segmenten: jede Zeile = Liste aus [x, Text]. */
function pageAt(rows: [number, string][][]): PageData {
  const words: Word[] = [];
  const lines: PageData['lines'] = rows.map((segs, li) => {
    const y = 0.6 + li * 0.015;
    const idx: number[] = [];
    for (const [x0, text] of segs) {
      let x = x0;
      for (const w of text.split(' ')) {
        idx.push(words.length);
        words.push({ text: w, x, y, w: w.length * 0.008, h: 0.011, line: li });
        x += w.length * 0.008 + 0.005;
      }
    }
    return { words: idx, x: 0, y, w: 1, h: 0.011 };
  });
  return { index: 0, width: 595, height: 842, source: 'text', words, lines };
}

describe('QR-Zahlteil', () => {
  it('nimmt den Namen unter «Zahlbar an» aus derselben Spalte, auch bei verschmolzenen Zeilen', () => {
    const p = pageAt([
      [
        [0.03, 'Empfangsschein'],
        [0.33, 'Zahlteil'],
        [0.58, 'Konto / Zahlbar an']
      ],
      [[0.58, 'CH44 3199 9123 0008 8901 2']],
      [
        [0.03, 'Konto / Zahlbar an'],
        [0.58, 'Muster Elektro AG']
      ],
      [
        [0.03, 'CH44 3199 9123 0008 8901 2'],
        [0.58, 'Bahnhofstrasse 12']
      ]
    ]);
    const r = runHeuristics(buildLineInfos([p]), [p], { ownCompany: '', defaultCurrency: 'CHF' });
    expect(r.fields.kreditor?.value).toBe('Muster Elektro AG');
  });
});

describe('KI-Ergebnis zuordnen', () => {
  const infos = buildLineInfos([invoice]);
  it('findet Beträge auch bei falscher Zeilenangabe', () => {
    const loc = locateAmount(infos, [invoice], 1571.25, '1.3');
    expect(loc?.raw).toBe("1'571.25");
  });
  it('wendet ein KI-Ergebnis an', () => {
    const specs = ['kreditor', 'rechnungsnummer', 'rechnungsdatum', 'zahlungsdatum', 'totalbetrag', 'steueranteil'].map((id) => ({
      key: id,
      columnId: id,
      label: id,
      type: (id.includes('datum') ? 'date' : id === 'totalbetrag' || id === 'steueranteil' ? 'amount' : 'text') as 'date' | 'amount' | 'text'
    }));
    const applied = applyAiResult(
      {
        fields: {
          kreditor: { zeile: '1.1', text: 'Muster Elektro AG' },
          rechnungsnummer: { zeile: '1.5', text: 'RE-2026-0412' },
          rechnungsdatum: { zeile: '1.4', text: '14. Oktober 2026' },
          zahlungsdatum: { zeile: '', text: '' },
          totalbetrag: { zeile: '1.12', text: "1'571.25" }
        },
        zahlungsfristTage: 30,
        mwst: [{ zeile: '1.11', betrag: '117.75', satz: '8.1' }],
        waehrung: 'CHF',
        positionen: [{ zeile: '1.8', titel: 'Installationsarbeiten Elektriker', menge: '12 Std', preis: "1'176.00" }]
      },
      specs,
      infos,
      [invoice]
    );
    expect(applied.fields.totalbetrag?.value).toBe('1571.25');
    expect(applied.fields.totalbetrag?.boxes.length).toBe(1);
    expect(applied.fields.zahlungsdatum?.value).toBe('2026-11-13');
    expect(applied.fields.steueranteil?.value).toBe('117.75');
    expect(applied.positions[0]).toMatchObject({ titel: 'Installationsarbeiten Elektriker', menge: 12, preis: 1176 });
    expect(applied.positions[0].boxes.length).toBe(1);
  });
});

describe('Eigene Firma vorschlagen', () => {
  it('erkennt die Firma, die auf allen Rechnungen steht', () => {
    const make = (sender: string) => ({ pages: [page([`${sender} | Hauptstrasse 1`, 'Belegfuchs GmbH', 'Seestrasse 5'])] });
    const docs = ['Alpha AG', 'Beta GmbH', 'Gamma SA'].map((s, i) => ({ ...make(s), id: String(i) })) as never[];
    expect(suggestOwnCompany(docs)).toBe('Belegfuchs GmbH');
  });
});

describe('Prompt & Grammatik', () => {
  it('erzeugt eindeutige Schlüssel', () => {
    const taken = new Set(['kreditor']);
    expect(slugKey('Kreditor', taken)).toBe('kreditor_2');
    expect(slugKey('Kunden-Nr.', taken)).toBe('kunden_nr');
    expect(slugKey('Größe', taken)).toBe('grosse');
  });
  it('liest Zeilenreferenzen', () => {
    expect(parseLineRef('1.12')).toEqual({ page: 0, line: 11 });
    expect(parseLineRef('[2.3]')).toEqual({ page: 1, line: 2 });
    expect(parseLineRef('')).toBeNull();
  });
  it('baut eine Grammatik mit flexiblem Leerraum', () => {
    const fields = [{ key: 'kreditor', columnId: 'kreditor', label: 'Kreditor', type: 'text' as const }];
    const gbnf = schemaToGbnf(buildSchema(fields, true) as never);
    expect(gbnf).toContain('root ::= ws obj-0');
    expect(gbnf).toContain('ws ::= [ \\t\\n]{0,20}');
    expect(gbnf).toMatch(/arr-\d+ ::= "\[" ws \( obj-\d+ \( ws "," ws obj-\d+ \)\{0,99\} \)\? ws "\]"/);
  });
  it('nennt eigene Spalten im Prompt', () => {
    const prompt = buildUserPrompt({
      text: '[1.1] Test',
      fields: [{ key: 'kundennummer', columnId: 'c_1', label: 'Kundennummer', type: 'text', description: 'steht oben rechts' }],
      withPositions: false,
      ownCompany: 'Belegfuchs GmbH'
    });
    expect(prompt).toContain('- kundennummer: «Kundennummer» – steht oben rechts');
    expect(prompt).toContain('«Belegfuchs GmbH»');
  });
});
