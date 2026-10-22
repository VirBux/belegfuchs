import { ArrowLeft, ArrowRight, CircleCheck, Equal, Pencil, X, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { Box, DocMeta, PageData } from '../../../shared/types';
import { buildLineInfos } from '../lib/doctext';
import { SOURCE_HINT, SOURCE_LABEL } from '../lib/format';
import { applyLensEdit, buildLensSteps, cropRegions, fitScale, type CropRegion, type LensPart, type LensStep } from '../lib/lens';
import { getPdf, renderBoxCanvas } from '../lib/pdf';
import { closeLens, focusFieldEditor, gotoNextUnverified, revealBox, setActive, setField, setLensStep, setPositions, setVerified, useStore } from '../store';
import { cls } from './ui';

// Feste Masse der Bühne (siehe .lens-* in styles.css), damit beim Weiterschalten nichts springt
const GUTTER = 44;
const ROW_GAP = 12;
const PANE_INSET = 20;
const STACK_GAP = 12;
const fontFor = (rows: number) => (rows > 1 ? 34 : 60);

interface Size {
  w: number;
  h: number;
}

/** Innenfläche einer Wert- bzw. Ausschnittfläche bei gegebener Zeilenzahl. */
const paneSize = (stage: Size, rows: number): Size => ({
  w: (stage.w - GUTTER) / 2 - PANE_INSET * 2,
  h: (stage.h - ROW_GAP * (rows - 1)) / rows - PANE_INSET * 2
});

// ---------- Ausschnitte rendern und zwischenspeichern ----------

interface CropPlan {
  region: CropRegion;
  cssW: number;
  cssH: number;
  renderScale: number;
}

function planCrops(part: LensPart, pages: PageData[], pane: Size, rows: number): CropPlan[] {
  const regions = cropRegions(part.boxes, pages);
  const s = fitScale(regions, pane.w, pane.h, fontFor(rows) * 1.15, STACK_GAP);
  const dpr = window.devicePixelRatio || 1;
  return regions.map((region) => ({
    region,
    cssW: region.widthPt * s,
    cssH: region.heightPt * s,
    renderScale: Math.min(s * dpr, 4096 / region.widthPt, 4096 / region.heightPt)
  }));
}

const crops = new Map<string, Promise<HTMLCanvasElement>>();
const rendered = new Map<string, HTMLCanvasElement>();

const cropKey = (docId: string, b: Box, scale: number) =>
  `${docId}|${b.page}|${b.x.toFixed(5)}|${b.y.toFixed(5)}|${b.w.toFixed(5)}|${b.h.toFixed(5)}|${scale.toFixed(3)}`;

/** Rand um die Fundstelle aufhellen, damit angeschnittene Nachbarzeichen nicht ablenken. */
function fadeMargin(canvas: HTMLCanvasElement, region: CropRegion): HTMLCanvasElement {
  const { box, focus } = region;
  const sx = canvas.width / box.w;
  const sy = canvas.height / box.h;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect((focus.x - box.x) * sx, (focus.y - box.y) * sy, focus.w * sx, focus.h * sy);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill('evenodd');
  return canvas;
}

function loadCrop(docId: string, bytes: Uint8Array, region: CropRegion, scale: number): Promise<HTMLCanvasElement> {
  const { box } = region;
  const key = cropKey(docId, box, scale);
  const cached = crops.get(key);
  if (cached) return cached;
  const task = getPdf(docId, bytes)
    .then((pdf) => pdf.getPage(box.page + 1))
    .then((page) => renderBoxCanvas(page, box, scale))
    .then((canvas) => fadeMargin(canvas, region));
  crops.set(key, task);
  task.then(
    (c) => crops.get(key) === task && rendered.set(key, c),
    () => crops.delete(key)
  );
  return task;
}

function Crop({ docId, bytes, plan }: { docId: string; bytes: Uint8Array; plan: CropPlan }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = cropKey(docId, plan.region.box, plan.renderScale);
  useLayoutEffect(() => {
    let alive = true;
    const draw = (src: HTMLCanvasElement) => {
      const c = ref.current;
      if (!alive || !c) return;
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
    };
    // Vorab gerenderte Ausschnitte sofort zeichnen, sonst nachladen (die Fläche hat bereits ihre Endgrösse)
    const done = rendered.get(key);
    if (done) draw(done);
    else void loadCrop(docId, bytes, plan.region, plan.renderScale).then(draw, () => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className="lens-crop" style={{ width: plan.cssW, height: plan.cssH }} />;
}

/** Text so gross wie möglich (bis max) in die feste Fläche einpassen; die gewählte Grösse landet in sizeRef. */
function FitText({ text, max, pane, sizeRef }: { text: string; max: number; pane: Size; sizeRef: MutableRefObject<number> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fits = () => el.offsetWidth <= box.clientWidth && el.offsetHeight <= box.clientHeight;
    const fit = (wrap: boolean, min: number) => {
      el.style.whiteSpace = wrap ? 'normal' : 'nowrap';
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && !fits()) el.style.fontSize = `${(size -= 2)}px`;
      return fits();
    };
    // Kurze Werte lieber etwas kleiner auf einer Zeile als umgebrochen
    if (!fit(false, max * 0.75)) fit(true, 14);
    sizeRef.current = parseFloat(el.style.fontSize) || max;
  }, [text, max, pane.w, pane.h, sizeRef]);
  return (
    <div className="lens-fit">
      <span ref={ref} className={cls('lens-value', !text && 'empty')}>
        {text || '–'}
      </span>
    </div>
  );
}

/** Bearbeitung im Linsenmodus: welcher Teil, der getippte Text und ggf. warum er nicht übernommen wurde. */
interface LensEditState {
  part: number;
  text: string;
  error?: string;
}

/** Eingabefeld an der Stelle des Werts: gleiche Schrift, mittig; wird kleiner, wenn der Text nicht mehr passt. */
function LensInput({ edit, size, onChange, onBlur }: { edit: LensEditState; size: number; onChange: (text: string) => void; onBlur: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s = size;
    el.style.fontSize = `${s}px`;
    while (s > 14 && el.scrollWidth > el.clientWidth) el.style.fontSize = `${(s -= 2)}px`;
  }, [edit.text, size]);
  return (
    <div className="lens-fit">
      <input
        ref={ref}
        className="lens-value lens-input"
        value={edit.text}
        spellCheck={false}
        aria-invalid={Boolean(edit.error)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

interface RowEdit {
  state: LensEditState | null;
  start: () => void;
  change: (text: string) => void;
  blur: () => void;
}

function LensRow({ part, rows, pane, doc, bytes, edit }: { part: LensPart; rows: number; pane: Size; doc: DocMeta; bytes: Uint8Array; edit: RowEdit }) {
  const plans = planCrops(part, doc.pages, pane, rows);
  const size = useRef(fontFor(rows));
  const editing = edit.state;
  return (
    <div className="lens-row">
      <div
        className={cls('lens-pane', 'editable', editing && 'editing', editing?.error && 'invalid')}
        onClick={() => !editing && edit.start()}
        title={editing ? undefined : 'Klicken oder E, um den Wert hier zu korrigieren'}
      >
        {rows > 1 && <span className="lens-tag">{part.label}</span>}
        {!editing && <Pencil className="lens-edit-icon" />}
        {editing ? (
          <LensInput edit={editing} size={size.current} onChange={edit.change} onBlur={edit.blur} />
        ) : (
          <FitText text={part.text} max={fontFor(rows)} pane={pane} sizeRef={size} />
        )}
        {editing ? (
          <span className={cls('lens-detail', editing.error && 'error')}>{editing.error ?? 'Enter übernimmt · Esc verwirft'}</span>
        ) : (
          part.detail && <span className="lens-detail">{part.detail}</span>
        )}
      </div>
      <div className="lens-eq">
        <Equal />
      </div>
      <div className="lens-pane paper">
        {part.wholeLine && <span className="lens-tag">ganze Zeile</span>}
        {plans.length ? (
          <div className="lens-stack">
            {plans.map((c, i) => (
              <Crop key={i} docId={doc.id} bytes={bytes} plan={c} />
            ))}
          </div>
        ) : (
          <span className="lens-none">Keine Fundstelle</span>
        )}
      </div>
    </div>
  );
}

function stepNote(step: LensStep): string {
  if (step.parts.some((p) => p.wholeLine)) return 'Nicht jeder Teil wurde einzeln gefunden – dort wird die ganze Zeile gezeigt.';
  if (step.source === 'computed') return `Berechnet${step.note ? `: ${step.note}` : ''} – im PDF steht die Grundlage.`;
  return step.note ?? '';
}

/** Vollbild-Dialog: erfasster Wert und PDF-Ausschnitt nebeneinander, Schritt für Schritt. */
export function LensDialog({ doc, bytes }: { doc: DocMeta; bytes: Uint8Array }) {
  const step = useStore((s) => s.lens?.step ?? 0);
  const columns = useStore((s) => s.columns);
  const settings = useStore((s) => s.settings);
  const infos = useMemo(() => buildLineInfos(doc.pages), [doc.pages]);
  const { steps, skipped } = useMemo(() => buildLensSteps(doc, columns, settings, infos), [doc, columns, settings, infos]);
  const index = Math.min(step, steps.length);
  const current: LensStep | undefined = steps[index];
  const done = !current;
  const rows = current?.parts.length ?? 1;
  const rowsRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const measure = () => setStage((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ausschnitte freigeben, wenn der Dialog schliesst
  useEffect(
    () => () => {
      crops.clear();
      rendered.clear();
    },
    []
  );

  // Die nächsten Schritte vorab rendern, damit das Weiterschalten sofort geht
  useEffect(() => {
    if (!stage) return;
    for (const s of [steps[index], steps[index + 1], steps[index + 2], steps[index + 3], steps[index - 1]]) {
      if (!s) continue;
      const pane = paneSize(stage, s.parts.length);
      for (const part of s.parts) {
        for (const c of planCrops(part, doc.pages, pane, s.parts.length)) void loadCrop(doc.id, bytes, c.region, c.renderScale).catch(() => undefined);
      }
    }
  }, [stage, steps, index, doc, bytes]);

  // Wert direkt im Linsenmodus korrigieren; editRef ist sofort aktuell, auch zwischen zwei Renderläufen
  const [edit, setEditState] = useState<LensEditState | null>(null);
  const editRef = useRef<LensEditState | null>(null);
  const putEdit = useCallback((e: LensEditState | null) => {
    editRef.current = e;
    setEditState(e);
  }, []);
  useEffect(() => putEdit(null), [current?.key, putEdit]);

  /** Übernimmt die Eingabe; false, wenn sie ungültig ist und die Bearbeitung offen bleibt. */
  const commitEdit = useCallback((): boolean => {
    const e = editRef.current;
    const part = e && current?.parts[e.part];
    if (!e || !part) return true;
    const r = applyLensEdit(doc, part.edit, e.text);
    if (r.kind === 'error') {
      putEdit({ ...e, error: r.message });
      return false;
    }
    putEdit(null);
    if (r.kind === 'field') setField(doc.id, r.columnId, r.value);
    else if (r.kind === 'positions') setPositions(doc.id, r.positions);
    return true;
  }, [current, doc, putEdit]);

  const startEdit = useCallback(
    (i: number) => {
      const part = current?.parts[i];
      if (part && commitEdit()) putEdit({ part: i, text: part.text });
    },
    [current, commitEdit, putEdit]
  );

  const go = useCallback(
    (delta: number) => {
      if (!commitEdit()) return;
      setLensStep(Math.max(0, Math.min(steps.length, index + delta)));
    },
    [index, steps.length, commitEdit]
  );

  const correct = useCallback(() => {
    if (!current) return;
    closeLens(true);
    setActive(current.target);
    if (current.target.kind === 'field') focusFieldEditor(current.target.columnId);
    const box = current.parts.find((p) => p.boxes.length)?.boxes[0];
    if (box) revealBox(box);
  }, [current]);

  const verifyAndNext = useCallback(() => {
    closeLens();
    setVerified(doc.id, true);
    gotoNextUnverified();
  }, [doc.id]);

  // Tastatur: →/Enter weiter, ← zurück, E/F2 bearbeiten, K korrigieren, Esc schliesst
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().confirm) return;
      const editing = editRef.current;
      if (editing) {
        // Während der Bearbeitung gehören die Tasten dem Eingabefeld; nur Enter, Esc und Tab steuern sie
        if (e.isComposing) return;
        if (e.key === 'Enter') commitEdit();
        else if (e.key === 'Escape') putEdit(null);
        else if (e.key === 'Tab') {
          const next = editing.part + (e.shiftKey ? -1 : 1);
          if (current?.parts[next]) startEdit(next);
        } else return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
      let handled = true;
      if (e.key === 'Escape') closeLens();
      else if (e.key === 'Enter' && (done || plain)) {
        // Gehaltene Enter-Taste darf das Dokument nicht versehentlich als geprüft markieren
        if (!done) go(1);
        else if (!e.repeat) verifyAndNext();
      } else if (e.key === 'ArrowRight' && plain) go(1);
      else if (e.key === 'ArrowLeft' && plain) go(-1);
      else if (e.key.toLowerCase() === 'k' && plain && !done) correct();
      else if (((e.key.toLowerCase() === 'e' && plain) || e.key === 'F2') && !done) startEdit(0);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [done, current, go, correct, verifyAndNext, commitEdit, startEdit, putEdit]);

  const progress = steps.length ? (done ? 1 : (index + 1) / steps.length) : 1;

  return (
    <div className="lens-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeLens()}>
      <div className="lens" role="dialog" aria-label="Linsenmodus" style={{ ['--c' as string]: current?.color ?? 'var(--ok)' } as CSSProperties}>
        <div className="lens-head">
          <span className="eyebrow">
            <ZoomIn /> Linsenmodus
          </span>
          <span className="field">
            <span className="sw" />
            <span className="name">{current ? current.label : 'Zusammenfassung'}</span>
            {current && (
              <span className={cls('src', current.source)} title={SOURCE_HINT[current.source]}>
                {SOURCE_LABEL[current.source]}
              </span>
            )}
          </span>
          <span className="count">
            {done ? steps.length : index + 1} / {steps.length}
          </span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => closeLens()} title="Schliessen (Esc)">
            <X />
          </button>
        </div>
        <div className="lens-progress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="lens-stage">
          <div className={cls('lens-captions', done && 'hidden')}>
            <span>Erfasst</span>
            <span />
            <span>Im PDF</span>
          </div>
          <div className="lens-rows" ref={rowsRef} style={{ ['--rows' as string]: rows } as CSSProperties}>
            {done ? (
              <div className="lens-summary">
                <CircleCheck className="big" />
                <h3>{steps.length === 1 ? '1 Wert verglichen' : `${steps.length} Werte verglichen`}</h3>
                <p>Alle erfassten Werte mit Fundstelle wurden mit dem PDF abgeglichen.</p>
                {skipped.length > 0 && (
                  <p className="muted">Übersprungen, weil ohne Fundstelle im PDF: {skipped.map((s) => `${s.label} (${s.reason})`).join(', ')}</p>
                )}
              </div>
            ) : (
              stage &&
              current.parts.map((part, i) => (
                <LensRow
                  key={`${current.key}-${i}`}
                  part={part}
                  rows={rows}
                  pane={paneSize(stage, rows)}
                  doc={doc}
                  bytes={bytes}
                  edit={{
                    state: edit?.part === i ? edit : null,
                    start: () => startEdit(i),
                    change: (text) => putEdit({ part: i, text }),
                    // Klick ausserhalb übernimmt; nach Esc oder Enter ist editRef schon leer
                    blur: () => editRef.current?.part === i && commitEdit()
                  }}
                />
              ))
            )}
          </div>
        </div>
        <div className="lens-note">
          <span>{done ? 'Enter oder Ctrl+Enter markiert das Dokument als geprüft.' : stepNote(current)}</span>
        </div>
        <div className="lens-foot">
          <button className="btn" onClick={() => go(-1)} disabled={index === 0} title="Vorheriger Wert (←)">
            <ArrowLeft /> Zurück
          </button>
          {done ? (
            <>
              <div className="spacer" />
              <button className="btn" onClick={() => closeLens()} title="Linsenmodus schliessen (Esc)">
                Schliessen <span className="kbd">Esc</span>
              </button>
              <button className="btn btn-success lens-next" onClick={verifyAndNext} title="Als geprüft markieren und zum nächsten Dokument (Enter)">
                <CircleCheck /> Geprüft &amp; weiter <span className="kbd">↵</span>
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={correct} title="Linsenmodus schliessen und dieses Feld im Prüfmodus bearbeiten (K)">
                <Pencil /> Korrigieren <span className="kbd">K</span>
              </button>
              <div className="spacer" />
              <span className="lens-hint">Stimmt der Wert Zeichen für Zeichen?</span>
              <button className="btn btn-primary lens-next" onClick={() => go(1)} title="Wert stimmt – weiter (→ oder Enter)">
                Stimmt <ArrowRight /> <span className="kbd">↵</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
