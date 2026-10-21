import { ArrowLeft, ChevronLeft, ChevronRight, Circle, CircleCheck, Pencil, RefreshCw, ScanLine, Undo2, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { isExtractable, isFieldColumn } from '../../../shared/columns';
import type { Box, Column, DocMeta } from '../../../shared/types';
import { buildLineInfos, findLineInfo, lineBox } from '../lib/doctext';
import { formatFieldValue } from '../lib/format';
import { buildLensSteps } from '../lib/lens';
import { pickFromWord, positionsFromLines, positionsFromText, valueFromText, wordsInBox } from '../lib/pick';
import { enqueueScan, ocrBox } from '../lib/scan';
import {
  askConfirm,
  closeReview,
  focusFieldEditor,
  gotoNextUnverified,
  gotoRelative,
  openLens,
  setActive,
  setField,
  setPositions,
  setVerified,
  toast,
  useStore,
  type ActiveTarget
} from '../store';
import { LensDialog } from './LensDialog';
import { StatusPill } from './Overview';
import { PdfViewer, type Highlight } from './PdfViewer';
import { ChecksCard, FieldEditor, MetaCard, PositionsEditor, SheetPreview } from './ReviewPanels';
import { cls } from './ui';

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
};

function Chip({ col, doc, index, active, onClick }: { col: Column; doc: DocMeta; index: number; active: boolean; onClick: () => void }) {
  const field = doc.fields[col.id];
  const isPos = col.type === 'positions';
  const filled = isPos ? doc.positions.length > 0 : Boolean(field?.value);
  return (
    <button
      className={cls('chip', active && 'active')}
      style={{ ['--c' as string]: col.color } as CSSProperties}
      onClick={onClick}
      title={isPos ? `${doc.positions.length} Positionen` : field ? `${col.label}: ${field.value}` : `${col.label}: kein Wert`}
    >
      <span className="swatch" />
      {col.label}
      {isPos ? (
        <span className="hk">{doc.positions.length}</span>
      ) : (
        <span className={cls('state', !filled ? 'empty' : field?.source === 'manual' ? 'manual' : 'ok')}>
          {!filled ? <Circle /> : field?.source === 'manual' ? <Pencil /> : <CircleCheck />}
        </span>
      )}
      {index < 9 && <span className="hk">{index + 1}</span>}
    </button>
  );
}

