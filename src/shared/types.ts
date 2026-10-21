// Gemeinsame Typen für Main-, Preload- und Renderer-Prozess.

export type ColumnType =
  | 'text' // freier Text (Kreditor, Titel, eigene Textspalten)
  | 'id' // Kennung, z.B. Rechnungsnummer (ein Token)
  | 'amount' // Geldbetrag
  | 'number' // sonstige Zahl
  | 'date' // Datum
  | 'currency' // ISO-Währungscode
  | 'positions' // Rechnungspositionen (JSON)
  | 'scanDate' // vom Programm gesetzt
  | 'fileName'; // vom Programm gesetzt

export interface Column {
  /** Eingebaute Spalten nutzen feste Schlüssel, eigene Spalten "c_<zufall>". */
  id: string;
  label: string;
  type: ColumnType;
  builtin: boolean;
  color: string;
  /** Hinweis für die KI, wonach gesucht werden soll (v.a. bei eigenen Spalten). */
  description?: string;
  /** Sichtbar und im Export enthalten. */
  enabled: boolean;
}

/** Rechteck in normierten Seitenkoordinaten (0..1), page = 0-basierter Seitenindex. */
export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FieldSource = 'ai' | 'heuristic' | 'pick' | 'box' | 'manual' | 'computed' | 'system';

export interface FieldValue {
  /** Normalisierter Wert: Beträge "1234.50", Datum "2026-10-21", sonst Text. */
  value: string;
  /** Text so, wie er im Dokument steht. */
  raw?: string;
  source: FieldSource;
  boxes: Box[];
  note?: string;
}

export interface Position {
  id: string;
  titel: string;
  menge: number | null;
  preis: number | null;
  boxes: Box[];
  source: FieldSource;
}

export interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index der Zeile innerhalb der Seite. */
  line: number;
  conf?: number;
}

export interface Line {
  /** Wortindizes der Seite, von links nach rechts. */
  words: number[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageData {
  index: number;
  /** Seitengrösse in PDF-Punkten (für das Seitenverhältnis). */
  width: number;
  height: number;
  source: 'text' | 'ocr';
  words: Word[];
  lines: Line[];
}

export type DocStatus = 'new' | 'queued' | 'scanning' | 'scanned' | 'verified' | 'error';

export interface DocMeta {
  id: string;
  fileName: string;
  filePath?: string;
  fileSize: number;
  pageCount: number;
  status: DocStatus;
  error?: string;
  /** ISO-Zeitstempel des letzten Scans. */
  scanDate?: string;
  pages: PageData[];
  fields: Record<string, FieldValue>;
  positions: Position[];
  aiModel?: string;
  verifiedAt?: string;
}

export interface Settings {
  modelId: string;
  gpu: 'auto' | 'cpu';
  ocrLangs: string[];
  forceOcr: boolean;
  maxPages: number;
  ownCompany: string;
  defaultCurrency: string;
  numberFormat: 'ch' | 'de' | 'plain';
  dateFormat: 'dd.MM.yyyy' | 'yyyy-MM-dd';
  csvDelimiter: ';' | ',' | '\t';
  csvDecimal: '.' | ',';
  positionsSheet: boolean;
  /** Spaltenvorlage für neue Projekte. */
  columnTemplate?: Column[];
}

export interface ProjectData {
  format: 'belegfuchs-project';
  version: 1;
  name: string;
  createdAt: string;
  savedAt: string;
  columns: Column[];
  docs: DocMeta[];
}

export interface ProjectFilePayload {
  project: ProjectData;
  pdfs: { id: string; bytes: Uint8Array }[];
}

// ---------- IPC: OCR ----------

export interface OcrWordRaw {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  conf: number;
  /** Laufende Zeilennummer aus Tesseract (über Blöcke hinweg). */
  line: number;
}

export interface OcrResult {
  /** Koordinaten in Pixeln des übergebenen Bildes. */
  words: OcrWordRaw[];
  text: string;
}

export interface OcrRequest {
  png: Uint8Array;
  langs: string[];
  /** 'page' = ganze Seite (PSM 3), 'block' = Ausschnitt (PSM 6). */
  mode: 'page' | 'block';
}

// ---------- IPC: KI ----------

export interface AiFieldSpec {
  key: string;
  columnId: string;
  label: string;
  type: ColumnType;
  description?: string;
}

export interface ExtractRequest {
  /** Kennung für Fortschrittsmeldungen (Dokument-ID). */
  requestId?: string;
  /** Rechnungstext mit Zeilen-IDs. */
  text: string;
  fields: AiFieldSpec[];
  withPositions: boolean;
  ownCompany?: string;
}

export interface AiField {
  zeile: string;
  text: string;
}

export interface AiResult {
  fields: Record<string, AiField>;
  zahlungsfristTage: number;
  mwst: { zeile: string; betrag: string; satz: string }[];
  waehrung: string;
  positionen: { zeile: string; titel: string; menge: string; preis: string }[];
}

export interface ExtractResponse {
  ok: boolean;
  result?: AiResult;
  error?: string;
  modelId?: string;
  ms?: number;
}

export interface LlmModelInfo {
  id: string;
  name: string;
  description: string;
  sizeGB: number;
  url: string;
  file: string;
  recommended?: boolean;
  downloaded?: boolean;
}

export type LlmState = 'missing' | 'downloading' | 'ready' | 'loading' | 'loaded' | 'busy' | 'error';

export interface LlmStatus {
  state: LlmState;
  modelId: string;
  modelName: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  gpu?: string | false;
  gpuName?: string;
  error?: string;
}

// ---------- IPC: Export ----------

export interface ExportCell {
  /** Rohwert: Zahl für Beträge, ISO-String für Datum, sonst Text. */
  value: string | number | null;
  type: ColumnType;
}

export interface ExportPayload {
  format: 'xlsx' | 'csv';
  defaultName: string;
  headers: { label: string; type: ColumnType; color: string }[];
  rows: ExportCell[][];
  /** Für das optionale Positionsblatt in Excel. */
  positions?: { file: string; invoiceNo: string; kreditor: string; pos: string; titel: string; menge: number | null; preis: number | null }[];
  csv?: { delimiter: string; decimal: string; dateFormat: string };
}

export interface PickedFile {
  name: string;
  path: string;
  size: number;
  bytes: Uint8Array;
}
