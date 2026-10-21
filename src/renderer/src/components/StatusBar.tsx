import { CircleCheck, Cpu, LoaderCircle, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cancelScans } from '../lib/scan';
import { useStore } from '../store';
import { ProgressBar } from './ui';

export function StatusBar() {
  const docs = useStore((s) => s.docs);
  const runtime = useStore((s) => s.runtime);
  const llm = useStore((s) => s.llm);
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.belegfuchs.app.info().then((i) => setVersion(i.version));
  }, []);

  const scanning = docs.filter((d) => d.status === 'scanning');
  const queued = docs.filter((d) => d.status === 'queued');
  const first = scanning[0];
  const rt = first ? runtime[first.id] : undefined;
  const scanned = docs.filter((d) => d.status === 'scanned').length;
  const verified = docs.filter((d) => d.status === 'verified').length;

  return (
    <footer className="statusbar">
      {first ? (
        <div className="scan-progress">
          <LoaderCircle size={14} className="spin" />
          <span className="truncate">
            Scanne {scanning.length + queued.length} Dokument{scanning.length + queued.length === 1 ? '' : 'e'} · {first.fileName}: {rt?.stage ?? '…'}
          </span>
          <ProgressBar value={rt?.progress} />
          <button className="btn btn-ghost btn-sm" onClick={cancelScans} title="Laufende Scans abbrechen">
            <Square /> Abbrechen
          </button>
        </div>
      ) : (
        <span className="status-item">
          <CircleCheck /> Bereit
        </span>
      )}
      <div className="spacer" />
      {docs.length > 0 && (
        <span className="status-item">
          {docs.length} Dokumente · {scanned} zu prüfen · {verified} geprüft
        </span>
      )}
      {(llm.state === 'loaded' || llm.state === 'busy') && (
        <span className="status-item" title={llm.gpuName}>
          <Cpu /> {llm.modelName} · {llm.gpu ? `${String(llm.gpu).toUpperCase()}${llm.gpuName ? ` (${llm.gpuName})` : ''}` : 'CPU'}
        </span>
      )}
      <span className="muted">Belegfuchs {version}</span>
    </footer>
  );
}
