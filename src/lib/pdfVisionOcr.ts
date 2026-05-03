import { invoke } from "@tauri-apps/api/core";
import { pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ollamaChatWithImages } from "./ollama";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function normalizeText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function bytesToUint8Array(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error("Nieprawidłowy format danych PDF.");
}

export type PdfPageImageOptions = {
  /** Skala PDF.js (domyślnie 1.6). */
  scale?: number;
  /** Po wyrenderowaniu — jeśli dłuższy bok przekracza limit, skaluje w dół (RAM / vision). */
  maxLongEdgePx?: number;
  mimeType?: "image/png" | "image/jpeg";
  /** 0–1, tylko dla JPEG (domyślnie 0.85). */
  jpegQuality?: number;
};

/** Domyślny podgląd strony do wizji (ostrzejszy PNG). */
export const PDF_PAGE_IMAGE_DEFAULT_OPTIONS = {
  scale: 1.6,
  mimeType: "image/png" as const,
} satisfies PdfPageImageOptions;

/**
 * Mniejszy, skompresowany JPEG + limit rozdzielczości — mniej RAM i mniejszy transfer do Ollamy.
 * Tryb „słabszego komputera” przy generowaniu testów (wizja).
 */
export const PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS: PdfPageImageOptions = {
  scale: 1.2,
  maxLongEdgePx: 1200,
  mimeType: "image/jpeg",
  jpegQuality: 0.84,
};

/**
 * Domyślny podgląd strony przy generowaniu testów z wizją — JPEG i limit dłuższego boku,
 * żeby paczka do Ollamy była mała, ale tekst na slajdzie nadal czytelny.
 */
export const PDF_PAGE_IMAGE_TEST_VISION_OPTIONS: PdfPageImageOptions = {
  scale: 1.35,
  maxLongEdgePx: 1400,
  mimeType: "image/jpeg",
  jpegQuality: 0.86,
};

async function renderPageToImageBase64(
  doc: pdfjs.PDFDocumentProxy,
  pageNumber: number,
  opts?: PdfPageImageOptions,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const baseScale = opts?.scale ?? PDF_PAGE_IMAGE_DEFAULT_OPTIONS.scale;
  let viewport = page.getViewport({ scale: baseScale });
  const maxEdge = opts?.maxLongEdgePx;
  if (maxEdge != null && maxEdge > 0) {
    const longest = Math.max(viewport.width, viewport.height);
    if (longest > maxEdge) {
      viewport = page.getViewport({ scale: baseScale * (maxEdge / longest) });
    }
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Brak canvas 2D.");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const mime = opts?.mimeType ?? "image/png";
  const dataUrl =
    mime === "image/jpeg"
      ? canvas.toDataURL("image/jpeg", opts?.jpegQuality ?? 0.85)
      : canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1] ?? "";
  if (!b64) throw new Error("Nie udało się wyrenderować obrazu strony.");
  return b64;
}

/**
 * Renderuje jedną stronę PDF do base64 (PNG lub JPEG, bez data-url prefix).
 * Przydatne do pytań „co jest na stronie N?” z vision modelem.
 */
export async function pdfPageToImageBase64(
  path: string,
  pageNumber: number,
  renderOptions?: PdfPageImageOptions,
): Promise<string> {
  const raw = await invoke<unknown>("read_file_bytes", { path });
  const bytes = bytesToUint8Array(raw);
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`Nieprawidłowy numer strony: ${pageNumber}.`);
  }
  return renderPageToImageBase64(doc, pageNumber, renderOptions);
}

/** Liczba stron w pliku PDF (ta sama ścieżka co przy renderze stron). */
export async function pdfGetPageCount(path: string): Promise<number> {
  const raw = await invoke<unknown>("read_file_bytes", { path });
  const bytes = bytesToUint8Array(raw);
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  return doc.numPages;
}

export type ImageCropPercent = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type OcrVisionOptions = {
  onProgress?: (current: number, total: number, pageNumber: number) => void;
  perPageTimeoutMs?: number;
  /** Domyślnie pełny PNG — ustaw np. PDF_PAGE_IMAGE_TEST_VISION_OPTIONS dla mniejszego JPEG. */
  renderOptions?: PdfPageImageOptions;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label}: timeout po ${ms} ms`)), ms);
    promise
      .then((value) => resolve(value))
      .catch((err) => reject(err))
      .finally(() => clearTimeout(id));
  });
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Zwraca wycinek obrazu (base64 PNG) wg współrzędnych procentowych. */
export async function cropImageBase64ByPercent(
  imageBase64: string,
  crop: ImageCropPercent,
): Promise<string> {
  const img = new Image();
  img.src = `data:image/png;base64,${imageBase64}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Nie udało się wczytać obrazu do cropa."));
  });
  const xPct = clampPercent(crop.x);
  const yPct = clampPercent(crop.y);
  const wPct = clampPercent(crop.w);
  const hPct = clampPercent(crop.h);
  const sx = Math.floor((xPct / 100) * img.width);
  const sy = Math.floor((yPct / 100) * img.height);
  const sw = Math.max(1, Math.floor((wPct / 100) * img.width));
  const sh = Math.max(1, Math.floor((hPct / 100) * img.height));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Brak canvas 2D dla cropa.");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const out = canvas.toDataURL("image/png").split(",")[1] ?? "";
  if (!out) throw new Error("Nie udało się przygotować cropa obrazu.");
  return out;
}

/**
 * OCR przez model vision z Ollama dla wskazanych stron PDF.
 * Zwraca mapę {numer_strony -> odczytany_tekst}.
 */
export async function ocrPdfPagesWithVision(
  path: string,
  model: string,
  pageNumbers: number[],
  options?: OcrVisionOptions,
): Promise<Map<number, string>> {
  if (pageNumbers.length === 0) return new Map();
  const perPageTimeoutMs = options?.perPageTimeoutMs ?? 45_000;
  const raw = await invoke<unknown>("read_file_bytes", { path });
  const bytes = bytesToUint8Array(raw);
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  const out = new Map<number, string>();

  for (let idx = 0; idx < pageNumbers.length; idx++) {
    const pageNumber = pageNumbers[idx]!;
    if (pageNumber < 1 || pageNumber > doc.numPages) continue;
    options?.onProgress?.(idx + 1, pageNumbers.length, pageNumber);
    const imageB64 = await renderPageToImageBase64(
      doc,
      pageNumber,
      options?.renderOptions,
    );
    const text = await withTimeout(
      ollamaChatWithImages(
        model,
        [
          {
            role: "system",
            content:
              "Jesteś silnikiem OCR. Przepisz dokładnie tekst z obrazu po polsku. Bez komentarzy, bez markdown, bez dopowiadania brakujących informacji.",
          },
          {
            role: "user",
            content:
              "Przepisz wyłącznie widoczny tekst z tej strony. Zachowaj liczby, skróty medyczne i nazwy własne.",
            images: [imageB64],
          },
        ],
        {
          temperature: 0.0,
          num_predict: 2048,
        },
      ),
      perPageTimeoutMs,
      `OCR strony ${pageNumber}`,
    );
    const normalized = normalizeText(text);
    if (normalized.length > 0) out.set(pageNumber, normalized);
  }

  return out;
}
