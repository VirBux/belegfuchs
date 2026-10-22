// Zahlen- und Datumsparser für Rechnungen aus CH, DE, AT, FR, IT und dem englischen Raum.

const APOSTROPHES = /['’`´ʼ]/g;
const THIN_SPACES = /[    ]/g;

export interface FoundAmount {
  value: number;
  start: number;
  end: number;
  text: string;
  hasDecimals: boolean;
  percent: boolean;
}

export interface FoundDate {
  iso: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Wandelt einen einzelnen Betrag in eine Zahl um ("1'234.50", "1.234,50", "CHF 1 949.75", "250.–").
 * Tolerant: Leerzeichen und Apostrophe gelten als Tausendertrenner.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = input.trim();
  if (!s) return null;

  // "250.–" / "250.-" bedeutet 250.00
  s = s.replace(/([.,])\s*[-–—]{1,2}(?!\s*\d)/g, '$100');

  let negative = false;
  if (/^\(.*\)$/.test(s)) negative = true;
  // Währung o.ä. vorne ignorieren, dann auf Vorzeichen prüfen ("CHF -12.50")
  if (/^[-–−]\s*\d/.test(s.replace(/^[^\d\-–−(]*/, ''))) negative = true;
  if (/\d\s*[-–−]$/.test(s)) negative = true;

  // Nur den ersten Zahlenblock betrachten (inkl. Trennzeichen)
  const m = s.match(/\d[\d.,'’`´ʼ\s    ]*/);
  if (!m) return null;
  let num = m[0].trim().replace(APOSTROPHES, '').replace(THIN_SPACES, '').replace(/\s+/g, '');
  num = num.replace(/[.,]+$/, '');
  if (!num) return null;

  const lastDot = num.lastIndexOf('.');
  const lastComma = num.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    num = num.split(thouSep).join('');
    num = num.replace(decSep, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = num.split(sep);
    const last = parts[parts.length - 1];
    if (parts.length > 2) {
      // Mehrere gleiche Trenner: Tausendertrenner, ausser die letzte Gruppe ist keine 3er-Gruppe
      num = last.length === 3 ? parts.join('') : parts.slice(0, -1).join('') + '.' + last;
    } else if (last.length === 3 && parts[0] !== '0' && parts[0] !== '') {
      num = parts.join('');
    } else {
      num = parts[0] + '.' + last;
    }
  }
  const value = Number.parseFloat(num);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Menge lesen. Anders als bei Beträgen ist "6,459" hier oft eine Dezimalzahl: Steht genau ein Trenner vor genau
 * drei Ziffern und ist er laut decimalSep der Dezimaltrenner ('any': jeder), gilt er nicht als Tausendertrenner.
 */
export function parseQuantityText(input: string, decimalSep: '.' | ',' | 'any' | null): number | null {
  const value = parseAmount(input);
  if (value === null || !decimalSep) return value;
  const block = (input.match(/\d[\d.,'’]*/)?.[0] ?? '').replace(/[.,]+$/, '');
  const m = /^(\d+)([.,])(\d{3})$/.exec(block);
  if (!m || (decimalSep !== 'any' && m[2] !== decimalSep)) return value;
  const n = Number(`${m[1]}.${m[3]}`);
  return value < 0 ? -n : n;
}

/** Dezimaltrenner eines Dokuments anhand der Beträge mit zwei Nachkommastellen; null, wenn unklar. */
export function detectDecimalSeparator(text: string): '.' | ',' | null {
  const comma = (text.match(/\d,\d{2}(?![\d.,])/g) ?? []).length;
  const dot = (text.match(/\d\.\d{2}(?![\d.,])/g) ?? []).length;
  return comma > dot ? ',' : dot > comma ? '.' : null;
}

const CURRENCY_SPACE_GROUP =
  /(?:CHF|EUR|USD|GBP|SFr\.?|Fr\.|€|\$|£)\s*(\d{1,3}(?: \d{3})+[.,](?:\d{2}|[-–]{1,2}))(?!\d)/g;
const AMOUNT_RE =
  /(\d{1,3}(?:['’`´ʼ    .,]\d{3})+|\d+)((?:[.,](?:\d{1,2}|[-–]{1,2}(?![\d-–]))))?(?!\d|[.,]\d)/g;

/** Findet alle Beträge in einer Textzeile (streng: normale Leerzeichen trennen Zahlen). */
export function findAmounts(text: string): FoundAmount[] {
  // Leerzeichen-Tausendertrenner nach Währung ("CHF 1 949.75") in schmale Leerzeichen umwandeln.
  // Gleiche Länge, damit die Indexe zum Originaltext passen.
  const work = text.replace(CURRENCY_SPACE_GROUP, (full, num: string) => full.replace(num, num.replace(/ /g, ' ')));
  const out: FoundAmount[] = [];
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(work))) {
    const start = m.index;
    const before = start > 0 ? work[start - 1] : '';
    // Nicht mitten in Wörtern/Kennungen beginnen (z.B. "RE2026", "CHE-123.456.789")
    if (before && /[\p{L}\d.,'’_/]/u.test(before)) continue;
    if (before === '-' && start > 1 && /[\p{L}\d]/u.test(work[start - 2])) continue;
    const end = start + m[0].length;
    const raw = text.slice(start, end);
    const value = parseAmount(m[0].replace(/ /g, ' '));
    if (value === null) continue;
    const after = work.slice(end).trimStart();
    const percent = after.startsWith('%');
    let signed = value;
    if ((before === '-' || before === '−' || before === '–') && (start < 2 || /\s/.test(work[start - 2]))) signed = -value;
    out.push({ value: signed, start, end, text: raw, hasDecimals: Boolean(m[2]), percent });
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, janvier: 1, gennaio: 1, janner: 1, jaenner: 1,
  feb: 2, febr: 2, februar: 2, february: 2, fevrier: 2, febbraio: 2,
  mar: 3, marz: 3, maerz: 3, mrz: 3, march: 3, mars: 3, marzo: 3,
  apr: 4, april: 4, avril: 4, aprile: 4,
  mai: 5, may: 5, maggio: 5,
  jun: 6, juni: 6, june: 6, juin: 6, giugno: 6,
  jul: 7, juli: 7, july: 7, juillet: 7, juil: 7, luglio: 7,
  aug: 8, august: 8, aout: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, settembre: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, octobre: 10, ottobre: 10, ott: 10,
  nov: 11, november: 11, novembre: 11,
  dez: 12, dec: 12, dezember: 12, december: 12, decembre: 12, dicembre: 12, dic: 12
};

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function monthFromName(name: string): number | null {
  const n = stripDiacritics(name.toLowerCase()).replace(/\.$/, '');
  if (MONTHS[n]) return MONTHS[n];
  if (n.length >= 3 && MONTHS[n.slice(0, 3)] && n.length <= 10) {
    // Präfix nur akzeptieren, wenn ein voller Monatsname damit beginnt
    const full = Object.keys(MONTHS).find((k) => k.length > 3 && k.startsWith(n));
    if (full) return MONTHS[full];
    if (n.length === 3) return MONTHS[n];
  }
  return null;
}

function toIso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/** Findet alle Datumsangaben in einem Text. */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const push = (iso: string | null, start: number, len: number) => {
    if (!iso) return;
    if (out.some((o) => start < o.end && start + len > o.start)) return;
    out.push({ iso, start, end: start + len, text: text.slice(start, start + len) });
  };

  let m: RegExpExecArray | null;
  const iso = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g;
  while ((m = iso.exec(text))) push(toIso(+m[1], +m[2], +m[3]), m.index, m[0].length);

  const numeric = /(?<![\d.])(\d{1,2})\s?([./-])\s?(\d{1,2})\s?\2\s?(\d{4}|\d{2})(?![\d])/g;
  while ((m = numeric.exec(text))) {
    let d = +m[1];
    let mo = +m[3];
    if (m[2] === '/' && mo > 12 && d <= 12) [d, mo] = [mo, d];
    push(toIso(+m[4], mo, d), m.index, m[0].length);
  }

  const textual = /(?<![\p{L}\d])(\d{1,2})(?:\.|er|st|nd|rd|th)?\s*(?:de\s+|di\s+)?(\p{L}{3,10})\.?,?\s*(\d{4})(?!\d)/gu;
  while ((m = textual.exec(text))) {
    const mo = monthFromName(m[2]);
    if (mo) push(toIso(+m[3], mo, +m[1]), m.index, m[0].length);
  }

  const us = /(?<![\p{L}])(\p{L}{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/gu;
  while ((m = us.exec(text))) {
    const mo = monthFromName(m[1]);
    if (mo) push(toIso(+m[3], mo, +m[2]), m.index, m[0].length);
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Parst ein einzelnes Datum in ISO-Form (YYYY-MM-DD). */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const found = findDates(input.trim());
  return found.length ? found[0].iso : null;
}

export function addDays(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type NumberFormat = 'ch' | 'de' | 'plain';

export function formatAmount(value: number | string | null | undefined, fmt: NumberFormat = 'ch'): string {
  const n = typeof value === 'number' ? value : parseAmount(value ?? '');
  if (n === null || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const grouped =
    fmt === 'plain' ? int : int.replace(/\B(?=(\d{3})+(?!\d))/g, fmt === 'ch' ? '’' : '.');
  return (neg ? '-' : '') + grouped + (fmt === 'de' ? ',' : '.') + dec;
}

export function formatDate(iso: string | null | undefined, fmt: 'dd.MM.yyyy' | 'yyyy-MM-dd' = 'dd.MM.yyyy'): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return fmt === 'yyyy-MM-dd' ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}.${m[2]}.${m[1]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function amountToValue(n: number | null): string {
  return n === null ? '' : (Math.round(n * 100) / 100).toFixed(2);
}

/** Normalisierung für unscharfen Textvergleich. */
export function normMatch(s: string): string {
  return stripDiacritics(s.normalize('NFKC'))
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[\s   ]+/g, '')
    .replace(/[:;]+$/g, '');
}

/** Ähnlichkeit 0..1 auf Basis der Levenshtein-Distanz. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.6) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/\bCHF\b|\bSFr\.?|\bFr\.\s?\d/g, 'CHF'],
  [/\bEUR\b|€/g, 'EUR'],
  [/\bUSD\b|US\$/g, 'USD'],
  [/\bGBP\b|£/g, 'GBP']
];

/** Häufigste Währung im Text, sonst null. */
export function detectCurrency(text: string): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [re, code] of CURRENCY_PATTERNS) {
    const count = (text.match(re) || []).length;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

export function normalizeCurrency(input: string | null | undefined): string {
  if (!input) return '';
  const s = input.trim().toUpperCase();
  if (s === '€' || s.startsWith('EURO')) return 'EUR';
  if (s === 'FR.' || s === 'SFR' || s === 'SFR.' || s === 'FRANKEN') return 'CHF';
  if (s === '$') return 'USD';
  if (s === '£') return 'GBP';
  const m = /[A-Z]{3}/.exec(s);
  return m ? m[0] : s.slice(0, 3);
}
