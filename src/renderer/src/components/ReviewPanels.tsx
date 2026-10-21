import { CircleCheck, Crosshair, Eye, FileSpreadsheet, Info, Plus, Trash, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isFieldColumn } from '../../../shared/columns';
import { amountToValue, formatAmount, formatDateTime, parseAmount } from '../../../shared/parse';
import type { Column, DocMeta, Position } from '../../../shared/types';
import { runChecks } from '../lib/checks';
import { columnLetter, displayCell, formatFieldValue, isValidValue, parseInput, SOURCE_HINT, SOURCE_LABEL } from '../lib/format';
import { uid } from '../lib/ids';
import { focusFieldEditor, revealBox, setActive, setField, setPositions, useStore } from '../store';
import { cls } from './ui';

const cssVar = (name: string, value: string) => ({ [name]: value }) as CSSProperties;

/** Eine Zeile so, wie sie im Excel-Export erscheint. */
export function SheetPreview({ doc }: { doc: DocMeta }) {
  const columns = useStore((s) => s.columns);
  const settings = useStore((s) => s.settings);
  const cols = columns.filter((c) => c.enabled);
  const onCell = (c: Column) => {
    if (isFieldColumn(c)) focusFieldEditor(c.id);
    const box = c.type === 'positions' ? doc.positions[0]?.boxes[0] : doc.fields[c.id]?.boxes[0];
    if (box) revealBox(box);
  };
  return (
    <div className="card">
      <div className="card-head">
        <FileSpreadsheet size={15} color="#15803d" />
        <h3>Excel-Vorschau</h3>
        <div className="spacer" />
        <small>So erscheint die Zeile im Export</small>
      </div>
      <div className="sheet">
        <table>
          <thead>
            <tr className="letters">
              <th className="rownum" />
              {cols.map((c, i) => (
                <th key={c.id}>{columnLetter(i)}</th>
              ))}
            </tr>
            <tr className="head">
              <th className="rownum">1</th>
              {cols.map((c) => (
                <th key={c.id} style={cssVar('--col', c.color)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rownum">2</td>
              {cols.map((c) => {
                const text = displayCell(c, doc, settings);
                const f = doc.fields[c.id];
                return (
                  <td
                    key={c.id}
                    style={cssVar('--col', c.color)}
                    className={cls(
                      (c.type === 'amount' || c.type === 'number') && 'num',
                      c.type === 'positions' && 'json',
                      !text && 'empty',
                      f?.source === 'manual' && 'manual'
                    )}
                    title={text}
                    onClick={() => onCell(c)}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChecksCard({ doc }: { doc: DocMeta }) {
  const columns = useStore((s) => s.columns);
  const settings = useStore((s) => s.settings);
  if (doc.status !== 'scanned' && doc.status !== 'verified') return null;
  const checks = runChecks(doc, columns, settings);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Kontrolle</h3>
      </div>
      <div className="checks">
        {checks.map((c, i) => (
          <div key={i} className={cls('check', c.level)}>
            {c.level === 'ok' ? <CircleCheck /> : c.level === 'warn' ? <TriangleAlert /> : <Info />}
            <span>{c.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function placeholder(c: Column): string {
  switch (c.type) {
    case 'amount':
    case 'number':
      return '0.00';
    case 'date':
      return 'TT.MM.JJJJ';
    case 'currency':
      return 'CHF';
    default:
      return 'Kein Wert';
  }
}

function FieldRow({ col, doc, index }: { col: Column; doc: DocMeta; index: number }) {
  const field = doc.fields[col.id];
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.active?.kind === 'field' && s.active.columnId === col.id);
  const focus = useStore((s) => s.focusField);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const display = formatFieldValue(col.type, field?.value, settings);
  const [draft, setDraft] = useState(display);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(display);
  }, [display, editing]);

  useEffect(() => {
    if (!focus || focus.columnId !== col.id) return;
    rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1000);
    return () => clearTimeout(t);
  }, [focus, col.id]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === display.trim()) return;
    const { value } = parseInput(col.type, draft);
    if (!value) setField(doc.id, col.id, null);
    // Manuelle Eingabe: frei, ohne Bezug zum Scan
    else setField(doc.id, col.id, { value, raw: draft.trim(), source: 'manual', boxes: [] });
  };
  const invalid = field ? !isValidValue(col.type, field.value) : false;

  return (
    <div ref={rowRef} className={cls('field-row', active && 'active', flash && 'flash')} style={cssVar('--c', col.color)}>
      <div className="field-color" />
      <div className="field-main">
        <div className="field-label">
          {col.label}
          {field && (
            <span className={cls('src', field.source)} title={SOURCE_HINT[field.source]}>
              {SOURCE_LABEL[field.source]}
            </span>
          )}
          {index < 9 && (
            <span className="kbd" title={`Taste ${index + 1}: Feld im PDF auswählen`}>
              {index + 1}
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          className={cls('field-input', (col.type === 'amount' || col.type === 'number') && 'num', invalid && 'invalid')}
          value={draft}
          placeholder={placeholder(col)}
          spellCheck={false}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(display);
              setEditing(false);
              setTimeout(() => inputRef.current?.blur());
            }
          }}
        />
        {field?.note && <div className="field-note">{field.note}</div>}
        {invalid && <div className="field-note">Freitext – wird unverändert exportiert</div>}
      </div>
      <div className="field-actions">
        <button
          className={cls('btn btn-ghost btn-icon btn-sm', active && 'on')}
          title="Im PDF auswählen: Wort anklicken oder Rahmen ziehen"
          onClick={() => setActive(active ? null : { kind: 'field', columnId: col.id })}
        >
          <Crosshair />
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          title="Fundstelle im PDF anzeigen"
          disabled={!field?.boxes.length}
          onClick={() => field?.boxes[0] && revealBox(field.boxes[0])}
        >
          <Eye />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm btn-danger" title="Wert löschen" disabled={!field} onClick={() => setField(doc.id, col.id, null)}>
          <X />
        </button>
      </div>
    </div>
  );
}

export function FieldEditor({ doc }: { doc: DocMeta }) {
  const columns = useStore((s) => s.columns);
  const cols = columns.filter((c) => c.enabled && isFieldColumn(c));
  return (
    <div className="card">
      <div className="card-head">
        <h3>Erfasste Werte</h3>
        <div className="spacer" />
        <small>Direkt überschreiben oder mit ⌖ im PDF auswählen</small>
      </div>
      <div className="fields">
        {cols.map((c, i) => (
          <FieldRow key={c.id} col={c} doc={doc} index={i} />
        ))}
      </div>
    </div>
  );
}

function PositionRow({ pos, index, doc, color }: { pos: Position; index: number; doc: DocMeta; color: string }) {
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.active?.kind === 'positions' && s.active.positionId === pos.id);
  const fmtNum = (n: number | null, decimals: boolean) => (n === null ? '' : decimals ? formatAmount(n, settings.numberFormat) : String(n));
  const [titel, setTitel] = useState(pos.titel);
  const [menge, setMenge] = useState(fmtNum(pos.menge, false));
  const [preis, setPreis] = useState(fmtNum(pos.preis, true));
  useEffect(() => {
    setTitel(pos.titel);
    setMenge(fmtNum(pos.menge, false));
    setPreis(fmtNum(pos.preis, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.titel, pos.menge, pos.preis, settings.numberFormat]);

  const update = (patch: Partial<Position>) =>
    setPositions(
      doc.id,
      doc.positions.map((p) => (p.id === pos.id ? { ...p, ...patch, source: 'manual' } : p))
    );
  const commitNum = (text: string, key: 'menge' | 'preis') => {
    const n = text.trim() ? parseAmount(text) : null;
    const value = n === null ? null : key === 'preis' ? Number(amountToValue(n)) : n;
    if (value !== pos[key]) update({ [key]: value } as Partial<Position>);
    else if (key === 'preis') setPreis(fmtNum(pos.preis, true));
  };

  return (
    <tr className={cls(active && 'active')}>
      <td className="idx">
        <span style={{ background: `color-mix(in srgb, ${color} 18%, white)` }}>P{index + 1}</span>
      </td>
      <td>
        <input value={titel} onChange={(e) => setTitel(e.target.value)} onBlur={() => titel !== pos.titel && update({ titel: titel.trim() })} placeholder="Bezeichnung" />
      </td>
      <td className="num" style={{ width: 80 }}>
        <input value={menge} onChange={(e) => setMenge(e.target.value)} onBlur={() => commitNum(menge, 'menge')} placeholder="–" />
      </td>
      <td className="num" style={{ width: 110 }}>
        <input value={preis} onChange={(e) => setPreis(e.target.value)} onBlur={() => commitNum(preis, 'preis')} placeholder="0.00" />
      </td>
      <td style={{ width: 92, whiteSpace: 'nowrap', textAlign: 'right' }}>
        <button
          className={cls('btn btn-ghost btn-icon btn-sm', active && 'on')}
          title="Diese Position im PDF neu auswählen (Zeile anklicken oder Rahmen ziehen)"
          onClick={() => setActive(active ? null : { kind: 'positions', positionId: pos.id })}
        >
          <Crosshair />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" title="Im PDF anzeigen" disabled={!pos.boxes.length} onClick={() => pos.boxes[0] && revealBox(pos.boxes[0])}>
          <Eye />
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm btn-danger"
          title="Position entfernen"
          onClick={() =>
            setPositions(
              doc.id,
              doc.positions.filter((p) => p.id !== pos.id)
            )
          }
        >
          <X />
        </button>
      </td>
    </tr>
  );
}

export function PositionsEditor({ doc }: { doc: DocMeta }) {
  const col = useStore((s) => s.columns.find((c) => c.type === 'positions'));
  const settings = useStore((s) => s.settings);
  const capture = useStore((s) => s.active?.kind === 'positions' && !s.active.positionId);
  if (!col?.enabled) return null;
  const sum = doc.positions.reduce((s, p) => s + (p.preis ?? 0), 0);
  const add = () => setPositions(doc.id, [...doc.positions, { id: uid('p_'), titel: '', menge: null, preis: null, boxes: [], source: 'manual' }]);
  return (
    <div className="card" style={cssVar('--c', col.color)}>
      <div className="card-head">
        <span style={{ width: 11, height: 11, borderRadius: 3, background: col.color }} />
        <h3>{col.label}</h3>
        <small>{doc.positions.length}</small>
        <div className="spacer" />
        <button
          className={cls('btn btn-sm', capture && 'btn-dark')}
          onClick={() => setActive(capture ? null : { kind: 'positions' })}
          title="Zeilen im PDF anklicken oder einen Rahmen um mehrere Positionen ziehen"
        >
          <Crosshair /> {capture ? 'Erfassen beenden' : 'Aus PDF erfassen'}
        </button>
        <button className="btn btn-sm" onClick={add} title="Leere Position manuell hinzufügen">
          <Plus /> Position
        </button>
        {doc.positions.length > 0 && (
          <button className="btn btn-ghost btn-icon btn-sm btn-danger" title="Alle Positionen entfernen" onClick={() => setPositions(doc.id, [])}>
            <Trash />
          </button>
        )}
      </div>
      {doc.positions.length ? (
        <table className="pos-table">
          <thead>
            <tr>
              <th />
              <th>Titel</th>
              <th style={{ textAlign: 'right' }}>Menge</th>
              <th style={{ textAlign: 'right' }}>Preis</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.positions.map((p, i) => (
              <PositionRow key={p.id} pos={p} index={i} doc={doc} color={col.color} />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="pos-empty">Keine Positionen erfasst. Klicke «Aus PDF erfassen» und ziehe einen Rahmen um die Positionstabelle.</div>
      )}
      <div className="pos-foot">
        <span>
          Summe: <b>{formatAmount(sum, settings.numberFormat)}</b>
        </span>
        <div className="spacer" />
        <span className="muted">Export als JSON in einer Spalte</span>
      </div>
    </div>
  );
}

export function MetaCard({ doc }: { doc: DocMeta }) {
  const sources = new Set(doc.pages.map((p) => p.source));
  return (
    <div className="card">
      <div className="card-head">
        <h3>Dokument</h3>
      </div>
      <dl className="meta-list">
        <dt>Datei</dt>
        <dd title={doc.filePath}>{doc.filePath ?? doc.fileName}</dd>
        <dt>Seiten</dt>
        <dd>{doc.pageCount || '–'}</dd>
        <dt>Textquelle</dt>
        <dd>{sources.size ? [...sources].map((s) => (s === 'ocr' ? 'OCR (gescannt)' : 'PDF-Text (digital)')).join(' + ') : '–'}</dd>
        <dt>Scan-Datum</dt>
        <dd>{formatDateTime(doc.scanDate) || '–'}</dd>
        <dt>Erkennung</dt>
        <dd>{doc.aiModel ? `KI (${doc.aiModel}) + Regeln` : doc.scanDate ? 'Regelbasiert' : '–'}</dd>
        {doc.verifiedAt && (
          <>
            <dt>Geprüft</dt>
            <dd>{formatDateTime(doc.verifiedAt)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
