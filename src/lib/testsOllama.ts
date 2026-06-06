import type { ChunkRow } from "./db";
import {
  geminiBatchDelayMs,
  getAiProvider,
  getGeminiProvider,
  sleep,
} from "./ai/aiManager";
import type { AiOptions, ImageChatMessage, StreamDelta } from "./ai/types";
import { useSingleShotCloudGeneration } from "./cloudGeneration";
import {
  buildFullTestMaterialContext,
  filterChunksByPageRange,
  geminiTestNumPredict,
} from "./cloudTestContext";
import { buildTestsGeminiPdfPrompt, buildTestsGeminiPrompt } from "./prompts";
import {
  DEFAULT_TEST_DIFFICULTY,
  getTestDifficultyAdjective,
  getTestDifficultyBlueprint,
  getTestDifficultyOllamaChunkRules,
  getTestDifficultyOllamaSystem,
  type TestDifficulty,
} from "./testDifficulty";
import {
  pdfGetPageCount,
  pdfPageToImageBase64,
  PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS,
  PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
} from "./pdfVisionOcr";
import {
  formatTestGenerationFailureMessage,
  GEMINI_TEST_PROGRESS_STEPS,
  runWithGeminiWaitProgress,
  type AiGenerationProgress,
} from "./geminiProgress";
import { getLowSpecTestModeEnabled } from "./storage";

export type TestGenProgress = AiGenerationProgress;

export type GeneratedTestQuestion = {
  slide_index: number | null;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
  explanation: string;
  requires_image: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
};

export type TestGenerationOptions = {
  sourceKind?: string;
  filePath?: string | null;
  mode?: "smart_chunking" | "legacy_page_mode";
  finalQuestionLimit?: number;
  /**
   * DEV: włącznie numery stron (PDF) lub slajdów — kolejność start/end nie ma znaczenia (normalizujemy do min–max).
   */
  devPageRange?: { start: number; end: number };
  /** DEV: log linii do konsoli w UI (np. Tests.tsx). */
  onDevLog?: (line: string) => void;
  /** Poziom trudności pytań testowych. */
  difficulty?: TestDifficulty;
};

export type TestGenerationRejectReasons = {
  invalid_shape: number;
  duplicate_options: number;
  quality_gate: number;
  duplicate_question: number;
  invalid_json: number;
  timeout: number;
  other_error: number;
};

export type TestGenerationMetrics = {
  model: string;
  isLowSpec: boolean;
  generationMode: "smart_chunking" | "legacy_page_mode";
  chunkCount: number;
  pageRanges: string[];
  targetQuestionLimit: number;
  targetQuestionMax: number;
  minimumSatisfied: boolean;
  plannedPerChunk: number;
  generatedPreOptimizer: number;
  generatedPostOptimizer: number;
  fallbackUsed: boolean;
  optimizerApplied: boolean;
  optimizerDropCount: number;
  pagesTotal: number;
  pagesWithAnyParsed: number;
  questionsBeforeDedupe: number;
  questionsAfterDedupe: number;
  qualityAverage: number;
  textCalls: number;
  visionCalls: number;
  totalLatencyMs: number;
  rejectReasons: TestGenerationRejectReasons;
  difficulty: TestDifficulty;
};

export type TestGenerationResult = {
  questions: GeneratedTestQuestion[];
  metrics: TestGenerationMetrics;
};

const HEARTBEAT_MS = 3_000;
/** Bez obrazu opieramy się wyłącznie na tekście z ingestu. */
const MAX_PAGE_CONTEXT_CHARS_TEXT = 12000;
const MIN_CHUNK_SIZE = 3500;
const MAX_PAGES = 6;
const VISION_TEXT_THRESHOLD = 200;
const MAX_VISION_PAGES_PER_CHUNK = 2;
const DEFAULT_FINAL_QUESTION_LIMIT = 20;
const QUALITY_GATE_MIN_SCORE = 5;
const NEGATIVE_QUESTION_RATIO_MIN = 0.15;
const NEGATIVE_QUESTION_RATIO_MAX = 0.3;
const SINGLE_QUESTION_RETRY_MAX = 2;
type QuestionArchetype =
  | "mechanizm_przyczynowo_skutkowy"
  | "różnicowanie_pośrednie"
  | "interpretacja_danych"
  | "weryfikacja_fałszu";
const QUESTION_ARCHETYPES: QuestionArchetype[] = [
  "mechanizm_przyczynowo_skutkowy",
  "różnicowanie_pośrednie",
  "interpretacja_danych",
  "weryfikacja_fałszu",
];

type SourcePage = {
  slide_index: number;
  context: string;
};

type SmartChunk = {
  id: string;
  startPage: number;
  endPage: number;
  representativePage: number;
  pageRange: string;
  context: string;
  sourcePages: SourcePage[];
  visionNotes: string[];
};

type TestPerfProfile = {
  attempts: number;
  numPredict: number;
  allowVision: boolean;
};

type AttemptRuntimeProfile = {
  numPredict: number;
  timeoutMs: number;
};

