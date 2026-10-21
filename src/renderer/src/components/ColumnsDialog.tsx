import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_COLUMNS, cloneColumns, nextCustomColor } from '../../../shared/columns';
import type { Column, ColumnType } from '../../../shared/types';
import { uid } from '../lib/ids';
import { aiAvailable, scanColumns } from '../lib/scan';
import { askConfirm, setColumns, setDialog, toast, useStore } from '../store';
import { cls, Modal, Switch } from './ui';

const TYPE_LABEL: Record<ColumnType, string> = {
  text: 'Text',
  id: 'Nummer / Kennung',
  amount: 'Betrag',
  number: 'Zahl',
  date: 'Datum',
  currency: 'Währung',
  positions: 'Positionen (JSON)',
  scanDate: 'Vom Programm gesetzt',
  fileName: 'Vom Programm gesetzt'
};

const CUSTOM_TYPES: ColumnType[] = ['text', 'id', 'amount', 'number', 'date'];

export function ColumnsDialog() {
  const columns = useStore((s) => s.columns);
  const docs = useStore((s) => s.docs);
  const [draft, setDraft] = useState<Column[]>(() => cloneColumns(columns));

  const update = (id: string, patch: Partial<Column>) => setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (i: number, delta: number) =>
    setDraft((d) => {
      const n = [...d];
      const [x] = n.splice(i, 1);
      n.splice(i + delta, 0, x);
      return n;
    });
  const addCustom = () =>
    setDraft((d) => [
      ...d,
      { id: uid('c_'), label: '', type: 'text', builtin: false, color: nextCustomColor(d), description: '', enabled: true }
    ]);
  const reset = () => setDraft((d) => [...cloneColumns(DEFAULT_COLUMNS), ...d.filter((c) => !c.builtin)]);

  const save = async () => {
    const cleaned = draft
      .map((c) => ({ ...c, label: c.label.trim(), description: c.description?.trim() }))
      .filter((c) => c.builtin || c.label);
    const labels = cleaned.map((c) => c.label.toLowerCase());
    const dup = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dup) {
      toast('warn', `Der Spaltenname «${dup}» kommt mehrfach vor.`);
      return;
    }
    // Neue oder geänderte eigene Spalten können in bereits gescannten Dokumenten gesucht werden
    const toSearch = cleaned.filter((c) => {
      if (c.builtin || !c.enabled) return false;
      const old = columns.find((o) => o.id === c.id);
      return !old || !old.enabled || old.label !== c.label || old.description !== c.description || old.type !== c.type;
    });
    setColumns(cleaned);
    setDialog(null);
    const scanned = docs.filter((d) => d.status === 'scanned' || d.status === 'verified').length;
    if (toSearch.length && scanned && aiAvailable()) {
      const answer = await askConfirm({
        title: 'Neue Spalten suchen?',
        text: `Soll die KI in den ${scanned} bereits gescannten Dokumenten nach ${toSearch.map((c) => `«${c.label}»`).join(', ')} suchen? Die übrigen Werte bleiben unverändert.`,
        confirmLabel: 'Jetzt suchen',
        cancelLabel: 'Später'
      });
      if (answer === 'confirm') void scanColumns(toSearch.map((c) => c.id));
    }
  };

  return (
    <Modal
      title="Spalten"
      subtitle="Reihenfolge, Sichtbarkeit und eigene Spalten. Die KI sucht eigene Spalten anhand von Name und Hinweis automatisch."
      size="wide"
      onClose={() => setDialog(null)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={reset} title="Eingebaute Spalten auf Standard zurücksetzen">
            <RotateCcw /> Standard
          </button>
          <button className="btn" onClick={addCustom}>
            <Plus /> Eigene Spalte
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={() => setDialog(null)}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Übernehmen
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="col-list">
          {draft.map((c, i) => (
            <div key={c.id} className={cls('col-item', !c.enabled && 'off')}>
              <div className="order">
                <button disabled={i === 0} onClick={() => move(i, -1)} title="Nach oben">
                  <ChevronUp />
                </button>
                <button disabled={i === draft.length - 1} onClick={() => move(i, 1)} title="Nach unten">
                  <ChevronDown />
                </button>
              </div>
              <label className="color-pick" style={{ background: c.color }} title="Farbe der Markierung">
                <input type="color" value={c.color} onChange={(e) => update(c.id, { color: e.target.value })} />
              </label>
              <div className="col-fields">
                <input
                  className="input"
                  value={c.label}
                  placeholder="Spaltenname, z.B. Kundennummer"
                  autoFocus={!c.builtin && !c.label}
                  onChange={(e) => update(c.id, { label: e.target.value })}
                />
                {c.builtin ? (
                  <div className="builtin-note">{TYPE_LABEL[c.type]} · eingebaut</div>
                ) : (
                  <select className="input" value={c.type} onChange={(e) => update(c.id, { type: e.target.value as ColumnType })}>
                    {CUSTOM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                )}
                {c.builtin ? (
                  c.description && <div className="desc builtin-note">{c.description}</div>
                ) : (
                  <input
                    className="input desc"
                    value={c.description ?? ''}
                    placeholder="Hinweis für die KI: wonach suchen? z.B. «Kundennummer, steht oben rechts als Kunden-Nr.»"
                    onChange={(e) => update(c.id, { description: e.target.value })}
                  />
                )}
              </div>
              <Switch on={c.enabled} onChange={(v) => update(c.id, { enabled: v })} title="In Tabelle und Export anzeigen" />
              {c.builtin ? (
                <span style={{ width: 28 }} />
              ) : (
                <button className="btn btn-ghost btn-icon btn-sm btn-danger" onClick={() => setDraft((d) => d.filter((x) => x.id !== c.id))} title="Spalte löschen">
                  <Trash />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
