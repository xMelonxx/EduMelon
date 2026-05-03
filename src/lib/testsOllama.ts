import type { ChunkRow } from "./db";
import {
  ollamaChat,
  ollamaChatStream,
  ollamaChatWithImages,
  ollamaChatWithImagesStream,
  type ChatStreamDelta,
  type OllamaImageMessage,
} from "./ollama";
import {
  pdfGetPageCount,
  pdfPageToImageBase64,
  PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS,
  PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
} from "./pdfVisionOcr";
import { getLowSpecTestModeEnabled } from "./storage";

export type TestGenProgress = {
  label: string;
  percent: number;
};

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
  /**
   * DEV: włącznie numery stron (PDF) lub slajdów — kolejność start/end nie ma znaczenia (normalizujemy do min–max).
   */
  devPageRange?: { start: number; end: number };
  /** DEV: log linii do konsoli w UI (np. Tests.tsx). */
  onDevLog?: (line: string) => void;
};

const TEST_GEN_CALL_TIMEOUT_MS = 90_000;
const HEARTBEAT_MS = 3_000;
/** Bez obrazu opieramy się wyłącznie na tekście z ingestu. */
const MAX_PAGE_CONTEXT_CHARS_TEXT = 12000;

/**
 * Heurystyka: kiedy wysłać obraz strony do modelu zamiast samego tekstu z PDF.
 * - bardzo mało tekstu (skan, zły extract),
 * - relatywnie mało słów przy umiarkowanej długości → często slajd z tabelą/diagramem jako grafika.
 */
function pageNeedsVisionForTest(pageContext: string): boolean {
  const t = normalizeText(pageContext);
  if (t.length === 0) return true;
  if (t.length < 380) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  return t.length < 820 && words < 44;
}

