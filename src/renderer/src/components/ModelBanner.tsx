import { CloudDownload, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { findModel } from '../../../shared/models';
import { setDialog, useStore } from '../store';
import { formatBytes, ProgressBar } from './ui';

export function ModelBanner() {
  const llm = useStore((s) => s.llm);
  const settings = useStore((s) => s.settings);
  const model = findModel(settings.modelId);

  if (llm.state === 'missing') {
    return (
      <div className="banner">
        <div className="icon">
          <Sparkles />
        </div>
        <div className="text">
          <strong>KI-Modell einrichten</strong>
          <span>
            Für die intelligente Erkennung lädt Belegfuchs einmalig «{model.name}» ({model.sizeGB.toFixed(1)} GB) herunter. Danach läuft die KI
            komplett offline auf diesem PC – keine Rechnungsdaten verlassen den Rechner. Bis dahin arbeitet die regelbasierte Erkennung.
          </span>
        </div>
        <button className="btn" onClick={() => setDialog('settings', 'ai')}>
          Andere Modelle
        </button>
        <button className="btn btn-primary" onClick={() => void window.belegfuchs.llm.download(model.id)}>
          <CloudDownload /> Jetzt herunterladen
        </button>
      </div>
    );
  }
  if (llm.state === 'downloading') {
    const pct = Math.round((llm.progress ?? 0) * 100);
    return (
      <div className="banner">
        <div className="icon">
          <CloudDownload />
        </div>
        <div className="text">
          <strong>
            «{llm.modelName}» wird heruntergeladen … {pct} %
          </strong>
          <span>
            {formatBytes(llm.downloadedBytes ?? 0)} von {formatBytes(llm.totalBytes ?? 0)} – du kannst währenddessen weiterarbeiten.
          </span>
          <ProgressBar value={llm.progress} />
        </div>
        <button className="btn" onClick={() => void window.belegfuchs.llm.cancelDownload()}>
          Abbrechen
        </button>
      </div>
    );
  }
  if (llm.state === 'error') {
    return (
      <div className="banner err">
        <div className="icon">
          <TriangleAlert />
        </div>
        <div className="text">
          <strong>Die KI ist nicht verfügbar</strong>
          <span>{llm.error}</span>
        </div>
        <button className="btn" onClick={() => setDialog('settings', 'ai')}>
          Einstellungen
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void (llm.error?.startsWith('Download') ? window.belegfuchs.llm.download(model.id) : window.belegfuchs.llm.load())}
        >
          <RefreshCw /> Erneut versuchen
        </button>
      </div>
    );
  }
  return null;
}
