import { ChevronDown, ClipboardCheck, Columns3, Download, FilePlus, FolderOpen, Save, ScanLine, Settings } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { LlmStatus } from '../../../shared/types';
import { newProject, openProject, pickAndAddPdfs, saveProject } from '../lib/actions';
import { enqueueScan } from '../lib/scan';
import { setDialog, setProjectName, startReviewMode, useStore } from '../store';
import { FoxLogo } from './FoxLogo';
import { cls, Dropdown } from './ui';

function MenuItem({ icon, label, hint, kbd, onClick, disabled }: { icon?: ReactNode; label: string; hint?: string; kbd?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="menu-item" onClick={onClick} disabled={disabled}>
      {icon ?? <span style={{ width: 16 }} />}
      <span className="menu-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

export function aiLabel(llm: LlmStatus): { text: string; tone: 'ok' | 'busy' | 'warn' | 'err' } {
  switch (llm.state) {
    case 'missing':
      return { text: 'KI-Modell fehlt', tone: 'warn' };
    case 'downloading':
      return { text: `KI-Download ${Math.round((llm.progress ?? 0) * 100)} %`, tone: 'busy' };
    case 'ready':
      return { text: `KI bereit · ${llm.modelName}`, tone: 'ok' };
    case 'loading':
      return { text: 'KI wird geladen …', tone: 'busy' };
    case 'loaded':
      return { text: `KI aktiv · ${llm.gpu ? 'GPU' : 'CPU'}`, tone: 'ok' };
    case 'busy':
      return { text: 'KI analysiert …', tone: 'busy' };
    default:
      return { text: 'KI-Fehler', tone: 'err' };
  }
}

export function TopBar() {
  const projectName = useStore((s) => s.projectName);
  const dirty = useStore((s) => s.dirty);
  const docs = useStore((s) => s.docs);
  const llm = useStore((s) => s.llm);
  const [name, setName] = useState(projectName);
  useEffect(() => setName(projectName), [projectName]);

  const scannable = docs.filter((d) => d.status === 'new' || d.status === 'error');
  const reviewable = docs.some((d) => d.status === 'scanned' || d.status === 'verified');
  const ai = aiLabel(llm);

  return (
    <header className="topbar">
      <div className="brand">
        <FoxLogo size={30} />
        <div className="brand-name">
          Beleg<span>fuchs</span>
        </div>
      </div>
      <Dropdown
        align="left"
        trigger={(_open, toggle) => (
          <button className="btn btn-ghost btn-sm" onClick={toggle}>
            Projekt <ChevronDown />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<FilePlus />} label="Neues Projekt" kbd="Ctrl+N" onClick={() => (close(), void newProject())} />
            <MenuItem icon={<FolderOpen />} label="Projekt öffnen …" hint="Gespeicherte .fuchs-Datei laden" kbd="Ctrl+O" onClick={() => (close(), void openProject())} />
            <div className="menu-sep" />
            <MenuItem icon={<Save />} label="Speichern" kbd="Ctrl+S" onClick={() => (close(), void saveProject())} />
            <MenuItem label="Speichern unter …" kbd="Ctrl+⇧+S" onClick={() => (close(), void saveProject(true))} />
          </>
        )}
      </Dropdown>
      <div className="project-name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setProjectName(name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          title="Projektname – wird auch als Dateiname vorgeschlagen"
          spellCheck={false}
        />
        {dirty && <span className="dirty-dot" title="Ungespeicherte Änderungen" />}
      </div>
      <div className="spacer" />
      <div className="topbar-group">
        <button className="btn" onClick={() => void pickAndAddPdfs()}>
          <FilePlus /> PDFs hinzufügen
        </button>
        <button
          className="btn btn-primary"
          disabled={!scannable.length}
          onClick={() => enqueueScan(scannable.map((d) => d.id))}
          title="Alle neuen Dokumente scannen (OCR + KI)"
        >
          <ScanLine /> {scannable.length ? `Scannen (${scannable.length})` : 'Scannen'}
        </button>
        <button className="btn" disabled={!reviewable} onClick={() => startReviewMode()} title="Alle gescannten Dokumente Schritt für Schritt prüfen">
          <ClipboardCheck /> Prüfmodus
        </button>
      </div>
      <div className="topbar-sep" />
      <div className="topbar-group">
        <button className="btn btn-ghost" onClick={() => setDialog('columns')} title="Spalten festlegen und eigene Spalten hinzufügen">
          <Columns3 /> Spalten
        </button>
        <button className="btn btn-ghost" disabled={!reviewable} onClick={() => setDialog('export')} title="Als Excel oder CSV exportieren">
          <Download /> Export
        </button>
        <button className="btn btn-ghost btn-icon" title="Projekt speichern (Ctrl+S)" onClick={() => void saveProject()}>
          <Save />
        </button>
        <button className="btn btn-ghost btn-icon" title="Einstellungen" onClick={() => setDialog('settings')}>
          <Settings />
        </button>
      </div>
      <button className={cls('ai-pill', ai.tone)} onClick={() => setDialog('settings', 'ai')} title={llm.error ?? 'KI-Einstellungen'}>
        <span className="dot" />
        {ai.text}
      </button>
    </header>
  );
}