function normalizeText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractBalancedJsonArray(raw: string): string | null {
  const s = raw.trim();
  const start = s.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (c === "\\") {
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Model często owija odpowiedź w ```json … ``` — bez tego JSON.parse wyjątek → cisza i 0 pytań. */
function stripMarkdownCodeFence(raw: string): string {
  let t = raw.trim();
  if (!t.startsWith("```")) return t;
  const firstNl = t.indexOf("\n");
  if (firstNl === -1) return t;
  t = t.slice(firstNl + 1);
  const end = t.lastIndexOf("```");
  if (end >= 0) t = t.slice(0, end);
  return t.trim();
}

function parseJsonRoot(raw: string): unknown | null {
  const cleaned = stripMarkdownCodeFence(raw.trim());
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const arrOnly = extractBalancedJsonArray(cleaned);
    if (!arrOnly) return null;
    try {
      return JSON.parse(arrOnly) as unknown;
    } catch {
      return null;
    }
  }
}

function coerceToQuestionRecords(root: unknown): Record<string, unknown>[] | null {
  if (root === null || root === undefined) return null;
  if (Array.isArray(root)) {
    return root.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  }
  if (typeof root === "object") {
    const o = root as Record<string, unknown>;
    for (const key of [
      "questions",
      "items",
      "data",
      "pytania",
      "test",
      "wynik",
      "results",
    ]) {
      const v = o[key];
      if (Array.isArray(v)) {
        return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
      }
    }
    if (
      "question" in o &&
      ("option_a" in o || "option_b" in o || "A" in o || "B" in o)
    ) {
      return [o];
    }
  }
  return null;
}

function parseQuestions(
  raw: string,
  page: number | null,
): {
  questions: GeneratedTestQuestion[];
  rejects: Pick<TestGenerationRejectReasons, "invalid_shape" | "duplicate_options" | "invalid_json">;
} {
  const parsedRoot = parseJsonRoot(raw);
  const records = coerceToQuestionRecords(parsedRoot);
  if (!records || records.length === 0) {
    return {
      questions: [],
      rejects: {
        invalid_shape: 1,
        duplicate_options: 0,
        invalid_json: parsedRoot == null ? 1 : 0,
      },
    };
  }
  const out: GeneratedTestQuestion[] = [];
  let invalidShape = 0;
  let duplicateOptions = 0;
  for (const item of records) {
    const r = item;
    const question = normalizeText(String(r.question ?? ""));
    const optionA = normalizeText(String(r.option_a ?? r.A ?? ""));
    const optionB = normalizeText(String(r.option_b ?? r.B ?? ""));
    const optionC = normalizeText(String(r.option_c ?? r.C ?? ""));
    const optionD = normalizeText(String(r.option_d ?? r.D ?? ""));
    const correctRaw = String(
      r.correct_option ?? r.correct ?? r.answer ?? "",
    ).toUpperCase();
    const correct =
      correctRaw === "A" || correctRaw === "B" || correctRaw === "C" || correctRaw === "D"
        ? (correctRaw as "A" | "B" | "C" | "D")
        : null;
    const explanation = normalizeText(String(r.explanation ?? r.why ?? ""));
    const requiresImageRaw = r.requires_image;
    let requiresImageFlag =
      requiresImageRaw === true ||
      requiresImageRaw === 1 ||
      String(requiresImageRaw ?? "").toLowerCase() === "true"
        ? 1
        : 0;
    const cropX = Number(r.crop_x);
    const cropY = Number(r.crop_y);
    const cropW = Number(r.crop_w);
    const cropH = Number(r.crop_h);
    const validCrop =
      Number.isFinite(cropX) &&
      Number.isFinite(cropY) &&
      Number.isFinite(cropW) &&
      Number.isFinite(cropH) &&
      cropX >= 0 &&
      cropY >= 0 &&
      cropW > 0 &&
      cropH > 0 &&
      cropX + cropW <= 100 &&
      cropY + cropH <= 100;
    const unique = new Set([optionA, optionB, optionC, optionD]);
    if (
      !question ||
      !optionA ||
      !optionB ||
      !optionC ||
      !optionD ||
      !correct ||
      unique.size < 4
    ) {
      if (unique.size < 4) duplicateOptions += 1;
      else invalidShape += 1;
      continue;
    }
    // Model często ustawia requires_image=false mimo kadru (np. cała strona 0,0,100,100) — wtedy i tak pokazujemy wycinek.
    if (validCrop && cropW > 0 && cropH > 0) {
      requiresImageFlag = 1;
    }
    const slideRaw = r.slide_index ?? r.page ?? r.page_number;
    let slideIndex: number | null = page;
    if (typeof slideRaw === "number" && Number.isFinite(slideRaw)) {
      slideIndex = slideRaw;
    } else if (typeof slideRaw === "string" && /^\d+$/.test(slideRaw.trim())) {
      slideIndex = parseInt(slideRaw.trim(), 10);
    }
    out.push({
      slide_index: slideIndex,
      question,
      option_a: optionA,
      option_b: optionB,
      option_c: optionC,
      option_d: optionD,
      correct_option: correct,
      explanation: explanation || "Poprawna odpowiedź wynika bezpośrednio z treści tej strony.",
      requires_image: requiresImageFlag,
      crop_x: validCrop ? cropX : null,
      crop_y: validCrop ? cropY : null,
      crop_w: validCrop ? cropW : null,
      crop_h: validCrop ? cropH : null,
    });
  }
  return {
    questions: out,
    rejects: {
      invalid_shape: invalidShape,
      duplicate_options: duplicateOptions,
      invalid_json: 0,
    },
  };
}

function dedupeQuestions(
  questions: GeneratedTestQuestion[],
): { deduped: GeneratedTestQuestion[]; removed: number } {
  const seen = new Set<string>();
  const out: GeneratedTestQuestion[] = [];
  let removed = 0;
  for (const q of questions) {
    const key = normalizeText(q.question).toLowerCase();
    if (!key || seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    out.push(q);
  }
  return { deduped: out, removed };
}

function buildEmptyRejectReasons(): TestGenerationRejectReasons {
  return {
    invalid_shape: 0,
    duplicate_options: 0,
    quality_gate: 0,
    duplicate_question: 0,
    invalid_json: 0,
    timeout: 0,
    other_error: 0,
  };
}

function isNegativeQuestionStem(question: string): boolean {
  const t = normalizeText(question).toLowerCase();
  return /\b(nie|fałszywe|nieprawidłowe|nie jest|nieprawda)\b/.test(t);
}

function scoreQuestionQuality(
  q: GeneratedTestQuestion,
  context: string,
): { score: number; failed: string[] } {
  const failed: string[] = [];
  let score = 0;

  // 1) unique_answer - zawsze true po parse/validation, ale zostawiamy jawny punkt rubryki.
  score += 1;

  // 2) distractor_plausibility
  const options = [q.option_a, q.option_b, q.option_c, q.option_d].map((x) => normalizeText(x));
  const avgLen = options.reduce((acc, x) => acc + x.length, 0) / 4;
  const hasTooShort = options.some((x) => x.length < 6);
  const hasHugeLengthSkew = options.some((x) => x.length > avgLen * 2.4);
  if (!hasTooShort && !hasHugeLengthSkew) score += 1;
  else failed.push("distractor_plausibility");

  // 3) source_alignment
  const ctx = normalizeText(context).toLowerCase();
  const qTokens = normalizeText(q.question)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 5);
  const aligned =
    ctx.length === 0 ||
    qTokens.some((t) => ctx.includes(t)) ||
    q.requires_image === 1;
  if (aligned) score += 1;
  else failed.push("source_alignment");

  // 4) non_triviality
  const nonTrivial =
    q.question.length >= 48 &&
    !/\b(co to jest|zdefiniuj|jak nazywa się)\b/i.test(q.question);
  if (nonTrivial) score += 1;
  else failed.push("non_triviality");

  // 5) no_surface_cues
  const correctIdx = q.correct_option === "A" ? 0 : q.correct_option === "B" ? 1 : q.correct_option === "C" ? 2 : 3;
  const correctLen = options[correctIdx]?.length ?? 0;
  const maxLen = Math.max(...options.map((x) => x.length));
  const hasSurfaceCue = correctLen === maxLen && options.filter((x) => x.length === maxLen).length === 1;
  if (!hasSurfaceCue) score += 1;
  else failed.push("no_surface_cues");

  // 6) explanation_quality
  const explanationQuality = q.explanation.length >= 45;
  if (explanationQuality) score += 1;
  else failed.push("explanation_quality");

  return { score, failed };
}

function classifyGenerationError(
  error: unknown,
): "timeout" | "invalid_json" | "other_error" {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (lower.includes("timeout")) return "timeout";
  if (lower.includes("json")) return "invalid_json";
  return "other_error";
}

function getAttemptRuntimeProfile(
  perf: TestPerfProfile,
  attemptIndex: number,
): AttemptRuntimeProfile {
  if (!getLowSpecTestModeEnabled()) {
    return { numPredict: 4096, timeoutMs: 300_000 };
  }
  if (attemptIndex === 0) {
    return { numPredict: Math.max(perf.numPredict, 3200), timeoutMs: 300_000 };
  }
  return { numPredict: 4096, timeoutMs: 300_000 };
}

function computeQuestionTargetRange(minRequested: number): {
  min: number;
  max: number;
} {
  const min = Math.max(1, Math.floor(minRequested));
  const extra = Math.max(1, Math.ceil(min * 0.1));
  return { min, max: min + extra };
}

function computePlannedPerChunk(
  minRequested: number,
  chunkCount: number,
  isLowSpec: boolean,
): number {
  if (chunkCount <= 0) return 3;
  const raw = Math.ceil(minRequested / chunkCount);
  // Ważne: nie ograniczamy już górnego pułapu stałym capem,
  // bo mogło to uniemożliwić osiągnięcie minimum N (np. 40 pytań).
  // LowSpec nadal ma ochronę przez timeout/retry i quality gate.
  const minFloor = isLowSpec ? 2 : 3;
  return Math.max(minFloor, raw);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label}: timeout po ${timeoutMs} ms`)),
      timeoutMs,
    );
    promise
      .then((v) => resolve(v))
      .catch((e) => reject(e))
      .finally(() => clearTimeout(id));
  });
}

async function runOllamaJsonChatForTests(
  model: string,
  options: TestGenerationOptions | undefined,
  numPredict: number,
  timeoutMs: number,
  timeoutLabel: string,
  visionMessages: ImageChatMessage[] | null,
  textMessages: { role: string; content: string }[],
): Promise<string> {
  const opts: AiOptions = {
    format: "json",
    temperature: 0.3,
    numPredict,
    think: false,
  };

  if (!useSingleShotCloudGeneration()) {
    await sleep(geminiBatchDelayMs());
  }

  if (!options?.onDevLog) {
    const provider = getAiProvider();
    if (visionMessages) {
      return await withTimeout(
        provider.chatWithImages(model, visionMessages, opts),
        timeoutMs,
        timeoutLabel,
      );
    }
    return await withTimeout(
      provider.chat(model, textMessages, opts),
      timeoutMs,
      timeoutLabel,
    );
  }

  let raw = "";
  let thinkingAcc = "";
  const flushThinking = () => {
    const t = thinkingAcc.trim();
    if (t.length > 0) {
      options?.onDevLog?.(`💭 ${t}`);
      thinkingAcc = "";
    }
  };
  const onDelta = (d: StreamDelta) => {
    if (d.kind === "thinking") {
      thinkingAcc += d.delta;
      return;
    }
    flushThinking();
    raw += d.delta;
  };

  const provider = getAiProvider();
  await withTimeout(
    visionMessages
      ? provider.chatWithImagesStream(model, visionMessages, opts, onDelta)
      : provider.chatStream(model, textMessages, opts, onDelta),
    timeoutMs,
    timeoutLabel,
  );
  flushThinking();
  return raw;
}

function getTestPerfProfile(): TestPerfProfile {
  if (getLowSpecTestModeEnabled()) {
    return {
      attempts: 2,
      /** Wystarczy na tablicę JSON z 2 pytaniami; wyżej niż stare 1200, żeby nie ucinało odpowiedzi. */
      numPredict: 2400,
      /** Wizja włączona — OCR/czytanie strony idzie przez model multimodalny; RAM oszczędzamy lżejszym JPEG (patrz pdfPageToImageBase64 + PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS). */
      allowVision: true,
    };
  }
  return {
    attempts: 3,
    numPredict: 4096,
    allowVision: true,
  };
}

function buildSourcePagesFromChunks(
  chunks: ChunkRow[],
  sourceKind: string | undefined,
  filePath: string | null | undefined,
): Promise<SourcePage[]> | SourcePage[] {
  const grouped = new Map<number, string[]>();
  for (const c of chunks) {
    const page = c.slide_index ?? 1;
    const body = normalizeText(c.body);
    if (!body) continue;
    if (!grouped.has(page)) grouped.set(page, []);
    grouped.get(page)!.push(body);
  }
  const isPdfWithFile = sourceKind?.toLowerCase() === "pdf" && !!filePath;
  if (isPdfWithFile && filePath) {
    return pdfGetPageCount(filePath).then((numPages) => {
      const out: SourcePage[] = [];
      for (let p = 1; p <= numPages; p++) {
        const bodies = grouped.get(p);
        const context = bodies?.length ? normalizeText(bodies.join("\n\n")) : "";
        out.push({ slide_index: p, context });
      }
      return out;
    });
  }
  return [...grouped.entries()]
    .map(([slide_index, bodies]) => ({
      slide_index,
      context: normalizeText(bodies.join("\n\n")),
    }))
    .filter((p) => p.context.length > 60)
    .sort((a, b) => a.slide_index - b.slide_index);
}

function applyDevRange(
  pages: SourcePage[],
  range: { start: number; end: number } | undefined,
): SourcePage[] {
  if (!range) return pages;
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  return pages.filter((p) => p.slide_index >= lo && p.slide_index <= hi);
}

function buildSmartChunks(pages: SourcePage[]): SmartChunk[] {
  const chunks: SmartChunk[] = [];
  let cursor = 0;
  while (cursor < pages.length) {
    const buffer: SourcePage[] = [];
    let chars = 0;
    while (cursor < pages.length && buffer.length < MAX_PAGES) {
      const p = pages[cursor]!;
      buffer.push(p);
      chars += p.context.length;
      cursor += 1;
      if (chars >= MIN_CHUNK_SIZE && buffer.length >= 3) break;
    }
    if (buffer.length === 0) break;
    const startPage = buffer[0]!.slide_index;
    const endPage = buffer[buffer.length - 1]!.slide_index;
    const representativePage = buffer[Math.floor(buffer.length / 2)]!.slide_index;
    const pageRange = startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`;
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      startPage,
      endPage,
      representativePage,
      pageRange,
      context: buffer.map((p) => p.context).filter(Boolean).join("\n\n"),
      sourcePages: buffer,
      visionNotes: [],
    });
  }
  return chunks;
}

