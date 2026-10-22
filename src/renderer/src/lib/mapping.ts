// Ordnet KI-Ergebnisse den Wörtern im Dokument zu, damit sie im PDF markiert werden können.
import {
  addDays,
  amountToValue,
  detectDecimalSeparator,
  findAmounts,
  findDates,
  normalizeCurrency,
  parseAmount,
  parseDate,
  parseQuantityText,
  similarity
} from '../../../shared/parse';
import { parseLineRef } from '../../../shared/prompt';
import type { AiFieldSpec, AiResult, Box, ColumnType, FieldValue, PageData, Position } from '../../../shared/types';
import { lineBox, normalizeWithMap, rangeBox, type LineInfo } from './doctext';
import { RE } from './heuristics';
import { uid } from './ids';

export interface Located {
  boxes: Box[];
  raw: string;
}

const compact = (boxes: (Box | null)[]): Box[] => boxes.filter((b): b is Box => Boolean(b));

/** Bevorzugt die von der KI genannte Zeile und ihre Nachbarn, danach den Rest des Dokuments. */
function ordered(infos: LineInfo[], ref?: string): LineInfo[] {
  const r = parseLineRef(ref);
  if (!r) return infos;
  const rank = (li: LineInfo) => (li.page !== r.page ? 3 : li.line === r.line ? 0 : Math.abs(li.line - r.line) <= 2 ? 1 : 2);
  return [...infos].sort((a, b) => rank(a) - rank(b));
}

