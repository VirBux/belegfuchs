import { create } from 'zustand';
import { DEFAULT_COLUMNS, cloneColumns, normalizeColumns } from '../../shared/columns';
import { DEFAULT_SETTINGS } from '../../shared/models';
import type { Box, Column, DocMeta, FieldValue, LlmStatus, PickedFile, Position, ProjectFilePayload, Settings } from '../../shared/types';
import { uid } from './lib/ids';
import { releaseAllPdfs, releasePdf } from './lib/pdf';

export type ActiveTarget = { kind: 'field'; columnId: string } | { kind: 'positions'; positionId?: string };

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warn' | 'error';
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
}

export interface DocRuntime {
  stage?: string;
  progress?: number;
}

export type DialogName = 'columns' | 'settings' | 'export' | null;

export type ConfirmResult = 'confirm' | 'cancel' | 'extra';

export interface ConfirmRequest {
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel?: string;
  extraLabel?: string;
  danger?: boolean;
  resolve: (r: ConfirmResult) => void;
}

export interface AppState {
  projectName: string;
  projectPath: string | null;
  createdAt: string;
  dirty: boolean;
  columns: Column[];
  docs: DocMeta[];
  pdfBytes: Record<string, Uint8Array>;
  runtime: Record<string, DocRuntime>;
  view: 'overview' | 'review';
  currentDocId: string | null;
  /** Prüfmodus: feste Reihenfolge; null = freie Auswahl. */
  reviewQueue: string[] | null;
  active: ActiveTarget | null;
  selected: string[];
  settings: Settings;
  llm: LlmStatus;
  toasts: Toast[];
  dialog: DialogName;
  focusField: { columnId: string; nonce: number } | null;
  reveal: { box: Box; nonce: number } | null;
  confirm: ConfirmRequest | null;
  settingsTab: string;
}

export const useStore = create<AppState>(() => ({
  projectName: 'Neues Projekt',
  projectPath: null,
  createdAt: new Date().toISOString(),
  dirty: false,
  columns: cloneColumns(DEFAULT_COLUMNS),
  docs: [],
  pdfBytes: {},
  runtime: {},
  view: 'overview',
  currentDocId: null,
  reviewQueue: null,
  active: null,
  selected: [],
  settings: { ...DEFAULT_SETTINGS },
  llm: { state: 'missing', modelId: DEFAULT_SETTINGS.modelId, modelName: '' },
  toasts: [],
  dialog: null,
  focusField: null,
  reveal: null,
  confirm: null,
  settingsTab: 'ai'
}));

const get = useStore.getState;
const set = useStore.setState;

// ---------- Hilfsfunktionen ----------

export function getDoc(id: string | null | undefined): DocMeta | undefined {
  return id ? get().docs.find((d) => d.id === id) : undefined;
}

function markDirty(): void {
  if (!get().dirty) set({ dirty: true });
}

export function toast(kind: Toast['kind'], text: string, opts: { action?: Toast['action']; sticky?: boolean; timeout?: number } = {}): string {
  const id = uid('t_');
  set((s) => ({ toasts: [...s.toasts, { id, kind, text, action: opts.action, sticky: opts.sticky }].slice(-5) }));
  if (!opts.sticky) setTimeout(() => dismissToast(id), opts.timeout ?? (kind === 'error' ? 9000 : 4500));
  return id;
}

export function dismissToast(id: string): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function setDialog(dialog: DialogName, settingsTab?: string): void {
  set(settingsTab ? { dialog, settingsTab } : { dialog });
}

export function askConfirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<ConfirmResult> {
  return new Promise((resolve) => set({ confirm: { ...opts, resolve } }));
}

export function resolveConfirm(result: ConfirmResult): void {
  const c = get().confirm;
  set({ confirm: null });
  c?.resolve(result);
}

export function revealBox(box: Box): void {
  set({ reveal: { box, nonce: Date.now() } });
}

// ---------- Dokumente ----------

