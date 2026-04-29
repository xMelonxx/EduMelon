import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link, useParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MODEL_PROFILES } from "../lib/constants";
import {
  getPresentation,
  listChunksForPresentation,
  listRecentAttemptsForPresentation,
  listAttemptQuestionReviews,
  listTestQuestionsForPresentation,
  saveTestAttempt,
  saveTestQuestionBank,
  listWrongAnswersForAttempt,
  type TestAttemptQuestionReviewRow,
  type TestAttemptRow,
  type TestQuestionOption,
  type TestQuestionRow,
  type TestWrongAnswerRow,
} from "../lib/db";
import { loadLocalProfile } from "../lib/storage";
import {
  generateTestQuestionsFromChunks,
  type TestGenProgress,
} from "../lib/testsOllama";
import {
  cropImageBase64ByPercent,
  pdfPageToImageBase64,
} from "../lib/pdfVisionOcr";
import { isDevToolsEnabled } from "../lib/devtools";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type Stage = "idle" | "in_progress" | "done";

type ResultState = {
  percent: number;
  correct: number;
  total: number;
  wrong: TestWrongAnswerRow[];
};

type QuizMode = "all" | "wrong_only";
type ViewMode = "quiz" | "review_all" | "review_wrong";

function randomOption(): TestQuestionOption {
  const opts: TestQuestionOption[] = ["A", "B", "C", "D"];
  return opts[Math.floor(Math.random() * opts.length)]!;
}

