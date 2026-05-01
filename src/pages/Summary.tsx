import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router-dom";
import {
  getSummaryForPresentation,
  getPresentation,
  listChunksForPresentation,
  upsertSummaryForPresentation,
  type ChunkRow,
} from "../lib/db";
import { MODEL_PROFILES } from "../lib/constants";
import { ollamaChat, ollamaChatWithImages } from "../lib/ollama";
import { pdfPageToImageBase64 } from "../lib/pdfVisionOcr";
import { buildSummaryFormatterPrompt, buildSummaryPrompt } from "../lib/prompts";
import { loadLocalProfile } from "../lib/storage";
import { retrieveTopK } from "../lib/rag";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type SummaryStage =
  | "idle"
  | "loading-context"
  | "building-prompt"
  | "generating-main"
  | "generating-short"
  | "done";

type ChatMessage = {
  role: "user" | "ai" | "error";
  content: string;
};

function normalizeAiMarkdown(raw: string): string {
  let t = raw ?? "";
  // Unwrap common LaTeX-ish artifacts from model output.
  t = t.replace(/\\text\{([^}]*)\}/g, "$1");
  t = t.replace(/\\_/g, "_");
  t = t.replace(/\$\s*/g, "");
  // Ensure headings and bullets start on separate lines.
  t = t.replace(/\s*(#{1,6}\s+)/g, "\n$1");
  t = t.replace(/\s*(?:^|\n)?\s*[-*]\s+/g, "\n- ");
  // Common model artifacts and repeated separators.
  t = t.replace(/\n\*+\s*/g, "\n- ");
  t = t.replace(/\n-{3,}\n/g, "\n\n");
  t = t.replace(/(^|\n)\*\*(\s*[^:\n]+)\*\*(\s*:\s*)/g, "$1- **$2**$3");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function stageProgress(stage: SummaryStage): number {
  switch (stage) {
    case "idle":
      return 0;
    case "loading-context":
      return 15;
    case "building-prompt":
      return 35;
    case "generating-main":
      return 70;
    case "generating-short":
      return 90;
    case "done":
      return 100;
    default:
      return 0;
  }
}

function stageLabel(stage: SummaryStage): string {
  switch (stage) {
    case "loading-context":
      return "Czytam treść materiału…";
    case "building-prompt":
      return "Przygotowuję prompt streszczenia…";
    case "generating-main":
      return "Generuję pełne streszczenie AI…";
    case "generating-short":
      return "Tworzę krótką wersję do szybkiej powtórki…";
    case "done":
      return "Gotowe.";
    default:
      return "";
  }
}

export function Summary() {
  const { id } = useParams<{ id: string }>();
  const profile = loadLocalProfile();
  const [title, setTitle] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<string>("");
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [shortS, setShortS] = useState("");
  const [fullS, setFullS] = useState("");
  const [busy, setBusy] = useState(false);
  const [summaryStage, setSummaryStage] = useState<SummaryStage>("idle");
  const [chatIn, setChatIn] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatOut, setChatOut] = useState<ChatMessage[]>([]);
  const [chatScope, setChatScope] = useState<"all" | "page">("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [maxPage, setMaxPage] = useState<number>(1);
  const [chatStatus, setChatStatus] = useState<string>("");
  const [chatElapsed, setChatElapsed] = useState<number>(0);
  const [previewPages, setPreviewPages] = useState<number>(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<"all" | "page">("all");
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const wheelLockRef = useRef<number>(0);
  const pageImageCacheRef = useRef<Map<number, string>>(new Map());
  const [previewWidth, setPreviewWidth] = useState<number>(640);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const p = await getPresentation(id);
      if (p) {
        setTitle(p.title);
        setFilePath(p.file_path);
        setSourceKind(p.source_kind);
      }
      const cachedSummary = await getSummaryForPresentation(id);
      if (cachedSummary) {
        setShortS(cachedSummary.short_text ?? "");
        setFullS(cachedSummary.full_text ?? "");
      }
      const loadedChunks = await listChunksForPresentation(id);
      setChunks(loadedChunks);
      const pageMax =
        loadedChunks
          .map((c) => c.slide_index ?? 0)
          .reduce((a, b) => Math.max(a, b), 0) || 1;
      setMaxPage(pageMax);
      setCurrentPage((cur) => Math.min(Math.max(cur, 1), pageMax));
    })();
  }, [id]);

  const generate = async () => {
    if (!id || !profile) return;
    setBusy(true);
    setSummaryStage("loading-context");
    setShortS("");
    setFullS("");
    try {
      const context = chunks.map((c) => c.body).join("\n\n").slice(0, 24000);
      setSummaryStage("building-prompt");
      const { system, user } = buildSummaryPrompt(context);
      const model = MODEL_PROFILES[profile.modelProfile].ollamaTag;
      setSummaryStage("generating-main");
      const draftText = await ollamaChat(model, [
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
      const { system: fmtSystem, user: fmtUser } = buildSummaryFormatterPrompt(
        draftText.slice(0, 12000),
      );
      const text = await ollamaChat(model, [
        { role: "system", content: fmtSystem },
        { role: "user", content: fmtUser },
      ]);
      setFullS(text || draftText);
      setSummaryStage("generating-short");
      const shortAsk = await ollamaChat(model, [
        {
          role: "system",
          content:
            "Podsumuj w 2 zdaniach po polsku, bez wstępu. Zwróć czysty tekst, bez markdown i bez list.",
        },
        {
          role: "user",
          content: `Skróć to do 2 zdań:\n${(text || draftText).slice(0, 4000)}`,
        },
      ]);
      setShortS(shortAsk);
      await upsertSummaryForPresentation(id, shortAsk, text || draftText);
      setSummaryStage("done");
    } catch (e) {
      setFullS(`Błąd: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (summaryStage !== "done") setSummaryStage("idle");
    }
  };

  const canPreviewPdf = Boolean(filePath && sourceKind.toLowerCase() === "pdf");
  const shortSummaryMd = useMemo(() => normalizeAiMarkdown(shortS), [shortS]);
  const fullSummaryMd = useMemo(() => normalizeAiMarkdown(fullS), [fullS]);
  useEffect(() => {
    if (!canPreviewPdf || !filePath) {
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setPdfLoading(true);
      setPreviewError(null);
      try {
        const bytes = await invoke<number[]>("read_file_bytes", { path: filePath });
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e) {
        if (cancelled) return;
        setPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canPreviewPdf, filePath]);
  useEffect(
    () => () => {
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      pageImageCacheRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    pageImageCacheRef.current.clear();
  }, [filePath]);
  const effectiveMaxPage = Math.max(maxPage, previewPages || 0);
  const singlePageWidth = Math.min(
    2200,
    Math.max(previewWidth, Math.floor(previewWidth * 1.85)),
  );
  const canGoPrevPage = currentPage > 1;
  const canGoNextPage = currentPage < effectiveMaxPage;
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const update = () => {
      const base = Math.floor(el.clientWidth - 20);
      const w =
        window.innerWidth >= 1280
          ? Math.max(900, base)
          : Math.max(320, base);
      setPreviewWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageContext = useMemo(() => {
    const scoped = chunks.filter((c) => (c.slide_index ?? 1) === currentPage);
    return scoped.map((c) => c.body).join("\n\n").slice(0, 8000);
  }, [chunks, currentPage]);

  const sendChat = async () => {
    const q = chatIn.trim();
    if (!q || !profile) return;
    const userMsg: ChatMessage = {
      role: "user",
      content: `(${chatScope === "page" ? `strona ${currentPage}` : "cały dokument"}) ${q}`,
    };
    const pendingMsg: ChatMessage = {
      role: "ai",
      content: "_AI analizuje pytanie..._",
    };
    setChatOut((prev) => [...prev, userMsg, pendingMsg]);
    setChatBusy(true);
    setChatStatus(
      chatScope === "page"
        ? `Analizuję treść strony ${currentPage}…`
        : "Wyszukuję najtrafniejsze fragmenty z dokumentu…",
    );
    setChatElapsed(0);
    setChatIn("");
    try {
      const model = MODEL_PROFILES[profile.modelProfile].ollamaTag;
      let context = "";
      if (chatScope === "page") {
        context = pageContext;
      } else {
        const top = await retrieveTopK(q, chunks, 6);
        context = top.map((c) => c.body).join("\n\n---\n\n");
      }
      setChatStatus("Generuję odpowiedź AI…");
      const scopeLabel =
        chatScope === "page"
          ? `kontekst strony ${currentPage}`
          : "kontekst całego dokumentu";
      const baseSystemPrompt =
        "Jesteś pomocnym asystentem nauki po polsku. Odpowiadaj na podstawie przekazanego kontekstu i nie zmyślaj danych spoza materiału. W tym systemie fragmenty mogą zawierać znaczniki 'Strona N:' — traktuj je jako prawdziwe numery stron i odnoś się do nich dosłownie.";
      let reply = "";
      if (chatScope === "page" && sourceKind.toLowerCase() === "pdf" && filePath) {
        try {
          setChatStatus(`Analizuję obraz strony ${currentPage} + kontekst tekstowy…`);
          let pageImage = pageImageCacheRef.current.get(currentPage);
          if (!pageImage) {
            pageImage = await pdfPageToImageBase64(filePath, currentPage);
            pageImageCacheRef.current.set(currentPage, pageImage);
          }
          reply = await ollamaChatWithImages(
            model,
            [
              {
                role: "system",
                content:
                  `${baseSystemPrompt} Dodatkowo dostajesz obraz strony PDF. Łącz informacje z obrazu i kontekstu tekstowego; gdy są rozbieżności, podaj to jasno.`,
              },
              {
                role: "user",
                content: `Tryb: ${scopeLabel}\n\nKontekst tekstowy:\n${context || "(brak kontekstu)"}`,
                images: [pageImage],
              },
              { role: "user", content: q },
            ],
            { temperature: 0.2, num_predict: 4096 },
          );
        } catch {
          setChatStatus("Nie udało się odczytać obrazu strony — przechodzę na sam tekst…");
          reply = await ollamaChat(model, [
            { role: "system", content: baseSystemPrompt },
            {
              role: "user",
              content: `Tryb: ${scopeLabel}\n\nKontekst:\n${context || "(brak kontekstu)"}`,
            },
            { role: "user", content: q },
          ]);
        }
      } else {
        reply = await ollamaChat(model, [
          { role: "system", content: baseSystemPrompt },
          {
            role: "user",
            content: `Tryb: ${scopeLabel}\n\nKontekst:\n${context || "(brak kontekstu)"}`,
          },
          { role: "user", content: q },
        ]);
      }
      setChatOut((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i]?.role === "ai" && copy[i]?.content === "_AI analizuje pytanie..._") {
            copy[i] = { role: "ai", content: reply.trim() || "Brak odpowiedzi." };
            return copy;
          }
        }
        copy.push({ role: "ai", content: reply.trim() || "Brak odpowiedzi." });
        return copy;
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setChatOut((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i]?.role === "ai" && copy[i]?.content === "_AI analizuje pytanie..._") {
            copy[i] = { role: "error", content: errMsg };
            return copy;
          }
        }
        copy.push({ role: "error", content: errMsg });
        return copy;
      });
    } finally {
      setChatBusy(false);
      setChatStatus("");
    }
  };
  useEffect(() => {
    if (!chatBusy) return;
    const t = setInterval(() => {
      setChatElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [chatBusy]);

  if (!id) {
    return (
      <p className="p-8 text-on-surface-variant">Brak ID prezentacji.</p>
    );
  }

  return (
    <div className="w-full px-4 md:px-8 py-6 md:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link
            to="/app/dashboard"
            className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1 mb-2"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            Biblioteka
          </Link>
          <h2 className="text-3xl font-extrabold text-on-surface m-0">
            Szczegółowe streszczenie
          </h2>
          <p className="text-on-surface-variant mt-2">{title}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="melon-gradient text-white font-bold px-8 py-3 rounded-full shadow-melon disabled:opacity-50 shrink-0"
        >
          {busy ? "Generuję…" : "Generuj (AI)"}
        </button>
      </div>

      {busy && (
        <section className="rounded-3xl bg-surface-container-lowest p-6 shadow-melon space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-surface m-0">
              Generowanie streszczenia
            </p>
            <p className="text-sm text-primary font-bold m-0">
              {stageProgress(summaryStage)}%
            </p>
          </div>
          <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
            <div
              className="h-full rounded-full melon-gradient transition-all duration-300"
              style={{ width: `${stageProgress(summaryStage)}%` }}
            />
          </div>
          <p className="text-xs text-on-surface-variant m-0">
            {stageLabel(summaryStage)}
          </p>
        </section>
      )}

      <section className="grid xl:grid-cols-[2.3fr_1fr] gap-5 items-start">
        <div
          data-tour-id="tour-summary-pdf-viewer"
          className="rounded-3xl bg-surface-container-lowest p-5 shadow-melon h-[78vh] flex flex-col"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant m-0">
              Podgląd pliku
            </h3>
            {canPreviewPdf ? (
              <span className="text-xs text-on-surface-variant">PDF</span>
            ) : (
              <span className="text-xs text-on-surface-variant">
                Podgląd działa dla PDF
              </span>
            )}
          </div>
          {canPreviewPdf ? (
            <div className="space-y-3 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="inline-flex rounded-full bg-surface-container-high p-1">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("all")}
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      previewMode === "all"
                        ? "bg-primary text-on-primary"
                        : "text-on-surface"
                    }`}
                  >
                    Cały PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("page")}
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      previewMode === "page"
                        ? "bg-primary text-on-primary"
                        : "text-on-surface"
                    }`}
                  >
                    Jedna strona
                  </button>
                </div>
                {previewMode === "page" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-semibold text-on-surface disabled:opacity-40"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      Poprzednia
                    </button>
                    <span className="text-xs text-on-surface-variant">
                      {currentPage}/{effectiveMaxPage}
                    </span>
                    <button
                      type="button"
                      className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-semibold text-on-surface disabled:opacity-40"
                      disabled={currentPage >= effectiveMaxPage}
                      onClick={() =>
                        setCurrentPage((p) => Math.min(effectiveMaxPage, p + 1))
                      }
                    >
                      Następna
                    </button>
                  </div>
                )}
              </div>
              <div
                ref={previewWrapRef}
                className="w-full flex-1 min-h-0 rounded-2xl bg-white overflow-auto p-2"
                onWheel={(e) => {
                  if (previewMode !== "page") return;
                  const now = Date.now();
                  if (now - wheelLockRef.current < 220) return;
                  if (Math.abs(e.deltaY) < 10) return;
                  if (e.deltaY > 0 && canGoNextPage) {
                    e.preventDefault();
                    wheelLockRef.current = now;
                    setCurrentPage((p) => Math.min(effectiveMaxPage, p + 1));
                  } else if (e.deltaY < 0 && canGoPrevPage) {
                    e.preventDefault();
                    wheelLockRef.current = now;
                    setCurrentPage((p) => Math.max(1, p - 1));
                  }
                }}
              >
                <Document
                  file={pdfBlobUrl}
                  loading={
                    <div className="h-full grid place-items-center text-sm text-gray-500">
                      {pdfLoading ? "Ładuję podgląd PDF…" : "Przygotowuję podgląd PDF…"}
                    </div>
                  }
                  onLoadSuccess={({ numPages }) => {
                    setPreviewError(null);
                    setPreviewPages(numPages);
                    setMaxPage((cur) => Math.max(cur, numPages));
                    setCurrentPage((cur) => Math.min(Math.max(cur, 1), numPages));
                  }}
                  onLoadError={(e) => {
                    setPreviewError(e instanceof Error ? e.message : String(e));
                  }}
                >
                  {previewMode === "all"
                    ? Array.from({ length: effectiveMaxPage }).map((_, idx) => (
                        <div key={idx + 1} className="mb-3">
                          <Page
                            pageNumber={idx + 1}
                            width={previewWidth}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                          />
                        </div>
                      ))
                    : (
                      <div className="w-full h-full grid place-items-center">
                        <Page
                          pageNumber={Math.min(Math.max(currentPage, 1), effectiveMaxPage)}
                          width={singlePageWidth}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                        />
                      </div>
                    )}
                </Document>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-surface-container-low px-4 py-3">
                <p className="text-xs text-on-surface-variant m-0">
                  {previewError
                    ? `Podgląd nie załadował się: ${previewError}`
                    : "Jeśli podgląd się nie ładuje, otwórz plik w systemowym czytniku."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (filePath) void openPath(filePath);
                  }}
                  className="text-xs font-bold text-primary hover:underline"
                >
                  Otwórz PDF
                </button>
              </div>
            </div>
          ) : (
            <div className="h-[600px] rounded-2xl bg-surface-container-low grid place-items-center text-sm text-on-surface-variant text-center px-6">
              Brak podglądu PDF. Dla plików PPTX korzystaj z czatu i streszczenia.
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-surface-container-low p-5 shadow-inner min-h-[78vh] h-[78vh] flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant m-0">
              Czat AI
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChatScope("all")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  chatScope === "all"
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface"
                }`}
              >
                Cały PDF
              </button>
              <button
                type="button"
                onClick={() => setChatScope("page")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  chatScope === "page"
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface"
                }`}
              >
                Konkretna strona
              </button>
            </div>
          </div>

          {chatScope === "page" && (
            <label className="text-xs text-on-surface-variant inline-flex items-center gap-2">
              Strona:
              <input
                type="number"
                min={1}
                max={effectiveMaxPage}
                value={currentPage}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) return;
                  setCurrentPage(Math.min(Math.max(n, 1), effectiveMaxPage));
                }}
                className="w-24 rounded-xl bg-surface-container-high border-0 px-3 py-1.5 text-sm text-on-surface"
              />
              <span>/ {effectiveMaxPage}</span>
            </label>
          )}
          {chatBusy && (
            <div className="rounded-xl bg-surface-container-high px-3 py-2 text-xs text-on-surface-variant flex items-center justify-between">
              <span>{chatStatus || "Przetwarzam pytanie…"}</span>
              <span>{chatElapsed}s</span>
            </div>
          )}

          <div className="rounded-2xl bg-surface-container-high/80 p-4 flex-1 min-h-0 overflow-y-auto text-sm space-y-3">
            {chatOut.length === 0 ? (
              <span className="text-on-surface-variant">
                Zadaj pytanie o cały dokument albo o aktualnie oglądaną stronę.
              </span>
            ) : (
              chatOut.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.role === "user"
                      ? "ml-auto max-w-[92%] rounded-2xl bg-primary/20 border border-primary/30 px-3 py-2 text-on-surface whitespace-pre-wrap"
                      : msg.role === "error"
                        ? "max-w-[95%] rounded-2xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-red-200 whitespace-pre-wrap"
                        : "max-w-[95%] rounded-2xl bg-surface-container-lowest border border-outline-variant/20 px-3 py-2 text-on-surface whitespace-pre-wrap leading-relaxed"
                  }
                >
                  {msg.role === "ai" ? (
                    <div className="text-[15px] leading-7 prose prose-invert prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              data-tour-id="tour-summary-chat-input"
              className="flex-1 rounded-full bg-surface-container-lowest border-0 px-5 py-3 text-sm font-medium shadow-sm focus:ring-2 focus:ring-primary/30"
              value={chatIn}
              onChange={(e) => setChatIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendChat()}
              placeholder={
                chatScope === "page"
                  ? `Np. Co jest najważniejsze na stronie ${currentPage}?`
                  : "Np. Jakie są kluczowe pojęcia z całego materiału?"
              }
              disabled={chatBusy}
            />
            <button
              type="button"
              data-tour-id="tour-summary-chat-send"
              disabled={chatBusy || !chatIn.trim()}
              onClick={() => void sendChat()}
              className="melon-gradient text-white font-bold px-8 py-3 rounded-full text-sm disabled:opacity-50 shrink-0"
            >
              {chatBusy ? "Wysyłam…" : "Wyślij"}
            </button>
          </div>
        </div>
      </section>

      {shortS && (
        <section className="rounded-3xl bg-surface-container-lowest p-8 shadow-melon">
          <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-3">
            Krótkie podsumowanie
          </h3>
          <div className="text-on-surface prose prose-invert prose-lg prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 max-w-none leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {shortSummaryMd}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {fullS && (
        <section className="rounded-3xl bg-surface-container-low p-8 shadow-inner">
          <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-3">
            Pełna analiza
          </h3>
          <div className="text-on-surface prose prose-invert prose-lg prose-headings:font-heading prose-headings:tracking-tight prose-headings:mb-3 prose-h2:text-xl prose-p:my-2 prose-p:leading-7 prose-ul:my-3 prose-ul:pl-5 prose-li:my-1 prose-strong:text-on-surface max-w-[82ch] leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {fullSummaryMd}
            </ReactMarkdown>
          </div>
        </section>
      )}
    </div>
  );
}
