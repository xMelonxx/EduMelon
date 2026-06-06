import { invoke } from "@tauri-apps/api/core";
import {
  deletePresentationWithChunks,
  getSubjectFolder,
  insertChunks,
  insertPresentation,
  type ChunkRow,
} from "./db";
import { chunkPlainText, embedTexts } from "./rag";
import { getAiProviderId } from "./storage";

type SlideChunk = { slide_index: number; text: string };

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
      ? "Skany i slajdy graficzne możesz potem przeanalizować przy generowaniu testów (wizja strony); do importu potrzebna jest minimalna warstwa tekstowa."
      : "Dla PPTX odczyt działa z warstwy tekstowej slajdów.";
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
    /** Ciężkie OCR/wizja przy imporcie celowo wyłączone — wystarczy warstwa tekstowa PDF do podglądu/RAG; skany i grafiki obsługiwane przy generowaniu testów. */
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

  try {
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

    if (chunkRows.length === 0) {
      throw new Error(
        "Nie udało się przygotować fragmentów tekstu do indeksu. Sprawdź, czy plik ma warstwę tekstową.",
      );
    }

    const provider = getAiProviderId();
    const embedLabel =
      provider === "gemini"
        ? "Indeksuję treść (Gemini)…"
        : "Tworzę embeddingi lokalnie (Ollama)…";
    report(embedLabel, 50);

    const bodies = chunkRows.map((c) => c.body);
    const embeddings = await embedTexts(bodies, (done, total) => {
      const pct = 50 + Math.round((done / Math.max(1, total)) * 45);
      report(`Indeks: ${done}/${total}`, pct);
    });

    if (embeddings.length !== chunkRows.length) {
      throw new Error(
        `Indeksowanie przerwane: oczekiwano ${chunkRows.length} wektorów, otrzymano ${embeddings.length}.`,
      );
    }

    const withEmb: ChunkRow[] = chunkRows.map((c, i) => ({
      ...c,
      embedding: JSON.stringify(embeddings[i]),
      embedding_provider: provider,
    }));

    report("Zapisuję fragmenty w bazie…", 97);
    await insertChunks(withEmb);
    report("Gotowe.", 100);
    return presId;
  } catch (e) {
    await deletePresentationWithChunks(presId).catch(() => undefined);
    throw e;
  }
}