export function Tests() {
  const devToolsEnabled = isDevToolsEnabled();
  const { id } = useParams<{ id: string }>();
  const profile = loadLocalProfile();
  const [title, setTitle] = useState("");
  const [subjectLabel, setSubjectLabel] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<string>("");
  const [questionBank, setQuestionBank] = useState<TestQuestionRow[]>([]);
  const [questions, setQuestions] = useState<TestQuestionRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, TestQuestionOption>>({});
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [genProgress, setGenProgress] = useState<TestGenProgress | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [visualCache, setVisualCache] = useState<Record<string, string>>({});
  const [latestAttempt, setLatestAttempt] = useState<TestAttemptRow | null>(null);
  const [latestReview, setLatestReview] = useState<TestAttemptQuestionReviewRow[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("quiz");

  const load = async () => {
    if (!id) return;
    const p = await getPresentation(id);
    if (p) {
      setTitle(p.title);
      setSubjectLabel(p.subject ?? "");
      setFilePath(p.file_path);
      setSourceKind(p.source_kind);
    }
    const q = await listTestQuestionsForPresentation(id);
    setQuestionBank(q);
    setQuestions(q);
    setAnswers({});
    setIdx(0);
    setResult(null);
    setViewMode("quiz");
    const attempts = await listRecentAttemptsForPresentation(id);
    const latest = attempts[0] ?? null;
    setLatestAttempt(latest);
    if (latest) {
      const review = await listAttemptQuestionReviews(latest.id);
      setLatestReview(review);
    } else {
      setLatestReview([]);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (!filePath || sourceKind.toLowerCase() !== "pdf") {
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfPreviewError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await invoke<number[]>("read_file_bytes", { path: filePath });
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const next = URL.createObjectURL(blob);
        setPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return next;
        });
      } catch (e) {
        if (cancelled) return;
        setPdfPreviewError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath, sourceKind]);

  useEffect(
    () => () => {
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    },
    [],
  );
  useEffect(() => {
    setVisualCache({});
  }, [filePath, id]);

  const current = questions[idx];
  const answeredCount = useMemo(
    () => Object.keys(answers).length,
    [answers],
  );

  const generateQuestions = async () => {
    if (!id || !profile) return;
    setStage("in_progress");
    setError(null);
    setResult(null);
    try {
      const chunks = await listChunksForPresentation(id);
      const model = MODEL_PROFILES[profile.modelProfile].ollamaTag;
      const generated = await generateTestQuestionsFromChunks(
        model,
        chunks,
        (p) => setGenProgress(p),
        { sourceKind, filePath },
      );
      await saveTestQuestionBank(
        id,
        generated.map((q) => ({
          id: crypto.randomUUID(),
          slide_index: q.slide_index,
          question: q.question,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          correct_option: q.correct_option,
          explanation: q.explanation,
          requires_image: q.requires_image,
          crop_x: q.crop_x,
          crop_y: q.crop_y,
          crop_w: q.crop_w,
          crop_h: q.crop_h,
        })),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStage("idle");
      setGenProgress(null);
    }
  };

  const startQuiz = (mode: QuizMode) => {
    const wrongIds = new Set(
      latestReview.filter((r) => r.is_correct === 0).map((r) => r.question_id),
    );
    const picked =
      mode === "wrong_only"
        ? questionBank.filter((q) => wrongIds.has(q.id))
        : questionBank;
    setQuestions(picked.length > 0 ? picked : questionBank);
    setAnswers({});
    setIdx(0);
    setResult(null);
    setViewMode("quiz");
  };

  const finishTest = async () => {
    if (!id || questions.length === 0) return;
    const scored = questions.map((q) => {
      const selected = answers[q.id];
      const isCorrect = selected === q.correct_option ? 1 : 0;
      return {
        question_id: q.id,
        selected_option: (selected ?? "A") as TestQuestionOption,
        is_correct: isCorrect,
      };
    });
    const correct = scored.reduce((acc, r) => acc + r.is_correct, 0);
    const percent = Math.round((correct / questions.length) * 100);
    const attemptId = await saveTestAttempt(id, percent, scored);
    const wrong = await listWrongAnswersForAttempt(attemptId);
    setResult({
      percent,
      correct,
      total: questions.length,
      wrong,
    });
    setStage("done");
    const attempts = await listRecentAttemptsForPresentation(id);
    const latest = attempts[0] ?? null;
    setLatestAttempt(latest);
    if (latest) {
      const review = await listAttemptQuestionReviews(latest.id);
      setLatestReview(review);
    }
  };

  const ensureVisualSnippet = async (
    key: string,
    slideIndex: number | null,
    crop: { x: number | null; y: number | null; w: number | null; h: number | null },
  ) => {
    if (visualCache[key] || !filePath || sourceKind.toLowerCase() !== "pdf") return;
    if (!slideIndex || crop.x == null || crop.y == null || crop.w == null || crop.h == null) {
      return;
    }
    try {
      const pageB64 = await pdfPageToImageBase64(filePath, slideIndex);
      const cut = await cropImageBase64ByPercent(pageB64, {
        x: crop.x,
        y: crop.y,
        w: crop.w,
        h: crop.h,
      });
      setVisualCache((prev) => ({ ...prev, [key]: cut }));
    } catch {
      // Brak cropa nie blokuje testu.
    }
  };

  useEffect(() => {
    const q = current;
    if (!q || q.requires_image !== 1) return;
    void ensureVisualSnippet(`q:${q.id}`, q.slide_index, {
      x: q.crop_x,
      y: q.crop_y,
      w: q.crop_w,
      h: q.crop_h,
    });
  }, [current, filePath, sourceKind]);

  useEffect(() => {
    if (!result) return;
    for (const w of result.wrong) {
      if (w.requires_image !== 1) continue;
      void ensureVisualSnippet(`w:${w.question_id}`, w.slide_index, {
        x: w.crop_x,
        y: w.crop_y,
        w: w.crop_w,
        h: w.crop_h,
      });
    }
  }, [result, filePath, sourceKind]);

  /** DEV-only helper: losowo zaznacza odpowiedzi, żeby szybko testować cały flow. */
  const fillRandomAnswersDev = () => {
    if (!devToolsEnabled || questions.length === 0) return;
    const randomMap: Record<string, TestQuestionOption> = {};
    for (const q of questions) {
      randomMap[q.id] = randomOption();
    }
    setAnswers(randomMap);
  };

  const latestCorrect = latestReview.filter((r) => r.is_correct === 1).length;
  const latestTotal = latestReview.length;
  const latestPercent =
    latestTotal > 0 ? Math.round((latestCorrect / latestTotal) * 100) : null;
  const latestWrongIds = new Set(
    latestReview.filter((r) => r.is_correct === 0).map((r) => r.question_id),
  );
  const reviewRows =
    viewMode === "review_wrong"
      ? latestReview
      : latestReview;

  if (!id) {
    return <p className="p-8 text-on-surface-variant">Brak identyfikatora testu.</p>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-surface-container-lowest text-on-surface">
      <div className="max-w-[1280px] mx-auto px-container-padding py-stack-lg">
        <div className="grid md:grid-cols-[260px_1fr] gap-gutter">
          <aside className="rounded-[24px] bg-surface-container-low border border-outline-variant p-6 h-fit sticky top-24">
            <p className="text-label-caps uppercase tracking-widest text-outline mb-5">Tryb testu</p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => startQuiz("all")}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition ${
                  viewMode === "quiz"
                    ? "text-primary bg-primary/5 border-r-2 border-primary"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined">grid_view</span>
                Rozwiąż cały
              </button>
              <button
                type="button"
                disabled={latestWrongIds.size === 0}
                onClick={() => startQuiz("wrong_only")}
                className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-primary disabled:opacity-40"
              >
                <span className="material-symbols-outlined">error_outline</span>
                Tylko błędne
              </button>
              <button
                type="button"
                onClick={() => setViewMode("review_all")}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition ${
                  viewMode === "review_all"
                    ? "text-primary bg-primary/5 border-r-2 border-primary"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined">visibility</span>
                Podejrzyj pytania
              </button>
              <button
                type="button"
                onClick={() => setViewMode("review_wrong")}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition ${
                  viewMode === "review_wrong"
                    ? "text-primary bg-primary/5 border-r-2 border-primary"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined">history</span>
                Ostatnie podejście
              </button>
            </div>
            {latestAttempt && latestPercent !== null && (
              <p className="text-[11px] text-on-surface-variant mt-5">
                Ostatni wynik: {latestPercent}% ({latestCorrect}/{latestTotal})
              </p>
            )}
          </aside>

          <section className="space-y-stack-md">
            <header className="space-y-2">
              <Link
                to="/app/tests"
                className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Wszystkie testy
              </Link>
              <p className="text-label-caps uppercase tracking-widest text-on-surface-variant">
                {subjectLabel || "Materiał"} · Quiz
              </p>
              <h1 className="text-h2 font-heading font-semibold">{title || "Test z prezentacji"}</h1>
            </header>

            {questions.length === 0 && (
              <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-container-padding space-y-4">
                <p className="text-on-surface">
                  Ten materiał nie ma jeszcze wygenerowanego testu.
                </p>
                <button
                  type="button"
                  disabled={stage === "in_progress"}
                  onClick={() => void generateQuestions()}
                  className="bg-primary text-on-primary font-bold px-6 py-3 rounded-xl text-sm disabled:opacity-50"
                >
                  {stage === "in_progress" ? "Generuję test…" : "Generuj test ABCD"}
                </button>
                {genProgress && (
                  <div className="rounded-xl bg-surface-container p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-on-surface">
                      <span>{genProgress.label}</span>
                      <span>{genProgress.percent}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                        style={{ width: `${genProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}
                {error && (
                  <p className="text-sm text-error bg-error/10 rounded-xl px-4 py-3">{error}</p>
                )}
              </section>
            )}

            {viewMode !== "quiz" && reviewRows.length > 0 && !result && (
              <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-container-padding space-y-3">
                <h3 className="text-h3 font-heading text-on-surface">
                  {viewMode === "review_all" ? "Podgląd pytań" : "Ostatnie odpowiedzi"}
                </h3>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {reviewRows.map((r) => {
                    const selectedText =
                      r.selected_option === "A"
                        ? r.option_a
                        : r.selected_option === "B"
                          ? r.option_b
                          : r.selected_option === "C"
                            ? r.option_c
                            : r.option_d;
                    const correctText =
                      r.correct_option === "A"
                        ? r.option_a
                        : r.correct_option === "B"
                          ? r.option_b
                          : r.correct_option === "C"
                            ? r.option_c
                            : r.option_d;
                    return (
                      <article
                        key={`review-${r.question_id}`}
                        className="rounded-xl bg-surface-container p-4 space-y-1"
                      >
                        <p className="font-semibold text-on-surface">{r.question}</p>
                        <p className="text-xs text-on-surface-variant">
                          Strona: {r.slide_index ?? "?"}
                        </p>
                        {viewMode === "review_wrong" && (
                          <>
                            <p className="text-sm">
                              Status:{" "}
                              <strong className={r.is_correct ? "text-primary" : "text-error"}>
                                {r.is_correct ? "dobrze" : "źle"}
                              </strong>
                            </p>
                            <p className="text-sm">
                              Twoja odpowiedź: {r.selected_option} — {selectedText}
                            </p>
                            <p className="text-sm">
                              Poprawna odpowiedź: {r.correct_option} — {correctText}
                            </p>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {questions.length > 0 && !result && viewMode === "quiz" && (
              <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-container-padding space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-outline font-semibold">
                      Pytanie {idx + 1}/{questions.length}
                    </p>
                    <p className="text-sm text-on-surface-variant">
                      Odpowiedziano: {answeredCount}/{questions.length}
                    </p>
                  </div>
                  {devToolsEnabled && (
                    <button
                      type="button"
                      onClick={fillRandomAnswersDev}
                      className="rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold"
                    >
                      DEV: losowe odpowiedzi
                    </button>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className="h-full bg-primary-container transition-all"
                    style={{ width: `${((idx + 1) / questions.length) * 100}%` }}
                  />
                </div>
                {current && (
                  <div className="space-y-5">
                    <div className="flex justify-between items-start gap-3">
                      <h2 className="text-h3 font-heading text-on-surface max-w-3xl">
                        {current.question}
                      </h2>
                      <span className="px-3 py-1 rounded-full border border-outline-variant text-xs text-on-surface-variant">
                        Strona {current.slide_index ?? "?"}
                      </span>
                    </div>
                    {current.requires_image === 1 && (
                      <div className="relative w-full max-w-3xl aspect-[21/9] rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high">
                        {visualCache[`q:${current.id}`] ? (
                          <img
                            src={`data:image/png;base64,${visualCache[`q:${current.id}`]}`}
                            alt="Fragment źródłowej grafiki do pytania"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <p className="text-xs text-on-surface-variant m-0 px-4 py-4">
                            Ładuję fragment grafiki do tego pytania…
                          </p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(
                        [
                          ["A", current.option_a],
                          ["B", current.option_b],
                          ["C", current.option_c],
                          ["D", current.option_d],
                        ] as const
                      ).map(([key, text]) => {
                        const selected = answers[current.id] === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() =>
                              setAnswers((prev) => ({
                                ...prev,
                                [current.id]: key,
                              }))
                            }
                            className={`group flex items-center gap-5 p-6 rounded-[20px] text-left border transition-all ${
                              selected
                                ? "border-primary bg-primary/10"
                                : "border-outline-variant bg-surface-container hover:border-primary hover:bg-surface-container-high"
                            }`}
                          >
                            <span
                              className={`w-11 h-11 rounded-full flex items-center justify-center font-heading font-bold border-2 ${
                                selected
                                  ? "bg-primary text-on-primary border-primary"
                                  : "border-outline text-outline group-hover:border-primary group-hover:text-primary"
                              }`}
                            >
                              {key}
                            </span>
                            <span className="text-body-md text-on-surface">{text}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-3 pt-4 border-t border-outline-variant">
                  <button
                    type="button"
                    disabled={idx <= 0}
                    onClick={() => setIdx((v) => Math.max(0, v - 1))}
                    className="px-6 py-3 rounded-xl border border-outline-variant text-on-surface disabled:opacity-40"
                  >
                    Poprzednie
                  </button>
                  <button
                    type="button"
                    disabled={idx >= questions.length - 1}
                    onClick={() => setIdx((v) => Math.min(questions.length - 1, v + 1))}
                    className="px-8 py-3 rounded-xl bg-primary text-on-primary font-semibold disabled:opacity-40"
                  >
                    Następne
                  </button>
                  <button
                    type="button"
                    disabled={answeredCount < questions.length}
                    onClick={() => void finishTest()}
                    className="ml-auto px-6 py-3 rounded-xl border border-error/30 text-error hover:bg-error/10 disabled:opacity-40"
                  >
                    Zakończ test
                  </button>
                </div>
              </section>
            )}

            {result && (
              <section className="space-y-stack-md">
                <section className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-gutter items-center rounded-[24px] bg-surface-container-low border border-outline-variant p-container-padding">
                  <div className="grid place-items-center">
                    <div
                      className="w-44 h-44 rounded-full grid place-items-center"
                      style={{
                        background: `conic-gradient(${
                          result.percent >= 60
                            ? "var(--c-primary)"
                            : "var(--c-error)"
                        } ${result.percent}%, rgba(255,255,255,0.12) ${result.percent}% 100%)`,
                      }}
                    >
                      <div className="w-32 h-32 rounded-full bg-surface-container-lowest grid place-items-center">
                        <span
                          className={`text-3xl font-black ${
                            result.percent >= 60 ? "text-primary" : "text-error"
                          }`}
                        >
                          {result.percent}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-h2 font-heading text-primary">Analiza Wyników</h2>
                    <p className="text-on-surface-variant text-body-md">
                      {result.correct} poprawnych i {result.total - result.correct} błędnych
                      odpowiedzi. Wróć do błędnych pytań, aby domknąć materiał.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setAnswers({});
                          setIdx(0);
                          setResult(null);
                          setStage("idle");
                          setViewMode("quiz");
                        }}
                        className="bg-primary text-on-primary px-6 py-3 rounded-full font-semibold"
                      >
                        Rozwiąż jeszcze raz
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResult(null);
                          startQuiz("wrong_only");
                        }}
                        className="border border-primary text-primary px-6 py-3 rounded-full font-semibold hover:bg-primary/10"
                      >
                        Tylko błędne
                      </button>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-h3 font-heading text-on-surface flex items-center gap-2">
                      <span className="material-symbols-outlined text-error">warning</span>
                      Pytania wymagające poprawy
                    </h3>
                    <span className="text-xs font-semibold uppercase px-3 py-1 rounded-full bg-error/10 text-error border border-error/30">
                      {result.wrong.length} błędów
                    </span>
                  </div>
                  {result.wrong.length === 0 ? (
                    <p className="text-sm text-on-surface-variant">
                      Super — wszystkie odpowiedzi były poprawne.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
                      {result.wrong.map((w) => {
                        const correctText =
                          w.correct_option === "A"
                            ? w.option_a
                            : w.correct_option === "B"
                              ? w.option_b
                              : w.correct_option === "C"
                                ? w.option_c
                                : w.option_d;
                        const selectedText =
                          w.selected_option === "A"
                            ? w.option_a
                            : w.selected_option === "B"
                              ? w.option_b
                              : w.selected_option === "C"
                                ? w.option_c
                                : w.option_d;
                        return (
                          <article
                            key={w.question_id}
                            className="rounded-[24px] bg-surface-container-low border border-outline-variant p-container-padding space-y-3"
                          >
                            <p className="text-xs uppercase tracking-wide text-on-surface-variant">
                              Pytanie • Strona {w.slide_index ?? "?"}
                            </p>
                            <h4 className="font-heading text-on-surface">{w.question}</h4>
                            <div className="space-y-2">
                              <div className="p-3 rounded-xl bg-error/10 border border-error/20">
                                <p className="text-[10px] uppercase tracking-wide text-error/80">
                                  Twoja odpowiedź
                                </p>
                                <p className="text-sm">{w.selected_option} — {selectedText}</p>
                              </div>
                              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                                <p className="text-[10px] uppercase tracking-wide text-primary/80">
                                  Poprawna odpowiedź
                                </p>
                                <p className="text-sm">
                                  {w.correct_option} — {correctText}
                                </p>
                              </div>
                            </div>
                            {w.explanation && (
                              <p className="text-sm text-on-surface-variant">{w.explanation}</p>
                            )}
                            <div className="rounded-xl bg-white overflow-hidden min-h-[160px] grid place-items-center p-2">
                              {w.requires_image === 1 && visualCache[`w:${w.question_id}`] ? (
                                <img
                                  src={`data:image/png;base64,${visualCache[`w:${w.question_id}`]}`}
                                  alt="Wycięty fragment strony dla pytania"
                                  className="w-full h-auto rounded-lg"
                                />
                              ) : sourceKind.toLowerCase() === "pdf" && pdfBlobUrl && w.slide_index ? (
                                <Document file={pdfBlobUrl}>
                                  <Page
                                    pageNumber={Math.max(1, w.slide_index)}
                                    width={320}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                  />
                                </Document>
                              ) : (
                                <p className="text-xs text-on-surface-variant px-3 text-center">
                                  {pdfPreviewError
                                    ? `Nie udało się wczytać podglądu PDF: ${pdfPreviewError}`
                                    : "Podgląd strony dostępny dla plików PDF."}
                                </p>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </section>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