export function locateAmount(infos: LineInfo[], pages: PageData[], value: number, ref?: string): Located | null {
  const list = ordered(infos, ref);
  for (const li of list) {
    const hit = findAmounts(li.text).find((a) => !a.percent && Math.abs(Math.abs(a.value) - Math.abs(value)) < 0.005);
    if (hit) return { boxes: compact([rangeBox(pages, li, hit.start, hit.end)]), raw: hit.text };
  }
  // Rückfall für Schreibweisen wie "1 786.57" (Leerzeichen als Tausendertrenner)
  const digits = Math.abs(value).toFixed(2).replace('.', '');
  for (const li of list) {
    const { norm, map } = normalizeWithMap(li.text);
    const stripped: number[] = [];
    let s = '';
    for (let i = 0; i < norm.length; i++) {
      if (/['.,]/.test(norm[i])) continue;
      s += norm[i];
      stripped.push(map[i]);
    }
    let idx = s.indexOf(digits);
    while (idx >= 0) {
      const before = s[idx - 1];
      const after = s[idx + digits.length];
      if (!/\d/.test(before ?? '') && !/\d/.test(after ?? '')) {
        const start = stripped[idx];
        const end = stripped[idx + digits.length - 1] + 1;
        return { boxes: compact([rangeBox(pages, li, start, end)]), raw: li.text.slice(start, end) };
      }
      idx = s.indexOf(digits, idx + 1);
    }
  }
  return null;
}

export function locateDate(infos: LineInfo[], pages: PageData[], iso: string, ref?: string): Located | null {
  for (const li of ordered(infos, ref)) {
    const hit = findDates(li.text).find((d) => d.iso === iso);
    if (hit) return { boxes: compact([rangeBox(pages, li, hit.start, hit.end)]), raw: hit.text };
  }
  return null;
}

export function locateText(infos: LineInfo[], pages: PageData[], text: string, ref?: string): Located | null {
  const target = normalizeWithMap(text).norm;
  if (!target) return null;
  const list = ordered(infos, ref);
  for (const li of list) {
    const { norm, map } = normalizeWithMap(li.text);
    const idx = norm.indexOf(target);
    if (idx >= 0) {
      const start = map[idx];
      const end = map[idx + target.length - 1] + 1;
      return { boxes: compact([rangeBox(pages, li, start, end)]), raw: li.text.slice(start, end) };
    }
  }
  // Unscharfe Suche über Wortfenster (OCR-Fehler, leicht abweichende Schreibweise)
  let best: { score: number; li: LineInfo; start: number; end: number } | null = null;
  for (const li of list.slice(0, 600)) {
    for (let i = 0; i < li.spans.length; i++) {
      for (let j = i; j < Math.min(li.spans.length, i + 14); j++) {
        const cand = normalizeWithMap(li.text.slice(li.spans[i].start, li.spans[j].end)).norm;
        if (cand.length > target.length * 1.5 + 4) break;
        const score = similarity(cand, target);
        if (score > (best?.score ?? 0.78)) best = { score, li, start: li.spans[i].start, end: li.spans[j].end };
      }
    }
  }
  if (best) return { boxes: compact([rangeBox(pages, best.li, best.start, best.end)]), raw: best.li.text.slice(best.start, best.end) };
  return null;
}

function locateCurrency(infos: LineInfo[], pages: PageData[], code: string): Box[] {
  const re = code === 'EUR' ? /\bEUR\b|€/ : code === 'CHF' ? /\bCHF\b|\bSFr\.?/ : new RegExp(`\\b${code}\\b`);
  // Bevorzugt die Währung in der Totalzeile
  const sorted = [...infos].sort((a, b) => Number(RE.totalStrong.test(b.text)) - Number(RE.totalStrong.test(a.text)));
  for (const li of sorted) {
    const m = re.exec(li.text);
    if (m) return compact([rangeBox(pages, li, m.index, m.index + m[0].length)]);
  }
  return [];
}

export function cleanId(text: string): string {
  return text
    .replace(/^\s*(?:rechnung(?:s)?\s*)?(?:nr|no|n°|nº|nummer|number|#)\.?\s*:?\s*/i, '')
    .replace(/[.,:;]+$/, '')
    .trim();
}

/** Wandelt einen Text je nach Spaltentyp in einen Feldwert und sucht die Fundstelle. */
export function fieldFromText(
  type: ColumnType,
  text: string,
  infos: LineInfo[],
  pages: PageData[],
  source: FieldValue['source'],
  ref?: string
): FieldValue | null {
  const raw = text.trim();
  if (!raw) return null;
  switch (type) {
    case 'amount':
    case 'number': {
      const n = parseAmount(raw);
      if (n === null) return { value: raw, raw, source, boxes: locateText(infos, pages, raw, ref)?.boxes ?? [], note: 'Kein gültiger Betrag' };
      const loc = locateAmount(infos, pages, n, ref);
      return { value: amountToValue(n), raw: loc?.raw ?? raw, source, boxes: loc?.boxes ?? [] };
    }
    case 'date': {
      const iso = parseDate(raw);
      if (!iso) return { value: raw, raw, source, boxes: locateText(infos, pages, raw, ref)?.boxes ?? [], note: 'Kein gültiges Datum' };
      const loc = locateDate(infos, pages, iso, ref) ?? locateText(infos, pages, raw, ref);
      return { value: iso, raw: loc?.raw ?? raw, source, boxes: loc?.boxes ?? [] };
    }
    case 'currency': {
      const code = normalizeCurrency(raw);
      return { value: code, raw, source, boxes: locateCurrency(infos, pages, code) };
    }
    case 'id': {
      const value = cleanId(raw);
      const loc = locateText(infos, pages, value, ref);
      return { value, raw: loc?.raw ?? raw, source, boxes: loc?.boxes ?? [] };
    }
    default: {
      const value = raw.replace(/\s+/g, ' ');
      const loc = locateText(infos, pages, value, ref);
      return { value, raw: loc?.raw ?? raw, source, boxes: loc?.boxes ?? [] };
    }
  }
}

/** Menge aus dem KI-Text; decimalSep ist der Dezimaltrenner des Dokuments ("6,459" in einer deutschen Rechnung = 6.459). */
export function parseQuantity(text: string, decimalSep: '.' | ',' | null = null): number | null {
  const m = /-?\d[\d.,'’]*/.exec(text ?? '');
  return m ? parseQuantityText(m[0], decimalSep) : null;
}

function positionBox(infos: LineInfo[], pages: PageData[], ref: string, titel: string, preis: number | null): Box[] {
  const r = parseLineRef(ref);
  const titleNorm = normalizeWithMap(titel).norm.slice(0, 12);
  const matches = (li: LineInfo) => {
    const hasPrice = preis === null || findAmounts(li.text).some((a) => Math.abs(a.value - preis) < 0.005);
    const hasTitle = !titleNorm || normalizeWithMap(li.text).norm.includes(titleNorm);
    return { hasPrice, hasTitle };
  };
  if (r) {
    const li = infos.find((l) => l.page === r.page && l.line === r.line);
    if (li) {
      const m = matches(li);
      if (m.hasPrice || m.hasTitle) return compact([lineBox(pages, li)]);
    }
  }
  const li = infos.find((l) => {
    const m = matches(l);
    return m.hasPrice && m.hasTitle;
  });
  return li ? compact([lineBox(pages, li)]) : [];
}

export interface AppliedAi {
  fields: Record<string, FieldValue>;
  positions: Position[];
}

export function applyAiResult(ai: AiResult, specs: AiFieldSpec[], infos: LineInfo[], pages: PageData[]): AppliedAi {
  const fields: Record<string, FieldValue> = {};
  for (const spec of specs) {
    if (spec.columnId === 'steueranteil') {
      const seen: number[] = [];
      const boxes: Box[] = [];
      const raws: string[] = [];
      const rates: string[] = [];
      for (const m of ai.mwst) {
        const v = parseAmount(m.betrag);
        if (v === null || seen.some((s) => Math.abs(s - v) < 0.005)) continue;
        seen.push(v);
        raws.push(m.betrag);
        if (m.satz) rates.push(m.satz.includes('%') ? m.satz : `${m.satz} %`);
        boxes.push(...(locateAmount(infos, pages, v, m.zeile)?.boxes ?? []));
      }
      if (seen.length) {
        const sum = seen.reduce((s, v) => s + v, 0);
        fields.steueranteil = {
          value: amountToValue(sum),
          raw: raws.join(' + '),
          source: 'ai',
          boxes,
          note: seen.length > 1 ? `Summe aus ${seen.length} Steuerbeträgen (${rates.join(', ')})` : rates[0] ? `MWST ${rates[0]}` : undefined
        };
      }
      continue;
    }
    if (spec.columnId === 'waehrung') {
      const code = normalizeCurrency(ai.waehrung);
      if (code) fields.waehrung = { value: code, raw: ai.waehrung, source: 'ai', boxes: locateCurrency(infos, pages, code) };
      continue;
    }
    const f = ai.fields[spec.key];
    if (!f?.text) continue;
    // Nur "Rechnung" o.ä. ist kein Titel
    if (spec.columnId === 'titel' && /^\s*(rechnung|faktura|invoice|facture|fattura|quittung)\s*$/i.test(f.text)) continue;
    const value = fieldFromText(spec.type, f.text, infos, pages, 'ai', f.zeile);
    if (value) fields[spec.columnId] = value;
  }

  // Fälligkeit aus Zahlungsfrist berechnen, wenn kein Datum gedruckt ist
  const wantsDue = specs.some((s) => s.columnId === 'zahlungsdatum');
  if (wantsDue && !fields.zahlungsdatum && ai.zahlungsfristTage > 0 && fields.rechnungsdatum && /^\d{4}-\d{2}-\d{2}$/.test(fields.rechnungsdatum.value)) {
    const iso = addDays(fields.rechnungsdatum.value, ai.zahlungsfristTage);
    if (iso) {
      let boxes: Box[] = [];
      let raw = `${ai.zahlungsfristTage} Tage`;
      for (const li of infos) {
        const m = RE.terms.exec(li.text);
        if (m && Number(m[1] ?? m[2]) === ai.zahlungsfristTage) {
          boxes = compact([rangeBox(pages, li, m.index, m.index + m[0].length)]);
          raw = m[0];
          break;
        }
      }
      fields.zahlungsdatum = { value: iso, raw, source: 'computed', boxes, note: `Rechnungsdatum + ${ai.zahlungsfristTage} Tage` };
    }
  }

  const decimalSep = detectDecimalSeparator(infos.map((li) => li.text).join('\n'));
  const positions: Position[] = ai.positionen
    .map((p) => {
      const preis = parseAmount(p.preis);
      return {
        id: uid('p_'),
        titel: p.titel.trim(),
        menge: parseQuantity(p.menge, decimalSep),
        preis: preis === null ? null : Math.round(preis * 100) / 100,
        boxes: positionBox(infos, pages, p.zeile, p.titel, preis),
        source: 'ai' as const
      };
    })
    .filter((p) => p.titel || p.preis !== null);
  return { fields, positions };
}
