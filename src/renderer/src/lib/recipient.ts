// Erkennung des Rechnungsempfängers (eigene Firma), damit er nicht als Kreditor übernommen wird.
import { normMatch } from '../../../shared/parse';
import type { DocMeta } from '../../../shared/types';
import { buildLineInfos, segmentAround, type LineInfo } from './doctext';
import { RE } from './heuristics';

const RECIPIENT_LABEL =
  /(zahlbar durch|payable par|pagabile da|payable by|rechnungsempfänger|rechnungsadresse|rechnungsanschrift|bill to|invoice to|facturé à|fatturato a)/i;

/** true, wenn der Name die eigene Firma ist oder als Empfänger (z.B. unter «Zahlbar durch») im Dokument steht. */
export function looksLikeRecipient(name: string, infos: LineInfo[], ownCompany: string): boolean {
  const key = normMatch(name);
  if (key.length < 3) return false;
  const own = normMatch(ownCompany);
  if (own && (key.includes(own) || own.includes(key))) return true;
  for (let i = 0; i < infos.length; i++) {
    const m = RECIPIENT_LABEL.exec(infos[i].text);
    if (!m) continue;
    if (normMatch(infos[i].text.slice(m.index + m[0].length)).includes(key)) return true;
    for (let k = i + 1; k <= i + 3 && k < infos.length; k++) {
      if (infos[k].page === infos[i].page && normMatch(infos[k].text).includes(key)) return true;
    }
  }
  return false;
}

/**
 * Eine Firma, die auf (fast) allen Rechnungen vorkommt, ist sehr wahrscheinlich der Empfänger –
 * also die eigene Firma. Liefert deren Namen oder null.
 */
export function suggestOwnCompany(docs: DocMeta[]): string | null {
  const scanned = docs.filter((d) => d.pages.length);
  if (scanned.length < 3) return null;
  const counts = new Map<string, { name: string; n: number }>();
  for (const d of scanned) {
    const seen = new Set<string>();
    for (const li of buildLineInfos(d.pages.filter((p) => p.index === 0))) {
      const m = RE.legalForm.exec(li.text);
      if (!m) continue;
      const seg = segmentAround(li, m.index, m.index + m[0].length);
      const name = li.text
        .slice(seg.start, seg.end)
        .split(/\s[·|•]\s|,\s/)
        .find((p) => RE.legalForm.test(p))
        ?.trim();
      const key = name ? normMatch(name) : '';
      if (!name || key.length < 5 || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { name, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n >= Math.max(3, Math.ceil(scanned.length * 0.6)) ? best.name : null;
}
