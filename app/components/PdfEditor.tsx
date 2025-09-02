'use client';

import React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import Draggable from 'react-draggable';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Module-scope shared canvas for measuring text; avoids re-creating per render
let __autosizeMeasureCanvas: HTMLCanvasElement | null = null;

type OverlayItem = {
  id: string;
  text: string;
  x: number; // normalized 0..1 from left
  y: number; // normalized 0..1 from top
  fontSize: number; // in px for UI, in pt for export (approx)
  color: string; // CSS color string
};

type PageOverlays = Record<number, OverlayItem[]>;

// Configure PDF.js worker (local file served from /public)
GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

export default function PdfEditor() {
  const [uploading, setUploading] = React.useState(false);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [pdfArrayBuffer, setPdfArrayBuffer] = React.useState<ArrayBuffer | null>(null);
  const [exportArrayBuffer, setExportArrayBuffer] = React.useState<ArrayBuffer | null>(null);
  const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = React.useState(0);
  const [pageSizes, setPageSizes] = React.useState<{ width: number; height: number }[]>([]);
  const [overlays, setOverlays] = React.useState<PageOverlays>({});
  const [rendering, setRendering] = React.useState(false);

  const canvasRefs = React.useRef<HTMLCanvasElement[]>([]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  function getOverlaysStorageKey(url: string) {
    return `overlays:${encodeURIComponent(url)}`;
  }

  function setCanvasRef(index: number, el: HTMLCanvasElement | null) {
    if (el) {
      canvasRefs.current[index] = el;
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }
      const data = (await res.json()) as { url: string };
      setPdfUrl(data.url);
      const ab = await fetch(data.url).then(r => r.arrayBuffer());
      // Keep a rendering copy (may be consumed by pdf.js internals) and a separate immutable copy for export
      const renderCopy = ab.slice(0);
      const exportCopy = ab.slice(0);
      setPdfArrayBuffer(renderCopy);
      setExportArrayBuffer(exportCopy);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  // Reflect selected PDF in the URL (?file=...) for reloadability
  React.useEffect(() => {
    if (!pdfUrl) return;
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (current.get('file') !== pdfUrl) {
      current.set('file', pdfUrl);
      router.replace(`${pathname}?${current.toString()}`, { scroll: false });
    }
  }, [pdfUrl, pathname, router, searchParams]);

  // On initial load or when URL changes, load PDF from ?file=...
  React.useEffect(() => {
    const paramUrl = searchParams.get('file');
    if (!paramUrl) return;
    if (paramUrl === pdfUrl) return;
    (async () => {
      try {
        setPdfUrl(paramUrl);
        const ab = await fetch(paramUrl).then(r => r.arrayBuffer());
        setPdfArrayBuffer(ab);
      } catch (e) {
        console.error(e);
        alert('Failed to load PDF from URL');
      }
    })();
  }, [searchParams, pdfUrl]);

  // Restore overlays for current PDF from localStorage when pdfUrl changes
  React.useEffect(() => {
    if (!pdfUrl) return;
    try {
      const raw = localStorage.getItem(getOverlaysStorageKey(pdfUrl));
      if (raw) {
        const parsed = JSON.parse(raw) as PageOverlays;
        setOverlays(parsed);
      } else {
        setOverlays({});
      }
    } catch (e) {
      console.error(e);
      setOverlays({});
    }
  }, [pdfUrl]);

  // Persist overlays to localStorage keyed by current PDF URL
  React.useEffect(() => {
    if (!pdfUrl) return;
    try {
      localStorage.setItem(getOverlaysStorageKey(pdfUrl), JSON.stringify(overlays));
    } catch (e) {
      console.error(e);
    }
  }, [overlays, pdfUrl]);

  // Load and render PDF on canvas when pdfArrayBuffer changes
  React.useEffect(() => {
    let cancelled = false;
    async function loadAndRender() {
      if (!pdfArrayBuffer) return;
      setRendering(true);
      try {
        const loadingTask = getDocument({ data: pdfArrayBuffer });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);

        const sizes: { width: number; height: number }[] = [];

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({ width: viewport.width, height: viewport.height });
        }

        if (cancelled) return;
        setPageSizes(sizes);

        // Render pages sequentially to canvases
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const canvas = canvasRefs.current[i - 1];
          if (!canvas) continue;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        }
      } catch (e) {
        console.error(e);
        alert('Failed to render PDF');
      } finally {
        if (!cancelled) setRendering(false);
      }
    }
    loadAndRender();
    return () => {
      cancelled = true;
    };
  }, [pdfArrayBuffer]);

  function addTextOverlay(pageIndex: number) {
    const size = pageSizes[pageIndex];
    const newOverlay: OverlayItem = {
      id: crypto.randomUUID(),
      text: 'New Text',
      x: 0.5,
      y: 0.5,
      fontSize: Math.max(12, Math.min(24, size ? Math.round(size.width * 0.02) : 16)),
      color: '#111827',
    };
    setOverlays(prev => ({ ...prev, [pageIndex]: [...(prev[pageIndex] || []), newOverlay] }));
  }

  function updateOverlay(pageIndex: number, id: string, partial: Partial<OverlayItem>) {
    setOverlays(prev => ({
      ...prev,
      [pageIndex]: (prev[pageIndex] || []).map(o => (o.id === id ? { ...o, ...partial } : o)),
    }));
  }

  function removeOverlay(pageIndex: number, id: string) {
    setOverlays(prev => ({
      ...prev,
      [pageIndex]: (prev[pageIndex] || []).filter(o => o.id !== id),
    }));
  }

  async function handleExport() {
    if (!exportArrayBuffer) return;
    try {
      const pdfDocLib = await PDFDocument.load(exportArrayBuffer.slice(0));
      const font = await pdfDocLib.embedFont(StandardFonts.Helvetica);

      for (let i = 0; i < pdfDocLib.getPageCount(); i++) {
        const page = pdfDocLib.getPage(i);
        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();
        const pageOverlays = overlays[i] || [];

        for (const o of pageOverlays) {
          const textWidth = font.widthOfTextAtSize(o.text, o.fontSize);
          const xPdf = o.x * pageWidth;
          const yTop = o.y * pageHeight; // normalized from top
          const yPdf = pageHeight - yTop - o.fontSize; // convert top-origin to bottom-origin
          page.drawText(o.text, {
            x: xPdf,
            y: yPdf,
            size: o.fontSize,
            font,
            color: rgb(...cssColorToRgb01(o.color)),
          });
        }
      }

      const bytes = await pdfDocLib.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotated.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Failed to export PDF');
    }
  }

  function cssColorToRgb01(color: string): [number, number, number] {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return [0, 0, 0];
    ctx.fillStyle = color;
    const computed = ctx.fillStyle as string;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed);
    if (!m) return [0, 0, 0];
    const r = Math.min(255, Math.max(0, parseInt(m[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(m[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(m[3], 10)));
    return [r / 255, g / 255, b / 255];
  }

  // Shared canvas for accurate text width measurement (module-scoped above)

  function AutosizeInput(props: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
    style?: React.CSSProperties;
    minWidth?: number;
  }) {
    const { value, onChange, className, style, minWidth = 20 } = props;
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [width, setWidth] = React.useState<number>(minWidth);

    React.useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const canvas = __autosizeMeasureCanvas || (__autosizeMeasureCanvas = document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Include line-height to satisfy full font shorthand
      const fontShorthand = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`;
      ctx.font = fontShorthand;
      const metrics = ctx.measureText(value || ' ');
      const paddingLeft = parseFloat(cs.paddingLeft || '0');
      const paddingRight = parseFloat(cs.paddingRight || '0');
      const borderLeft = parseFloat(cs.borderLeftWidth || '0');
      const borderRight = parseFloat(cs.borderRightWidth || '0');
      const computedWidth = Math.ceil(metrics.width + paddingLeft + paddingRight + borderLeft + borderRight + 1);
      setWidth(Math.max(minWidth, computedWidth));
    }, [value, minWidth, style?.fontSize, style?.fontFamily, style?.fontWeight]);

    return (
      <input
        ref={inputRef}
        className={className}
        value={value}
        onChange={onChange}
        style={{ ...style, width, whiteSpace: 'nowrap' }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.preventDefault();
        }}
      />
    );
  }

  return (
    <div className="px-4 py-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
            <input type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />
            {uploading ? 'Uploading…' : pdfUrl ? 'Replace PDF' : 'Upload PDF'}
          </label>
          {pdfUrl ? (
            <span className="text-sm text-gray-600 truncate max-w-xs">{pdfUrl}</span>
          ) : (
            <span className="text-sm text-gray-500">Upload a single PDF to begin</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={!pdfArrayBuffer}
            className="px-4 py-2 rounded-md bg-emerald-600 text-white disabled:opacity-50 hover:bg-emerald-700"
          >
            Export PDF
          </button>
        </div>
      </div>

      {rendering && (
        <div className="text-sm text-gray-600">Rendering PDF…</div>
      )}

      {pdfDoc && (
        <div className="space-y-8">
          {Array.from({ length: numPages }).map((_, i) => {
            const pageIndex = i;
            const size = pageSizes[pageIndex] || { width: 595, height: 842 };
            const pageOverlays = overlays[pageIndex] || [];
            return (
              <div key={pageIndex} className="border rounded-md shadow-sm bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                  <div className="text-sm font-medium">Page {pageIndex + 1}</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addTextOverlay(pageIndex)}
                      className="px-3 py-1.5 rounded-md bg-slate-700 text-white hover:bg-slate-800 text-sm"
                    >
                      Add text
                    </button>
                  </div>
                </div>
                <div className="relative overflow-auto p-4">
                  <div className="relative mx-auto" style={{ width: size.width, height: size.height }}>
                    <canvas ref={el => setCanvasRef(pageIndex, el)} className="block" />
                    {/* Overlays */}
                    {pageOverlays.map(o => {
                      const left = o.x * size.width;
                      const top = o.y * size.height;
                      return (
                        <Draggable
                          key={o.id}
                          defaultPosition={{ x: left, y: top }}
                          bounds="parent"
                          onStop={(e, data) => {
                            const newX = Math.min(1, Math.max(0, data.x / size.width));
                            const newY = Math.min(1, Math.max(0, data.y / size.height));
                            updateOverlay(pageIndex, o.id, { x: newX, y: newY });
                          }}
                          cancel="input,textarea,select,button"
                        >
                          <div className="absolute">
                            <div className="group rounded px-2 py-1 bg-transparent border border-transparent hover:border-slate-300 cursor-move">
                              {/* Single autosizing input (no wrapping, grows with content) */}
                              <AutosizeInput
                                className="bg-transparent outline-none text-gray-900"
                                value={o.text}
                                onChange={e => updateOverlay(pageIndex, o.id, { text: e.target.value })}
                                style={{ fontSize: o.fontSize, color: o.color }}
                                minWidth={40}
                              />
                              <div className="hidden group-hover:flex items-center gap-2 pt-1 text-xs text-gray-600">
                                <input
                                  type="color"
                                  value={o.color}
                                  onChange={e => updateOverlay(pageIndex, o.id, { color: e.target.value })}
                                />
                                <input
                                  type="range"
                                  min={8}
                                  max={72}
                                  step={1}
                                  value={o.fontSize}
                                  onChange={e => updateOverlay(pageIndex, o.id, { fontSize: parseInt(e.target.value, 10) })}
                                />
                                <button
                                  className="px-2 py-0.5 rounded bg-red-600 text-white"
                                  onClick={() => removeOverlay(pageIndex, o.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        </Draggable>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

