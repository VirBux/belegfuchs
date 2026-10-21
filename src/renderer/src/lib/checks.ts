import { formatAmount } from '../../../shared/parse';
import type { Column, DocMeta, Settings } from '../../../shared/types';
import { isIsoDate, isNumericValue } from './format';

export interface Check {
  level: 'ok' | 'warn' | 'info';
  text: string;
}

const KNOWN_RATES = [8.1, 2.6, 3.8, 7.7, 2.5, 3.7, 19, 7, 20, 10, 13, 5.5, 22, 4, 21, 6, 9, 12, 25];

/** Plausibilitätsprüfungen als Hilfe im Prüfmodus. */
export function runChecks(doc: DocMeta, columns: Column[], settings: Settings): Check[] {
  const checks: Check[] = [];
  const enabled = new Set(columns.filter((c) => c.enabled).map((c) => c.id));
  const num = (id: string) => {
    const v = doc.fields[id]?.value;
    return v && isNumericValue(v) ? Number(v) : null;
  };
  const fmt = (n: number) => formatAmount(n, settings.numberFormat);

  const missing = columns.filter(
    (c) => c.enabled && !['scanDate', 'fileName', 'positions', 'currency'].includes(c.type) && !doc.fields[c.id]?.value
  );
  if (missing.length) checks.push({ level: 'warn', text: `Ohne Wert: ${missing.map((c) => c.label).join(', ')}` });

  const invalid = columns.filter((c) => {
    const v = doc.fields[c.id]?.value;
    if (!c.enabled || !v) return false;
    if (c.type === 'amount' || c.type === 'number') return !isNumericValue(v);
    if (c.type === 'date') return !isIsoDate(v);
    return false;
  });
  if (invalid.length) checks.push({ level: 'warn', text: `Freitext statt Zahl/Datum: ${invalid.map((c) => c.label).join(', ')}` });

  const total = num('totalbetrag');
  const vat = num('steueranteil');
  if (enabled.has('positionen') && doc.positions.length && total !== null) {
    const sum = doc.positions.reduce((s, p) => s + (p.preis ?? 0), 0);
    if (Math.abs(sum - total) < 0.06) checks.push({ level: 'ok', text: `Summe der Positionen = Totalbetrag (${fmt(total)})` });
    else if (vat !== null && Math.abs(sum + vat - total) < 0.06) checks.push({ level: 'ok', text: 'Positionen + Steueranteil = Totalbetrag' });
    else
      checks.push({
        level: 'warn',
        text: `Summe der Positionen (${fmt(sum)}) ≠ Totalbetrag (${fmt(total)}) – Differenz ${fmt(total - sum)}`
      });
  }
  if (total !== null && vat !== null && vat > 0 && total > vat) {
    const rate = (vat / (total - vat)) * 100;
    const known = KNOWN_RATES.find((r) => Math.abs(r - rate) < 0.12);
    if (known !== undefined) checks.push({ level: 'ok', text: `Steueranteil entspricht ${known.toString().replace('.', ',')} % MWST` });
    else checks.push({ level: 'info', text: `Steuersatz ≈ ${rate.toFixed(2).replace('.', ',')} % (gemischte Sätze oder Rundung?)` });
  }
  const inv = doc.fields.rechnungsdatum?.value;
  const due = doc.fields.zahlungsdatum?.value;
  if (inv && due && isIsoDate(inv) && isIsoDate(due) && due < inv) checks.push({ level: 'warn', text: 'Zahlungsdatum liegt vor dem Rechnungsdatum' });
  if (doc.fields.zahlungsdatum?.source === 'computed') checks.push({ level: 'info', text: `Zahlungsdatum berechnet (${doc.fields.zahlungsdatum.note})` });
  if (checks.length === 0) checks.push({ level: 'ok', text: 'Keine Auffälligkeiten' });
  return checks;
}
