// Prompt und JSON-Schema für die KI-Extraktion. Nur Typ-Importe, damit das Modul auch
// ohne Bundler (z.B. in Testskripten) geladen werden kann.
import type { AiFieldSpec, ExtractRequest, Line, PageData, Word } from './types';

export const SYSTEM_PROMPT =
  'Du bist ein präziser Assistent für die Kreditorenbuchhaltung. Du liest Rechnungen auf Deutsch, Französisch, ' +
  'Italienisch oder Englisch und extrahierst Daten exakt aus dem gegebenen Text. Du erfindest nichts. ' +
  'Texte und Zahlen übernimmst du genau so, wie sie gedruckt sind.';

/** Feste Schlüssel der eingebauten Felder im JSON der KI. */
const BUILTIN_INSTRUCTIONS: Record<string, string> = {
  kreditor:
    'Firmenname des Rechnungsstellers (Absender/Lieferant). Steht meist ganz oben im Briefkopf, in der Fusszeile oder im Zahlteil unter "Konto / Zahlbar an". NICHT der Rechnungsempfänger aus dem Adressfeld oder unter "Zahlbar durch".',
  titel:
    'Betreff der Rechnung (Zeile mit "Betreff", "Betrifft", "Objet", "Oggetto", "Subject" o.ä.), nur der Betreff-Text ohne das Wort "Betreff". Gibt es keinen Betreff: die Hauptleistung in 2–6 Worten (z.B. "Druck Flyer und Visitenkarten"), nie nur das Wort "Rechnung".',
  rechnungsnummer: 'Rechnungs- bzw. Belegnummer, nur die Nummer selbst (z.B. "RE-2026-0412"), ohne "Rechnung Nr.".',
  rechnungsdatum: 'Datum der Rechnung, nur das Datum (ohne Ort).',
  zahlungsdatum:
    'Fälligkeitsdatum, aber nur wenn ein konkretes Datum gedruckt ist ("zahlbar bis", "fällig am", "Zahlungsziel", "échéance", "scadenza", "due date"). Sonst leer.',
  totalbetrag: 'Zu zahlender Gesamtbetrag inkl. MWST, nur die Zahl (ohne Währung und Bezeichnung).'
};

export function lineRef(page: number, line: number): string {
  return `${page + 1}.${line + 1}`;
}

export function parseLineRef(ref: string | undefined | null): { page: number; line: number } | null {
  const m = /^\s*\[?\s*(\d+)\s*[.:,]\s*(\d+)\s*\]?\s*$/.exec(ref ?? '');
  if (!m) return null;
  return { page: +m[1] - 1, line: +m[2] - 1 };
}

/** Trenner zwischen zwei Wörtern: grosse Lücken werden als Spaltentrenner (3 Leerzeichen) dargestellt. */
export function wordSeparator(prev: Word, next: Word, pageAspect = 1.414): string {
  const gap = next.x - (prev.x + prev.w);
  // Breiten sind relativ zur Seitenbreite, Höhen relativ zur Seitenhöhe
  const charW = Math.max(prev.w / Math.max(prev.text.length, 1), (next.h * pageAspect) * 0.3);
  return gap > charW * 2.2 ? '   ' : ' ';
}

/** Text einer Zeile; grosse Lücken zwischen Wörtern werden als Spaltentrenner dargestellt. */
export function lineText(words: Word[], line: Line, pageAspect = 1.414): string {
  let out = '';
  let prev: Word | null = null;
  for (const wi of line.words) {
    const w = words[wi];
    if (prev) out += wordSeparator(prev, w, pageAspect);
    out += w.text;
    prev = w;
  }
  return out;
}

