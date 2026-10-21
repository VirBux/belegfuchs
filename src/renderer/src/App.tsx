import { FilePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { normalizeColumns } from '../../shared/columns';
import { ColumnsDialog } from './components/ColumnsDialog';
import { ExportDialog } from './components/ExportDialog';
import { ConfirmDialog, Toasts } from './components/Feedback';
import { Overview } from './components/Overview';
import { Review } from './components/Review';
import { SettingsDialog } from './components/SettingsDialog';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { handleDroppedFiles, newProject, openPathsFromSystem, openProject, saveProject } from './lib/actions';
import { enqueueScan } from './lib/scan';
import { setLlmStatus, toast, useStore } from './store';

export function App() {
  const view = useStore((s) => s.view);
  const dialog = useStore((s) => s.dialog);
  const projectName = useStore((s) => s.projectName);
  const dirty = useStore((s) => s.dirty);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  // Start: Einstellungen, KI-Status, beim Start übergebene Dateien
  useEffect(() => {
    const api = window.belegfuchs;
    void (async () => {
      const settings = await api.settings.get();
      const s = useStore.getState();
      useStore.setState({ settings, columns: s.docs.length || s.dirty ? s.columns : normalizeColumns(settings.columnTemplate) });
      setLlmStatus(await api.llm.status());
      const files = await api.app.ready();
      if (files.length) await openPathsFromSystem(files);
    })();
    let previous = useStore.getState().llm.state;
    const offStatus = api.llm.onStatus((status) => {
      if (previous === 'downloading' && status.state === 'ready') {
        // Download fertig: ohne KI gescannte Dokumente zum erneuten Scannen anbieten
        const withoutAi = useStore.getState().docs.filter((d) => d.scanDate && !d.aiModel && d.status !== 'verified').map((d) => d.id);
        toast('success', `KI-Modell «${status.modelName}» ist bereit – neue Scans nutzen jetzt die KI.`, {
          action: withoutAi.length ? { label: `${withoutAi.length} mit KI neu scannen`, run: () => enqueueScan(withoutAi) } : undefined,
          timeout: 10000
        });
      }
      previous = status.state;
      setLlmStatus(status);
    });
    const offOpen = api.app.onOpenFiles((paths) => void openPathsFromSystem(paths));
    const offSave = api.app.onSaveAndClose(() => {
      void saveProject().then((ok) => ok && api.app.closeNow());
    });
    return () => {
      offStatus();
      offOpen();
      offSave();
    };
  }, []);

  useEffect(() => {
    window.belegfuchs.app.setDirty(dirty);
    window.belegfuchs.app.setTitle(`${projectName}${dirty ? ' •' : ''} – Belegfuchs`);
  }, [dirty, projectName]);

  // Globale Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        void saveProject(e.shiftKey);
      } else if (key === 'o') {
        e.preventDefault();
        void openProject();
      } else if (key === 'n') {
        e.preventDefault();
        void newProject();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dateien ins Fenster ziehen
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      if (e.dataTransfer?.files.length) void handleDroppedFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main>{view === 'review' ? <Review /> : <Overview />}</main>
      <StatusBar />
      {dialog === 'columns' && <ColumnsDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dragOver && (
        <div className="drag-overlay">
          <div className="inner">
            <FilePlus />
            PDFs hier ablegen
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              oder eine .fuchs-Projektdatei zum Öffnen
            </span>
          </div>
        </div>
      )}
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