type TestPerfProfile = {
  attempts: number;
  numPredict: number;
  allowVision: boolean;
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

function countForPage(): number {
  return 2;
}

function parseQuestions(
  raw: string,
  page: number | null,
): GeneratedTestQuestion[] {
  const records = coerceToQuestionRecords(parseJsonRoot(raw));
  if (!records || records.length === 0) return [];
  const out: GeneratedTestQuestion[] = [];
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
      continue;
    }
    // Model często ustawia requires_image=false mimo kadru (np. cała strona 0,0,100,100) — wtedy i tak pokazujemy wycinek.
    if (validCrop && cropW > 0 && cropH > 0) {
      requiresImageFlag = 1;
    }
    out.push({
      slide_index: page,
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
  return out;
}

function dedupeQuestions(
  questions: GeneratedTestQuestion[],
): GeneratedTestQuestion[] {
  const seen = new Set<string>();
  const out: GeneratedTestQuestion[] = [];
  for (const q of questions) {
    const key = normalizeText(q.question).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
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

/** Przy `onDevLog` używamy strumienia — w konsoli DEV widać 💭 thinking z modeli, które je zwracają. */
async function runOllamaJsonChatForTests(
  model: string,
  options: TestGenerationOptions | undefined,
  numPredict: number,
  timeoutMs: number,
  timeoutLabel: string,
  visionMessages: OllamaImageMessage[] | null,
  textMessages: { role: string; content: string }[],
): Promise<string> {
  const opts = {
    format: "json" as const,
    temperature: 0.25,
    num_predict: numPredict,
  };

  if (!options?.onDevLog) {
    if (visionMessages) {
      return await withTimeout(
        ollamaChatWithImages(model, visionMessages, opts),
        timeoutMs,
        timeoutLabel,
      );
    }
    return await withTimeout(
      ollamaChat(model, textMessages, opts),
      timeoutMs,
      timeoutLabel,
    );
  }

  let raw = "";
  /** Delty thinking składamy — jeden wpis 💭 w konsoli zamiast osobnej linii na każde słowo. */
  let thinkingAcc = "";
  const flushThinking = () => {
    const t = thinkingAcc.trim();
    if (t.length > 0) {
      options?.onDevLog?.(`💭 ${t}`);
      thinkingAcc = "";
    }
  };
  const onDelta = (d: ChatStreamDelta) => {
    if (d.kind === "thinking") {
      thinkingAcc += d.delta;
      return;
    }
    flushThinking();
    raw += d.delta;
  };

  await withTimeout(
    visionMessages
      ? ollamaChatWithImagesStream(model, visionMessages, opts, onDelta)
      : ollamaChatStream(model, textMessages, opts, onDelta),
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

export async function generateTestQuestionsFromChunks(
  model: string,
  chunks: ChunkRow[],
  onProgress?: (p: TestGenProgress) => void,
  options?: TestGenerationOptions,
): Promise<GeneratedTestQuestion[]> {
  const devLog = (msg: string) => {
    options?.onDevLog?.(msg);
  };
  const perf = getTestPerfProfile();
  const grouped = new Map<number, string[]>();
  for (const c of chunks) {
    const page = c.slide_index ?? 1;
    const body = normalizeText(c.body);
    if (!body) continue;
    if (!grouped.has(page)) grouped.set(page, []);
    grouped.get(page)!.push(body);
  }

  const isPdfWithFile =
    options?.sourceKind?.toLowerCase() === "pdf" && !!options.filePath;

  let pages: { slide_index: number; context: string }[];

  if (isPdfWithFile && options.filePath) {
    const numPages = await pdfGetPageCount(options.filePath);
    if (numPages < 1) {
      throw new Error("PDF nie zawiera żadnej strony.");
    }
    pages = [];
    for (let p = 1; p <= numPages; p++) {
      const bodies = grouped.get(p);
      const context = bodies?.length
        ? normalizeText(bodies.join("\n\n"))
        : "";
      pages.push({ slide_index: p, context });
    }
  } else {
    pages = [...grouped.entries()]
      .map(([slide_index, bodies]) => ({
        slide_index,
        context: normalizeText(bodies.join("\n\n")),
      }))
      .filter((p) => p.context.length > 60)
      .sort((a, b) => a.slide_index - b.slide_index);
  }

  if (options?.devPageRange) {
    const { start: a, end: b } = options.devPageRange;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    pages = pages.filter(
      (p) => p.slide_index >= lo && p.slide_index <= hi,
    );
    devLog(
      `Zakres DEV: strony/slajdy ${lo}–${hi} → ${pages.length} stron po filtrze`,
    );
    if (pages.length === 0) {
      throw new Error(
        `Zakres DEV (strony/slajdy ${lo}–${hi}) nie obejmuje żadnej strony z materiału (albo wszystkie odrzucono przez filtr treści).`,
      );
    }
  }

  if (pages.length === 0) {
    throw new Error("Brak treści do wygenerowania testu.");
  }

  devLog(
    `Start: model=${model}, lowSpec=${getLowSpecTestModeEnabled()}, stron=${pages.length}, próby/strona=${perf.attempts}, num_predict=${perf.numPredict}`,
  );
  const idxPreview =
    pages.length <= 24
      ? pages.map((p) => p.slide_index).join(", ")
      : `${pages
          .slice(0, 18)
          .map((p) => p.slide_index)
          .join(", ")}, … (+${pages.length - 18})`;
  devLog(`Kolejka stron (${pages.length}): ${idxPreview}`);

  const all: GeneratedTestQuestion[] = [];
  let pagesWithAnyParsed = 0;
  let lastPageFailure: string | null = null;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const target = countForPage();
    const useVision =
      perf.allowVision &&
      options?.sourceKind?.toLowerCase() === "pdf" &&
      !!options.filePath &&
      page.slide_index > 0 &&
      pageNeedsVisionForTest(page.context);

    const modeLabel = useVision
      ? "obraz strony"
      : options?.sourceKind?.toLowerCase() === "pdf"
        ? "tekst z PDF"
        : "tekst ze slajdów";
    onProgress?.({
      label: `Tworzę pytania ze strony ${page.slide_index} (${target}) — ${modeLabel}…`,
      percent: 8 + Math.round(((i + 0.2) / pages.length) * 84),
    });

    devLog(
      `--- Strona ${page.slide_index} [${i + 1}/${pages.length}] ${useVision ? "vision" : "tekst"} | ctxLen=${page.context.length} | cel=${target} pytań`,
    );

    const system =
      "Jesteś generatorem pytań testowych ABCD po polsku. Zwracasz WYŁĄCZNIE tablicę JSON.";

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
- każde pytanie dotyczy INNEGO faktu ze strony;
- tylko jedna poprawna odpowiedź;
- unikaj "wszystkie powyższe" i "żadne z powyższych";
- jeśli pytanie dotyczy grafiki/diagramu/wykresu/tabeli, ustaw requires_image=true i podaj kadr (crop_x/y/w/h) tego elementu w procentach strony;
- jeśli pytanie nie dotyczy grafiki, ustaw requires_image=false i zostaw crop_* jako 0;
- nie używaj markdown.`;

    const user = useVision
      ? `Zwróć DOKŁADNIE jedną tablicę JSON z ${target} obiektami (elementów musi być ${target} — nie jeden, nie trzy).

Na podstawie WYŁĄCZNIE przesłanego obrazu strony ${page.slide_index} utwórz te ${target} pytań testowych wielokrotnego wyboru. Odczytaj treść z obrazu (tekst, tabela, wykres). Nie ma osobnej warstwy tekstowej w tym pytaniu.

${jsonAndRules}

To jest strona ${page.slide_index} w dokumencie — pytania muszą wynikać tylko z tego, co widać na obrazie.`
      : `Zwróć DOKŁADNIE jedną tablicę JSON z ${target} obiektami (elementów musi być ${target} — nie jeden, nie trzy).

Na podstawie kontekstu utwórz te ${target} pytań testowych wielokrotnego wyboru.

${jsonAndRules}

Kontekst strony ${page.slide_index}:
---
${page.context.slice(0, MAX_PAGE_CONTEXT_CHARS_TEXT).trim()}
---`;

    let generated: GeneratedTestQuestion[] = [];
    const attempts = perf.attempts;
    for (let a = 0; a < attempts; a++) {
      const basePercent = 8 + Math.round(((i + 0.25 + a * 0.2) / pages.length) * 84);
      let heartbeat = 0;
      onProgress?.({
        label: `Strona ${page.slide_index}: próba ${a + 1}/${attempts}…`,
        percent: Math.min(94, basePercent),
      });
      const heartbeatId = setInterval(() => {
        heartbeat += 1;
        onProgress?.({
          label: `Strona ${page.slide_index}: generuję pytania (${heartbeat * 3}s)…`,
          percent: Math.min(94, basePercent),
        });
      }, HEARTBEAT_MS);
      try {
        let raw: string;
        if (useVision && options.filePath) {
          const pageImage = await pdfPageToImageBase64(
            options.filePath,
            page.slide_index,
            getLowSpecTestModeEnabled()
              ? PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS
              : PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
          );
          raw = await runOllamaJsonChatForTests(
            model,
            options,
            perf.numPredict,
            TEST_GEN_CALL_TIMEOUT_MS,
            `Generowanie pytań (strona ${page.slide_index})`,
            [
              {
                role: "system",
                content:
                  `${system} Masz tylko obraz jednej strony PDF — odczytaj z niego treść i kadruj elementy wizualne przy requires_image.`,
              },
              { role: "user", content: user, images: [pageImage] },
            ],
            [],
          );
        } else {
          raw = await runOllamaJsonChatForTests(
            model,
            options,
            perf.numPredict,
            TEST_GEN_CALL_TIMEOUT_MS,
            `Generowanie pytań (strona ${page.slide_index})`,
            null,
            [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          );
        }
        generated = parseQuestions(raw, page.slide_index);
        devLog(
          `  próba ${a + 1}/${attempts}: odpowiedź ${raw.length} zn. → ${generated.length} pytań po walidacji`,
        );
      } catch (e) {
        lastPageFailure =
          e instanceof Error ? e.message : `Strona ${page.slide_index}: ${String(e)}`;
        generated = [];
        devLog(
          `  próba ${a + 1}/${attempts}: BŁĄD ${lastPageFailure}`,
        );
      } finally {
        clearInterval(heartbeatId);
      }
      if (generated.length >= target) break;
    }

    if (generated.length > 0 && generated.length < target) {
      const need = target - generated.length;
      onProgress?.({
        label: `Strona ${page.slide_index}: uzupełniam brakujące pytania (${need})…`,
        percent: Math.min(
          94,
          8 + Math.round(((i + 0.85) / pages.length) * 84),
        ),
      });
      const excludeBlock = generated
        .map((g, j) => `${j + 1}. ${g.question}`)
        .join("\n");
      const topUpIntro = `Wygeneruj DOKŁADNIE ${need} dodatkowe pytania (tablica JSON z ${need} obiektami). Każde dotyczy INNEGO faktu niż poniższe — nie duplikuj treści.

Już wygenerowane pytania na tej stronie (nie powtarzaj):
${excludeBlock}

${jsonAndRules}`;
      const topUpUser = useVision
        ? `${topUpIntro}

Dane wyłącznie z obrazu strony ${page.slide_index} (jak wcześniej).`
        : `${topUpIntro}

Kontekst strony ${page.slide_index}:
---
${page.context.slice(0, MAX_PAGE_CONTEXT_CHARS_TEXT).trim()}
---`;
      try {
        let rawTop: string;
        if (useVision && options.filePath) {
          const pageImage = await pdfPageToImageBase64(
            options.filePath,
            page.slide_index,
            getLowSpecTestModeEnabled()
              ? PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS
              : PDF_PAGE_IMAGE_TEST_VISION_OPTIONS,
          );
          rawTop = await runOllamaJsonChatForTests(
            model,
            options,
            perf.numPredict,
            TEST_GEN_CALL_TIMEOUT_MS,
            `Uzupełnianie pytań (strona ${page.slide_index})`,
            [
              {
                role: "system",
                content:
                  `${system} Uzupełniasz zestaw — zwróć WYŁĄCZNIE tablicę z samymi nowymi pytaniami (${need} szt.).`,
              },
              { role: "user", content: topUpUser, images: [pageImage] },
            ],
            [],
          );
        } else {
          rawTop = await runOllamaJsonChatForTests(
            model,
            options,
            perf.numPredict,
            TEST_GEN_CALL_TIMEOUT_MS,
            `Uzupełnianie pytań (strona ${page.slide_index})`,
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
        const extra = parseQuestions(rawTop, page.slide_index);
        const seen = new Set(
          generated.map((g) => normalizeText(g.question).toLowerCase()),
        );
        for (const e of extra) {
          if (generated.length >= target) break;
          const k = normalizeText(e.question).toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          generated.push(e);
        }
        devLog(
          `  uzupełnienie: surowo +${extra.length} → łącznie ${generated.length}/${target} po scaleniu`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        devLog(`  uzupełnienie: BŁĄD ${msg}`);
      }
    }

    if (generated.length > 0) pagesWithAnyParsed += 1;
    const take = generated.slice(0, target);
    devLog(
      `Strona ${page.slide_index}: do banku ${take.length}/${target} pytań (po próbach)`,
    );
    all.push(...take);
  }

  devLog(`Surowe pytania (łącznie, przed deduplikacją): ${all.length}`);
  const deduped = dedupeQuestions(all);
  devLog(
    `Po deduplikacji: ${deduped.length} (odrzucono ${all.length - deduped.length} duplikatów treści pytania)`,
  );
  onProgress?.({ label: "Finalizuję test…", percent: 96 });
  if (deduped.length === 0) {
    const hint =
      pagesWithAnyParsed === 0
        ? " Żadna strona nie zwróciła poprawnego zestawu pytań — często: timeout (90 s na stronę), Ollama przeciążona, model bez sensownego JSON lub powtarzające się opcje ABCD (walidacja odrzuca pytanie)."
        : " Wszystkie kandydaty odrzucono przy deduplikacji (powtarzające się treści pytań).";
    const last =
      lastPageFailure != null
        ? ` Ostatni błąd wywołania: ${lastPageFailure}`
        : "";
    devLog(
      `KONIEC BŁĄD: 0 pytań po deduplikacji (stron z jakimkolwiek parsowaniem: ${pagesWithAnyParsed}).${last}`,
    );
    throw new Error(
      `Nie udało się zebrać pytań testowych po ${pages.length} stronach (${pagesWithAnyParsed} stron z jakimkolwiek wynikiem parsowania).${hint}${last}`,
    );
  }
  devLog(`Sukces: zwracam ${deduped.length} pytań do zapisu w bazie.`);
  return deduped;
}
