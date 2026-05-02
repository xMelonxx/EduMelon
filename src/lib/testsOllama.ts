import type { ChunkRow } from "./db";
import { ollamaChat, ollamaChatWithImages } from "./ollama";
import {
  pdfGetPageCount,
  pdfPageToImageBase64,
  PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS,
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

type TestGenerationOptions = {
  sourceKind?: string;
  filePath?: string | null;
};

const TEST_GEN_CALL_TIMEOUT_MS = 90_000;
const HEARTBEAT_MS = 3_000;
/** Bez obrazu opieramy się wyłącznie na tekście z ingestu. */
const MAX_PAGE_CONTEXT_CHARS_TEXT = 12000;

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

function countForPage(): number {
  return 2;
}

function parseQuestions(
  raw: string,
  page: number | null,
): GeneratedTestQuestion[] {
  const arrRaw = extractBalancedJsonArray(raw) ?? raw;
  const parsed = JSON.parse(arrRaw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: GeneratedTestQuestion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
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
    const requiresImage =
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
    out.push({
      slide_index: page,
      question,
      option_a: optionA,
      option_b: optionB,
      option_c: optionC,
      option_d: optionD,
      correct_option: correct,
      explanation: explanation || "Poprawna odpowiedź wynika bezpośrednio z treści tej strony.",
      requires_image: requiresImage,
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

  if (pages.length === 0) {
    throw new Error("Brak treści do wygenerowania testu.");
  }

  const all: GeneratedTestQuestion[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const target = countForPage();
    onProgress?.({
      label: `Tworzę pytania testowe ze strony ${page.slide_index} (${target})…`,
      percent: 8 + Math.round(((i + 0.2) / pages.length) * 84),
    });
    const useVision =
      perf.allowVision &&
      options?.sourceKind?.toLowerCase() === "pdf" &&
      options.filePath &&
      page.slide_index > 0;

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
      ? `Na podstawie WYŁĄCZNIE przesłanego obrazu strony ${page.slide_index} utwórz DOKŁADNIE ${target} pytań testowych wielokrotnego wyboru. Odczytaj treść z obrazu (tekst, tabela, wykres). Nie ma osobnej warstwy tekstowej w tym pytaniu.

${jsonAndRules}

To jest strona ${page.slide_index} w dokumencie — pytania muszą wynikać tylko z tego, co widać na obrazie.`
      : `Na podstawie kontekstu utwórz DOKŁADNIE ${target} pytań testowych wielokrotnego wyboru.

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
        let raw = "";
        if (
          perf.allowVision &&
          options?.sourceKind?.toLowerCase() === "pdf" &&
          options.filePath &&
          page.slide_index > 0
        ) {
          const pageImage = await pdfPageToImageBase64(
            options.filePath,
            page.slide_index,
            getLowSpecTestModeEnabled()
              ? PDF_PAGE_IMAGE_LOW_SPEC_OPTIONS
              : undefined,
          );
          raw = await withTimeout(
            ollamaChatWithImages(
              model,
              [
                {
                  role: "system",
                  content:
                    `${system} Masz tylko obraz jednej strony PDF — odczytaj z niego treść i kadruj elementy wizualne przy requires_image.`,
                },
                { role: "user", content: user, images: [pageImage] },
              ],
              {
                format: "json",
                temperature: 0.25,
                num_predict: perf.numPredict,
              },
            ),
            TEST_GEN_CALL_TIMEOUT_MS,
            `Generowanie pytań (strona ${page.slide_index})`,
          );
        } else {
          raw = await withTimeout(
            ollamaChat(
              model,
              [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              {
                format: "json",
                temperature: 0.25,
                num_predict: perf.numPredict,
              },
            ),
            TEST_GEN_CALL_TIMEOUT_MS,
            `Generowanie pytań (strona ${page.slide_index})`,
          );
        }
        generated = parseQuestions(raw, page.slide_index);
      } catch {
        generated = [];
      } finally {
        clearInterval(heartbeatId);
      }
      if (generated.length >= target) break;
    }
    all.push(...generated.slice(0, target));
  }

  const deduped = dedupeQuestions(all);
  onProgress?.({ label: "Finalizuję test…", percent: 96 });
  if (deduped.length === 0) {
    throw new Error("Nie udało się wygenerować pytań testowych.");
  }
  return deduped;
}
