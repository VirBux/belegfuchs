import { LoaderCircle, Maximize2, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Box, DocMeta, PageData } from '../../../shared/types';
import { getPdf } from '../lib/pdf';
import { toast, useStore, type ActiveTarget } from '../store';
import { cls } from './ui';

export interface Highlight {
  key: string;
  box: Box;
  color: string;
  label: string;
  tag: string;
  target: ActiveTarget;
  emph: boolean;
  dim: boolean;
}

interface ViewerProps {
  doc: DocMeta;
  bytes: Uint8Array;
  highlights: Highlight[];
  /** Farbe des aktiven Feldes – gesetzt = Zuordnungsmodus. */
  assignColor: string | null;
  busy: string | null;
  preview: (page: number, word: number) => Box[];
  onPickWord: (page: number, word: number, append: boolean) => void;
  onBox: (box: Box) => void;
  onMiss: () => void;
  onHighlightClick: (t: ActiveTarget) => void;
  note?: ReactNode;
}

const CSS_PX_PER_PT = 96 / 72;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function pct(b: { x: number; y: number; w: number; h: number }, pad = 0): CSSProperties {
  return {
    left: `calc(${b.x * 100}% - ${pad}px)`,
    top: `calc(${b.y * 100}% - ${pad}px)`,
    width: `calc(${b.w * 100}% + ${pad * 2}px)`,
    height: `calc(${b.h * 100}% + ${pad * 2}px)`
  };
}

const sameBox = (a: Box, b: Box) => a.page === b.page && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

interface PageProps {
  pdf: PDFDocumentProxy;
  index: number;
  w: number;
  h: number;
  scale: number;
  pageData?: PageData;
  highlights: Highlight[];
  assignColor: string | null;
  showPlaceholders: boolean;
  showLabels: boolean;
  flashBox: Box | null;
  preview: (page: number, word: number) => Box[];
  onPickWord: (page: number, word: number, append: boolean) => void;
  onBox: (box: Box) => void;
  onMiss: () => void;
  onHighlightClick: (t: ActiveTarget) => void;
}

const PdfPage = memo(function PdfPage(props: PageProps) {
  const { pdf, index, w, h, scale, pageData, assignColor } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(index < 2);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Box | null>(null);
  const downRef = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const assign = assignColor !== null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const page = await pdf.getPage(index + 1);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      let renderScale = scale * dpr;
      const base = page.getViewport({ scale: 1 });
      // Sehr grosse Leinwände begrenzen (Speicher)
      const maxPixels = 18e6;
      if (base.width * base.height * renderScale * renderScale > maxPixels) renderScale = Math.sqrt(maxPixels / (base.width * base.height));
      const viewport = page.getViewport({ scale: renderScale });
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = page.render({ canvas: off, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d')!.drawImage(off, 0, 0);
      setReady(true);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, index, scale, visible]);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  const hit = (x: number, y: number): number | null => {
    if (!pageData) return null;
    let best: number | null = null;
    let bestArea = Infinity;
    const padX = 3 / w;
    const padY = 3 / h;
    pageData.words.forEach((wd, i) => {
      if (x >= wd.x - padX && x <= wd.x + wd.w + padX && y >= wd.y - padY && y <= wd.y + wd.h + padY) {
        const area = wd.w * wd.h;
        if (area < bestArea) {
          best = i;
          bestArea = area;
        }
      }
    });
    return best;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!assign || e.button !== 0) return;
    e.preventDefault();
    const p = toNorm(e);
    downRef.current = { ...p, cx: e.clientX, cy: e.clientY, moved: false };
    const rectFrom = (q: { x: number; y: number }, d: { x: number; y: number }): Box => ({
      page: index,
      x: Math.min(d.x, q.x),
      y: Math.min(d.y, q.y),
      w: Math.abs(q.x - d.x),
      h: Math.abs(q.y - d.y)
    });
    const onMove = (ev: MouseEvent) => {
      const d = downRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) < 5) return;
      d.moved = true;
      setHover(null);
      setDrag(rectFrom(toNorm(ev), d));
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const d = downRef.current;
      downRef.current = null;
      if (!d) return;
      if (d.moved) {
        const box = rectFrom(toNorm(ev), d);
        setDrag(null);
        if (box.w * w > 6 && box.h * h > 5) props.onBox(box);
      } else {
        const idx = hit(d.x, d.y);
        if (idx !== null) props.onPickWord(index, idx, ev.ctrlKey || ev.metaKey);
        else props.onMiss();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!assign || downRef.current) return;
    const p = toNorm(e);
    setHover(hit(p.x, p.y));
  };

  const { preview } = props;
  const previewBoxes = useMemo(() => (assign && hover !== null ? preview(index, hover) : []), [assign, hover, preview, index]);

  return (
    <div ref={wrapRef} className="pdf-page" data-page={index} style={{ width: w, height: h }}>
      <canvas ref={canvasRef} style={{ width: w, height: h }} />
      {!ready && (
        <div className="page-loading">
          <LoaderCircle className="spin" />
        </div>
      )}
      <div
        className={cls('pdf-overlay', assign && 'assign', props.showLabels && 'labels')}
        style={assignColor ? ({ ['--c' as string]: assignColor } as CSSProperties) : undefined}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {assign && props.showPlaceholders && pageData?.words.map((wd, i) => <div key={i} className="ph" style={pct(wd, 1)} />)}
        {props.highlights.map((hl) => (
          <div
            key={hl.key}
            className={cls('hl', hl.target.kind === 'positions' && 'pos', hl.emph && 'emph', hl.dim && 'dim', props.flashBox && sameBox(props.flashBox, hl.box) && 'flash')}
            style={{ ...pct(hl.box, 2), ['--c' as string]: hl.color }}
            title={hl.label}
            onClick={(e) => {
              e.stopPropagation();
              props.onHighlightClick(hl.target);
            }}
          >
            <span className="hl-tag">{hl.tag}</span>
          </div>
        ))}
        {previewBoxes.map((b, i) => (
          <div key={`pv${i}`} className="ph hover" style={pct(b, 2)} />
        ))}
        {drag && <div className="drag-rect" style={pct(drag)} />}
      </div>
    </div>
  );
});