async function enrichChunkWithVisionNotes(
  chunk: SmartChunk,
  model: string,
  options: TestGenerationOptions | undefined,
  perf: TestPerfProfile,
): Promise<{ chunk: SmartChunk; visionCalls: number }> {
  if (options?.sourceKind?.toLowerCase() !== "pdf" || !options.filePath) {
    return { chunk, visionCalls: 0 };
  }
  const visionCandidates = chunk.sourcePages
    .filter((p) => normalizeText(p.context).length < VISION_TEXT_THRESHOLD)
    .slice(0, MAX_VISION_PAGES_PER_CHUNK);
  if (visionCandidates.length === 0) return { chunk, visionCalls: 0 };
  const notes: string[] = [];
  let calls = 0;
  for (const p of visionCandidates) {
    try {
      const image = await pdfPageToImageBase64(
        options.filePath,
        p.slide_index,
        getLowSpecTestModeEnabled()
          ? PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS
          : PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
      );
      const summary = await runOllamaJsonChatForTests(
        model,
        options,
        Math.max(1024, perf.numPredict),
        120_000,
        `Vision opis slajdu ${p.slide_index}`,
        [
          {
            role: "system",
            content:
              "Jesteś asystentem analizy slajdów. Zwróć krótką listę kluczowych informacji z obrazu (tabela, schemat, wykres).",
          },
          {
            role: "user",
            content:
              "Opisz tylko to, co istotne do tworzenia pytań testowych. Bez markdown, zwięźle.",
            images: [image],
          },
        ],
        [],
      );
      calls += 1;
      notes.push(`Slajd ${p.slide_index}: ${normalizeText(summary).slice(0, 900)}`);
    } catch {
      // Vision note is best-effort.
    }
  }
  if (notes.length === 0) return { chunk, visionCalls: calls };
  return {
    visionCalls: calls,
    chunk: {
      ...chunk,
      visionNotes: notes,
      context: `${chunk.context}\n\nVISION_NOTES:\n${notes.map((n) => `- ${n}`).join("\n")}`,
    },
  };
}

