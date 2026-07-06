import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
// `?url` gives Vite a stable URL to the worker asset (bundled at build time,
// served from the dev server at runtime) — the recommended way to wire the
// pdf.js worker in Vite. Without this, pdf.js falls back to a CDN URL that
// may not match the version we've installed, causing subtle rendering bugs.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// Global one-time worker registration. Module-scope so it runs before any
// getDocument() call from anywhere in the app.
pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker;

/** Fetch the interior PDF once and expose its handle + page count. Callers
 *  render a specific page with {@link PdfPageCanvas}. */
export function usePdfDoc(url: string | null): {
  doc: PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  error: string | null;
} {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) {
      setDoc(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const task = pdfjs.getDocument(url);
        opened = await task.promise;
        if (cancelled) {
          opened.destroy();
          return;
        }
        setDoc(opened);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      opened?.destroy();
    };
  }, [url]);

  return { doc, numPages: doc?.numPages ?? 0, loading, error };
}

/** Render one page from a loaded PDF onto a canvas sized to its container.
 *  Uses devicePixelRatio for retina crispness. Cancels in-flight renders
 *  when props change or the component unmounts. */
export function PdfPageCanvas({
  doc,
  pageNumber,
  className,
}: {
  doc: PDFDocumentProxy | null;
  pageNumber: number;
  className?: string;
}): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    (async () => {
      try {
        setRendering(true);
        const page = await doc.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;

        // Fit the page inside the container preserving the PDF's own aspect
        // ratio. Scaling by min(width, height) ratio guarantees the canvas
        // fits without distortion regardless of whether the container is
        // square, tall, or wide relative to the PDF. Previously we scaled by
        // width alone and let CSS max-h-full cap the height, which visually
        // squashed 6×9 pages into a square container.
        const dpr = window.devicePixelRatio || 1;
        const wrapRect = wrap.getBoundingClientRect();
        const baseViewport = page.getViewport({ scale: 1 });
        const scaleByWidth = wrapRect.width / baseViewport.width;
        const scaleByHeight = wrapRect.height / baseViewport.height;
        const cssScale = Math.min(scaleByWidth, scaleByHeight);
        const viewport = page.getViewport({ scale: cssScale * dpr });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${baseViewport.width * cssScale}px`;
        canvas.style.height = `${baseViewport.height * cssScale}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) setRendering(false);
      } catch (err) {
        // pdf.js signals "we cancelled you" via a specific exception; ignore.
        const name = (err as { name?: string } | null)?.name;
        if (name !== "RenderingCancelledException") {
          // eslint-disable-next-line no-console
          console.error("pdf.js render failed:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber]);

  return (
    <div ref={wrapRef} className={`relative w-full h-full flex items-center justify-center ${className ?? ""}`}>
      <canvas ref={canvasRef} className="block" />
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#faf8f3]/80">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/** Rewrite an absolute interior-PDF URL to a same-origin path so the browser
 *  fetches through Vite's dev proxy (or Apache in prod) — no CORS
 *  preflight, no tunnel origin mismatch. */
export function toRelativePdfUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