export function addFiles(files: PickedFile[]): number {
  const state = get();
  const known = new Set(state.docs.map((d) => `${d.fileName}|${d.fileSize}`));
  const docs: DocMeta[] = [];
  const bytes: Record<string, Uint8Array> = {};
  let skipped = 0;
  for (const f of files) {
    const key = `${f.name}|${f.size}`;
    if (known.has(key)) {
      skipped++;
      continue;
    }
    known.add(key);
    const id = uid('d_');
    docs.push({
      id,
      fileName: f.name,
      filePath: f.path || undefined,
      fileSize: f.size,
      pageCount: 0,
      status: 'new',
      pages: [],
      fields: {},
      positions: []
    });
    bytes[id] = f.bytes;
  }
  if (docs.length) {
    set((s) => ({ docs: [...s.docs, ...docs], pdfBytes: { ...s.pdfBytes, ...bytes } }));
    markDirty();
  }
  if (skipped) toast('info', `${skipped} Datei${skipped > 1 ? 'en waren' : ' war'} bereits im Projekt und wurde${skipped > 1 ? 'n' : ''} übersprungen.`);
  return docs.length;
}

export function removeDocs(ids: string[]): void {
  const remove = new Set(ids);
  set((s) => {
    const pdfBytes = { ...s.pdfBytes };
    const runtime = { ...s.runtime };
    for (const id of ids) {
      delete pdfBytes[id];
      delete runtime[id];
    }
    const docs = s.docs.filter((d) => !remove.has(d.id));
    const currentGone = s.currentDocId && remove.has(s.currentDocId);
    return {
      docs,
      pdfBytes,
      runtime,
      selected: s.selected.filter((id) => !remove.has(id)),
      reviewQueue: s.reviewQueue?.filter((id) => !remove.has(id)) ?? null,
      currentDocId: currentGone ? null : s.currentDocId,
      view: currentGone ? 'overview' : s.view
    };
  });
  for (const id of ids) void releasePdf(id);
  markDirty();
}

export function updateDoc(id: string, patch: Partial<DocMeta> | ((d: DocMeta) => Partial<DocMeta>), dirty = true): void {
  set((s) => ({
    docs: s.docs.map((d) => (d.id === id ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d))
  }));
  if (dirty) markDirty();
}

export function setRuntime(id: string, rt: DocRuntime | null): void {
  set((s) => {
    const runtime = { ...s.runtime };
    if (rt) runtime[id] = rt;
    else delete runtime[id];
    return { runtime };
  });
}

/** Setzt ein Feld; ein bereits geprüftes Dokument gilt danach wieder als ungeprüft. */
export function setField(docId: string, columnId: string, value: FieldValue | null): void {
  updateDoc(docId, (d) => {
    const fields = { ...d.fields };
    if (value) fields[columnId] = value;
    else delete fields[columnId];
    return { fields, status: d.status === 'verified' ? 'scanned' : d.status, verifiedAt: undefined };
  });
}

export function setPositions(docId: string, positions: Position[]): void {
  updateDoc(docId, (d) => ({ positions, status: d.status === 'verified' ? 'scanned' : d.status, verifiedAt: undefined }));
}

export function setVerified(docId: string, verified: boolean): void {
  updateDoc(docId, (d) => ({
    status: verified ? 'verified' : d.status === 'verified' ? 'scanned' : d.status,
    verifiedAt: verified ? new Date().toISOString() : undefined
  }));
}

export function setSelected(ids: string[]): void {
  set({ selected: ids });
}

// ---------- Ansicht / Prüfmodus ----------

export function openReview(docId: string, queue: string[] | null = null): void {
  set({ view: 'review', currentDocId: docId, reviewQueue: queue, active: null });
}

export function startReviewMode(ids?: string[]): boolean {
  const docs = get().docs;
  const pool = ids?.length ? docs.filter((d) => ids.includes(d.id)) : docs;
  const queue = pool.filter((d) => d.status === 'scanned' || d.status === 'verified').map((d) => d.id);
  const first = pool.find((d) => d.status === 'scanned') ?? pool.find((d) => queue.includes(d.id));
  if (!first) {
    toast('info', 'Es gibt noch keine gescannten Dokumente zum Prüfen.');
    return false;
  }
  openReview(first.id, queue);
  return true;
}

export function closeReview(): void {
  set({ view: 'overview', active: null });
}

