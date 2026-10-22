import { describe, expect, it } from 'vitest';
import {
  addDays,
  detectDecimalSeparator,
  findAmounts,
  findDates,
  formatAmount,
  normalizeCurrency,
  parseAmount,
  parseDate,
  parseQuantityText
} from '../src/shared/parse';

describe('parseAmount', () => {
  it.each([
    ["1'234.50", 1234.5],
    ['1’234.50', 1234.5],
    ['1.234,50', 1234.5],
    ['1,234.50', 1234.5],
    ['1 234,50', 1234.5],
    ['CHF 1 949.75', 1949.75],
    ['250.–', 250],
    ['250.-', 250],
    ['12,5', 12.5],
    ['5.000', 5000],
    ['0,042 €', 0.042],
    ['-12.50', -12.5],
    ['CHF -5.00', -5],
    ['1.234.567,89', 1234567.89],
    ['€ 639,03', 639.03],
    ['abc', null]
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('Mengen', () => {
  it.each([
    ['6,459', ',', 6.459],
    ['6,459', '.', 6459],
    ['6.459', 'any', 6.459],
    ['6,459 GB', 'any', 6.459],
    ['6,459', null, 6459],
    ['1.234,5', 'any', 1234.5],
    ["1'000", 'any', 1000],
    ['12', ',', 12],
    ['-2,500', ',', -2.5]
  ] as const)('%s mit Dezimaltrenner %s → %s', (input, sep, expected) => {
    expect(parseQuantityText(input, sep)).toBe(expected);
  });

  it('erkennt den Dezimaltrenner des Dokuments', () => {
    expect(detectDecimalSeparator('Volume 6,459 0,0572 € 0,3695 €\nSumme 12,34 €')).toBe(',');
    expect(detectDecimalSeparator("Total CHF 1'571.25\nDatum 21.10.2026")).toBe('.');
    expect(detectDecimalSeparator('Datum 21.10.2026')).toBeNull();
  });
});

describe('findAmounts', () => {
  it('trennt Spalten und erkennt Prozent', () => {
    const found = findAmounts("MWST 8.1%   CHF   133.87");
    expect(found.map((a) => [a.value, a.percent])).toEqual([
      [8.1, true],
      [133.87, false]
    ]);
  });
  it('liest Datum nicht als Betrag', () => {
    expect(findAmounts('Datum 14.10.2026').filter((a) => a.hasDecimals)).toEqual([]);
  });
  it('ignoriert UID-Nummern', () => {
    expect(findAmounts('MWST-Nr. CHE-123.456.789 MWST').filter((a) => a.hasDecimals)).toEqual([]);
  });
  it('erkennt Leerzeichen-Tausender nach Währung (QR-Rechnung)', () => {
    expect(findAmounts('CHF 1 835.20').map((a) => a.value)).toContain(1835.2);
  });
  it('verschmilzt Menge und Preis nicht', () => {
    const values = findAmounts('Kabel   3 120.00   360.00').map((a) => a.value);
    expect(values).toContain(120);
    expect(values).not.toContain(3120);
  });
});

describe('Datumsangaben', () => {
  it.each([
    ['14.10.2026', '2026-10-14'],
    ['Zürich, 14. Oktober 2026', '2026-10-14'],
    ['Morges, le 3 octobre 2026', '2026-10-03'],
    ['1er décembre 2026', '2026-12-01'],
    ['9 ottobre 2026', '2026-10-09'],
    ['October 31, 2026', '2026-10-31'],
    ['2026-10-02', '2026-10-02'],
    ['02.10.26', '2026-10-02'],
    ['31.02.2026', null]
  ])('%s → %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });
  it('findet mehrere Daten', () => {
    expect(findDates('Ausführung: 22.09.2026 – 03.10.2026').map((d) => d.iso)).toEqual(['2026-09-22', '2026-10-03']);
  });
  it('addiert Tage über Monatsgrenzen', () => {
    expect(addDays('2026-10-14', 30)).toBe('2026-11-13');
  });
});

describe('Formatierung', () => {
  it('formatiert Beträge', () => {
    expect(formatAmount(1835.2, 'ch')).toBe('1’835.20');
    expect(formatAmount(1835.2, 'de')).toBe('1.835,20');
    expect(formatAmount(-5, 'plain')).toBe('-5.00');
  });
  it('normalisiert Währungen', () => {
    expect(normalizeCurrency('€')).toBe('EUR');
    expect(normalizeCurrency('Fr.')).toBe('CHF');
    expect(normalizeCurrency('chf')).toBe('CHF');
  });
});
