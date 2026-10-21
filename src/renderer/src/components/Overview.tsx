import { CircleAlert, CircleCheck, Clock, FilePlus, FileText, FolderOpen, LoaderCircle, RefreshCw, ScanLine, Trash, X, ClipboardCheck } from 'lucide-react';
import type { Column, DocMeta } from '../../../shared/types';
import { openProject, pickAndAddPdfs } from '../lib/actions';
import { displayCell, formatFieldValue } from '../lib/format';
import { enqueueScan } from '../lib/scan';
import { askConfirm, openReview, removeDocs, setSelected, startReviewMode, useStore, type DocRuntime } from '../store';
import { FoxLogo } from './FoxLogo';
import { ModelBanner } from './ModelBanner';
import { cls, formatBytes, ProgressBar } from './ui';

const STATUS: Record<DocMeta['status'], { label: string; icon: typeof Clock }> = {
  new: { label: 'Neu', icon: FileText },
  queued: { label: 'Wartet', icon: Clock },
  scanning: { label: 'Scannt', icon: LoaderCircle },
  scanned: { label: 'Zu prüfen', icon: CircleAlert },
  verified: { label: 'Geprüft', icon: CircleCheck },
  error: { label: 'Fehler', icon: CircleAlert }
};

export function StatusPill({ status }: { status: DocMeta['status'] }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cls('status', status)}>
      <Icon className={status === 'scanning' ? 'spin' : undefined} />
      {s.label}
    </span>
  );
}

function StatusCell({ doc, rt }: { doc: DocMeta; rt?: DocRuntime }) {
  return (
    <div className="status-cell">
      <StatusPill status={doc.status} />
      {doc.status === 'scanning' && (
        <>
          <ProgressBar value={rt?.progress} />
          <small>{rt?.stage}</small>
        </>
      )}
      {doc.status === 'error' && <small title={doc.error}>{doc.error}</small>}
    </div>
  );
}

function cellClass(col: Column): string | undefined {
  if (col.type === 'amount' || col.type === 'number') return 'num';
  return undefined;
}

function EmptyState() {
  return (
    <div className="empty">
      <div className="dropzone">
        <FoxLogo size={76} />
        <h2>Rechnungen hierher ziehen</h2>
        <p>
          Lege PDF-Rechnungen deiner Kreditoren ab – digital erstellt oder gescannt. Belegfuchs liest den Text (OCR), die KI markiert die relevanten
          Angaben und du prüfst alles bequem nebeneinander.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn btn-primary" onClick={() => void pickAndAddPdfs()}>
            <FilePlus /> PDFs auswählen
          </button>
          <button className="btn" onClick={() => void openProject()}>
            <FolderOpen /> Projekt öffnen
          </button>
        </div>
        <div className="steps">
          <div className="step">
            <b>1</b>PDFs hinzufügen
          </div>
          <div className="step">
            <b>2</b>Scannen (OCR + KI)
          </div>
          <div className="step">
            <b>3</b>Prüfen &amp; korrigieren
          </div>
          <div className="step">
            <b>4</b>Excel / CSV exportieren
          </div>
        </div>
      </div>
    </div>
  );
}

async function confirmRemove(ids: string[]): Promise<void> {
  const answer = await askConfirm({
    title: ids.length === 1 ? 'Dokument entfernen?' : `${ids.length} Dokumente entfernen?`,
    text: 'Die Dokumente und ihre Ergebnisse werden aus dem Projekt entfernt. Die PDF-Dateien auf der Festplatte bleiben unverändert.',
    confirmLabel: 'Entfernen',
    cancelLabel: 'Abbrechen',
    danger: true
  });
  if (answer === 'confirm') removeDocs(ids);
}

export function Overview() {
  const docs = useStore((s) => s.docs);
  const columns = useStore((s) => s.columns);
  const settings = useStore((s) => s.settings);
  const selected = useStore((s) => s.selected);
  const runtime = useStore((s) => s.runtime);

  if (!docs.length) {
    return (
      <div className="overview">
        <ModelBanner />
        <EmptyState />
      </div>
    );
  }

  const cols = columns.filter((c) => c.enabled && c.type !== 'fileName');
  const count = (st: DocMeta['status'][]) => docs.filter((d) => st.includes(d.status)).length;
  const allSelected = selected.length === docs.length;
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="overview">
      <ModelBanner />
      <div className="ov-toolbar">
        <div className="ov-title">Rechnungen</div>
        <div className="counts">
          <span className="count-chip">
            <b>{docs.length}</b> Dokumente
          </span>
          {count(['new', 'error']) > 0 && (
            <span className="count-chip">
              <b>{count(['new', 'error'])}</b> nicht gescannt
            </span>
          )}
          <span className="count-chip">
            <b>{count(['scanned'])}</b> zu prüfen
          </span>
          <span className="count-chip">
            <b>{count(['verified'])}</b> geprüft
          </span>
        </div>
        <div className="spacer" />
        {selected.length > 0 && (
          <div className="selection-actions">
            {selected.length} ausgewählt
            <button className="btn btn-sm" onClick={() => enqueueScan(selected)}>
              <ScanLine /> Scannen
            </button>
            <button className="btn btn-sm" onClick={() => startReviewMode(selected)}>
              <ClipboardCheck /> Prüfen
            </button>
            <button className="btn btn-sm" onClick={() => void confirmRemove(selected)}>
              <Trash /> Entfernen
            </button>
            <button className="btn btn-sm btn-icon" onClick={() => setSelected([])} title="Auswahl aufheben">
              <X />
            </button>
          </div>
        )}
      </div>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr className="labels">
              <th className="check-col sticky-col">
                <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : docs.map((d) => d.id))} title="Alle auswählen" />
              </th>
              <th className="status-col">Status</th>
              <th className="file-col">Dateiname</th>
              {cols.map((c) => (
                <th key={c.id} style={{ ['--col' as string]: c.color }} title={c.description}>
                  {c.label}
                </th>
              ))}
              <th className="actions-col" />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className={cls(selected.includes(d.id) && 'selected')} onClick={() => openReview(d.id)}>
                <td className="check-col sticky-col" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                </td>
                <td className="status-col">
                  <StatusCell doc={d} rt={runtime[d.id]} />
                </td>
                <td className="file-col">
                  <div className="file-cell" title={d.filePath ?? d.fileName}>
                    <FileText />
                    <span className="name">{d.fileName}</span>
                    <small>
                      {d.pageCount ? `${d.pageCount} S. · ` : ''}
                      {formatBytes(d.fileSize)}
                    </small>
                  </div>
                </td>
                {cols.map((c) => {
                  const field = d.fields[c.id];
                  const text =
                    c.type === 'positions'
                      ? d.positions.length
                        ? `${d.positions.length} Position${d.positions.length === 1 ? '' : 'en'}`
                        : ''
                      : c.type === 'scanDate'
                        ? displayCell(c, d, settings)
                        : formatFieldValue(c.type, field?.value, settings);
                  return (
                    <td key={c.id} className={cls(cellClass(c), field?.source === 'manual' && 'src-manual')} title={text}>
                      {text || <span className="empty-cell">—</span>}
                    </td>
                  );
                })}
                <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                  <div className="row-actions">
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      title={d.scanDate ? 'Neu scannen' : 'Scannen'}
                      disabled={d.status === 'scanning' || d.status === 'queued'}
                      onClick={() => enqueueScan([d.id])}
                    >
                      <RefreshCw />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm btn-danger" title="Aus Projekt entfernen" onClick={() => void confirmRemove([d.id])}>
                      <Trash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