export function PdfViewer(props: ViewerProps) {
  const { doc, bytes } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [zoom, setZoom] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const [page, setPage] = useState(1);
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem('bf.labels') === '1');
  const [flashBox, setFlashBox] = useState<Box | null>(null);
  const reveal = useStore((s) => s.reveal);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setSizes([]);
    void getPdf(doc.id, bytes)
      .then(async (p) => {
        const list: { w: number; h: number }[] = [];
        for (let i = 1; i <= p.numPages; i++) {
          const vp = (await p.getPage(i)).getViewport({ scale: 1 });
          list.push({ w: vp.width, h: vp.height });
        }
        if (!cancelled) {
          setPdf(p);
          setSizes(list);
        }
      })
      .catch((err) => toast('error', `PDF kann nicht angezeigt werden: ${err instanceof Error ? err.message : err}`));
    return () => {
      cancelled = true;
    };
  }, [doc.id, bytes]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = Math.max(1, ...sizes.map((s) => s.w));
  const fitScale = Math.max(0.2, (width - 44) / maxW);
  const scale = zoom ?? fitScale;

  // Ctrl + Mausrad zoomt (nicht-passiver Listener nötig)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clamp((z ?? fitScale) * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.3, 6));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fitScale]);

  // Fundstelle ansteuern
  useEffect(() => {
    if (!reveal || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-page="${reveal.box.page}"]`);
    if (!el) return;
    const top = el.offsetTop + reveal.box.y * el.offsetHeight - scrollRef.current.clientHeight * 0.35;
    const left = el.offsetLeft + reveal.box.x * el.offsetWidth - scrollRef.current.clientWidth * 0.3;
    scrollRef.current.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });
    setFlashBox(reveal.box);
    const t = setTimeout(() => setFlashBox(null), 1500);
    return () => clearTimeout(t);
  }, [reveal]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const pages = el.querySelectorAll<HTMLElement>('[data-page]');
    const mid = el.scrollTop + el.clientHeight / 3;
    let current = 1;
    pages.forEach((p, i) => {
      if (p.offsetTop <= mid) current = i + 1;
    });
    setPage(current);
  };

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of props.highlights) map.set(h.box.page, [...(map.get(h.box.page) ?? []), h]);
    return map;
  }, [props.highlights]);

  const zoomBy = (f: number) => setZoom(clamp(scale * f, 0.3, 6));

  return (
    <div className="pdf-pane">
      <div className="pdf-toolbar">
        <span>
          Seite {page} / {sizes.length || '–'}
        </span>
        <div className="spacer" />
        <label className="toggle" title="Feldnamen an allen Markierungen anzeigen (sonst beim Darüberfahren)">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => {
              setShowLabels(e.target.checked);
              localStorage.setItem('bf.labels', e.target.checked ? '1' : '0');
            }}
          />
          Beschriftungen
        </label>
        {props.assignColor && (
          <label className="toggle" title="Erkannte Wörter als auswählbare Platzhalter umranden">
            <input type="checkbox" checked={showPlaceholders} onChange={(e) => setShowPlaceholders(e.target.checked)} />
            Platzhalter zeigen
          </label>
        )}
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => zoomBy(1 / 1.2)} title="Verkleinern">
          <Minus />
        </button>
        <span className="zoom-val">{Math.round((scale / CSS_PX_PER_PT) * 100)} %</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => zoomBy(1.2)} title="Vergrössern (Ctrl + Mausrad)">
          <Plus />
        </button>
        <button className={cls('btn btn-ghost btn-icon btn-sm', zoom === null && 'on')} onClick={() => setZoom(null)} title="An Breite anpassen">
          <Maximize2 />
        </button>
      </div>
      <div className="pdf-scroll" ref={scrollRef} onScroll={onScroll}>
        {props.note}
        <div className="pdf-pages">
          {pdf ? (
            sizes.map((s, i) => (
              <PdfPage
                key={`${doc.id}-${i}`}
                pdf={pdf}
                index={i}
                w={s.w * scale}
                h={s.h * scale}
                scale={scale}
                pageData={doc.pages.find((p) => p.index === i)}
                highlights={highlightsByPage.get(i) ?? []}
                assignColor={props.assignColor}
                showPlaceholders={showPlaceholders}
                showLabels={showLabels}
                flashBox={flashBox}
                preview={props.preview}
                onPickWord={props.onPickWord}
                onBox={props.onBox}
                onMiss={props.onMiss}
                onHighlightClick={props.onHighlightClick}
              />
            ))
          ) : (
            <div style={{ padding: 60 }}>
              <LoaderCircle className="spin" />
            </div>
          )}
        </div>
      </div>
      {props.busy && (
        <div className="pdf-busy">
          <span>
            <LoaderCircle size={15} className="spin" /> {props.busy}
          </span>
        </div>
      )}
    </div>
  );
}