function navigationList(): string[] {
  const s = get();
  return s.reviewQueue ?? s.docs.map((d) => d.id);
}

export function gotoRelative(delta: number): void {
  const s = get();
  const list = navigationList();
  const idx = list.indexOf(s.currentDocId ?? '');
  const next = list[idx + delta];
  if (next) set({ currentDocId: next, active: null });
}

/** Nach "Geprüft": nächstes ungeprüftes Dokument der Reihenfolge, sonst zurück zur Übersicht. */
export function gotoNextUnverified(): void {
  const s = get();
  const list = navigationList();
  const idx = list.indexOf(s.currentDocId ?? '');
  const ordered = [...list.slice(idx + 1), ...list.slice(0, Math.max(idx, 0))];
  const next = ordered.find((id) => getDoc(id)?.status === 'scanned');
  if (next) set({ currentDocId: next, active: null });
  else {
    toast('success', 'Alle Dokumente sind geprüft. Du kannst jetzt exportieren.', {
      action: { label: 'Exportieren', run: () => setDialog('export') }
    });
    closeReview();
  }
}

export function setActive(active: ActiveTarget | null): void {
  set({ active });
}

export function focusFieldEditor(columnId: string): void {
  set({ focusField: { columnId, nonce: Date.now() } });
}

// ---------- Spalten / Einstellungen ----------

export function setColumns(columns: Column[]): void {
  set({ columns });
  markDirty();
  void window.belegfuchs.settings.set({ columnTemplate: columns }).then((settings) => set({ settings }));
}

export async function saveSettings(partial: Partial<Settings>): Promise<void> {
  const settings = await window.belegfuchs.settings.set(partial);
  set({ settings });
}

export function setLlmStatus(llm: LlmStatus): void {
  set({ llm });
}

// ---------- Projekt ----------

export function setProjectName(name: string): void {
  const trimmed = name.trim() || 'Neues Projekt';
  if (trimmed !== get().projectName) {
    set({ projectName: trimmed });
    markDirty();
  }
}

export function resetProject(): void {
  releaseAllPdfs();
  const template = get().settings.columnTemplate;
  set({
    projectName: 'Neues Projekt',
    projectPath: null,
    createdAt: new Date().toISOString(),
    dirty: false,
    columns: normalizeColumns(template),
    docs: [],
    pdfBytes: {},
    runtime: {},
    view: 'overview',
    currentDocId: null,
    reviewQueue: null,
    active: null,
    selected: []
  });
}

export function buildProjectPayload(): ProjectFilePayload {
  const s = get();
  const docs = s.docs.map((d) => ({
    ...d,
    // Laufende Scans werden nicht gespeichert
    status: d.status === 'scanning' || d.status === 'queued' ? (d.scanDate ? 'scanned' : 'new') : d.status
  })) as DocMeta[];
  return {
    project: {
      format: 'belegfuchs-project',
      version: 1,
      name: s.projectName,
      createdAt: s.createdAt,
      savedAt: new Date().toISOString(),
      columns: s.columns,
      docs
    },
    pdfs: docs.filter((d) => s.pdfBytes[d.id]).map((d) => ({ id: d.id, bytes: s.pdfBytes[d.id] }))
  };
}

export function loadProjectPayload(payload: ProjectFilePayload, filePath: string): void {
  releaseAllPdfs();
  const pdfBytes: Record<string, Uint8Array> = {};
  for (const p of payload.pdfs) pdfBytes[p.id] = p.bytes;
  const docs = payload.project.docs.filter((d) => pdfBytes[d.id]);
  const missing = payload.project.docs.length - docs.length;
  set({
    projectName: payload.project.name,
    projectPath: filePath,
    createdAt: payload.project.createdAt,
    dirty: false,
    columns: normalizeColumns(payload.project.columns),
    docs,
    pdfBytes,
    runtime: {},
    view: 'overview',
    currentDocId: null,
    reviewQueue: null,
    active: null,
    selected: []
  });
  if (missing) toast('warn', `${missing} Dokument(e) konnten nicht geladen werden (PDF fehlt in der Projektdatei).`);
}

export function markSaved(filePath: string): void {
  set({ projectPath: filePath, dirty: false });
}
