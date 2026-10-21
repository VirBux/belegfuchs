import type { PickedFile } from '../../../shared/types';
import {
  addFiles,
  askConfirm,
  buildProjectPayload,
  loadProjectPayload,
  markSaved,
  resetProject,
  setDialog,
  toast,
  useStore
} from '../store';
import { buildExportPayload, type ExportScope } from './exportData';
import { enqueueScan } from './scan';

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));

function afterAdd(added: string[]): void {
  if (!added.length) return;
  const n = added.length;
  toast('success', `${n} PDF${n > 1 ? 's' : ''} hinzugefügt.`, {
    action: { label: 'Jetzt scannen', run: () => enqueueScan(added) },
    timeout: 7000
  });
  if (useStore.getState().llm.state === 'ready') void window.belegfuchs.llm.load();
}

function addAndReport(files: PickedFile[]): void {
  const before = new Set(useStore.getState().docs.map((d) => d.id));
  addFiles(files);
  afterAdd(useStore.getState().docs.filter((d) => !before.has(d.id)).map((d) => d.id));
}

export async function pickAndAddPdfs(): Promise<void> {
  try {
    const files = await window.belegfuchs.pickPdfs();
    if (files.length) addAndReport(files);
  } catch (err) {
    toast('error', `Dateien konnten nicht gelesen werden: ${errorText(err)}`);
  }
}

export async function addPdfPaths(paths: string[]): Promise<void> {
  try {
    const files = await window.belegfuchs.readFiles(paths);
    if (files.length) addAndReport(files);
  } catch (err) {
    toast('error', `Dateien konnten nicht gelesen werden: ${errorText(err)}`);
  }
}

export async function handleDroppedFiles(list: FileList): Promise<void> {
  const pdfs: PickedFile[] = [];
  let project: string | null = null;
  let ignored = 0;
  for (const file of Array.from(list)) {
    const path = window.belegfuchs.pathForFile(file);
    if (/\.fuchs$/i.test(file.name)) {
      project = path;
      continue;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      ignored++;
      continue;
    }
    pdfs.push({ name: file.name, path, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  if (project) return openProject(project);
  if (ignored && !pdfs.length) toast('warn', 'Bitte PDF-Dateien oder eine .fuchs-Projektdatei ablegen.');
  else if (ignored) toast('info', `${ignored} Datei(en) ignoriert – nur PDFs werden unterstützt.`);
  if (pdfs.length) addAndReport(pdfs);
}

/** Fragt bei ungespeicherten Änderungen nach. true = weitermachen. */
async function confirmLeaveProject(): Promise<boolean> {
  if (!useStore.getState().dirty) return true;
  const answer = await askConfirm({
    title: 'Ungespeicherte Änderungen',
    text: 'Das aktuelle Projekt wurde noch nicht gespeichert. Möchtest du es vorher speichern?',
    confirmLabel: 'Speichern',
    extraLabel: 'Nicht speichern',
    cancelLabel: 'Abbrechen'
  });
  if (answer === 'cancel') return false;
  if (answer === 'confirm') return saveProject();
  return true;
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const state = useStore.getState();
  try {
    const result = await window.belegfuchs.project.save({
      payload: buildProjectPayload(),
      filePath: state.projectPath ?? undefined,
      saveAs,
      suggestedName: state.projectName
    });
    if (!result) return false;
    markSaved(result.filePath);
    toast('success', `Projekt gespeichert: ${basename(result.filePath)}`, {
      action: { label: 'Im Ordner zeigen', run: () => void window.belegfuchs.shell.showItem(result.filePath) }
    });
    return true;
  } catch (err) {
    toast('error', `Speichern fehlgeschlagen: ${errorText(err)}`);
    return false;
  }
}

export async function openProject(filePath?: string): Promise<void> {
  if (!(await confirmLeaveProject())) return;
  try {
    const result = await window.belegfuchs.project.open(filePath);
    if (!result) return;
    loadProjectPayload(result.payload, result.filePath);
    toast('success', `Projekt «${result.payload.project.name}» geöffnet (${result.payload.project.docs.length} Dokumente).`);
  } catch (err) {
    toast('error', `Projekt konnte nicht geöffnet werden: ${errorText(err)}`);
  }
}

export async function newProject(): Promise<void> {
  if (!(await confirmLeaveProject())) return;
  resetProject();
}

/** Vom Hauptprozess übergebene Dateien (Doppelklick auf .fuchs, PDFs aufs Programmsymbol). */
export async function openPathsFromSystem(paths: string[]): Promise<void> {
  const project = paths.find((p) => /\.fuchs$/i.test(p));
  if (project) return openProject(project);
  const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
  if (pdfs.length) await addPdfPaths(pdfs);
}

export async function runExport(format: 'xlsx' | 'csv', scope: ExportScope): Promise<boolean> {
  const state = useStore.getState();
  const payload = buildExportPayload(format, scope, state);
  if (!payload.rows.length) {
    toast('warn', scope === 'verified' ? 'Es gibt noch keine geprüften Dokumente.' : 'Es gibt noch keine gescannten Dokumente.');
    return false;
  }
  try {
    const result = await window.belegfuchs.exportData(payload);
    if (!result) return false;
    const n = payload.rows.length;
    toast('success', `${n} Rechnung${n === 1 ? '' : 'en'} exportiert: ${basename(result.filePath)}`, {
      action: { label: 'Öffnen', run: () => void window.belegfuchs.shell.openPath(result.filePath) },
      timeout: 8000
    });
    return true;
  } catch (err) {
    toast('error', `Export fehlgeschlagen: ${errorText(err)}`);
    return false;
  }
}

export function openExportDialog(): void {
  setDialog('export');
}
