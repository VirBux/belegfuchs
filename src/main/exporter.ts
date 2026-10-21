import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { formatDate } from '../shared/parse';
import type { ColumnType, ExportCell, ExportPayload } from '../shared/types';

function tint(hex: string, amount = 0.82): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `FF${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function isoDateToExcel(iso: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : iso;
}

function isoDateTimeToExcel(iso: string): Date | string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Excel kennt keine Zeitzonen: lokale Uhrzeit als "UTC" ablegen, damit sie unverändert angezeigt wird.
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
}

function excelValue(cell: ExportCell): string | number | Date | null {
  if (cell.value === null || cell.value === '') return null;
  switch (cell.type) {
    case 'amount':
    case 'number':
      return typeof cell.value === 'number' ? cell.value : Number.parseFloat(cell.value) || null;
    case 'date':
      return isoDateToExcel(String(cell.value));
    case 'scanDate':
      return isoDateTimeToExcel(String(cell.value));
    default:
      return String(cell.value);
  }
}

function columnWidth(type: ColumnType, label: string): number {
  const base: Partial<Record<ColumnType, number>> = {
    text: 30,
    id: 18,
    amount: 14,
    number: 12,
    date: 13,
    currency: 9,
    positions: 60,
    scanDate: 17,
    fileName: 32
  };
  return Math.max(base[type] ?? 16, label.length + 4);
}

export async function writeXlsx(filePath: string, payload: ExportPayload): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Belegfuchs';
  wb.created = new Date();

  const ws = wb.addWorksheet('Rechnungen', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = payload.headers.map((h, i) => ({ header: h.label, key: `c${i}`, width: columnWidth(h.type, h.label) }));
  for (const row of payload.rows) {
    const values: Record<string, unknown> = {};
    row.forEach((cell, i) => (values[`c${i}`] = excelValue(cell)));
    ws.addRow(values);
  }
  payload.headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    if (h.type === 'amount' || h.type === 'number') col.numFmt = '#,##0.00';
    else if (h.type === 'date') col.numFmt = 'dd.mm.yyyy';
    else if (h.type === 'scanDate') col.numFmt = 'dd.mm.yyyy hh:mm';
    const head = ws.getRow(1).getCell(i + 1);
    head.font = { bold: true, color: { argb: 'FF1F2937' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(h.color) } };
    head.border = { bottom: { style: 'medium', color: { argb: `FF${h.color.replace('#', '').toUpperCase()}` } } };
    head.alignment = { vertical: 'middle' };
  });
  ws.getRow(1).height = 22;
  if (payload.headers.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: payload.headers.length } };
  }

  if (payload.positions?.length) {
    const ps = wb.addWorksheet('Positionen', { views: [{ state: 'frozen', ySplit: 1 }] });
    ps.columns = [
      { header: 'Dateiname', key: 'file', width: 32 },
      { header: 'Kreditor', key: 'kreditor', width: 28 },
      { header: 'Rechnungsnummer', key: 'invoiceNo', width: 18 },
      { header: 'Pos', key: 'pos', width: 8 },
      { header: 'Titel', key: 'titel', width: 48 },
      { header: 'Menge', key: 'menge', width: 10 },
      { header: 'Preis', key: 'preis', width: 14 }
    ];
    for (const p of payload.positions) ps.addRow(p);
    ps.getColumn('preis').numFmt = '#,##0.00';
    ps.getRow(1).font = { bold: true };
    ps.getRow(1).eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint('#16A34A') } };
    });
    ps.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  }

  await wb.xlsx.writeFile(filePath);
}

export async function writeCsv(filePath: string, payload: ExportPayload): Promise<void> {
  const delimiter = payload.csv?.delimiter ?? ';';
  const decimal = payload.csv?.decimal ?? '.';
  const dateFormat = (payload.csv?.dateFormat ?? 'dd.MM.yyyy') as 'dd.MM.yyyy' | 'yyyy-MM-dd';
  const escape = (s: string) =>
    s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  const format = (cell: ExportCell): string => {
    if (cell.value === null || cell.value === '') return '';
    switch (cell.type) {
      case 'amount':
      case 'number': {
        const n = typeof cell.value === 'number' ? cell.value : Number.parseFloat(cell.value);
        return Number.isFinite(n) ? n.toFixed(2).replace('.', decimal) : '';
      }
      case 'date':
        return formatDate(String(cell.value), dateFormat);
      case 'scanDate': {
        const d = new Date(String(cell.value));
        if (Number.isNaN(d.getTime())) return String(cell.value);
        const p = (n: number) => n.toString().padStart(2, '0');
        const date = formatDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, dateFormat);
        return `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
      }
      default:
        return String(cell.value);
    }
  };
  const lines = [payload.headers.map((h) => escape(h.label)).join(delimiter)];
  for (const row of payload.rows) lines.push(row.map((c) => escape(format(c))).join(delimiter));
  // BOM, damit Excel UTF-8 (Umlaute) korrekt erkennt
  await fs.promises.writeFile(filePath, `﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
