// Regelbasierte Erkennung: liefert sofort Ergebnisse (auch ohne KI) und dient als Rückfallebene.
import {
  addDays,
  amountToValue,
  detectCurrency,
  findAmounts,
  findDates,
  normMatch,
  parseAmount,
  type FoundAmount
} from '../../../shared/parse';
import type { Box, FieldValue, PageData, Position } from '../../../shared/types';
import { lineBox, rangeBox, segmentAround, type LineInfo } from './doctext';
import { uid } from './ids';

export const RE = {
  invoiceNo:
    /\b(?:rechnungs?|faktura|beleg|invoice|facture|fattura|re)\s*[-.]?\s*(?:nr|no|n°|nº|nummer|number|numéro|numero|num|#)\.?\s*:?\s*/i,
  invoiceDateStrong: /\b(rechnungsdatum|datum der rechnung|belegdatum|ausstellungsdatum|date de (?:la )?facture|data (?:della )?fattura|invoice date)\b/i,
  invoiceDate: /\b(datum|date|data)\b/i,
  due: /\b(zahlbar bis|fällig (?:am|bis|per)|fälligkeit(?:sdatum)?|zahlungsziel|zahlungstermin|due date|due by|payable (?:by|until)|échéance|payable jusqu|scadenza|pagabile entro|bis zum)\b/i,
  terms:
    /(?:innert|innerhalb(?:\s+von)?|binnen|within|dans les|dans un délai de|entro)\s+(\d{1,3})\s*(?:tagen|tage|days|jours|giorni)|(\d{1,3})\s*(?:tage|days|jours|giorni)\s*(?:netto|net|rein)/i,
  total:
    /\b(total|gesamt(?:betrag|summe)?|rechnungsbetrag|endbetrag|zu zahlen|zahlbetrag|totalbetrag|montant|à payer|totale|importo|amount due|grand total|balance due|summe|betrag)\b/i,
  totalStrong:
    /(zu zahlen|rechnungsbetrag|totalbetrag|gesamtbetrag|endbetrag|total inkl|inkl\.?\s*mwst|total ttc|net à payer|montant dû|amount due|grand total|totale fattura|zahlbetrag|total chf|total eur)/i,
  subtotal:
    /(zwischen(?:total|summe)|subtotal|sous-total|netto(?:betrag)?|total exkl|total excl|exkl\.|excl\.|\bht\b|imponibile|nettobetrag|warenwert|rabatt|skonto)/i,
  vat: /\b(mwst|mehrwertsteuer|ust|umsatzsteuer|mws|tva|iva|vat|mwst\.|ust\.)\b/i,
  vatId: /(mwst-?nr|mwst\.?\s*nr|ust-?id|uid|che-\d|vat (?:no|number|reg)|n° tva|partita iva|steuernummer|tva n)/i,
  subject: /^\s*(betreff|betrifft|objet|oggetto|subject|concerne|re)\s*:\s*/i,
  docTitle: /^\s*(rechnung|faktura|invoice|facture|fattura)\b/i,
  legalForm: /\b(AG|GmbH|SA|S\.A\.|Sàrl|SARL|Sagl|Ltd\.?|Inc\.?|KG|OHG|e\.K\.|GbR|SE|LLC|Genossenschaft|Stiftung|& Co\.?)(?=\s|$|[,.;·|])/,
  payTo: /(zahlbar an|payable à|payable to|pagabile a|empfänger\s*\/?\s*konto|account\s*\/\s*payable)/i,
  iban: /\b(IBAN|[A-Z]{2}\d{2}\s?(?:\d{4}\s?){3,})/,
  posHeader:
    /\b(pos\.?|position|artikel|art\.?-?nr\.?|beschreibung|bezeichnung|leistung|menge|anzahl|einheit|preis|betrag|description|qty|quantity|désignation|quantité|prix|montant|descrizione|quantità|prezzo|importo|total|stk)\b/i
};

function countHeaderWords(text: string): number {
  return (text.match(new RegExp(RE.posHeader.source, 'gi')) || []).length;
}

export interface HeuristicResult {
  fields: Record<string, FieldValue>;
  positions: Position[];
}

function field(value: string, raw: string, boxes: (Box | null)[], note?: string, source: FieldValue['source'] = 'heuristic'): FieldValue {
  return { value, raw, source, boxes: boxes.filter((b): b is Box => Boolean(b)), note };
}

function moneyAmounts(text: string): FoundAmount[] {
  return findAmounts(text).filter((a) => a.hasDecimals && !a.percent);
}

function findInvoiceNumber(infos: LineInfo[], pages: PageData[]): FieldValue | null {
  for (let i = 0; i < infos.length; i++) {
    const li = infos[i];
    const m = RE.invoiceNo.exec(li.text);
    if (!m) continue;
    const offset = m.index + m[0].length;
    const tok = /[A-Z0-9][A-Z0-9\-/._]*/i.exec(li.text.slice(offset));
    if (tok && tok.index < 25 && /\d/.test(tok[0])) {
      const value = tok[0].replace(/[.,:;/-]+$/, '');
      const start = offset + tok.index;
      return field(value, value, [rangeBox(pages, li, start, start + value.length)]);
    }
    // Wert unter der Bezeichnung
    const next = infos[i + 1];
    if (next && next.page === li.page) {
      const t2 = /[A-Z0-9][A-Z0-9\-/._]*\d[A-Z0-9\-/._]*/i.exec(next.text);
      if (t2 && t2.index < 40) {
        const value = t2[0].replace(/[.,:;/-]+$/, '');
        return field(value, value, [rangeBox(pages, next, t2.index, t2.index + value.length)]);
      }
    }
  }
  return null;
}

function dateAfterLabel(li: LineInfo, labelEnd: number) {
  const dates = findDates(li.text);
  return dates.find((d) => d.start >= labelEnd) ?? dates[0];
}

function findInvoiceDate(infos: LineInfo[], pages: PageData[]): FieldValue | null {
  for (const re of [RE.invoiceDateStrong, RE.invoiceDate]) {
    for (let i = 0; i < infos.length; i++) {
      const li = infos[i];
      const m = re.exec(li.text);
      if (!m || RE.due.test(li.text) || /liefer|leistung|bestell|auftrag|druck/i.test(li.text.slice(0, m.index + m[0].length))) continue;
      let d = dateAfterLabel(li, m.index + m[0].length);
      let line = li;
      if (!d && infos[i + 1]?.page === li.page) {
        line = infos[i + 1];
        d = findDates(line.text)[0];
      }
      if (d) return field(d.iso, d.text, [rangeBox(pages, line, d.start, d.end)]);
    }
  }
  // Ohne Bezeichnung: erstes Datum auf der ersten Seite
  for (const li of infos) {
    if (li.page !== 0 || RE.due.test(li.text) || RE.terms.test(li.text)) continue;
    const d = findDates(li.text)[0];
    if (d) return field(d.iso, d.text, [rangeBox(pages, li, d.start, d.end)]);
  }
  return null;
}

function findDueDate(infos: LineInfo[], pages: PageData[], invoiceDate: FieldValue | null): FieldValue | null {
  for (let i = 0; i < infos.length; i++) {
    const li = infos[i];
    const m = RE.due.exec(li.text);
    if (!m) continue;
    let line = li;
    let d = dateAfterLabel(li, m.index + m[0].length);
    if (!d && infos[i + 1]?.page === li.page) {
      line = infos[i + 1];
      d = findDates(line.text)[0];
    }
    if (d) return field(d.iso, d.text, [rangeBox(pages, line, d.start, d.end)]);
  }
  for (const li of infos) {
    const m = RE.terms.exec(li.text);
    if (!m) continue;
    const days = Number(m[1] ?? m[2]);
    if (!days || !invoiceDate?.value) continue;
    const iso = addDays(invoiceDate.value, days);
    if (iso) return field(iso, m[0], [rangeBox(pages, li, m.index, m.index + m[0].length)], `Rechnungsdatum + ${days} Tage`, 'computed');
  }
  return null;
}

function findTotal(infos: LineInfo[], pages: PageData[]): { field: FieldValue; line: LineInfo; value: number } | null {
  let best: { li: LineInfo; a: FoundAmount; strong: boolean } | null = null;
  for (let i = 0; i < infos.length; i++) {
    const li = infos[i];
    if (!RE.total.test(li.text)) continue;
    const strong = RE.totalStrong.test(li.text);
    if (RE.subtotal.test(li.text) && !strong) continue;
    let line = li;
    let amounts = moneyAmounts(li.text).filter((a) => a.value > 0);
    if (!amounts.length && infos[i + 1]?.page === li.page) {
      line = infos[i + 1];
      amounts = moneyAmounts(line.text).filter((a) => a.value > 0);
    }
    if (!amounts.length) continue;
    const a = amounts[amounts.length - 1];
    if (!best || a.value > best.a.value + 0.004 || (Math.abs(a.value - best.a.value) < 0.005 && strong && !best.strong)) {
      best = { li: line, a, strong };
    }
  }
  if (!best) {
    // Rückfall: grösster Betrag im Dokument
    for (const li of infos) {
      if (RE.iban.test(li.text)) continue;
      for (const a of moneyAmounts(li.text)) if (!best || a.value > best.a.value) best = { li, a, strong: false };
    }
    if (!best) return null;
  }
  return {
    field: field(amountToValue(best.a.value), best.a.text, [rangeBox(pages, best.li, best.a.start, best.a.end)], best.strong ? undefined : 'unsicher'),
    line: best.li,
    value: best.a.value
  };
}

function findVat(infos: LineInfo[], pages: PageData[], total: { line: LineInfo; value: number } | null): FieldValue | null {
  const found: { value: number; li: LineInfo; a: FoundAmount }[] = [];
  for (const li of infos) {
    if (!RE.vat.test(li.text) || RE.vatId.test(li.text)) continue;
    if (total && li === total.line) continue;
    const amounts = moneyAmounts(li.text).filter((a) => a.value > 0);
    if (!amounts.length) continue;
    if (total && amounts.length === 1 && Math.abs(amounts[0].value - total.value) < 0.01) continue;
    const a = amounts.reduce((m, x) => (x.value < m.value ? x : m));
    if (total && a.value >= total.value * 0.5) continue;
    if (found.some((f) => Math.abs(f.value - a.value) < 0.005)) continue;
    found.push({ value: a.value, li, a });
  }
  if (!found.length) return null;
  const sum = found.reduce((s, f) => s + f.value, 0);
  return field(
    amountToValue(sum),
    found.map((f) => f.a.text).join(' + '),
    found.map((f) => rangeBox(pages, f.li, f.a.start, f.a.end)),
    found.length > 1 ? `Summe aus ${found.length} Steuerbeträgen` : undefined
  );
}

function cleanCompanySegment(text: string): string {
  const parts = text.split(/\s[·|•]\s|\s[-–]\s|,\s/);
  const withForm = parts.find((p) => RE.legalForm.test(p));
  return (withForm ?? parts[0]).trim();
}

/** Spalten-Segmente einer Zeile mit linker Kante (normiert). */
function segmentsOf(li: LineInfo, pages: PageData[]): { start: number; end: number; text: string; x: number }[] {
  const p = pages.find((pg) => pg.index === li.page);
  const out: { start: number; end: number; text: string; x: number }[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(li.text))) {
    const span = li.spans.find((s) => s.end > m!.index);
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0], x: span && p ? p.words[span.word].x : 0 });
  }
  return out;
}

