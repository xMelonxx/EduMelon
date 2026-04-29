import type { ChunkRow } from "./db";
import { ollamaChat, ollamaChatWithImages } from "./ollama";
import { pdfPageToImageBase64 } from "./pdfVisionOcr";

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

export async function generateTestQuestionsFromChunks(
  model: string,
  chunks: ChunkRow[],
  onProgress?: (p: TestGenProgress) => void,
  options?: TestGenerationOptions,
): Promise<GeneratedTestQuestion[]> {
  const grouped = new Map<number, string[]>();
  for (const c of chunks) {
    const page = c.slide_index ?? 1;
    const body = normalizeText(c.body);
    if (!body) continue;
    if (!grouped.has(page)) grouped.set(page, []);
    grouped.get(page)!.push(body);
  }
  const pages = [...grouped.entries()]
    .map(([slide_index, bodies]) => ({
      slide_index,
      context: normalizeText(bodies.join("\n\n")).slice(0, 12000),
    }))
    .filter((p) => p.context.length > 60)
    .sort((a, b) => a.slide_index - b.slide_index);

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
    const system =
      "Jesteś generatorem pytań testowych ABCD po polsku. Zwracasz WYŁĄCZNIE tablicę JSON.";
    const user = `Na podstawie kontekstu utwórz DOKŁADNIE ${target} pytań testowych wielokrotnego wyboru.

Format JSON:
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
- nie używaj markdown.

Kontekst strony ${page.slide_index}:
---
${page.context}
---`;

    let generated: GeneratedTestQuestion[] = [];
    const attempts = 3;
    for (let a = 0; a < attempts; a++) {
      try {
        let raw = "";
        if (
          options?.sourceKind?.toLowerCase() === "pdf" &&
          options.filePath &&
          page.slide_index > 0
        ) {
          const pageImage = await pdfPageToImageBase64(options.filePath, page.slide_index);
          raw = await ollamaChatWithImages(
            model,
            [
              {
                role: "system",
                content:
                  `${system} Oprócz tekstu dostajesz obraz strony — użyj go do pytań o elementy wizualne i wyznaczenia kadru.`,
              },
              { role: "user", content: user, images: [pageImage] },
            ],
            {
              format: "json",
              temperature: 0.25,
              num_predict: 4096,
            },
          );
        } else {
          raw = await ollamaChat(
            model,
            [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            {
              format: "json",
              temperature: 0.25,
              num_predict: 4096,
            },
          );
        }
        generated = parseQuestions(raw, page.slide_index);
      } catch {
        generated = [];
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