/** Baut den Dokumenttext mit Zeilen-IDs; bei sehr langen Dokumenten werden mittlere Seiten gekürzt. */
export function buildDocumentText(pages: PageData[], maxChars = 14000): string {
  const pageTexts = pages.map((p) =>
    p.lines
      .map((l, li) => `[${lineRef(p.index, li)}] ${lineText(p.words, l, p.height / p.width)}`)
      .filter((t) => t.trim().length > 0)
      .join('\n')
  );
  let total = pageTexts.reduce((s, t) => s + t.length, 0);
  if (total <= maxChars) return pageTexts.join('\n');
  // Erste und letzte Seite haben Vorrang (Kopf, Total, Zahlungsangaben)
  const keep = pageTexts.map(() => true);
  for (let i = pageTexts.length - 2; i >= 1 && total > maxChars; i--) {
    keep[i] = false;
    total -= pageTexts[i].length;
  }
  const result = pageTexts.filter((_, i) => keep[i]).join('\n');
  return result.length > maxChars ? result.slice(0, maxChars) : result;
}

export function slugKey(label: string, taken: Set<string>): string {
  let base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  if (!base || /^\d/.test(base)) base = `feld_${base}`;
  let key = base;
  let i = 2;
  while (taken.has(key)) key = `${base}_${i++}`;
  taken.add(key);
  return key;
}

const RESERVED_KEYS = ['kreditor', 'titel', 'rechnungsnummer', 'rechnungsdatum', 'zahlungsdatum', 'zahlungsfrist_tage', 'totalbetrag', 'mwst', 'waehrung', 'positionen'];

export function reservedKeys(): Set<string> {
  return new Set(RESERVED_KEYS);
}

export function buildUserPrompt(req: ExtractRequest): string {
  const lines: string[] = [];
  lines.push(
    'Hier ist der Text einer Rechnung. Jede Zeile beginnt mit ihrer ID in eckigen Klammern [Seite.Zeile]. Mehrere Leerzeichen trennen Spalten.'
  );
  lines.push('', '<rechnung>', req.text, '</rechnung>', '');
  lines.push(
    'Fülle das JSON mit den folgenden Feldern. Für jedes Feld gilt: "zeile" = ID der Zeile, in der der Wert steht (z.B. "1.12"), "text" = nur der Wert selbst, genau wie gedruckt, ohne Bezeichnung davor (z.B. "1\'786.57" statt "Total CHF 1\'786.57"). Kommt ein Wert nicht vor, bleiben "zeile" und "text" leer.',
    ''
  );
  for (const f of req.fields) {
    switch (f.columnId) {
      case 'steueranteil':
        lines.push(
          '- mwst: jede ausgewiesene MWST/USt/TVA/IVA/VAT-Zeile als eigener Eintrag mit "betrag" = Steuerbetrag (nicht der Prozentsatz, nicht die Basis) und "satz" = Prozentsatz. Ist ausdrücklich 0 % bzw. keine Steuer ausgewiesen (z.B. Reverse Charge), ein Eintrag mit "betrag" 0.00. Leere Liste, wenn die Rechnung gar keine Steuer erwähnt.'
        );
        break;
      case 'waehrung':
        lines.push('- waehrung: ISO-Code der Rechnungswährung (z.B. CHF, EUR, USD).');
        break;
      case 'zahlungsdatum':
        lines.push(`- zahlungsdatum: ${BUILTIN_INSTRUCTIONS.zahlungsdatum}`);
        lines.push('- zahlungsfrist_tage: Zahlungsfrist in Tagen, falls angegeben ("zahlbar innert 30 Tagen" = 30), sonst 0.');
        break;
      default: {
        const builtin = BUILTIN_INSTRUCTIONS[f.columnId];
        if (builtin) lines.push(`- ${f.key}: ${builtin}`);
        else {
          const kind =
            f.type === 'amount' ? ' (Betrag, nur die Zahl)' : f.type === 'date' ? ' (Datum)' : f.type === 'number' ? ' (Zahl)' : '';
          lines.push(`- ${f.key}: «${f.label}»${kind}${f.description ? ` – ${f.description}` : ''}`);
        }
      }
    }
  }
  if (req.withPositions) {
    lines.push(
      '- positionen: jede Rechnungsposition (Artikel oder Leistung) als eigener Eintrag: "titel" = Bezeichnung, "menge" = Menge mit Einheit wie gedruckt (leer, wenn keine), "preis" = Gesamtbetrag der Position (meist die letzte Betragsspalte). Keine Zwischentotal-, MWST- oder Totalzeilen.'
    );
  }
  if (req.ownCompany?.trim()) {
    lines.push('', `Hinweis: Der Rechnungsempfänger ist «${req.ownCompany.trim()}». Diese Firma ist nie der Kreditor.`);
  }
  return lines.join('\n');
}

