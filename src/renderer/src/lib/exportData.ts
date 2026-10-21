import type { Column, DocMeta, ExportCell, ExportPayload, Settings } from '../../../shared/types';
import { isIsoDate, isNumericValue, positionsJson } from './format';

export type ExportScope = 'all' | 'verified';

function cell(col: Column, doc: DocMeta): ExportCell {
  switch (col.type) {
    case 'positions':
      return { value: positionsJson(doc.positions) || null, type: 'positions' };
    case 'scanDate':
      return { value: doc.scanDate ?? null, type: 'scanDate' };
    case 'fileName':
      return { value: doc.fileName, type: 'fileName' };
    case 'amount':
    case 'number': {
      const v = doc.fields[col.id]?.value ?? '';
      if (!v) return { value: null, type: col.type };
      // Manuell eingegebener Freitext bleibt Text
      return isNumericValue(v) ? { value: Number(v), type: col.type } : { value: v, type: 'text' };
    }
    case 'date': {
      const v = doc.fields[col.id]?.value ?? '';
      if (!v) return { value: null, type: 'date' };
      return isIsoDate(v) ? { value: v, type: 'date' } : { value: v, type: 'text' };
    }
    default:
      return { value: doc.fields[col.id]?.value || null, type: col.type };
  }
}

export function exportDocs(docs: DocMeta[], scope: ExportScope): DocMeta[] {
  return docs.filter((d) => (scope === 'verified' ? d.status === 'verified' : d.status === 'scanned' || d.status === 'verified'));
}

export function buildExportPayload(
  format: 'xlsx' | 'csv',
  scope: ExportScope,
  state: { columns: Column[]; docs: DocMeta[]; settings: Settings; projectName: string }
): ExportPayload {
  const cols = state.columns.filter((c) => c.enabled);
  const docs = exportDocs(state.docs, scope);
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    format,
    defaultName: `${state.projectName} ${stamp}`,
    headers: cols.map((c) => ({ label: c.label, type: c.type, color: c.color })),
    rows: docs.map((d) => cols.map((c) => cell(c, d))),
    positions:
      format === 'xlsx' && state.settings.positionsSheet && cols.some((c) => c.type === 'positions')
        ? docs.flatMap((d) =>
            d.positions.map((p, i) => ({
              file: d.fileName,
              invoiceNo: d.fields.rechnungsnummer?.value ?? '',
              kreditor: d.fields.kreditor?.value ?? '',
              pos: `pos${i + 1}`,
              titel: p.titel,
              menge: p.menge,
              preis: p.preis
            }))
          )
        : undefined,
    csv: { delimiter: state.settings.csvDelimiter, decimal: state.settings.csvDecimal, dateFormat: state.settings.dateFormat }
  };
}