async function optimizeQuizSet(
  model: string,
  options: TestGenerationOptions | undefined,
  questions: GeneratedTestQuestion[],
  minCount: number,
  maxCount: number,
): Promise<GeneratedTestQuestion[]> {
  if (questions.length <= maxCount) return questions;
  const list = questions
    .map(
      (q, idx) =>
        `${idx + 1}. [slide=${q.slide_index ?? "?"}] ${q.question}\nA) ${q.option_a}\nB) ${q.option_b}\nC) ${q.option_c}\nD) ${q.option_d}\ncorrect=${q.correct_option}\nexplanation=${q.explanation}`,
    )
    .join("\n\n");
  const raw = await runOllamaJsonChatForTests(
    model,
    options,
    4096,
    180_000,
    "Quiz Optimizer",
    null,
    [
      {
        role: "system",
        content:
          "Jesteś optymalizatorem zestawu pytań. Zwracasz wyłącznie tablicę JSON pytań w tym samym schemacie co wejście.",
      },
      {
        role: "user",
        content: `Oto zestaw pytań. Usuń duplikaty i wybierz od ${minCount} do ${maxCount} najbardziej wartościowych merytorycznie pytań. Zadbaj o równomierne pokrycie materiału.\n\n${list}`,
      },
    ],
  );
  const parsed = parseQuestions(raw, null).questions;
  if (parsed.length === 0) return questions.slice(0, maxCount);
  return parsed.slice(0, maxCount);
}

