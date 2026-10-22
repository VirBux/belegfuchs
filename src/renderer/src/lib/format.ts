import {
  amountToValue,
  formatAmount,
  formatDate,
  formatDateTime,
  normalizeCurrency,
  parseAmount,
  parseDate
} from '../../../shared/parse';
import type { Column, ColumnType, DocMeta, FieldSource, Position, Settings } from '../../../shared/types';

/** Fehlertext ohne Electron-Präfix bei IPC-Aufrufen */
export const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));

export const isNumericValue = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function formatFieldValue(type: ColumnType, value: string | undefined, settings: Settings): string {
  if (!value) return '';
  if ((type === 'amount' || type === 'number') && isNumericValue(value)) return formatAmount(Number(value), settings.numberFormat);
  if (type === 'date' && isIsoDate(value)) return formatDate(value, settings.dateFormat);
  return value;
}

export function displayCell(col: Column, doc: DocMeta, settings: Settings): string {
  switch (col.type) {
    case 'scanDate':
      return formatDateTime(doc.scanDate);
    case 'fileName':
      return doc.fileName;
    case 'positions':
      return doc.positions.length ? positionsJson(doc.positions) : '';
    default:
      return formatFieldValue(col.type, doc.fields[col.id]?.value, settings);
  }
}

/** Positionen als JSON-Objekt: {"pos1": {"titel": "…", "menge": 2, "preis": 12.5}} */
export function positionsJson(positions: Position[]): string {
  if (!positions.length) return '';
  const obj: Record<string, { titel: string; menge?: number; preis: number | null }> = {};
  positions.forEach((p, i) => {
    obj[`pos${i + 1}`] = { titel: p.titel, ...(p.menge !== null ? { menge: p.menge } : {}), preis: p.preis };
  });
  return JSON.stringify(obj);
}

/** Manuelle Eingabe interpretieren; ungültige Werte bleiben als freier Text erhalten. */
export function parseInput(type: ColumnType, input: string): { value: string; valid: boolean } {
  const text = input.trim();
  if (!text) return { value: '', valid: true };
  switch (type) {
    case 'amount':
    case 'number': {
      const n = parseAmount(text);
      return n === null ? { value: text, valid: false } : { value: amountToValue(n), valid: true };
    }
    case 'date': {
      const iso = parseDate(text);
      return iso ? { value: iso, valid: true } : { value: text, valid: false };
    }
    case 'currency':
      return { value: normalizeCurrency(text), valid: true };
    default:
      return { value: text, valid: true };
  }
}

export function isValidValue(type: ColumnType, value: string): boolean {
  if (!value) return true;
  if (type === 'amount' || type === 'number') return isNumericValue(value);
  if (type === 'date') return isIsoDate(value);
  return true;
}

export const SOURCE_LABEL: Record<FieldSource, string> = {
  ai: 'KI',
  heuristic: 'Regel',
  pick: 'Auswahl',
  box: 'Rahmen',
  manual: 'Manuell',
  computed: 'Berechnet',
  system: 'System'
};

export const SOURCE_HINT: Record<FieldSource, string> = {
  ai: 'Von der KI erkannt',
  heuristic: 'Von der regelbasierten Erkennung gefunden',
  pick: 'Im PDF ausgewählt',
  box: 'Per Rahmen im PDF erfasst',
  manual: 'Manuell eingegeben – ohne Bezug zum Scan',
  computed: 'Berechnet',
  system: 'Von Belegfuchs gesetzt'
};

export function columnLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
