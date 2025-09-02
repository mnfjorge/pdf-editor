"use client";

import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Draggable from "react-draggable";

// Configure pdfjs worker (Next.js friendly, module worker)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Web Worker constructor available in browser and workerPort not in TS types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(GlobalWorkerOptions as any).workerPort = new Worker(
  // Use module worker from pdfjs-dist
  new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
  { type: "module" }
);

type TextItem = {
  id: string;
  text: string;
  x: number; // canvas px
  y: number; // canvas px from top
  size: number; // px
};

type PdfEditorProps = {
  pdfUrl: string;
};

export default function PdfEditor({ pdfUrl }: PdfEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pageViewport, setPageViewport] = useState<{ width: number; height: number } | null>(null);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [newText, setNewText] = useState("");

  // Render first page of PDF into canvas
  useEffect(() => {
    let cancelled = false;

    async function render() {
      const loadingTask = getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      setPageViewport({ width: canvas.width, height: canvas.height });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renderContext: any = {
        canvasContext: context,
        viewport,
      };
      if (!cancelled) {
        await page.render(renderContext).promise;
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, scale]);

  function handleAddText() {
    if (!pageViewport || !containerRef.current) return;
    const defaultX = pageViewport.width / 2 - 50;
    const defaultY = pageViewport.height / 2 - 10;
    setTextItems((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        text: newText || "Text",
        x: defaultX,
        y: defaultY,
        size: 16,
      },
    ]);
    setNewText("");
  }

  function updateItemPosition(id: string, x: number, y: number) {
    setTextItems((prev) => prev.map((t) => (t.id === id ? { ...t, x, y } : t)));
  }

  async function handleExport() {
    // Fetch original PDF
    const originalPdfBytes = await fetch(pdfUrl).then((r) => r.arrayBuffer());
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const page = pdfDoc.getPage(0);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Translate canvas coordinates (origin top-left) to PDF coords (origin bottom-left)
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    // Map from canvas pixels to pdf points using scale ratios
    const canvasWidth = pageViewport?.width || pageWidth;
    const canvasHeight = pageViewport?.height || pageHeight;
    const xRatio = pageWidth / canvasWidth;
    const yRatio = pageHeight / canvasHeight;

    for (const item of textItems) {
      const pdfX = item.x * xRatio;
      const pdfY = (canvasHeight - item.y) * yRatio; // invert Y
      page.drawText(item.text, {
        x: pdfX,
        y: pdfY,
        size: item.size,
        font,
        color: rgb(0, 0, 0),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const arrayBuffer = new ArrayBuffer(pdfBytes.length);
    const view = new Uint8Array(arrayBuffer);
    view.set(pdfBytes);
    const blob = new Blob([arrayBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filled.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="border rounded px-2 py-1 w-64"
          placeholder="Enter text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button
          className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50"
          onClick={handleAddText}
          disabled={!pageViewport}
        >
          Add text
        </button>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm">Zoom</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
          />
          <button
            className="bg-green-600 text-white px-3 py-1 rounded"
            onClick={handleExport}
          >
            Export filled PDF
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative border rounded overflow-hidden bg-white"
        style={{ width: pageViewport?.width, height: pageViewport?.height }}
      >
        <canvas ref={canvasRef} className="block" />
        {textItems.map((item) => (
          <Draggable
            key={item.id}
            bounds="parent"
            defaultPosition={{ x: item.x, y: item.y }}
            onStop={(_, data) => updateItemPosition(item.id, data.x, data.y)}
          >
            <div
              className="absolute select-none cursor-move bg-yellow-100 px-1 rounded"
              style={{ fontSize: item.size }}
            >
              {item.text}
            </div>
          </Draggable>
        ))}
      </div>
    </div>
  );
}

