import type { Column } from './types';

/** Farben der eingebauten Felder – gut unterscheidbar auf weissem Papier. */
export const FIELD_COLORS = {
  kreditor: '#7C3AED',
  titel: '#2563EB',
  rechnungsnummer: '#EA580C',
  rechnungsdatum: '#0D9488',
  zahlungsdatum: '#DB2777',
  totalbetrag: '#DC2626',
  steueranteil: '#CA8A04',
  waehrung: '#475569',
  positionen: '#16A34A',
  scandatum: '#64748B',
  dateiname: '#64748B'
} as const;

/** Farbpalette für eigene Spalten. */
export const CUSTOM_COLORS = ['#0891B2', '#C026D3', '#65A30D', '#4F46E5', '#B45309', '#0F766E', '#BE123C', '#7E22CE'];

export const DEFAULT_COLUMNS: Column[] = [
  {
    id: 'kreditor',
    label: 'Kreditor',
    type: 'text',
    builtin: true,
    color: FIELD_COLORS.kreditor,
    description: 'Firmenname des Rechnungsstellers (Absender, nicht der Empfänger)',
    enabled: true
  },
  {
    id: 'titel',
    label: 'Titel',
    type: 'text',
    builtin: true,
    color: FIELD_COLORS.titel,
    description: 'Betreff bzw. Bezeichnung der Rechnung',
    enabled: true
  },
  {
    id: 'rechnungsnummer',
    label: 'Rechnungsnummer',
    type: 'id',
    builtin: true,
    color: FIELD_COLORS.rechnungsnummer,
    description: 'Rechnungsnummer bzw. Belegnummer',
    enabled: true
  },
  {
    id: 'rechnungsdatum',
    label: 'Rechnungsdatum',
    type: 'date',
    builtin: true,
    color: FIELD_COLORS.rechnungsdatum,
    description: 'Ausstellungsdatum der Rechnung',
    enabled: true
  },
  {
    id: 'zahlungsdatum',
    label: 'Zahlungsdatum',
    type: 'date',
    builtin: true,
    color: FIELD_COLORS.zahlungsdatum,
    description: 'Fälligkeitsdatum («zahlbar bis»), sonst aus der Zahlungsfrist berechnet',
    enabled: true
  },
  {
    id: 'totalbetrag',
    label: 'Totalbetrag',
    type: 'amount',
    builtin: true,
    color: FIELD_COLORS.totalbetrag,
    description: 'Zu zahlender Gesamtbetrag inkl. MWST',
    enabled: true
  },
  {
    id: 'steueranteil',
    label: 'Steueranteil',
    type: 'amount',
    builtin: true,
    color: FIELD_COLORS.steueranteil,
    description: 'Summe der ausgewiesenen MWST/USt-Beträge',
    enabled: true
  },
  {
    id: 'waehrung',
    label: 'Währung',
    type: 'currency',
    builtin: true,
    color: FIELD_COLORS.waehrung,
    description: 'ISO-Währungscode, z.B. CHF oder EUR',
    enabled: true
  },
  {
    id: 'positionen',
    label: 'Positionen',
    type: 'positions',
    builtin: true,
    color: FIELD_COLORS.positionen,
    description: 'Einzelne Rechnungspositionen als JSON',
    enabled: true
  },
  {
    id: 'scandatum',
    label: 'Scan-Datum',
    type: 'scanDate',
    builtin: true,
    color: FIELD_COLORS.scandatum,
    description: 'Zeitpunkt des Scans durch Belegfuchs',
    enabled: true
  },
  {
    id: 'dateiname',
    label: 'Dateiname',
    type: 'fileName',
    builtin: true,
    color: FIELD_COLORS.dateiname,
    description: 'Name der PDF-Datei',
    enabled: true
  }
];

/** Spalten, deren Wert die KI bzw. der Scan liefert (nicht vom System gesetzt). */
export function isExtractable(col: Column): boolean {
  return col.type !== 'scanDate' && col.type !== 'fileName';
}

/** Spalten, die im Prüfmodus als Feld (nicht Positionsliste) bearbeitet werden. */
export function isFieldColumn(col: Column): boolean {
  return isExtractable(col) && col.type !== 'positions';
}

export function nextCustomColor(columns: Column[]): string {
  const used = new Set(columns.map((c) => c.color.toUpperCase()));
  return CUSTOM_COLORS.find((c) => !used.has(c.toUpperCase())) ?? CUSTOM_COLORS[columns.length % CUSTOM_COLORS.length];
}

export function cloneColumns(cols: Column[]): Column[] {
  return cols.map((c) => ({ ...c }));
}

/** Ergänzt fehlende eingebaute Spalten (z.B. nach Updates) und behält die Reihenfolge des Nutzers. */
export function normalizeColumns(cols: Column[] | undefined): Column[] {
  if (!cols || cols.length === 0) return cloneColumns(DEFAULT_COLUMNS);
  const result = cloneColumns(cols);
  for (const def of DEFAULT_COLUMNS) {
    if (!result.some((c) => c.id === def.id)) result.push({ ...def });
  }
  return result;
}
