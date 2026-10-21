import { FileSpreadsheet, FileText, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { runExport } from '../lib/actions';
import { exportDocs, type ExportScope } from '../lib/exportData';
import { setDialog, useStore } from '../store';
import { cls, Modal } from './ui';

export function ExportDialog() {
  const docs = useStore((s) => s.docs);
  const columns = useStore((s) => s.columns);
  const settings = useStore((s) => s.settings);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [scope, setScope] = useState<ExportScope>('all');
  const [running, setRunning] = useState(false);
  const all = exportDocs(docs, 'all').length;
  const verified = exportDocs(docs, 'verified').length;
  const count = scope === 'all' ? all : verified;
  const unverified = scope === 'all' ? all - verified : 0;
  const enabledCols = columns.filter((c) => c.enabled).length;
  const delimiterLabel = settings.csvDelimiter === '\t' ? 'Tabulator' : `«${settings.csvDelimiter}»`;

  const run = async () => {
    setRunning(true);
    const ok = await runExport(format, scope);
    setRunning(false);
    if (ok) setDialog(null);
  };

  return (
    <Modal
      title="Exportieren"
      subtitle={`${enabledCols} Spalten · Positionen als JSON in einer Spalte`}
      onClose={() => setDialog(null)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => setDialog('columns')}>
            Spalten anpassen …
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={() => setDialog(null)}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={!count || running} onClick={() => void run()}>
            {count} Rechnung{count === 1 ? '' : 'en'} exportieren
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="export-options">
          <div className={cls('option-card', format === 'xlsx' && 'on')} onClick={() => setFormat('xlsx')}>
            <FileSpreadsheet color="#15803d" />
            <div>
              <strong>Excel (.xlsx)</strong>
              <span>
                Beträge und Daten als echte Excel-Werte, Filter, farbige Kopfzeile{settings.positionsSheet ? ', eigenes Blatt für Positionen' : ''}.
              </span>
            </div>
          </div>
          <div className={cls('option-card', format === 'csv' && 'on')} onClick={() => setFormat('csv')}>
            <FileText color="#475569" />
            <div>
              <strong>CSV (.csv)</strong>
              <span>
                UTF-8, Trennzeichen {delimiterLabel}, Dezimalzeichen «{settings.csvDecimal}». Einstellbar unter Einstellungen → Format.
              </span>
            </div>
          </div>
        </div>
        <div className="form-row" style={{ borderBottom: 0 }}>
          <label className="l">Welche Dokumente?</label>
          <div className="seg">
            <button className={cls(scope === 'all' && 'on')} onClick={() => setScope('all')}>
              Alle gescannten ({all})
            </button>
            <button className={cls(scope === 'verified' && 'on')} onClick={() => setScope('verified')}>
              Nur geprüfte ({verified})
            </button>
          </div>
        </div>
        {unverified > 0 && (
          <div className="check warn" style={{ marginTop: 6 }}>
            <TriangleAlert />
            <span>
              {unverified} Dokument{unverified === 1 ? ' ist' : 'e sind'} noch nicht geprüft und werden trotzdem exportiert.
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