const QR_LABELS = /(konto|account|compte|conto|referenz|reference|zahlbar|payable|pagabile|währung|betrag|empfangsschein|zahlteil|annahmestelle)/i;

function findCreditor(infos: LineInfo[], pages: PageData[], ownCompany: string): FieldValue | null {
  const own = ownCompany.trim() ? normMatch(ownCompany) : '';
  const isOwn = (t: string) => Boolean(own) && normMatch(t).includes(own);
  const make = (li: LineInfo, start: number, end: number) => {
    const seg = segmentAround(li, start, end);
    const value = cleanCompanySegment(li.text.slice(seg.start, seg.end));
    const at = li.text.indexOf(value, seg.start);
    return field(value, value, [rangeBox(pages, li, at >= 0 ? at : seg.start, at >= 0 ? at + value.length : seg.end)]);
  };
  // 1) Schweizer QR-Rechnung: unter "Konto / Zahlbar an" folgen IBAN und Name – in derselben Spalte
  for (let i = 0; i < infos.length; i++) {
    const label = RE.payTo.exec(infos[i].text);
    if (!label) continue;
    const labelX = segmentsOf(infos[i], pages).find((s) => s.end > label.index)?.x ?? 0;
    for (let k = i + 1; k <= i + 5 && k < infos.length; k++) {
      const li = infos[k];
      if (li.page !== infos[i].page) break;
      const seg = segmentsOf(li, pages).find(
        (s) =>
          Math.abs(s.x - labelX) < 0.03 &&
          /\p{L}{3,}/u.test(s.text) &&
          !RE.iban.test(s.text) &&
          !QR_LABELS.test(s.text) &&
          !isOwn(s.text)
      );
      if (seg) return make(li, seg.start, seg.end);
    }
  }
  // 2) Briefkopf: oberste Zeile mit Rechtsform, sonst Fusszeile
  const first = infos.filter((li) => li.page === 0);
  for (const li of first) {
    const m = RE.legalForm.exec(li.text);
    if (m && !isOwn(li.text) && !RE.vatId.test(li.text.slice(0, m.index))) return make(li, m.index, m.index + m[0].length);
  }
  // 3) erste Zeile mit Buchstaben
  const top = first.find((li) => /\p{L}{3,}/u.test(li.text) && !isOwn(li.text));
  return top ? make(top, 0, 1) : null;
}

