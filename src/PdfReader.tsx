import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { LoaderCircle, FileWarning } from "lucide-react";
import { messageOf } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({
  bookId,
  page,
  zoom,
  onPageCount,
}: {
  bookId: string;
  page: number;
  zoom: number;
  onPageCount: (count: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const pageRoot = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(700);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const countCallback = useRef(onPageCount);
  countCallback.current = onPageCount;

  useEffect(() => {
    let active = true;
    setDocument(null);
    setError("");
    setLoading(true);
    const task = getDocument({
      url: `/api/books/${encodeURIComponent(bookId)}/file`,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    });
    task.promise
      .then((pdf) => {
        if (active) {
          setDocument(pdf);
          countCallback.current(pdf.numPages);
        }
      })
      .catch((error) => {
        if (active) {
          setError(messageOf(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [bookId]);

  useEffect(() => {
    if (!holder.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width)),
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !pageRoot.current) return;
    let active = true;
    let render: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    const root = pageRoot.current;
    setLoading(true);
    setError("");
    root.replaceChildren();
    document
      .getPage(Math.min(Math.max(page, 1), document.numPages))
      .then(async (pdfPage) => {
        if (!active) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 1.5) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = window.document.createElement("canvas");
        const layer = window.document.createElement("div");
        layer.className = "textLayer";
        layer.style.setProperty("--scale-factor", String(scale));
        layer.style.setProperty("--total-scale-factor", String(scale));
        root.style.width = `${viewport.width}px`;
        root.style.height = `${viewport.height}px`;
        const resolution = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * resolution);
        canvas.height = Math.floor(viewport.height * resolution);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        root.append(canvas, layer);
        render = pdfPage.render({
          canvas,
          viewport,
          transform:
            resolution === 1 ? undefined : [resolution, 0, 0, resolution, 0, 0],
        });
        await render.promise;
        if (!active) return;
        const text = await pdfPage.getTextContent();
        if (!active) return;
        textLayer = new TextLayer({
          textContentSource: text,
          container: layer,
          viewport,
        });
        await textLayer.render();
        if (active) setLoading(false);
      })
      .catch((error) => {
        if (
          active &&
          error?.name !== "RenderingCancelledException" &&
          error?.name !== "AbortException"
        ) {
          setError(messageOf(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [document, page, width, zoom]);

  return (
    <div className="pdf-holder" ref={holder}>
      {loading && (
        <div className="pdf-loading" role="status">
          <LoaderCircle className="spin" size={18} /> 正在呈现这一页…
        </div>
      )}
      {error && (
        <div className="reader-error" role="alert">
          <FileWarning size={24} />
          <p>无法显示 PDF</p>
          <small>{error}</small>
        </div>
      )}
      <div className="pdf-page" ref={pageRoot} />
    </div>
  );
}
