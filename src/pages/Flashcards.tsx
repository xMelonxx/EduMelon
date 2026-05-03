import { useEffect, useState } from "react";
import type { FlashcardGenProgress } from "../lib/flashcardsOllama";
import { Link, useParams } from "react-router-dom";
import {
  getPresentation,
  listChunksForPresentation,
  listFlashcards,
  insertFlashcards,
  deleteFlashcardsForPresentation,
  updateFlashcardProgress,
} from "../lib/db";
import { MODEL_PROFILES } from "../lib/constants";
import { generateFlashcardsFromMaterial } from "../lib/flashcardsOllama";
import {
  ocrPdfPagesWithVision,
  PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
} from "../lib/pdfVisionOcr";
import { loadLocalProfile } from "../lib/storage";
import { downloadQuizletTsv } from "../lib/exportCsv";
import type { ChunkRow, FlashcardRow } from "../lib/db";

/** Strony z mniej tekstu niż ten próg dostają OCR przy generowaniu fiszek (bez limitu liczby stron). */
const FLASHCARD_OCR_PAGE_TEXT_MIN = 160;

function normalizeSpaces(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function chunkMeaningfulLen(body: string): number {
  return normalizeSpaces(body.replace(/^Strona\s+\d+:\s*/i, "")).length;
}

function mergeImageOcrIntoChunks(
  chunks: ChunkRow[],
  ocrByPage: Map<number, string>,
): ChunkRow[] {
  if (ocrByPage.size === 0) return chunks;
  return chunks.map((c) => {
    const page = c.slide_index ?? 0;
    const ocr = page > 0 ? ocrByPage.get(page) : undefined;
    if (!ocr) return c;
    const merged = normalizeSpaces(
      `${c.body}\n\n[Treść z obrazu strony]\n${ocr}`,
    );
    return { ...c, body: merged };
  });
}

export function Flashcards() {
  const { id } = useParams<{ id: string }>();
  const profile = loadLocalProfile();
  const [title, setTitle] = useState("");
  const [subjectLabel, setSubjectLabel] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<string>("");
  const [count, setCount] = useState(10);
  const [detail, setDetail] = useState<"short" | "medium" | "long">("medium");
  const [cards, setCards] = useState<FlashcardRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<FlashcardGenProgress | null>(
    null,
  );
  const [genElapsedSec, setGenElapsedSec] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);

  const load = async () => {
    if (!id) return;
    const p = await getPresentation(id);
    if (p) {
      setTitle(p.title);
      setSubjectLabel(p.subject ?? "");
      setFilePath(p.file_path);
      setSourceKind(p.source_kind);
    }
    setCards(await listFlashcards(id));
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (!busy || !genProgress) return;
    const t = setInterval(() => {
      setGenElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [busy, genProgress]);

  const removeAllFlashcards = async () => {
    if (!id || cards.length === 0) return;
    if (
      !confirm(
        "Usunąć wszystkie fiszki tego zestawu? Tej operacji nie można cofnąć.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteFlashcardsForPresentation(id);
      await load();
      setIdx(0);
      setShowBack(false);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!id || !profile) return;
    setBusy(true);
    setGenError(null);
    setGenElapsedSec(0);
    setGenProgress({ label: "Ładuję fragmenty materiału…", percent: 1 });
    try {
      const chunks = await listChunksForPresentation(id);
      const model = MODEL_PROFILES[profile.modelProfile].ollamaTag;
      let effectiveChunks = chunks;
      if (sourceKind.toLowerCase() === "pdf" && filePath) {
        const pagesToOcr = chunks
          .filter(
            (c) =>
              (c.slide_index ?? 0) > 0 &&
              chunkMeaningfulLen(c.body) < FLASHCARD_OCR_PAGE_TEXT_MIN,
          )
          .map((c) => c.slide_index ?? 0)
          .filter((p, i, arr) => p > 0 && arr.indexOf(p) === i);
        if (pagesToOcr.length > 0) {
          setGenProgress({
            label: `OCR stron PDF (${pagesToOcr.length}) przed fiszkami…`,
            percent: 6,
          });
          try {
            const ocrByPage = await ocrPdfPagesWithVision(
              filePath,
              model,
              pagesToOcr,
              {
                renderOptions: PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
                onProgress: (current, total, pageNumber) => {
                  setGenProgress({
                    label: `OCR fiszki: strona ${pageNumber} (${current}/${total})…`,
                    percent: 6 + Math.round((current / Math.max(1, total)) * 12),
                  });
                },
              },
            );
            effectiveChunks = mergeImageOcrIntoChunks(chunks, ocrByPage);
          } catch {
            // OCR opcjonalny — przy błędzie generujemy z samych chunków.
          }
        }
      }
      const context = effectiveChunks
        .map((c) => c.body)
        .join("\n\n")
        .slice(0, 20000);
      const parsed = await generateFlashcardsFromMaterial(
        model,
        context,
        count,
        detail,
        (p) => setGenProgress(p),
        { chunkRows: effectiveChunks },
      );
      setGenProgress({ label: "Zapisuję fiszki lokalnie…", percent: 100 });
      await deleteFlashcardsForPresentation(id);
      const rows = parsed.map((x) => ({
        id: crypto.randomUUID(),
        presentation_id: id,
        front: x.front,
        back: x.back,
      }));
      await insertFlashcards(rows);
      await load();
      setIdx(0);
      setShowBack(false);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setGenProgress(null);
    }
  };

  const current = cards[idx];
  const known = cards.filter((c) => c.repetitions > 0).length;
  const meterPct = cards.length
    ? Math.min(100, (known / cards.length) * 100)
    : 0;
  const positionPct = cards.length ? ((idx + 1) / cards.length) * 100 : 0;

  if (!id) {
    return (
      <p className="p-8 text-on-surface-variant">
        Brak identyfikatora zestawu.
      </p>
    );
  }

  return (
    <div className="relative flex flex-col items-center p-4 md:p-10 min-h-[calc(100vh-4rem)]">
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-secondary-container/30 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary-container/20 rounded-full blur-3xl -z-10 pointer-events-none" />

      <div className="w-full max-w-4xl flex flex-col gap-8 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <Link
              to="/app/flashcards"
              className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1 mb-2"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
              Wszystkie zestawy
            </Link>
            <span className="block text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant/70">
              {subjectLabel || "Materiał"} · Flashcards Mode
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-surface mt-1">
              {title || "Fiszki"}
            </h2>
          </div>
          <div className="text-right">
            <span className="text-3xl font-black text-primary">{idx + 1}</span>
            <span className="text-xl font-bold text-on-surface-variant/40">
              {" "}
              / {Math.max(cards.length, 1)}
            </span>
          </div>
        </div>

        <div className="fruit-meter">
          <span style={{ width: `${cards.length ? positionPct : 0}%` }} />
        </div>
        <p className="text-sm text-on-surface-variant">
          Opanowane: {known} / {cards.length} · pasek: pozycja w zestawie
        </p>

        <div className="flex flex-wrap gap-3 items-end bg-surface-container-lowest/80 rounded-3xl p-4 md:p-6 shadow-melon">
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Liczba fiszek
            <input
              type="number"
              min={3}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-xl bg-surface-container-high border-0 px-3 py-2 font-sans font-semibold normal-case text-on-surface w-24"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Wyjaśnienia
            <select
              value={detail}
              onChange={(e) =>
                setDetail(e.target.value as "short" | "medium" | "long")
              }
              className="rounded-xl bg-surface-container-high border-0 px-3 py-2 font-sans font-semibold normal-case text-on-surface"
            >
              <option value="short">Krótko</option>
              <option value="medium">Średnio</option>
              <option value="long">Dokładnie</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="melon-gradient text-white font-bold px-6 py-3 rounded-full text-sm shadow-melon disabled:opacity-50"
          >
            {busy ? "Generuję…" : "Generuj fiszki z AI"}
          </button>
          <button
            type="button"
            disabled={cards.length === 0}
            onClick={() => {
              void (async () => {
                try {
                  await downloadQuizletTsv(
                    cards.map((c) => ({ front: c.front, back: c.back })),
                  );
                } catch (e) {
                  alert(
                    e instanceof Error
                      ? e.message
                      : "Nie udało się zapisać pliku.",
                  );
                }
              })();
            }}
            className="bg-secondary-container text-on-secondary-container font-bold px-6 py-3 rounded-full text-sm disabled:opacity-50"
          >
            Eksport Quizlet
          </button>
          <button
            type="button"
            disabled={busy || cards.length === 0}
            onClick={() => void removeAllFlashcards()}
            className="border-2 border-error/60 text-error font-bold px-6 py-3 rounded-full text-sm hover:bg-error/10 disabled:opacity-50"
          >
            Usuń fiszki
          </button>
        </div>

        {genError && (
          <div
            className="rounded-3xl border border-error/50 bg-error/10 p-4 md:p-5 shadow-inner space-y-3"
            role="alert"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-semibold text-on-surface m-0">
                  Nie udało się wygenerować fiszek
                </p>
                <p className="text-sm text-on-surface/90 m-0 break-words">
                  {genError}
                </p>
                <p className="text-xs text-on-surface-variant m-0">
                  Kliknij ponownie „Generuj fiszki z AI”, albo ustaw mniejszą liczbę
                  fiszek (np. 10–12) i spróbuj jeszcze raz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGenError(null)}
                className="shrink-0 rounded-full border border-error/40 px-4 py-2 text-xs font-bold text-error hover:bg-error/10"
              >
                Zamknij
              </button>
            </div>
          </div>
        )}

        {genProgress && (
          <div
            className="rounded-3xl border border-primary/25 bg-surface-container-low/90 p-4 md:p-5 shadow-inner space-y-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-on-surface font-semibold leading-snug m-0">
                {genProgress.label}
              </p>
              <span className="tabular-nums text-on-surface-variant font-medium">
                {genElapsedSec}s
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-surface-container-high overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-secondary to-primary transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, genProgress.percent))}%`,
                }}
              />
            </div>
            <p className="text-xs text-on-surface-variant m-0">
              Przy więcej niż 10 fiszkach materiał jest dzielony na części (ok. 10
              kart na fragment PDF) — krótsze przebiegi zamiast jednej bardzo długiej
              odpowiedzi. Ollama nadal może potrzebować kilku minut na duży plik.
            </p>
          </div>
        )}
      </div>

      {current && (
        <div className="w-full max-w-4xl flex flex-col md:flex-row items-center gap-6">
          <button
            type="button"
            aria-label="Poprzednia"
            onClick={() => {
              setShowBack(false);
              setIdx((i) => (i - 1 + cards.length) % cards.length);
            }}
            className="hidden md:flex w-16 h-16 rounded-full bg-surface-container-lowest shadow-melon items-center justify-center text-primary hover:scale-105 transition-transform"
          >
            <span className="material-symbols-outlined text-3xl">chevron_left</span>
          </button>

          <div className="flex-1 w-full perspective-1000">
            <div className="relative w-full min-h-[280px] md:min-h-[320px] bg-surface-container-lowest rounded-3xl shadow-melonLg flex flex-col items-center justify-center p-8 md:p-12 text-center overflow-hidden transition-transform hover:-translate-y-1">
              <div className="absolute top-6 left-6 w-3 h-3 bg-on-surface rounded-full opacity-5" />
              <div className="absolute bottom-6 right-6 w-3 h-3 bg-on-surface rounded-full opacity-5 rotate-45" />

              <span className="bg-secondary-container text-on-secondary-container px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4">
                {showBack ? "Odpowiedź" : "Pytanie"}
              </span>
              <p className="text-2xl md:text-4xl font-black tracking-tight text-on-surface max-w-[90%] leading-snug">
                {showBack ? current.back : current.front}
              </p>

              <div className="mt-10 flex flex-wrap gap-3 justify-center">
                <button
                  type="button"
                  data-tour-id="tour-flashcards-flip"
                  onClick={() => setShowBack(!showBack)}
                  className="melon-gradient text-white px-8 py-3 rounded-full font-bold text-base shadow-melon inline-flex items-center gap-2 hover:scale-[1.02] active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined">flip</span>
                  {showBack ? "Pokaż pytanie" : "Odwróć kartę"}
                </button>
                <button
                  type="button"
                  data-tour-id="tour-flashcards-next"
                  onClick={async () => {
                    await updateFlashcardProgress(
                      current.id,
                      current.repetitions + 1,
                      current.ease + 0.1,
                    );
                    setShowBack(false);
                    setIdx((i) => (i + 1) % cards.length);
                    await load();
                  }}
                  className="px-8 py-3 rounded-full bg-surface-container-low text-on-surface font-bold hover:bg-surface-container-high transition-colors"
                >
                  Znam — następna
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Następna"
            onClick={() => {
              setShowBack(false);
              setIdx((i) => (i + 1) % cards.length);
            }}
            className="hidden md:flex w-16 h-16 rounded-full bg-surface-container-lowest shadow-melon items-center justify-center text-primary hover:scale-105 transition-transform"
          >
            <span className="material-symbols-outlined text-3xl">chevron_right</span>
          </button>
        </div>
      )}

      {!current && cards.length === 0 && (
        <p className="text-on-surface-variant text-center max-w-md">
          Brak fiszek — ustaw liczbę i kliknij „Generuj fiszki z AI”, albo wróć do{" "}
          <Link to="/app/upload" className="text-primary font-semibold">
            wgrywania
          </Link>
          .
        </p>
      )}

      <div className="mt-10 w-full max-w-4xl">
        <div className="h-3 w-full rounded-full bg-surface-container-high overflow-hidden flex p-0.5">
          <span
            className="h-full rounded-full bg-gradient-to-r from-secondary to-primary shadow-inner transition-all"
            style={{ width: `${meterPct}%` }}
          />
        </div>
        <p className="text-center text-xs text-on-surface-variant mt-2">
          Fruit meter: postęp opanowania ({known} / {cards.length})
        </p>
      </div>
    </div>
  );
}