function findTitle(infos: LineInfo[], pages: PageData[]): FieldValue | null {
  for (const li of infos) {
    const m = RE.subject.exec(li.text);
    if (!m) continue;
    const seg = segmentAround(li, m[0].length, m[0].length + 1);
    const value = li.text.slice(m[0].length, seg.end).trim();
    if (value.length > 2) return field(value, value, [rangeBox(pages, li, m[0].length, seg.end)]);
  }
  for (const li of infos) {
    if (!RE.docTitle.test(li.text)) continue;
    const seg = segmentAround(li, 0, 1);
    const value = li.text.slice(seg.start, seg.end).trim();
    const rest = value.replace(RE.docTitle, '').replace(RE.invoiceNo, '').replace(/[\w\-/.]*\d[\w\-/.]*/g, '').trim();
    if (rest.split(/\s+/).filter((w) => /\p{L}{3,}/u.test(w)).length >= 1) return field(value, value, [rangeBox(pages, li, seg.start, seg.end)]);
  }
  return null;
}

const QTY = /^\d+(?:[.,']\d+)*\s*(?:x|×|stk\.?|stück|st\.?|std\.?|h|m2?|m²|m³|kg|g|l|lt|pce|pcs|pc|pauschal|psch\.?|tage?|jours?|giorni|mt|pz)?$/i;

/** Zerlegt eine Positionszeile in Titel, Menge und Preis. */
export function parsePositionLine(li: LineInfo, pages: PageData[]): Position | null {
  const amounts = findAmounts(li.text).filter((a) => !a.percent);
  const money = amounts.filter((a) => a.hasDecimals);
  const priceAmount = money[money.length - 1] ?? amounts[amounts.length - 1];
  const segments: { text: string; start: number }[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(li.text))) segments.push({ text: m[0], start: m.index });
  const letters = (s: string) => (s.match(/\p{L}/gu) || []).length;
  const titleSeg = [...segments].filter((s) => !priceAmount || s.start < priceAmount.start).sort((a, b) => letters(b.text) - letters(a.text))[0];
  if (!titleSeg || letters(titleSeg.text) < 2) return null;
  let titel = titleSeg.text.replace(/^\d{1,3}[.)]?\s+(?=\p{L})/u, '').trim();
  // Am Ende stehende Zahlen gehören nicht zum Titel, wenn keine Spalten erkannt wurden
  if (segments.length === 1 && priceAmount) titel = li.text.slice(0, priceAmount.start).replace(/[\d.,'’\s]+$/, '').replace(/^\d{1,3}[.)]?\s+/, '').trim();
  let menge: number | null = null;
  for (const s of segments) {
    if (s === titleSeg || (priceAmount && s.start >= priceAmount.start)) continue;
    if (s.start < titleSeg.start && /^\d{1,3}[.)]?$/.test(s.text)) continue; // Positionsnummer
    if (QTY.test(s.text)) {
      menge = parseAmount(s.text);
      break;
    }
  }
  return {
    id: uid('p_'),
    titel,
    menge,
    preis: priceAmount ? Math.round(priceAmount.value * 100) / 100 : null,
    boxes: [lineBox(pages, li)].filter((b): b is Box => Boolean(b)),
    source: 'heuristic'
  };
}

function findPositions(infos: LineInfo[], pages: PageData[], totalLine: LineInfo | null): Position[] {
  const headerIdx = infos.findIndex((li) => countHeaderWords(li.text) >= 2 && moneyAmounts(li.text).length === 0);
  if (headerIdx < 0) return [];
  const result: Position[] = [];
  for (let i = headerIdx + 1; i < infos.length && result.length < 100; i++) {
    const li = infos[i];
    if (totalLine && li === totalLine) break;
    // Zwischentotal-, Total- oder MWST-Zeile mit Betrag beendet die Positionsliste
    if (RE.subtotal.test(li.text) || RE.totalStrong.test(li.text) || /^\s*(total|summe|totale)\b/i.test(li.text) || RE.vat.test(li.text)) {
      if (moneyAmounts(li.text).length) break;
      continue;
    }
    const amounts = moneyAmounts(li.text);
    if (!amounts.length) continue;
    // Betrag muss am Zeilenende stehen
    const last = amounts[amounts.length - 1];
    if (li.text.slice(last.end).replace(/[\s€$£]|CHF|EUR/g, '').length > 2) continue;
    const pos = parsePositionLine(li, pages);
    if (pos) result.push(pos);
  }
  return result;
}

export function runHeuristics(infos: LineInfo[], pages: PageData[], opts: { ownCompany: string; defaultCurrency: string }): HeuristicResult {
  const fields: Record<string, FieldValue> = {};
  const set = (id: string, v: FieldValue | null) => {
    if (v && v.value) fields[id] = v;
  };
  const invoiceDate = findInvoiceDate(infos, pages);
  const total = findTotal(infos, pages);
  set('kreditor', findCreditor(infos, pages, opts.ownCompany));
  set('titel', findTitle(infos, pages));
  set('rechnungsnummer', findInvoiceNumber(infos, pages));
  set('rechnungsdatum', invoiceDate);
  set('zahlungsdatum', findDueDate(infos, pages, invoiceDate));
  set('totalbetrag', total?.field ?? null);
  set('steueranteil', findVat(infos, pages, total));
  const currency = detectCurrency(infos.map((l) => l.text).join('\n')) ?? opts.defaultCurrency;
  if (currency) fields.waehrung = { value: currency, raw: currency, source: 'heuristic', boxes: [] };
  return { fields, positions: findPositions(infos, pages, total?.line ?? null) };
}