interface Schema {
  type: 'object' | 'array' | 'string' | 'integer';
  properties?: Record<string, Schema>;
  items?: Schema;
  maxItems?: number;
  maxLength?: number;
}

/**
 * Erzeugt eine GBNF-Grammatik für das Schema. Anders als die eingebaute JSON-Grammatik von
 * node-llama-cpp ist der Leerraum flexibel: Die feste Einrückung dort kollidiert mit Tokenizern,
 * die Leerzeichen und Klammern zu einem Token verschmelzen (" {"), wodurch Listen leer blieben.
 */
export function schemaToGbnf(schema: Schema): string {
  const rules = new Map<string, string>();
  let counter = 0;
  const visit = (s: Schema): string => {
    switch (s.type) {
      case 'string': {
        const name = s.maxLength ? `str-${s.maxLength}` : 'str';
        if (!rules.has(name)) rules.set(name, String.raw`"\"" char` + (s.maxLength ? `{0,${s.maxLength}}` : '*') + String.raw` "\""`);
        return name;
      }
      case 'integer':
        return 'int';
      case 'object': {
        const name = `obj-${counter++}`;
        const parts = Object.entries(s.properties ?? {}).map(([k, v]) => String.raw`"\"${k}\"" ws ":" ws ` + visit(v));
        rules.set(name, `"{" ws ${parts.join(' ws "," ws ')} ws "}"`);
        return name;
      }
      case 'array': {
        const name = `arr-${counter++}`;
        const item = visit(s.items ?? { type: 'string' });
        const rep = s.maxItems ? `{0,${Math.max(s.maxItems - 1, 0)}}` : '*';
        rules.set(name, `"[" ws ( ${item} ( ws "," ws ${item} )${rep} )? ws "]"`);
        return name;
      }
    }
  };
  const root = visit(schema);
  const out = [`root ::= ws ${root} ` + String.raw`"\n\n\n\n" [\n]*`];
  for (const [name, body] of rules) out.push(`${name} ::= ${body}`);
  out.push(String.raw`ws ::= [ \t\n]{0,20}`);
  out.push(String.raw`char ::= [^"\\\x7F\x00-\x1F] | "\\" ["\\/bfnrt] | "\\u" [0-9a-fA-F]{4}`);
  out.push('int ::= "-"? [0-9]{1,5}');
  return out.join('\n');
}

/** Stopp-Trigger passend zum Abschluss der Grammatik. */
export const GRAMMAR_STOP = '\n\n\n\n';

export function buildSchema(fields: AiFieldSpec[], withPositions: boolean): Schema {
  const str = (max: number): Schema => ({ type: 'string', maxLength: max });
  const field = (max = 120): Schema => ({ type: 'object', properties: { zeile: str(8), text: str(max) } });
  const props: Record<string, Schema> = {};
  for (const f of fields) {
    switch (f.columnId) {
      case 'steueranteil':
        props.mwst = {
          type: 'array',
          maxItems: 8,
          items: { type: 'object', properties: { zeile: str(8), betrag: str(24), satz: str(12) } }
        };
        break;
      case 'waehrung':
        props.waehrung = str(3);
        break;
      case 'zahlungsdatum':
        props.zahlungsdatum = field(40);
        props.zahlungsfrist_tage = { type: 'integer' };
        break;
      default:
        props[f.key] = field(f.type === 'amount' || f.type === 'date' ? 40 : 120);
    }
  }
  if (withPositions) {
    props.positionen = {
      type: 'array',
      maxItems: 100,
      items: { type: 'object', properties: { zeile: str(8), titel: str(120), menge: str(24), preis: str(24) } }
    };
  }
  return { type: 'object', properties: props };
}
