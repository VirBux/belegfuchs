// Erzeugt Testrechnungen in samples/: node scripts/make-samples.mjs
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const chf = (n) => {
  const [i, d] = n.toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${d}`;
};
const eur = (n) => {
  const [i, d] = n.toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
};

function save(doc, name) {
  return new Promise((resolve) => {
    const file = path.join(outDir, name);
    const stream = fs.createWriteStream(file);
    stream.on('finish', () => resolve(file));
    doc.pipe(stream);
    doc.end();
  });
}

function letterhead(doc, lines, accent) {
  doc.rect(0, 0, 595.28, 8).fill(accent);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(17).text(lines[0], 50, 42);
  doc.font('Helvetica').fontSize(8.5).fillColor('#555');
  lines.slice(1).forEach((l, i) => doc.text(l, 50, 64 + i * 11));
  doc.fillColor('#111');
}

function address(doc, lines, x = 50, y = 140) {
  doc.font('Helvetica').fontSize(10);
  lines.forEach((l, i) => doc.text(l, x, y + i * 13));
}

function table(doc, { y, cols, rows, fmt }) {
  // cols: [{ title, x, w, align }]
  doc.font('Helvetica-Bold').fontSize(9);
  cols.forEach((c) => doc.text(c.title, c.x, y, { width: c.w, align: c.align ?? 'left' }));
  doc.moveTo(50, y + 13).lineTo(545, y + 13).lineWidth(0.6).stroke('#999');
  doc.font('Helvetica').fontSize(9.5);
  let cy = y + 20;
  for (const r of rows) {
    cols.forEach((c, i) => doc.text(fmt ? fmt(r[i], i) : String(r[i] ?? ''), c.x, cy, { width: c.w, align: c.align ?? 'left' }));
    cy += 17;
  }
  doc.moveTo(50, cy).lineTo(545, cy).lineWidth(0.6).stroke('#999');
  return cy + 8;
}

function sumLine(doc, label, value, y, bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5);
  doc.text(label, 330, y, { width: 130 });
  doc.text(value, 445, y, { width: 100, align: 'right' });
  return y + (bold ? 18 : 15);
}

function fakeQr(doc, x, y, size) {
  const n = 25;
  const cell = size / n;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  doc.fillColor('#000');
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const finder = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
      const on = finder ? (r % 6 === 0 || c % 6 === 0 || (r > 1 && r < 5 && c > 1 && c < 5) || (r % 6 === 0) || ((c >= n - 7) && ((c - (n - 7)) % 6 === 0 || (r > 1 && r < 5 && c > n - 6 && c < n - 2)))) : rnd() > 0.55;
      if (on) doc.rect(x + c * cell, y + r * cell, cell, cell).fill();
    }
  doc.rect(x + size / 2 - 9, y + size / 2 - 9, 18, 18).fill('#fff');
  doc.rect(x + size / 2 - 7, y + size / 2 - 7, 14, 14).fill('#000');
  doc.fillColor('#fff').rect(x + size / 2 - 1.5, y + size / 2 - 5, 3, 10).fill().rect(x + size / 2 - 5, y + size / 2 - 1.5, 10, 3).fill();
  doc.fillColor('#111');
}

function qrBill(doc, { iban, creditor, debtor, amount, ref }) {
  const top = 842 - 298;
  doc.save();
  doc.moveTo(0, top).lineTo(595.28, top).dash(3, { space: 3 }).lineWidth(0.5).stroke('#000');
  doc.moveTo(175, top).lineTo(175, 842).stroke('#000');
  doc.undash();
  doc.restore();
  const left = 17;
  doc.font('Helvetica-Bold').fontSize(11).text('Empfangsschein', left, top + 15);
  doc.fontSize(6).text('Konto / Zahlbar an', left, top + 40);
  doc.font('Helvetica').fontSize(8);
  [iban, ...creditor].forEach((l, i) => doc.text(l, left, top + 49 + i * 9));
  doc.font('Helvetica-Bold').fontSize(6).text('Referenz', left, top + 100);
  doc.font('Helvetica').fontSize(8).text(ref, left, top + 109);
  doc.font('Helvetica-Bold').fontSize(6).text('Zahlbar durch', left, top + 125);
  doc.font('Helvetica').fontSize(8);
  debtor.forEach((l, i) => doc.text(l, left, top + 134 + i * 9));
  doc.font('Helvetica-Bold').fontSize(6).text('Währung', left, top + 205).text('Betrag', left + 50, top + 205);
  doc.font('Helvetica').fontSize(8).text('CHF', left, top + 214).text(amount, left + 50, top + 214);
  const px = 192;
  doc.font('Helvetica-Bold').fontSize(11).text('Zahlteil', px, top + 15);
  fakeQr(doc, px, top + 40, 130);
  doc.fontSize(8).text('Währung', px, top + 190).text('Betrag', px + 50, top + 190);
  doc.font('Helvetica').fontSize(10).text('CHF', px, top + 201).text(amount, px + 50, top + 201);
  const rx = 345;
  doc.font('Helvetica-Bold').fontSize(8).text('Konto / Zahlbar an', rx, top + 15);
  doc.font('Helvetica').fontSize(10);
  [iban, ...creditor].forEach((l, i) => doc.text(l, rx, top + 26 + i * 12));
  doc.font('Helvetica-Bold').fontSize(8).text('Referenz', rx, top + 86);
  doc.font('Helvetica').fontSize(10).text(ref, rx, top + 97);
  doc.font('Helvetica-Bold').fontSize(8).text('Zahlbar durch', rx, top + 118);
  doc.font('Helvetica').fontSize(10);
  debtor.forEach((l, i) => doc.text(l, rx, top + 129 + i * 12));
}

const debtor = ['Belegfuchs GmbH', 'Seestrasse 5', '6300 Zug'];

// 1) Schweizer Elektroinstallateur mit QR-Rechnung
async function invoiceCH() {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Rechnung RE-2026-0412' } });
  letterhead(doc, ['Muster Elektro AG', 'Bahnhofstrasse 12 · 8001 Zürich · Tel. 044 123 45 67', 'info@muster-elektro.ch · MWST-Nr. CHE-123.456.789 MWST'], '#1d4ed8');
  address(doc, debtor, 330, 120);
  doc.font('Helvetica').fontSize(10).text('Zürich, 14. Oktober 2026', 330, 175);
  doc.font('Helvetica-Bold').fontSize(15).text('Rechnung Nr. RE-2026-0412', 50, 205);
  doc.font('Helvetica').fontSize(10).text('Betreff: Elektroinstallation Büro 2. OG', 50, 227);
  doc.text('Kunden-Nr.: K-10442      Auftrag: A-2026-118      Ausführung: 22.09.–03.10.2026', 50, 242);
  const rows = [
    ['1', 'Installationsarbeiten Elektriker', '12', 'Std', 98, 1176],
    ['2', 'Kabel NYM-J 3x1.5 mm2', '150', 'm', 1.85, 277.5],
    ['3', 'Steckdosen 3-fach weiss', '8', 'Stk', 24.9, 199.2],
    ['4', 'Kleinmaterial pauschal', '1', 'psch', 45, 45]
  ];
  const y = table(doc, {
    y: 270,
    cols: [
      { title: 'Pos', x: 50, w: 28 },
      { title: 'Bezeichnung', x: 80, w: 200 },
      { title: 'Menge', x: 285, w: 40, align: 'right' },
      { title: 'Einheit', x: 332, w: 40 },
      { title: 'Preis', x: 375, w: 70, align: 'right' },
      { title: 'Betrag CHF', x: 455, w: 90, align: 'right' }
    ],
    rows,
    fmt: (v, i) => (i >= 4 ? chf(v) : v)
  });
  const net = rows.reduce((s, r) => s + r[5], 0);
  const vat = Math.round(net * 0.081 * 20) / 20;
  let sy = sumLine(doc, 'Zwischentotal', chf(net), y + 4);
  sy = sumLine(doc, 'MWST 8.1%', chf(vat), sy);
  sumLine(doc, 'Total CHF', chf(net + vat), sy + 4, true);
  doc.font('Helvetica').fontSize(9.5).text('Zahlbar innert 30 Tagen netto. Besten Dank für Ihren Auftrag!', 50, 500);
  const total = net + vat;
  const [i, d] = total.toFixed(2).split('.');
  qrBill(doc, {
    iban: 'CH44 3199 9123 0008 8901 2',
    creditor: ['Muster Elektro AG', 'Bahnhofstrasse 12', '8001 Zürich'],
    debtor,
    amount: `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${d}`,
    ref: '21 00000 00003 13947 14300 09017'
  });
  return save(doc, '01_Muster_Elektro_CH.pdf');
}

// 2) Deutsche Druckerei, Fälligkeitsdatum gedruckt
async function invoiceDE() {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.font('Helvetica').fontSize(7.5).fillColor('#666').text('Druckerei Schmidt GmbH · Industriestr. 4 · 70565 Stuttgart', 50, 118);
  doc.fillColor('#111');
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#b91c1c').text('DRUCKEREI SCHMIDT', 300, 45, { width: 245, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#444').text('Druck · Werbetechnik · Displays', 300, 72, { width: 245, align: 'right' });
  doc.fillColor('#111');
  address(doc, debtor, 50, 132);
  doc.font('Helvetica-Bold').fontSize(18).text('RECHNUNG', 50, 215);
  doc.font('Helvetica').fontSize(9.5);
  doc.text('Rechnungsnummer:', 330, 150).text('2026/10-337', 440, 150);
  doc.text('Kundennummer:', 330, 164).text('K-55120', 440, 164);
  doc.text('Rechnungsdatum:', 330, 178).text('02.10.2026', 440, 178);
  doc.text('Lieferdatum:', 330, 192).text('30.09.2026', 440, 192);
  const rows = [
    ['FL-A5', 'Flyer A5, 4/4-farbig, 170g', '5.000', '0,042 €', 210],
    ['VK-85', 'Visitenkarten 85x55, matt', '1.000', '0,089 €', 89],
    ['ROLL', 'Roll-Up Display 85x200', '2', '119,00 €', 238]
  ];
  const y = table(doc, {
    y: 250,
    cols: [
      { title: 'Artikel', x: 50, w: 50 },
      { title: 'Beschreibung', x: 105, w: 200 },
      { title: 'Anzahl', x: 310, w: 55, align: 'right' },
      { title: 'Preis', x: 370, w: 75, align: 'right' },
      { title: 'Gesamt', x: 455, w: 90, align: 'right' }
    ],
    rows,
    fmt: (v, i) => (i === 4 ? `${eur(v)} €` : v)
  });
  const net = rows.reduce((s, r) => s + r[4], 0);
  const vat = Math.round(net * 0.19 * 100) / 100;
  let sy = sumLine(doc, 'Nettobetrag', `${eur(net)} €`, y + 4);
  sy = sumLine(doc, 'zzgl. 19% USt.', `${eur(vat)} €`, sy);
  sumLine(doc, 'Rechnungsbetrag', `${eur(net + vat)} €`, sy + 4, true);
  doc.font('Helvetica').fontSize(9.5).text('Bitte überweisen Sie den Betrag bis zum 16.10.2026 auf unser Konto.', 50, y + 80);
  doc.fontSize(7.5).fillColor('#666').text('IBAN DE89 3704 0044 0532 0130 00 · BIC COBADEFFXXX · Geschäftsführer: Hans Schmidt · USt-IdNr. DE123456789 · AG Stuttgart HRB 12345', 50, 790, { width: 495, align: 'center' });
  return save(doc, '02_Druckerei_Schmidt_DE.pdf');
}

// 3) Französischsprachige Garage
async function invoiceFR() {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  letterhead(doc, ['Garage du Lac SA', 'Route de Lausanne 88 · 1110 Morges', 'Tél. 021 801 22 33 · N° TVA CHE-987.654.321 TVA'], '#0f766e');
  address(doc, debtor, 330, 120);
  doc.font('Helvetica-Bold').fontSize(15).text('Facture n° F-88123', 50, 200);
  doc.font('Helvetica').fontSize(10).text('Morges, le 3 octobre 2026', 50, 222);
  doc.text('Objet : Service annuel véhicule VD 123 456', 50, 238);
  const rows = [
    ["Main d'oeuvre service", '2.5 h', 145, 362.5],
    ['Huile moteur 5W30', '4.5 l', 18.4, 82.8],
    ['Filtre à huile', '1', 24.5, 24.5],
    ['Contrôle freins et pneus', '1', 60, 60]
  ];
  const y = table(doc, {
    y: 270,
    cols: [
      { title: 'Désignation', x: 50, w: 230 },
      { title: 'Qté', x: 285, w: 60, align: 'right' },
      { title: 'Prix unit.', x: 355, w: 80, align: 'right' },
      { title: 'Montant', x: 445, w: 100, align: 'right' }
    ],
    rows,
    fmt: (v, i) => (i >= 2 ? chf(v) : v)
  });
  const net = rows.reduce((s, r) => s + r[3], 0);
  const vat = Math.round(net * 0.081 * 20) / 20;
  let sy = sumLine(doc, 'Total HT', `CHF ${chf(net)}`, y + 4);
  sy = sumLine(doc, 'TVA 8.1 %', `CHF ${chf(vat)}`, sy);
  sumLine(doc, 'Total TTC', `CHF ${chf(net + vat)}`, sy + 4, true);
  doc.font('Helvetica').fontSize(9.5).text('Payable dans les 20 jours. Merci de votre confiance.', 50, y + 80);
  return save(doc, '03_Garage_du_Lac_FR.pdf');
}

// 4) Zwei Seiten, zwei MWST-Sätze, Rabatt
async function invoiceMultiPage() {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  letterhead(doc, ['Papeterie Zentrum GmbH', 'Marktgasse 21 · 3011 Bern', 'www.papeterie-zentrum.ch · CHE-222.333.444 MWST'], '#7c3aed');
  address(doc, debtor, 330, 120);
  doc.font('Helvetica-Bold').fontSize(15).text('Rechnung 2026-5521', 50, 200);
  doc.font('Helvetica').fontSize(10).text('Rechnungsdatum: 07.10.2026', 50, 222).text('Zahlbar bis: 06.11.2026', 50, 236);
  const items = [
    ['Kopierpapier A4 80g (500 Blatt)', 20, 6.9, 'A'],
    ['Ordner breit, blau', 12, 4.5, 'A'],
    ['Kugelschreiber Gel schwarz (10er)', 5, 12.8, 'A'],
    ['Haftnotizen 76x76 (12 Blöcke)', 4, 9.9, 'A'],
    ['Druckerpatrone HP 912 schwarz', 3, 32.5, 'A'],
    ['Druckerpatrone HP 912 farbig', 3, 29.9, 'A'],
    ['Whiteboard-Marker Set', 2, 14.5, 'A'],
    ['Fachbuch «Buchhaltung kompakt»', 2, 48, 'B'],
    ['Zeitschrift Abo KMU (Jahr)', 1, 89, 'B'],
    ['Briefumschläge C5 (100 Stk)', 6, 11.2, 'A'],
    ['Heftklammern 24/6 (5000)', 4, 3.9, 'A'],
    ['Locher 40 Blatt', 1, 24.9, 'A'],
    ['Laminierfolien A4 (100)', 2, 19.9, 'A'],
    ['Schreibtischunterlage', 3, 16.5, 'A'],
    ['Archivschachteln (10er)', 2, 27, 'A'],
    ['Taschenrechner Tisch', 2, 22.5, 'A'],
    ['Kalender 2027 Wand', 4, 18.9, 'B'],
    ['Etiketten 70x36 (2400)', 1, 34.9, 'A']
  ];
  const cols = [
    { title: 'Pos', x: 50, w: 25 },
    { title: 'Artikel', x: 78, w: 220 },
    { title: 'Menge', x: 300, w: 45, align: 'right' },
    { title: 'Preis', x: 350, w: 65, align: 'right' },
    { title: 'MWST', x: 420, w: 30, align: 'right' },
    { title: 'Total CHF', x: 455, w: 90, align: 'right' }
  ];
  const rows = items.map((it, i) => [String(i + 1), it[0], String(it[1]), chf(it[2]), it[3], chf(it[1] * it[2])]);
  table(doc, { y: 265, cols, rows: rows.slice(0, 14) });
  doc.font('Helvetica').fontSize(8).fillColor('#666').text('Übertrag auf Seite 2', 50, 790).fillColor('#111');
  doc.addPage({ size: 'A4', margin: 0 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#555').text('Papeterie Zentrum GmbH · Rechnung 2026-5521 · Seite 2', 50, 40).fillColor('#111');
  let y = table(doc, { y: 70, cols, rows: rows.slice(14) });
  const sumA = items.filter((i) => i[3] === 'A').reduce((s, i) => s + i[1] * i[2], 0);
  const sumB = items.filter((i) => i[3] === 'B').reduce((s, i) => s + i[1] * i[2], 0);
  const discount = Math.round((sumA + sumB) * 0.05 * 20) / 20;
  const netA = sumA * 0.95;
  const netB = sumB * 0.95;
  const vatA = Math.round(netA * 0.081 * 20) / 20;
  const vatB = Math.round(netB * 0.026 * 20) / 20;
  y = sumLine(doc, 'Warenwert', chf(sumA + sumB), y + 4);
  y = sumLine(doc, 'Rabatt 5%', `-${chf(discount)}`, y);
  y = sumLine(doc, 'MWST A 8.1%', chf(vatA), y);
  y = sumLine(doc, 'MWST B 2.6%', chf(vatB), y);
  sumLine(doc, 'Gesamtbetrag CHF', chf(sumA + sumB - discount + vatA + vatB), y + 4, true);
  doc.font('Helvetica').fontSize(9).text('MWST-Codes: A = 8.1 % (Normalsatz), B = 2.6 % (reduzierter Satz, Bücher/Zeitschriften)', 50, y + 50);
  return save(doc, '04_Papeterie_2Seiten_CH.pdf');
}

// 5) Englische Hosting-Rechnung
async function invoiceEN() {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  letterhead(doc, ['Northwind Cloud Ltd.', '22 Harbour Street · Dublin D02 X285 · Ireland', 'billing@northwind.cloud · VAT IE9876543X'], '#0891b2');
  address(doc, ['Belegfuchs GmbH', 'Attn. Accounting', 'Seestrasse 5', '6300 Zug, Switzerland'], 50, 130);
  doc.font('Helvetica-Bold').fontSize(20).text('INVOICE', 380, 120, { width: 165, align: 'right' });
  doc.font('Helvetica').fontSize(9.5);
  doc.text('Invoice #', 380, 150).text('INV-2026-1088', 450, 150, { width: 95, align: 'right' });
  doc.text('Invoice date', 380, 164).text('October 1, 2026', 450, 164, { width: 95, align: 'right' });
  doc.text('Due date', 380, 178).text('October 31, 2026', 450, 178, { width: 95, align: 'right' });
  doc.font('Helvetica').fontSize(10).text('Subject: Managed hosting October 2026', 50, 215);
  const rows = [
    ['Managed VPS L (8 vCPU, 32 GB)', '1', '189.00', 189],
    ['Backup storage 500 GB', '1', '24.00', 24],
    ['SSL certificate wildcard', '1', '39.00', 39]
  ];
  const y = table(doc, {
    y: 245,
    cols: [
      { title: 'Description', x: 50, w: 260 },
      { title: 'Qty', x: 315, w: 40, align: 'right' },
      { title: 'Unit price', x: 365, w: 80, align: 'right' },
      { title: 'Amount EUR', x: 455, w: 90, align: 'right' }
    ],
    rows,
    fmt: (v, i) => (i === 3 ? v.toFixed(2) : v)
  });
  const net = rows.reduce((s, r) => s + r[3], 0);
  let sy = sumLine(doc, 'Subtotal', net.toFixed(2), y + 4);
  sy = sumLine(doc, 'VAT 0% (reverse charge)', '0.00', sy);
  sumLine(doc, 'Amount due EUR', net.toFixed(2), sy + 4, true);
  doc.font('Helvetica').fontSize(9).text('Reverse charge: VAT to be accounted for by the recipient.', 50, y + 80);
  return save(doc, '05_Northwind_Hosting_EN.pdf');
}

// 6) Gescannte Rechnung (nur Bild, kein Textlayer)
async function invoiceScanned() {
  for (const [file, name] of [
    ['C:/Windows/Fonts/arial.ttf', 'Arial'],
    ['C:/Windows/Fonts/arialbd.ttf', 'Arial Bold']
  ]) {
    if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, name);
  }
  const dpi = 200;
  const W = Math.round(8.27 * dpi);
  const H = Math.round(11.69 * dpi);
  const page = createCanvas(W, H);
  const ctx = page.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#151515';
  const pt = (p) => (p * dpi) / 72;
  const text = (t, x, y, size = 10, bold = false, align = 'left') => {
    ctx.font = `${bold ? 'bold ' : ''}${pt(size)}px ${bold ? 'Arial Bold' : 'Arial'}`;
    ctx.textAlign = align;
    ctx.fillText(t, pt(x), pt(y));
  };
  text('Malerbetrieb Huber GmbH', 50, 70, 18, true);
  text('Dorfstrasse 7  ·  5400 Baden  ·  Tel. 056 222 33 44', 50, 88, 9);
  text('Belegfuchs GmbH', 330, 140, 10.5);
  text('Seestrasse 5', 330, 154, 10.5);
  text('6300 Zug', 330, 168, 10.5);
  text('Baden, 9. Oktober 2026', 330, 200, 10.5);
  text('Rechnung Nr. 2026-0981', 50, 245, 15, true);
  text('Betreff: Malerarbeiten Sitzungszimmer', 50, 268, 10.5);
  const rows = [
    ['1', 'Wände streichen, 2 Anstriche', '64 m2', "1'536.00"],
    ['2', 'Decke streichen', '28 m2', '588.00'],
    ['3', 'Abdeck- und Schutzmaterial', '1 psch', '120.00']
  ];
  text('Pos', 50, 305, 9.5, true);
  text('Beschreibung', 80, 305, 9.5, true);
  text('Menge', 360, 305, 9.5, true, 'right');
  text('Betrag CHF', 545, 305, 9.5, true, 'right');
  ctx.fillRect(pt(50), pt(311), pt(495), 2);
  rows.forEach((r, i) => {
    const y = 330 + i * 20;
    text(r[0], 50, y, 10.5);
    text(r[1], 80, y, 10.5);
    text(r[2], 360, y, 10.5, false, 'right');
    text(r[3], 545, y, 10.5, false, 'right');
  });
  ctx.fillRect(pt(50), pt(392), pt(495), 2);
  text('Zwischentotal', 330, 412, 10.5);
  text("2'244.00", 545, 412, 10.5, false, 'right');
  text('MWST 8.1%', 330, 430, 10.5);
  text('181.75', 545, 430, 10.5, false, 'right');
  text('Total CHF', 330, 452, 12, true);
  text("2'425.75", 545, 452, 12, true, 'right');
  text('Zahlbar bis 08.11.2026. Vielen Dank für den Auftrag.', 50, 500, 10.5);
  text('IBAN CH93 0076 2011 6238 5295 7  ·  MWST-Nr. CHE-555.666.777 MWST', 50, 780, 8.5);

  // "Scanner": leicht schief, etwas Rauschen, JPEG
  const scan = createCanvas(W, H);
  const sctx = scan.getContext('2d');
  sctx.fillStyle = '#fbfaf6';
  sctx.fillRect(0, 0, W, H);
  sctx.translate(W / 2, H / 2);
  sctx.rotate((0.55 * Math.PI) / 180);
  sctx.translate(-W / 2, -H / 2);
  sctx.drawImage(page, 6, 4);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    sctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.25})`;
    sctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const jpg = await scan.encode('jpeg', 82);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.image(jpg, 0, 0, { width: 595.28, height: 841.89 });
  return save(doc, '06_Scan_Malerbetrieb_Huber.pdf');
}

const files = await Promise.all([invoiceCH(), invoiceDE(), invoiceFR(), invoiceMultiPage(), invoiceEN(), invoiceScanned()]);
for (const f of files) console.log('erstellt:', path.relative(root, f));