async function generateChunkFocusedTopUpQuestions(
  model: string,
  options: TestGenerationOptions | undefined,
  chunks: SmartChunk[],
  existingQuestions: GeneratedTestQuestion[],
  need: number,
): Promise<GeneratedTestQuestion[]> {
  if (need <= 0 || chunks.length === 0) return [];
  // Dogrywka oparta o konkretną paczkę zwykle daje stabilniejszy JSON
  // i mniej halucynacji niż globalny prompt przez cały dokument.
  const MAX_CONTEXT_CHARS = 14_000;
  const out: GeneratedTestQuestion[] = [];
  const seen = new Set(
    existingQuestions.map((q) => normalizeText(q.question).toLowerCase()),
  );
  for (let attempt = 0; attempt < 10 && out.length < need; attempt++) {
    const remaining = need - out.length;
    const batchSize = Math.min(3, remaining);
    const chunk = chunks[attempt % chunks.length]!;
    const chunkContext = normalizeText(chunk.context).slice(0, MAX_CONTEXT_CHARS);
    const forbidden = [
      ...existingQuestions.map((q) => q.question),
      ...out.map((q) => q.question),
    ]
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n");
    const user = `Wygeneruj DOKŁADNIE ${batchSize} NOWYCH pytań ABCD w JSON na podstawie całego materiału.

Format JSON:
[
  {
    "question":"...",
    "option_a":"...",
    "option_b":"...",
    "option_c":"...",
    "option_d":"...",
    "correct_option":"A|B|C|D",
    "explanation":"krótkie uzasadnienie",
    "requires_image": true|false,
    "crop_x": 0-100,
    "crop_y": 0-100,
    "crop_w": 0-100,
    "crop_h": 0-100
  }
]

Zasady:
- nie powtarzaj żadnego pytania z listy zakazanej,
- każda odpowiedź A/B/C/D musi być inna,
- pytania mają wymagać rozumienia i łączenia faktów z paczki.

Pytania zakazane (nie powtarzaj):
${forbidden || "(brak)"}

KONTEKST PACZKI (${chunk.pageRange}):
---
${chunkContext}
---`;
    const raw = await runOllamaJsonChatForTests(
      model,
      options,
      4096,
      300_000,
      "Global top-up pytań",
      null,
      [
        {
          role: "system",
          content:
            "Jesteś akademickim twórcą pytań egzaminacyjnych. Zwracasz WYŁĄCZNIE tablicę JSON pytań ABCD.",
        },
        { role: "user", content: user },
      ],
    );
    const parsed = parseQuestions(raw, null).questions;
    for (const q of parsed) {
      if (out.length >= need) break;
      const key = normalizeText(q.question).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
    options?.onDevLog?.(
      `Chunk top-up batch ${attempt + 1}/10: raw=${parsed.length}, accepted=${out.length}/${need}, chunk=${chunk.pageRange}`,
    );
  }
  return out;
}

async function generateTestsGeminiSingleShot(
  model: string,
  chunks: ChunkRow[],
  onProgress?: (p: TestGenProgress) => void,
  options?: TestGenerationOptions,
): Promise<TestGenerationResult> {
  const targetRange = computeQuestionTargetRange(
    options?.finalQuestionLimit ?? DEFAULT_FINAL_QUESTION_LIMIT,
  );
  const targetCount = targetRange.min;
  const difficulty = options?.difficulty ?? DEFAULT_TEST_DIFFICULTY;

  const isPdf =
    options?.sourceKind?.toLowerCase() === "pdf" && !!options.filePath?.trim();
  let raw: string;
  let contextForQuality = "";
  let chunkCount = 0;
  let pageRangeLabel: string;
  const startedAt = Date.now();

  if (isPdf && options.filePath) {
    onProgress?.({
      label: "Wysyłam PDF do analizy (tekst + wykresy)…",
      percent: 12,
      stepIndex: 1,
      steps: GEMINI_TEST_PROGRESS_STEPS,
    });
    const { system, user } = buildTestsGeminiPdfPrompt(
      targetCount,
      options.devPageRange,
      difficulty,
    );
    options?.onDevLog?.(`Gemini test: PDF ${options.filePath}`);
    raw = await runWithGeminiWaitProgress(
      onProgress,
      {
        label: `Gemini analizuje PDF i tworzy ${targetCount} pytań…`,
        percent: 28,
        stepIndex: 2,
        steps: GEMINI_TEST_PROGRESS_STEPS,
      },
      () =>
        withTimeout(
          getGeminiProvider().chatWithPdf(
            model,
            system,
            user,
            options.filePath!,
            {
              format: "json",
              temperature: 0.32,
              numPredict: geminiTestNumPredict(targetCount),
              think: false,
            },
          ),
          600_000,
          "Generowanie testu z PDF (Gemini)",
        ),
      { messageKind: "tests" },
    );
    chunkCount = chunks.length;
    pageRangeLabel = options.devPageRange
      ? `PDF str. ${Math.min(options.devPageRange.start, options.devPageRange.end)}–${Math.max(options.devPageRange.start, options.devPageRange.end)}`
      : "PDF (analiza wizualna)";
  } else {
    onProgress?.({
      label: "Przygotowuję pełny materiał tekstowy…",
      percent: 8,
      stepIndex: 0,
      steps: GEMINI_TEST_PROGRESS_STEPS,
    });
    const scoped = filterChunksByPageRange(chunks, options?.devPageRange);
    const built = buildFullTestMaterialContext(scoped, options?.devPageRange);
    contextForQuality = built.context;
    chunkCount = built.chunkCount;

    if (!built.context.trim()) {
      throw new Error(
        isPdf
          ? "Brak ścieżki do pliku PDF."
          : "Brak treści do wygenerowania testu. Dla PPTX używamy warstwy tekstowej slajdów.",
      );
    }

    options?.onDevLog?.(
      `Gemini test: tekst, ${built.chunkCount} fragmentów, ${built.charCount} znaków` +
        (built.truncated ? " (obcięty)" : ""),
    );

    onProgress?.({
      label: `Przygotowuję zapytanie o ${targetCount} pytań…`,
      percent: 16,
      stepIndex: 1,
      steps: GEMINI_TEST_PROGRESS_STEPS,
    });

    const { system, user } = buildTestsGeminiPrompt(
      built.context,
      targetCount,
      difficulty,
    );
    raw = await runWithGeminiWaitProgress(
      onProgress,
      {
        label: `Gemini tworzy ${targetCount} pytań z materiału…`,
        percent: 28,
        stepIndex: 2,
        steps: GEMINI_TEST_PROGRESS_STEPS,
      },
      () =>
        withTimeout(
          getAiProvider().chat(
            model,
            [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            {
              format: "json",
              temperature: 0.32,
              numPredict: geminiTestNumPredict(targetCount),
              think: false,
            },
          ),
          300_000,
          "Generowanie testu (Gemini)",
        ),
      { messageKind: "tests" },
    );
    pageRangeLabel = built.truncated
      ? `tekst (obcięty, ${built.chunkCount} fragm.)`
      : "tekst (pełny materiał)";
  }

  const latencyMs = Date.now() - startedAt;

  onProgress?.({
    label: "Przetwarzam pytania…",
    percent: 85,
    stepIndex: 3,
    steps: GEMINI_TEST_PROGRESS_STEPS,
  });

  const parsed = parseQuestions(raw, null);
  const rejectReasons = buildEmptyRejectReasons();
  rejectReasons.invalid_shape += parsed.rejects.invalid_shape;
  rejectReasons.duplicate_options += parsed.rejects.duplicate_options;
  rejectReasons.invalid_json += parsed.rejects.invalid_json;

  const qualityKept: GeneratedTestQuestion[] = [];
  let totalQualityScore = 0;
  for (const q of parsed.questions) {
    const quality = scoreQuestionQuality(q, contextForQuality);
    totalQualityScore += quality.score;
    if (quality.score < QUALITY_GATE_MIN_SCORE) {
      rejectReasons.quality_gate += 1;
      continue;
    }
    qualityKept.push(q);
  }

  const dedupeResult = dedupeQuestions(qualityKept);
  rejectReasons.duplicate_question += dedupeResult.removed;
  let questions = dedupeResult.deduped.slice(0, targetRange.max);

  if (questions.length === 0) {
    const failureMsg = formatTestGenerationFailureMessage({
      targetCount,
      parsedCount: parsed.questions.length,
      afterQualityCount: qualityKept.length,
      finalCount: questions.length,
      rejectReasons,
    });
    options?.onDevLog?.(
      `Gemini test — odrzucono cały wynik: parsed=${parsed.questions.length}, quality=${qualityKept.length}, deduped=${dedupeResult.deduped.length}, target=${targetCount}, rawLen=${raw.trim().length}, rejects=${JSON.stringify(rejectReasons)}`,
    );
    throw new Error(failureMsg);
  }

  onProgress?.({
    label: "Test gotowy.",
    percent: 99,
    stepIndex: 3,
    steps: GEMINI_TEST_PROGRESS_STEPS,
  });

  return {
    questions,
    metrics: {
      model,
      isLowSpec: false,
      generationMode: "smart_chunking",
      chunkCount,
      pageRanges: [pageRangeLabel],
      targetQuestionLimit: targetRange.min,
      targetQuestionMax: targetRange.max,
      minimumSatisfied: questions.length >= targetRange.min,
      plannedPerChunk: targetCount,
      generatedPreOptimizer: parsed.questions.length,
      generatedPostOptimizer: questions.length,
      fallbackUsed: questions.length < targetRange.min,
      optimizerApplied: false,
      optimizerDropCount: Math.max(0, parsed.questions.length - questions.length),
      pagesTotal: chunks.length,
      pagesWithAnyParsed: questions.length > 0 ? 1 : 0,
      questionsBeforeDedupe: parsed.questions.length,
      questionsAfterDedupe: questions.length,
      qualityAverage:
        qualityKept.length > 0 ? totalQualityScore / qualityKept.length : 0,
      textCalls: 1,
      visionCalls: isPdf ? 1 : 0,
      totalLatencyMs: latencyMs,
      rejectReasons,
      difficulty,
    },
  };
}

export async function generateTestQuestionsFromChunks(
  model: string,
  chunks: ChunkRow[],
  onProgress?: (p: TestGenProgress) => void,
  options?: TestGenerationOptions,
): Promise<TestGenerationResult> {
  if (useSingleShotCloudGeneration()) {
    return generateTestsGeminiSingleShot(model, chunks, onProgress, options);
  }

  const devLog = (msg: string) => {
    options?.onDevLog?.(msg);
  };
  const difficulty = options?.difficulty ?? DEFAULT_TEST_DIFFICULTY;
  const perf = getTestPerfProfile();
  const sourcePagesRaw = await buildSourcePagesFromChunks(
    chunks,
    options?.sourceKind,
    options?.filePath,
  );
  const sourcePages = applyDevRange(sourcePagesRaw, options?.devPageRange);
  if (options?.devPageRange) {
    const lo = Math.min(options.devPageRange.start, options.devPageRange.end);
    const hi = Math.max(options.devPageRange.start, options.devPageRange.end);
    devLog(`Zakres DEV: strony/slajdy ${lo}–${hi} → ${sourcePages.length} stron po filtrze`);
  }
  if (sourcePages.length === 0) {
    throw new Error("Brak treści do wygenerowania testu.");
  }
  const generationMode = options?.mode ?? "smart_chunking";
  let chunksToProcess: SmartChunk[] =
    generationMode === "legacy_page_mode"
      ? sourcePages.map((p, idx) => ({
          id: `legacy-${idx + 1}`,
          startPage: p.slide_index,
          endPage: p.slide_index,
          representativePage: p.slide_index,
          pageRange: `${p.slide_index}`,
          context: p.context,
          sourcePages: [p],
          visionNotes: [],
        }))
      : buildSmartChunks(sourcePages);

  devLog(
    `Start: model=${model}, mode=${generationMode}, trudność=${difficulty}, lowSpec=${getLowSpecTestModeEnabled()}, paczek=${chunksToProcess.length}, próby/paczka=${perf.attempts}`,
  );
  const idxPreview =
    chunksToProcess.length <= 24
      ? chunksToProcess.map((p) => p.pageRange).join(", ")
      : `${chunksToProcess
          .slice(0, 18)
          .map((p) => p.pageRange)
          .join(", ")}, … (+${chunksToProcess.length - 18})`;
  devLog(`Kolejka paczek (${chunksToProcess.length}): ${idxPreview}`);

  const all: GeneratedTestQuestion[] = [];
  const preOptimizerCandidates: GeneratedTestQuestion[] = [];
  let pagesWithAnyParsed = 0;
  let lastPageFailure: string | null = null;
  const rejectReasons = buildEmptyRejectReasons();
  let totalQualityScore = 0;
  let qualityScoredCount = 0;
  let textCalls = 0;
  let visionCalls = 0;
  let totalLatencyMs = 0;
  const targetRange = computeQuestionTargetRange(
    options?.finalQuestionLimit ?? DEFAULT_FINAL_QUESTION_LIMIT,
  );
  const targetFinalQuestionsMin = targetRange.min;
  const targetFinalQuestionsMax = targetRange.max;
  const plannedPerChunk = computePlannedPerChunk(
    targetFinalQuestionsMin,
    chunksToProcess.length,
    getLowSpecTestModeEnabled(),
  );
  const totalTargetQuestions = chunksToProcess.length * plannedPerChunk;
  const minNegativeQuestions = Math.ceil(totalTargetQuestions * NEGATIVE_QUESTION_RATIO_MIN);
  const maxNegativeQuestions = Math.floor(totalTargetQuestions * NEGATIVE_QUESTION_RATIO_MAX);
  let currentNegativeQuestions = 0;
  for (let i = 0; i < chunksToProcess.length; i++) {
    const chunk = chunksToProcess[i]!;
    const enrich = await enrichChunkWithVisionNotes(chunk, model, options, perf);
    chunksToProcess[i] = enrich.chunk;
    visionCalls += enrich.visionCalls;
    const target = plannedPerChunk;
    onProgress?.({
      label: `Tworzę pytania dla paczki ${chunk.pageRange} (${target})…`,
      percent: 8 + Math.round(((i + 0.2) / chunksToProcess.length) * 84),
    });

    devLog(
      `--- Paczka ${chunk.pageRange} [${i + 1}/${chunksToProcess.length}] | ctxLen=${chunk.context.length} | visionNotes=${chunk.visionNotes.length} | cel=${target} pytań`,
    );

    const system = getTestDifficultyOllamaSystem(difficulty);

    const jsonAndRules = `Format JSON:
[
  {
    "question":"...",
    "option_a":"...",
    "option_b":"...",
    "option_c":"...",
    "option_d":"...",
    "correct_option":"A|B|C|D",
    "explanation":"krótkie uzasadnienie poprawnej odpowiedzi",
    "requires_image": true|false,
    "crop_x": 0-100,
    "crop_y": 0-100,
    "crop_w": 0-100,
    "crop_h": 0-100
  }
]

Zasady:
- każde pytanie dotyczy INNEGO faktu z paczki slajdów;
- tylko jedna poprawna odpowiedź;
${getTestDifficultyOllamaChunkRules(difficulty)}
- unikaj "wszystkie powyższe" i "żadne z powyższych";
- jeśli pytanie dotyczy grafiki/diagramu/wykresu/tabeli, ustaw requires_image=true i podaj kadr (crop_x/y/w/h) tego elementu w procentach strony;
- jeśli pytanie nie dotyczy grafiki, ustaw requires_image=false i zostaw crop_* jako 0;
- nie używaj markdown.`;

    const remainingPages = chunksToProcess.length - i;
    const remainingMinNeeded = Math.max(0, minNegativeQuestions - currentNegativeQuestions);
    const mustForceNegativeNow = remainingMinNeeded >= remainingPages;
    const canAddNegative = currentNegativeQuestions < maxNegativeQuestions;
    const negativeGuidance = mustForceNegativeNow
      ? "W tej odpowiedzi DOKŁADNIE jedno z pytań ma być negatywne (np. „Które NIE jest ...”)."
      : canAddNegative
        ? "Możesz dać pytanie negatywne, ale nie więcej niż jedno w tym zestawie."
        : "Nie twórz pytania negatywnego w tym zestawie.";
    const primaryArchetype = QUESTION_ARCHETYPES[i % QUESTION_ARCHETYPES.length];
    const secondaryArchetype =
      QUESTION_ARCHETYPES[(i + 1) % QUESTION_ARCHETYPES.length];
    const benchmarkGuidance = getTestDifficultyBlueprint(difficulty, target);
    const questionAdj = getTestDifficultyAdjective(difficulty);
    const useVision = chunk.visionNotes.length > 0;

    const user = useVision
      ? `Przeanalizuj paczkę slajdów (${chunk.pageRange}). Wygeneruj DOKŁADNIE ${target} ${questionAdj} pytań ABCD w formacie JSON. Pytania muszą łączyć fakty z różnych części fragmentu.

${jsonAndRules}

${negativeGuidance}
${benchmarkGuidance}
- archetyp pytania #1: ${primaryArchetype},
- archetyp pytania #2: ${secondaryArchetype},

KONTEKST (obrazy + notatki wizji):
---
${chunk.context.slice(0, MAX_PAGE_CONTEXT_CHARS_TEXT).trim()}
---`
      : `Przeanalizuj poniższą paczkę slajdów (${chunk.pageRange}). Wygeneruj DOKŁADNIE ${target} ${questionAdj} pytań ABCD w formacie JSON. Pytania muszą łączyć fakty z różnych części tego fragmentu.

${jsonAndRules}

${negativeGuidance}
${benchmarkGuidance}
- archetyp pytania #1: ${primaryArchetype},
- archetyp pytania #2: ${secondaryArchetype},

KONTEKST:
---
${chunk.context.slice(0, MAX_PAGE_CONTEXT_CHARS_TEXT).trim()}
---`;

    let generated: GeneratedTestQuestion[] = [];
    const attempts = perf.attempts;
    for (let a = 0; a < attempts; a++) {
      const basePercent = 8 + Math.round(((i + 0.25 + a * 0.2) / chunksToProcess.length) * 84);
      let heartbeat = 0;
      onProgress?.({
        label: `Paczka ${chunk.pageRange}: próba ${a + 1}/${attempts}…`,
        percent: Math.min(94, basePercent),
      });
      const heartbeatId = setInterval(() => {
        heartbeat += 1;
        onProgress?.({
          label: `Paczka ${chunk.pageRange}: generuję pytania (${heartbeat * 3}s)…`,
          percent: Math.min(94, basePercent),
        });
      }, HEARTBEAT_MS);
      try {
        let raw: string;
        const runtime = getAttemptRuntimeProfile(perf, a);
        const callStartedAt = Date.now();
        if (chunk.visionNotes.length > 0) {
          textCalls += 1;
          raw = await runOllamaJsonChatForTests(
            model,
            options,
            runtime.numPredict,
            runtime.timeoutMs,
            `Generowanie pytań (paczka ${chunk.pageRange})`,
            null,
            [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          );
        } else {
          textCalls += 1;
          raw = await runOllamaJsonChatForTests(
            model,
            options,
            runtime.numPredict,
            runtime.timeoutMs,
            `Generowanie pytań (paczka ${chunk.pageRange})`,
            null,
            [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          );
        }
        totalLatencyMs += Date.now() - callStartedAt;
        const parsed = parseQuestions(raw, chunk.representativePage);
        generated = parsed.questions;
        rejectReasons.invalid_shape += parsed.rejects.invalid_shape;
        rejectReasons.duplicate_options += parsed.rejects.duplicate_options;
        rejectReasons.invalid_json += parsed.rejects.invalid_json;
        const qualityKept: GeneratedTestQuestion[] = [];
        for (const q of generated) {
          const quality = scoreQuestionQuality(q, chunk.context);
          totalQualityScore += quality.score;
          qualityScoredCount += 1;
          if (quality.score < QUALITY_GATE_MIN_SCORE) {
            rejectReasons.quality_gate += 1;
            continue;
          }
          qualityKept.push(q);
        }
        generated = qualityKept;
        devLog(
          `  próba ${a + 1}/${attempts}: odpowiedź ${raw.length} zn. → ${generated.length} pytań po quality gate (>=${QUALITY_GATE_MIN_SCORE}/6)`,
        );
      } catch (e) {
        lastPageFailure =
          e instanceof Error ? e.message : `Paczka ${chunk.pageRange}: ${String(e)}`;
        generated = [];
        const reason = classifyGenerationError(e);
        rejectReasons[reason] += 1;
        devLog(
          `  próba ${a + 1}/${attempts}: BŁĄD ${lastPageFailure}`,
        );
      } finally {
        clearInterval(heartbeatId);
      }
      if (generated.length >= target) break;
    }

    if (generated.length < target) {
      let need = target - generated.length;
      onProgress?.({
        label: `Paczka ${chunk.pageRange}: uzupełniam brakujące pytania (${need})…`,
        percent: Math.min(
          94,
          8 + Math.round(((i + 0.85) / chunksToProcess.length) * 84),
        ),
      });
      const excludeBlock = generated
        .map((g, j) => `${j + 1}. ${g.question}`)
        .join("\n");
      const topUpIntro = `Wygeneruj DOKŁADNIE ${need} dodatkowe pytania (tablica JSON z ${need} obiektami). Każde dotyczy INNEGO faktu niż poniższe — nie duplikuj treści.

Już wygenerowane pytania w tej paczce (nie powtarzaj):
${excludeBlock}

${jsonAndRules}`;
      const topUpUser = useVision
        ? `${topUpIntro}

Kontekst paczki ${chunk.pageRange} (w tym VISION_NOTES jak wcześniej).`
        : `${topUpIntro}

Kontekst paczki ${chunk.pageRange}:
---
${chunk.context.slice(0, MAX_PAGE_CONTEXT_CHARS_TEXT).trim()}
---`;
      const seen = new Set(
        generated.map((g) => normalizeText(g.question).toLowerCase()),
      );
      for (let r = 0; r < SINGLE_QUESTION_RETRY_MAX && need > 0; r++) {
        try {
          let rawTop: string;
          const runtimeTop = getAttemptRuntimeProfile(perf, r);
          const topStartedAt = Date.now();
          if (useVision) {
            textCalls += 1;
            rawTop = await runOllamaJsonChatForTests(
              model,
              options,
              runtimeTop.numPredict,
              runtimeTop.timeoutMs,
              `Uzupełnianie pytań (paczka ${chunk.pageRange})`,
              null,
              [
                {
                  role: "system",
                  content:
                    `${system} Uzupełniasz zestaw — zwróć WYŁĄCZNIE tablicę z samymi nowymi pytaniami (${need} szt.).`,
                },
                { role: "user", content: topUpUser },
              ],
            );
          } else {
            textCalls += 1;
            rawTop = await runOllamaJsonChatForTests(
              model,
              options,
              runtimeTop.numPredict,
              runtimeTop.timeoutMs,
              `Uzupełnianie pytań (paczka ${chunk.pageRange})`,
              null,
              [
                {
                  role: "system",
                  content:
                    `${system} Uzupełniasz zestaw — zwróć WYŁĄCZNIE tablicę z samymi nowymi pytaniami (${need} szt.).`,
                },
                { role: "user", content: topUpUser },
              ],
            );
          }
          totalLatencyMs += Date.now() - topStartedAt;
          const parsedExtra = parseQuestions(rawTop, chunk.representativePage);
          rejectReasons.invalid_shape += parsedExtra.rejects.invalid_shape;
          rejectReasons.duplicate_options += parsedExtra.rejects.duplicate_options;
          rejectReasons.invalid_json += parsedExtra.rejects.invalid_json;
          const extra = parsedExtra.questions.filter((q) => {
            const quality = scoreQuestionQuality(q, chunk.context);
            totalQualityScore += quality.score;
            qualityScoredCount += 1;
            if (quality.score < QUALITY_GATE_MIN_SCORE) {
              rejectReasons.quality_gate += 1;
              return false;
            }
            return true;
          });
          for (const e of extra) {
            if (generated.length >= target) break;
            const k = normalizeText(e.question).toLowerCase();
            if (seen.has(k)) {
              rejectReasons.duplicate_question += 1;
              continue;
            }
            seen.add(k);
            generated.push(e);
          }
          need = target - generated.length;
          devLog(
            `  uzupełnienie ${r + 1}/${SINGLE_QUESTION_RETRY_MAX}: +${extra.length} → ${generated.length}/${target}`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const reason = classifyGenerationError(e);
          rejectReasons[reason] += 1;
          devLog(`  uzupełnienie ${r + 1}/${SINGLE_QUESTION_RETRY_MAX}: BŁĄD ${msg}`);
        }
      }
    }

    if (generated.length > 0) pagesWithAnyParsed += 1;
    const take = generated.slice(0, target);
    currentNegativeQuestions += take.filter((q) => isNegativeQuestionStem(q.question)).length;
    devLog(
      `Paczka ${chunk.pageRange}: do banku ${take.length}/${target} pytań (po próbach)`,
    );
    all.push(...take);
    preOptimizerCandidates.push(...take);
  }

  devLog(`Surowe pytania (łącznie, przed deduplikacją): ${all.length}`);
  let optimized = all;
  let fallbackUsed = false;
  let optimizerApplied = false;
  if (generationMode === "smart_chunking") {
    try {
      optimized = await optimizeQuizSet(
        model,
        options,
        all,
        targetFinalQuestionsMin,
        targetFinalQuestionsMax,
      );
      optimizerApplied = true;
      devLog(
        `Quiz Optimizer: ${all.length} -> ${optimized.length} (zakres=${targetFinalQuestionsMin}-${targetFinalQuestionsMax})`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      devLog(`Quiz Optimizer: BŁĄD ${msg} (fallback do lokalnej deduplikacji)`);
    }
  }
  const dedupeResult = dedupeQuestions(optimized);
  let deduped = dedupeResult.deduped.slice(0, targetFinalQuestionsMax);
  rejectReasons.duplicate_question += dedupeResult.removed + Math.max(0, optimized.length - deduped.length - dedupeResult.removed);
  devLog(
    `Po deduplikacji/finalizacji: ${deduped.length} (odrzucono ${all.length - deduped.length})`,
  );
  onProgress?.({ label: "Finalizuję test…", percent: 96 });
  if (deduped.length === 0) {
    const hint =
      pagesWithAnyParsed === 0
        ? " Żadna paczka nie zwróciła poprawnego zestawu pytań — często: timeout (5 min na paczkę), Ollama przeciążona, model bez sensownego JSON lub powtarzające się opcje ABCD (walidacja odrzuca pytanie)."
        : " Wszystkie kandydaty odrzucono przy deduplikacji (powtarzające się treści pytań).";
    const last =
      lastPageFailure != null
        ? ` Ostatni błąd wywołania: ${lastPageFailure}`
        : "";
    devLog(
      `KONIEC BŁĄD: 0 pytań po deduplikacji (stron z jakimkolwiek parsowaniem: ${pagesWithAnyParsed}).${last}`,
    );
    throw new Error(
      `Nie udało się zebrać pytań testowych po ${chunksToProcess.length} paczkach (${pagesWithAnyParsed} paczek z jakimkolwiek wynikiem parsowania).${hint}${last}`,
    );
  }
  if (deduped.length < targetFinalQuestionsMin) {
    const fallbackDeduped = dedupeQuestions(preOptimizerCandidates).deduped.slice(
      0,
      targetFinalQuestionsMax,
    );
    if (fallbackDeduped.length >= targetFinalQuestionsMin) {
      deduped = fallbackDeduped;
      fallbackUsed = true;
      devLog(
        `Fallback minimum: użyto zbioru sprzed optimizera (${deduped.length}/${targetFinalQuestionsMin}-${targetFinalQuestionsMax}).`,
      );
    } else {
      deduped = fallbackDeduped;
      // Ostatnia dogrywka: próbujemy domknąć minimum N, paczka po paczce.
      let globalNeed = targetFinalQuestionsMin - deduped.length;
      if (globalNeed > 0) {
        for (let r = 0; r < 4 && globalNeed > 0; r++) {
          try {
            const extra = await generateChunkFocusedTopUpQuestions(
              model,
              options,
              chunksToProcess,
              deduped,
              globalNeed,
            );
            const seen = new Set(
              deduped.map((q) => normalizeText(q.question).toLowerCase()),
            );
            const accepted: GeneratedTestQuestion[] = [];
            const catchupQualityMin =
              r < 2 ? QUALITY_GATE_MIN_SCORE - 1 : QUALITY_GATE_MIN_SCORE - 2;
            for (const q of extra) {
              const key = normalizeText(q.question).toLowerCase();
              if (!key || seen.has(key)) continue;
              const quality = scoreQuestionQuality(
                q,
                chunksToProcess.map((c) => c.context).join("\n\n"),
              );
              totalQualityScore += quality.score;
              qualityScoredCount += 1;
              if (quality.score < catchupQualityMin) {
                rejectReasons.quality_gate += 1;
                continue;
              }
              seen.add(key);
              accepted.push(q);
            }
            deduped = [...deduped, ...accepted].slice(0, targetFinalQuestionsMax);
            fallbackUsed = true;
            globalNeed = targetFinalQuestionsMin - deduped.length;
            devLog(
              `Chunk top-up ${r + 1}/4: +${accepted.length}, łącznie ${deduped.length}/${targetFinalQuestionsMin}-${targetFinalQuestionsMax}, gate>=${catchupQualityMin}/6`,
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            devLog(`Chunk top-up ${r + 1}/4: BŁĄD ${msg}`);
          }
        }
      }
      // Ostatnia awaryjna dogrywka: jeśli brakuje 1-2 pytań, domykamy minimum
      // bez dodatkowego zaostrzania quality gate (wciąż z walidacją struktury i dedupe).
      if (deduped.length < targetFinalQuestionsMin) {
        let emergencyNeed = targetFinalQuestionsMin - deduped.length;
        if (emergencyNeed > 0 && emergencyNeed <= 2) {
          try {
            const emergency = await generateChunkFocusedTopUpQuestions(
              model,
              options,
              chunksToProcess,
              deduped,
              emergencyNeed,
            );
            const seen = new Set(
              deduped.map((q) => normalizeText(q.question).toLowerCase()),
            );
            const accepted: GeneratedTestQuestion[] = [];
            for (const q of emergency) {
              if (accepted.length >= emergencyNeed) break;
              const key = normalizeText(q.question).toLowerCase();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              // Awaryjnie dopuszczamy pytania, które przeszły walidację strukturalną,
              // ale mogły odpaść na jakości; lepiej domknąć target niż kończyć błędem.
              accepted.push(q);
            }
            if (accepted.length > 0) {
              deduped = [...deduped, ...accepted].slice(0, targetFinalQuestionsMax);
              fallbackUsed = true;
              devLog(
                `Emergency top-up: +${accepted.length}, łącznie ${deduped.length}/${targetFinalQuestionsMin}-${targetFinalQuestionsMax}`,
              );
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            devLog(`Emergency top-up: BŁĄD ${msg}`);
          }
        }
      }
      if (deduped.length < targetFinalQuestionsMin) {
        // Nie przerywamy procesu błędem — decyzję o zapisie niepełnego zestawu
        // podejmie użytkownik w UI.
        devLog(
          `Minimum nieosiągnięte: ${deduped.length}/${targetFinalQuestionsMin} (maksimum ${targetFinalQuestionsMax}).`,
        );
      }
    }
  }
  const qualityAverage = qualityScoredCount > 0 ? totalQualityScore / qualityScoredCount : 0;
  devLog(
    `Sukces: zwracam ${deduped.length} pytań do zapisu w bazie. Quality avg=${qualityAverage.toFixed(2)}/6`,
  );
  return {
    questions: deduped,
    metrics: {
      model,
      isLowSpec: getLowSpecTestModeEnabled(),
      generationMode,
      chunkCount: chunksToProcess.length,
      pageRanges: chunksToProcess.map((c) => c.pageRange),
      targetQuestionLimit: targetFinalQuestionsMin,
      targetQuestionMax: targetFinalQuestionsMax,
      minimumSatisfied: deduped.length >= targetFinalQuestionsMin,
      plannedPerChunk,
      generatedPreOptimizer: all.length,
      generatedPostOptimizer: optimized.length,
      fallbackUsed,
      optimizerApplied,
      optimizerDropCount: Math.max(0, all.length - deduped.length),
      pagesTotal: sourcePages.length,
      pagesWithAnyParsed,
      questionsBeforeDedupe: all.length,
      questionsAfterDedupe: deduped.length,
      qualityAverage,
      textCalls,
      visionCalls,
      totalLatencyMs,
      rejectReasons,
      difficulty,
    },
  };
}