export function Review() {
  const doc = useStore((s) => s.docs.find((d) => d.id === s.currentDocId));
  const bytes = useStore((s) => (s.currentDocId ? s.pdfBytes[s.currentDocId] : undefined));
  const columns = useStore((s) => s.columns);
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.active);
  const queue = useStore((s) => s.reviewQueue);
  const docIds = useStore((s) => s.docs.map((d) => d.id).join('|'));
  const scanStage = useStore((s) => (s.currentDocId ? s.runtime[s.currentDocId]?.stage : undefined));
  const lensOpen = useStore((s) => Boolean(s.lens && s.lens.docId === s.currentDocId));
  const [busy, setBusy] = useState<string | null>(null);
  const [leftW, setLeftW] = useState(() => Number(localStorage.getItem('bf.leftW')) || 45);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const pages = doc?.pages;
  const infos = useMemo(() => (pages ? buildLineInfos(pages) : []), [pages]);
  const chipCols = useMemo(() => columns.filter((c) => c.enabled && isExtractable(c)), [columns]);
  const fieldCols = useMemo(() => columns.filter((c) => c.enabled && isFieldColumn(c)), [columns]);
  const posCol = useMemo(() => columns.find((c) => c.type === 'positions'), [columns]);
  const activeCol = active?.kind === 'field' ? columns.find((c) => c.id === active.columnId) : active?.kind === 'positions' ? posCol : undefined;

  const highlights = useMemo<Highlight[]>(() => {
    if (!doc) return [];
    const list: Highlight[] = [];
    const isActiveField = (id: string) => active?.kind === 'field' && active.columnId === id;
    for (const c of fieldCols) {
      const f = doc.fields[c.id];
      if (!f) continue;
      f.boxes.forEach((b, i) =>
        list.push({
          key: `${c.id}-${i}`,
          box: b,
          color: c.color,
          label: `${c.label}: ${formatFieldValue(c.type, f.value, settings)}`,
          tag: c.label,
          target: { kind: 'field', columnId: c.id },
          emph: isActiveField(c.id),
          dim: active !== null && !isActiveField(c.id)
        })
      );
    }
    if (posCol?.enabled) {
      doc.positions.forEach((p, i) =>
        p.boxes.forEach((b, j) =>
          list.push({
            key: `pos-${p.id}-${j}`,
            box: b,
            color: posCol.color,
            label: `Position ${i + 1}: ${p.titel}`,
            tag: `P${i + 1}`,
            target: { kind: 'positions', positionId: p.id },
            emph: active?.kind === 'positions' && active.positionId === p.id,
            dim: active !== null && active.kind !== 'positions'
          })
        )
      );
    }
    return list;
  }, [doc, fieldCols, posCol, active, settings]);

  const preview = useCallback(
    (page: number, word: number): Box[] => {
      if (!doc || !active) return [];
      if (active.kind === 'positions') {
        const w = doc.pages.find((p) => p.index === page)?.words[word];
        const li = w ? findLineInfo(infos, page, w.line) : undefined;
        const b = li ? lineBox(doc.pages, li) : null;
        return b ? [b] : [];
      }
      const col = columns.find((c) => c.id === active.columnId);
      return col ? (pickFromWord(doc.pages, infos, page, word, col.type)?.boxes ?? []) : [];
    },
    [doc, active, columns, infos]
  );

  const applyPositions = useCallback(
    (found: DocMeta['positions'], target: ActiveTarget & { kind: 'positions' }) => {
      if (!doc) return;
      if (!found.length) {
        toast('warn', 'Hier wurde keine Position mit Betrag gefunden. Ziehe einen Rahmen um die Positionszeile(n).');
        return;
      }
      if (target.positionId) {
        setPositions(
          doc.id,
          doc.positions.map((p) => (p.id === target.positionId ? { ...found[0], id: p.id } : p))
        );
        setActive(null);
        return;
      }
      // Bereits erfasste Zeilen (gleiche Box) nicht doppelt hinzufügen
      const fresh = found.filter((f) => !doc.positions.some((p) => p.boxes[0] && f.boxes[0] && Math.abs(p.boxes[0].y - f.boxes[0].y) < 0.003 && p.boxes[0].page === f.boxes[0].page));
      if (!fresh.length) {
        toast('info', 'Diese Position ist bereits erfasst.');
        return;
      }
      const merged = [...doc.positions, ...fresh].sort((a, b) => {
        const ba = a.boxes[0];
        const bb = b.boxes[0];
        if (!ba || !bb) return 0;
        return ba.page - bb.page || ba.y - bb.y;
      });
      setPositions(doc.id, merged);
      if (fresh.length > 1) toast('success', `${fresh.length} Positionen übernommen.`);
    },
    [doc]
  );

  const onPickWord = useCallback(
    (page: number, word: number, append: boolean) => {
      if (!doc || !active) return;
      if (active.kind === 'positions') {
        const w = doc.pages.find((p) => p.index === page)?.words[word];
        const li = w ? findLineInfo(infos, page, w.line) : undefined;
        if (li) applyPositions(positionsFromLines(doc.pages, [{ li, words: li.spans.map((s) => s.word) }]), active);
        return;
      }
      const col = columns.find((c) => c.id === active.columnId);
      if (!col) return;
      const res = pickFromWord(doc.pages, infos, page, word, col.type);
      if (!res) {
        toast('warn', `Hier steht kein passender Wert für «${col.label}». Tipp: einen Rahmen um den Wert ziehen.`);
        return;
      }
      const current = doc.fields[col.id];
      if (append && current && (col.type === 'text' || col.type === 'id')) {
        setField(doc.id, col.id, { value: `${current.value} ${res.value}`.trim(), raw: `${current.raw ?? current.value} ${res.raw}`, source: 'pick', boxes: [...current.boxes, ...res.boxes] });
        return;
      }
      setField(doc.id, col.id, { value: res.value, raw: res.raw, source: 'pick', boxes: res.boxes });
      setActive(null);
      focusFieldEditor(col.id);
    },
    [doc, active, columns, infos, applyPositions]
  );

  const onBox = useCallback(
    async (box: Box) => {
      if (!doc || !active) return;
      const inBox = wordsInBox(doc.pages, infos, box);
      if (active.kind === 'positions') {
        let found = positionsFromLines(doc.pages, inBox.lines);
        if (!found.length) {
          setBusy('Rahmen wird gelesen …');
          try {
            found = positionsFromText(await ocrBox(doc.id, box), box);
          } finally {
            setBusy(null);
          }
        }
        applyPositions(found, active);
        return;
      }
      const col = columns.find((c) => c.id === active.columnId);
      if (!col) return;
      let text = inBox.clean ? inBox.text : '';
      if (!text) {
        // Angeschnittene oder fehlende Wörter: Ausschnitt in hoher Auflösung neu erkennen
        setBusy('Texterkennung im Rahmen …');
        try {
          text = await ocrBox(doc.id, box);
        } catch (err) {
          toast('error', `Texterkennung fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
          return;
        } finally {
          setBusy(null);
        }
      }
      const parsed = valueFromText(text, col.type);
      if (!parsed) {
        toast('warn', `Im Rahmen wurde kein gültiger Wert für «${col.label}» erkannt${text ? ` («${text.slice(0, 60)}»)` : ''}.`);
        return;
      }
      setField(doc.id, col.id, { value: parsed.value, raw: parsed.raw, source: 'box', boxes: [box] });
      setActive(null);
      focusFieldEditor(col.id);
    },
    [doc, active, columns, infos, applyPositions]
  );

  const onMiss = useCallback(() => {
    if (doc && !doc.pages.length) toast('info', 'Das Dokument ist noch nicht gescannt – ziehe einen Rahmen um den Wert.');
  }, [doc]);

  const onHighlightClick = useCallback((t: ActiveTarget) => {
    setActive(t);
    if (t.kind === 'field') focusFieldEditor(t.columnId);
  }, []);

  const verifyAndNext = useCallback(() => {
    if (!doc) return;
    if (doc.status !== 'scanned' && doc.status !== 'verified') {
      toast('info', 'Bitte das Dokument zuerst scannen.');
      return;
    }
    setVerified(doc.id, true);
    gotoNextUnverified();
  }, [doc]);

  const startLens = useCallback(() => {
    if (!doc) return;
    if (doc.status !== 'scanned' && doc.status !== 'verified') {
      toast('info', 'Bitte das Dokument zuerst scannen.');
      return;
    }
    if (!buildLensSteps(doc, columns, settings, infos).steps.length) {
      toast('info', 'Kein erfasster Wert hat eine Fundstelle im PDF – im Linsenmodus gibt es nichts zu vergleichen.');
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    openLens();
  }, [doc, columns, settings, infos]);

  const rescan = useCallback(async () => {
    if (!doc) return;
    if (doc.status === 'verified' || Object.values(doc.fields).some((f) => f.source === 'manual' || f.source === 'pick' || f.source === 'box')) {
      const answer = await askConfirm({
        title: 'Dokument neu scannen?',
        text: 'Alle erkannten und korrigierten Werte dieses Dokuments werden durch das neue Scan-Ergebnis ersetzt.',
        confirmLabel: 'Neu scannen'
      });
      if (answer !== 'confirm') return;
    }
    setActive(null);
    enqueueScan([doc.id]);
  }, [doc]);

  // Tastatur: Esc, Ctrl+Enter, Alt+←/→, 1–9, L
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.dialog || s.confirm || s.lens) return;
      if (e.key === 'Escape' && !isTyping()) {
        setActive(null);
        return;
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        setTimeout(verifyAndNext);
        return;
      }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        gotoRelative(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (!isTyping() && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const col = chipCols[Number(e.key) - 1];
        if (col) setActive(col.type === 'positions' ? { kind: 'positions' } : { kind: 'field', columnId: col.id });
        return;
      }
      if (!isTyping() && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        startLens();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chipCols, verifyAndNext, startLens]);

  // Teiler zwischen Ergebnis und PDF
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const r = bodyRef.current?.getBoundingClientRect();
      if (!r) return;
      setLeftW(Math.min(70, Math.max(28, ((e.clientX - r.left) / r.width) * 100)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);
  useEffect(() => localStorage.setItem('bf.leftW', String(Math.round(leftW))), [leftW]);

  if (!doc || !bytes) return null;
  const list = queue ?? docIds.split('|');
  const pos = list.indexOf(doc.id);
  const scanning = doc.status === 'scanning' || doc.status === 'queued';
  const notScanned = doc.status === 'new' || doc.status === 'error';

  return (
    <div className="review">
      <div className="review-head">
        <button className="btn btn-ghost" onClick={closeReview} title="Zurück zur Übersicht">
          <ArrowLeft /> Übersicht
        </button>
        <div className="doc-nav">
          <button className="btn btn-icon" disabled={pos <= 0} onClick={() => gotoRelative(-1)} title="Vorheriges Dokument (Alt+←)">
            <ChevronLeft />
          </button>
          <div className="doc-title">
            <span className="mode">
              {queue ? 'Prüfmodus' : 'Einzelprüfung'} · {pos + 1} von {list.length}
            </span>
            <span className="name">
              <span title={doc.fileName}>{doc.fileName}</span>
              <StatusPill status={doc.status} />
            </span>
          </div>
          <button className="btn btn-icon" disabled={pos >= list.length - 1} onClick={() => gotoRelative(1)} title="Nächstes Dokument (Alt+→)">
            <ChevronRight />
          </button>
        </div>
        <div className="review-actions">
          <button className="btn" onClick={() => void rescan()} disabled={scanning} title="Dokument erneut scannen">
            {notScanned ? <ScanLine /> : <RefreshCw />} {notScanned ? 'Scannen' : 'Neu scannen'}
          </button>
          {doc.status === 'verified' ? (
            <button className="btn" onClick={() => setVerified(doc.id, false)} title="Wieder als ungeprüft markieren">
              <Undo2 /> Ungeprüft
            </button>
          ) : null}
          <button className="btn" onClick={startLens} disabled={scanning || notScanned} title="Erfasste Werte Schritt für Schritt vergrössert mit dem PDF vergleichen (L)">
            <ZoomIn /> Linsenmodus <span className="kbd">L</span>
          </button>
          <button className="btn btn-success" onClick={verifyAndNext} disabled={scanning || notScanned} title="Als geprüft markieren und zum nächsten Dokument (Ctrl+Enter)">
            <CircleCheck /> Geprüft &amp; weiter <span className="kbd">Ctrl+↵</span>
          </button>
        </div>
      </div>

      <div className="chipbar">
        <span className="label">Felder</span>
        {chipCols.map((c, i) => (
          <Chip
            key={c.id}
            col={c}
            doc={doc}
            index={i}
            active={c.type === 'positions' ? active?.kind === 'positions' : active?.kind === 'field' && active.columnId === c.id}
            onClick={() => {
              const isOn = c.type === 'positions' ? active?.kind === 'positions' : active?.kind === 'field' && active.columnId === c.id;
              setActive(isOn ? null : c.type === 'positions' ? { kind: 'positions' } : { kind: 'field', columnId: c.id });
              if (c.type !== 'positions') focusFieldEditor(c.id);
            }}
          />
        ))}
      </div>

      <div className="review-body" ref={bodyRef} style={{ ['--left-w' as string]: `${leftW}%` } as CSSProperties}>
        <div className="left-panel">
          <SheetPreview doc={doc} />
          <ChecksCard doc={doc} />
          <FieldEditor doc={doc} />
          <PositionsEditor doc={doc} />
          <MetaCard doc={doc} />
        </div>
        <div className={cls('splitter', dragging && 'dragging')} onMouseDown={() => setDragging(true)} />
        <div className="pdf-wrap">
          {activeCol && (
            <div className="assign-hint">
              <span className="sw" style={{ background: activeCol.color }} />
              {active?.kind === 'positions'
                ? active.positionId
                  ? 'Zeile der Position anklicken oder Rahmen ziehen'
                  : 'Positionszeilen anklicken oder Rahmen um die Tabelle ziehen'
                : `«${activeCol.label}»: Wert anklicken oder Rahmen ziehen`}
              {active?.kind === 'field' && (activeCol.type === 'text' || activeCol.type === 'id') && <span className="muted"> · Ctrl+Klick ergänzt</span>}
              <span className="kbd">Esc</span>
            </div>
          )}
          <PdfViewer
            doc={doc}
            bytes={bytes}
            highlights={highlights}
            assignColor={activeCol?.color ?? null}
            busy={busy ?? (scanning ? (scanStage ?? 'Wird gescannt …') : null)}
            preview={preview}
            onPickWord={onPickWord}
            onBox={(b) => void onBox(b)}
            onMiss={onMiss}
            onHighlightClick={onHighlightClick}
            note={
              notScanned ? (
                <div className="pdf-empty-note">
                  Dieses Dokument ist noch nicht gescannt.
                  <button className="btn btn-primary btn-sm" onClick={() => enqueueScan([doc.id])}>
                    <ScanLine /> Jetzt scannen
                  </button>
                </div>
              ) : null
            }
          />
        </div>
      </div>
      {lensOpen && <LensDialog doc={doc} bytes={bytes} />}
    </div>
  );
}
