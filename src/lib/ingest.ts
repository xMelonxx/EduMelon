import { invoke } from "@tauri-apps/api/core";
import {
  getSubjectFolder,
  insertChunks,
  insertPresentation,
  type ChunkRow,
} from "./db";
import { MODEL_PROFILES } from "./constants";
import { ocrPdfPagesWithVision } from "./pdfVisionOcr";
import { chunkPlainText, embedText } from "./rag";
import { loadLocalProfile } from "./storage";

type SlideChunk = { slide_index: number; text: string };
const OCR_VISION_MIN_TEXT_CHARS_PER_PAGE = 90;
const OCR_VISION_MAX_PAGES = 8;

export type IngestProgress = {
  label: string;
  percent: number;
};

type IngestOptions = {
  onProgress?: (p: IngestProgress) => void;
};

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function countMeaningfulChars(s: string): number {
  return normalizeSpaces(s).length;
}

function buildImageOnlyHint(kind: "pdf" | "pptx"): string {
  const label = kind === "pdf" ? "PDF" : "PPTX";
  const ocrNote =
    kind === "pdf"
      ? "Dla PDF aplikacja próbuje też OCR (vision) na stronach obrazowych, ale to zależy od lokalnego modelu i jakości obrazu."
      : "Dla PPTX (na ten moment) odczyt działa tylko z warstwy tekstowej slajdów.";
  return (
    `Wykryto bardzo mało tekstu w pliku ${label}. ` +
    "Materiał wygląda na slajdy/skany jako obrazy, których parser tekstu nie odczytuje. " +
    `${ocrNote} Użyj wersji z warstwą tekstową albo wykonaj OCR pliku przed importem.`
  );
}

export async function ingestFileFromPath(
  path: string,
  title: string,
  folderId: string | null,
  options?: IngestOptions,
): Promise<string> {
  const report = (label: string, percent: number) =>
    options?.onProgress?.({ label, percent: Math.min(100, Math.max(0, percent)) });

  report("Przygotowuję import pliku…", 2);
  let subjectLabel: string | null = null;
  if (folderId) {
    const folder = await getSubjectFolder(folderId);
    subjectLabel = folder?.name ?? null;
  }
  const lower = path.toLowerCase();
  let kind: "pdf" | "pptx";
  let slideChunks: SlideChunk[] = [];
  let pdfText = "";

  if (lower.endsWith(".pptx")) {
    kind = "pptx";
    report("Wyciągam tekst ze slajdów PPTX…", 14);
    slideChunks = await invoke<SlideChunk[]>("extract_pptx_slides", { path });
  } else if (lower.endsWith(".pdf")) {
    kind = "pdf";
    report("Czytam tekst z PDF…", 10);
    pdfText = await invoke<string>("extract_pdf_text", { path });
    report("Rozpoznaję strony PDF…", 16);
    slideChunks = await invoke<SlideChunk[]>("extract_pdf_pages_text", { path });
    // OCR vision fallback: strony z małą ilością tekstu (np. skan/obraz slajdu).
    try {
      const profile = loadLocalProfile();
      const model =
        profile?.modelProfile
          ? MODEL_PROFILES[profile.modelProfile].ollamaTag
          : MODEL_PROFILES["e2b-it"].ollamaTag;
      const pagesToOcr = slideChunks
        .filter((s) => countMeaningfulChars(s.text) < OCR_VISION_MIN_TEXT_CHARS_PER_PAGE)
        .map((s) => s.slide_index)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .slice(0, OCR_VISION_MAX_PAGES);
      if (pagesToOcr.length > 0) {
        report(
          `Uruchamiam OCR obrazów (${pagesToOcr.length} stron)…`,
          24,
        );
        const ocrByPage = await ocrPdfPagesWithVision(path, model, pagesToOcr);
        if (ocrByPage.size > 0) {
          slideChunks = slideChunks.map((s) => {
            const ocr = ocrByPage.get(s.slide_index);
            if (!ocr) return s;
            const merged = normalizeSpaces([s.text, ocr].filter(Boolean).join(" "));
            return { ...s, text: merged };
          });
        }
      }
    } catch {
      // OCR to fallback best-effort; nie przerywamy importu gdy vision jest niedostępne.
    }
  } else {
    throw new Error("Obsługiwane są pliki PDF i PPTX.");
  }

  report("Przygotowuję fragmenty do indeksu…", 34);
  const extractedChars =
    kind === "pdf"
      ? countMeaningfulChars(
          slideChunks.map((s) => s.text).join(" ") || pdfText || "",
        )
      : countMeaningfulChars(slideChunks.map((s) => s.text).join(" "));
  const extractedSlides = slideChunks.filter((s) => countMeaningfulChars(s.text) > 0).length;
  const looksLikeImageOnly =
    (kind === "pdf" && extractedChars < 220) ||
    (kind === "pptx" && extractedSlides === 0 && extractedChars < 120);
  if (looksLikeImageOnly) {
    throw new Error(buildImageOnlyHint(kind));
  }

  const preview =
    kind === "pptx"
      ? normalizeSpaces(slideChunks.map((s) => s.text).join("\n")).slice(0, 500)
      : normalizeSpaces((pdfText || slideChunks.map((s) => s.text).join("\n")).trim()).slice(
          0,
          500,
        );

  report("Zapisuję metadane materiału…", 42);
  const presId = await insertPresentation({
    title,
    subject: subjectLabel,
    folder_id: folderId,
    file_path: path,
    source_kind: kind,
    raw_text_preview: preview,
  });

  const chunkRows: Omit<ChunkRow, "embedding">[] = [];

  if (kind === "pptx") {
    for (const s of slideChunks) {
      chunkRows.push({
        id: crypto.randomUUID(),
        presentation_id: presId,
        slide_index: s.slide_index,
        body: `Slajd ${s.slide_index}:\n${s.text}`,
      });
    }
  } else {
    if (slideChunks.length > 0) {
      for (const s of slideChunks) {
        const pageBody = s.text.trim();
        if (!pageBody) continue;
        const parts = chunkPlainText(pageBody);
        if (parts.length === 0) {
          chunkRows.push({
            id: crypto.randomUUID(),
            presentation_id: presId,
            slide_index: s.slide_index,
            body: `Strona ${s.slide_index}:\n${pageBody}`,
          });
        } else {
          for (const part of parts) {
            chunkRows.push({
              id: crypto.randomUUID(),
              presentation_id: presId,
              slide_index: s.slide_index,
              body: `Strona ${s.slide_index}:\n${part}`,
            });
          }
        }
      }
    } else {
      const parts = chunkPlainText(pdfText);
      parts.forEach((body, i) => {
        chunkRows.push({
          id: crypto.randomUUID(),
          presentation_id: presId,
          slide_index: i + 1,
          body: `Strona ${i + 1}:\n${body}`,
        });
      });
    }
  }

  report("Tworzę embeddingi lokalnie (Ollama)…", 50);
  const withEmb: ChunkRow[] = [];
  const total = Math.max(1, chunkRows.length);
  for (const c of chunkRows) {
    const emb = await embedText(c.body);
    withEmb.push({
      ...c,
      embedding: JSON.stringify(emb),
    });
    const pct = 50 + Math.round((withEmb.length / total) * 45);
    report(`Embeddingi: ${withEmb.length}/${total}`, pct);
  }

  report("Zapisuję fragmenty w bazie…", 97);
  await insertChunks(withEmb);
  report("Gotowe.", 100);
  return presId;
}
