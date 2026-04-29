import type { ChunkRow } from "./db";
import { ollamaChat } from "./ollama";
import {
  buildFlashcardsPromptWithOutline,
  buildFlashcardsTopUpPrompt,
  buildTopicOutlinePrompt,
} from "./prompts";
import {
  hasDuplicateNormalizedFronts,
  hasMetaSummaryStyleBacks,
  isRepetitiveFlashcards,
} from "./flashcardVariety";
import {
  buildOllamaFlashcardsArraySchema,
  parseFlashcardsFromModel,
  parseJsonStringArray,
} from "./parseFlashcardsResponse";

/** Nieco wyższa temperatura niż przy streszczeniach — mniej ryzyka 10× tej samej fiszki. */
const OLLAMA_FLASH_BASE_OPTS = {
  temperature: 0.32,
} as const;

/** Długa tablica JSON — wymusza wystarczający limit tokenów na N fiszek. */
function flashcardNumPredict(forCount: number): number {
  return Math.min(32768, Math.max(6144, forCount * 900 + 4096));
}

/**
 * Jedna odpowiedź modelu jest łatwo ucięta przy dużej liczbie kart — dzielimy generowanie.
 * (limit wyjścia Ollama ~32k tokenów; krótsze partie = stabilniejszy JSON.)
 */
const FLASHCARD_BATCH_SIZE = 18;

/**
 * Przy większej liczbie fiszek: dzielimy materiał (chunki PDF/slajdy) na segmenty
 * i generujemy np. 10 kart na segment — krótszy kontekst = szybciej niż jedna gigantyczna odpowiedź.
 */
const MATERIAL_SEGMENT_CARDS = 10;

const MAX_CONTEXT_CHARS_PER_SEGMENT = 20000;

function distributeCardCounts(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Tekst segmentu do promptów (bez całego PDFu naraz). */
function chunkRowsToContext(rows: ChunkRow[]): string {
  return rows
    .map((c) => c.body)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS_PER_SEGMENT);
}

/**
 * Dzieli chunki na N segmentów (kolejność stron). Przy jednym chunku — dzieli tekst na części.
 */
function splitChunksIntoSegments(
  chunks: ChunkRow[],
  numSegments: number,
): ChunkRow[][] {
  if (chunks.length === 0) return [];
  const sorted = [...chunks].sort(
    (a, b) => (a.slide_index ?? 0) - (b.slide_index ?? 0),
  );
  if (numSegments <= 1) return [sorted];

  if (sorted.length >= numSegments) {
    const out: ChunkRow[][] = [];
    let idx = 0;
    for (let s = 0; s < numSegments; s++) {
      const remaining = sorted.length - idx;
      const segsLeft = numSegments - s;
      const take = Math.ceil(remaining / segsLeft);
      out.push(sorted.slice(idx, idx + take));
      idx += take;
    }
    return out;
  }

  const full = sorted.map((c) => c.body).join("\n\n");
  if (full.length === 0) {
    return Array.from({ length: numSegments }, () => []);
  }
  const base = sorted[0]!;
  const partLen = Math.ceil(full.length / numSegments);
  const out: ChunkRow[][] = [];
  for (let s = 0; s < numSegments; s++) {
    const slice = full.slice(s * partLen, (s + 1) * partLen);
    out.push([
      {
        ...base,
        id: `${base.id}-seg-${s}-${crypto.randomUUID()}`,
        body: slice,
      },
    ]);
  }
  return out;
}

export type GenerateFlashcardsMaterialOptions = {
  /** Chunki z bazy (strony/slajdy) — przy większej liczbie fiszek używane do podziału materiału. */
  chunkRows?: ChunkRow[];
};

/** Informacja o etapie generowania fiszek (UI: pasek + opis). */
export type FlashcardGenProgress = {
  label: string;
  /** 0–100, przybliżony postęp całego procesu */
  percent: number;
};

function dedupeTopicLabels(topics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of topics) {
    const k = t.trim().toLowerCase().replace(/\s+/g, " ");
    if (k.length === 0 || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
  }
  return out;
}

function padTopicsWithContextFragments(
  context: string,
  count: number,
  existing: string[],
): string[] {
  let base = dedupeTopicLabels([...existing]);
  if (base.length >= count) return base.slice(0, count);
  const paras = context
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 80);
  let i = 0;
  while (base.length < count && paras.length > 0) {
    const p = paras[i % paras.length]!;
    const label = `Fragment z materiału (${base.length + 1}): ${p.slice(0, 85).replace(/\s+/g, " ")}…`;
    base.push(label);
    i++;
  }
  while (base.length < count) {
    base.push(`Zagadnienie ${base.length + 1} — inny aspekt niż wcześniejsze pozycje`);
  }
  return dedupeTopicLabels(base).slice(0, count);
}

/**
 * Etap 1: lista N etykiet (różne tematy). Etap 2: fiszki 1:1 z listą.
 */
async function buildTopicsForGeneration(
  model: string,
  context: string,
  count: number,
  onProgress?: (p: FlashcardGenProgress) => void,
): Promise<{ topics: string[]; outlineFromModel: number }> {
  onProgress?.({
    label: "Tworzę listę tematów z materiału…",
    percent: 6,
  });
  const { system, user } = buildTopicOutlinePrompt(count, context);
  let raw: string[] = [];
  try {
    const outlineSchema = {
      type: "array",
      items: { type: "string" },
      minItems: count,
      maxItems: count,
    } as const;
    const chatText = await ollamaChat(
      model,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        ...OLLAMA_FLASH_BASE_OPTS,
        temperature: 0.42,
        num_predict: Math.min(16384, Math.max(8192, count * 120 + 2048)),
        format: outlineSchema,
      },
    );
    raw = parseJsonStringArray(chatText) ?? [];
  } catch {
    try {
      const chatText2 = await ollamaChat(
        model,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        {
          ...OLLAMA_FLASH_BASE_OPTS,
          temperature: 0.42,
          num_predict: Math.min(16384, Math.max(8192, count * 120 + 2048)),
          format: "json",
        },
      );
      raw = parseJsonStringArray(chatText2) ?? [];
    } catch {
      raw = [];
    }
  }
  let deduped = dedupeTopicLabels(raw);
  const uniqueRatio =
    raw.length > 0 ? deduped.length / raw.length : 0;
  if (uniqueRatio < 0.35 && raw.length >= 5) {
    deduped = [];
  }
  const outlineFromModel = deduped.length;
  const topics = padTopicsWithContextFragments(context, count, deduped);
  onProgress?.({
    label: "Lista tematów gotowa — generuję fiszki…",
    percent: 22,
  });
  return { topics, outlineFromModel };
}

function dedupeFlashcardsByFront(
  cards: { front: string; back: string }[],
): { front: string; back: string }[] {
  const seen = new Set<string>();
  const out: { front: string; back: string }[] = [];
  for (const c of cards) {
    const k = c.front.trim().toLowerCase().replace(/\s+/g, " ");
    if (k.length === 0) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function topUpFlashcardsToTarget(
  model: string,
  context: string,
  target: number,
  detail: "short" | "medium" | "long",
  initial: { front: string; back: string }[],
  onProgress?: (p: FlashcardGenProgress) => void,
): Promise<{ front: string; back: string }[]> {
  let merged = dedupeFlashcardsByFront(initial);
  let rounds = 0;
  /** Mniejsze partie + druga próba z luźnym JSON — mniej „0 nowych” przy dużym `need`. */
  const maxNeedPerCall = 20;

  while (merged.length < target && rounds < 20) {
    const need = Math.min(target - merged.length, maxNeedPerCall);
    onProgress?.({
      label: `Uzupełniam brakujące fiszki (runda ${rounds + 1})…`,
      percent: 82 + (rounds % 6) * 2,
    });
    const { system, user } = buildFlashcardsTopUpPrompt(
      context,
      need,
      detail,
      merged.map((c) => c.front),
    );
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    let more: { front: string; back: string }[] = [];
    try {
      const raw = await ollamaChat(model, messages, {
        ...OLLAMA_FLASH_BASE_OPTS,
        num_predict: flashcardNumPredict(need),
        format: buildOllamaFlashcardsArraySchema(need),
      });
      more = parseFlashcardsFromModel(raw);
    } catch {
      more = [];
    }
    if (more.length === 0) {
      try {
        const raw = await ollamaChat(model, messages, {
          ...OLLAMA_FLASH_BASE_OPTS,
          num_predict: flashcardNumPredict(need),
          format: "json",
        });
        more = parseFlashcardsFromModel(raw);
      } catch {
        more = [];
      }
    }
    if (more.length === 0) {
      rounds++;
      continue;
    }
    merged = dedupeFlashcardsByFront([...merged, ...more]);
    rounds++;
  }
  return merged;
}

const ANTI_PARAPHRASE_FOOTER =
  "\n\n---\n" +
  "Dodatkowo: ZAKAZ parafrazowania tego samego pytania. " +
  "Uznaje się za błąd, gdy wiele fiszek pyta o to samo zagadnienie innymi słowami " +
  "(np. „Czym jest X?”, „Co to jest X?”, „Zdefiniuj X”, „Wyjaśnij pojęcie X” — to nadal JEDNO zagadnienie). " +
  "Każda fiszka = inny fakt, inny mechanizm, inny objaw, inna klasyfikacja lub inny fragment z materiału.";

async function runFlashcardGenerationAttempts(
  model: string,
  context: string,
  count: number,
  detail: "short" | "medium" | "long",
  topics: string[],
  outlineFromModel: number,
  onProgress: ((p: FlashcardGenProgress) => void) | undefined,
  batch: { index: number; total: number } | null,
): Promise<{ front: string; back: string }[]> {
  if (topics.length !== count) {
    throw new Error("Wewnętrzny błąd: lista tematów nie zgadza się z liczbą fiszek.");
  }

  const { system, user } = buildFlashcardsPromptWithOutline(
    context,
    count,
    detail,
    topics,
  );

  const strictFooter =
    "\n\n---\n" +
    "KRYTYCZNE — nie pisz streszczenia ani komentarza. " +
    "ZAKAZ: zdań typu „Przedstawiony tekst to…”, „Oto podsumowanie”, nagłówków markdown, **. " +
    "ZAKAZ tyłów: „Omówiono…”, „Przedstawiono przyczyny i patofizjologię…”, „W tekście omówiono…” — zamiast tego JEDEN konkretny fakt z materiału na fiszkę. " +
    "Odpowiedź to WYŁĄCZNIE jedna tablica JSON: pierwszy znak to [, ostatni to ]. " +
    `${count} obiektów w kolejności jak lista tematów. ` +
    'Format elementu: {"front":"…","back":"…"}.';

  const exactSchema = buildOllamaFlashcardsArraySchema(count);
  const attempts: Array<{
    messages: { role: string; content: string }[];
    format: object | "json";
  }> = [
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      format: exactSchema,
    },
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user + strictFooter },
      ],
      format: exactSchema,
    },
    {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: buildFlashcardsPromptWithOutline(context, count, detail, topics, {
            strictJsonFooter: true,
          }).user,
        },
      ],
      format: exactSchema,
    },
    {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            buildFlashcardsPromptWithOutline(context, count, detail, topics, {
              strictJsonFooter: true,
            }).user + ANTI_PARAPHRASE_FOOTER,
        },
      ],
      format: exactSchema,
    },
  ];

  let lastParseError: Error | null = null;
  const outlineOk = batch
    ? true
    : outlineFromModel >= Math.max(4, Math.min(count, Math.ceil(count * 0.45)));

  const batchPrefix =
    batch && batch.total > 1 ? `Partia ${batch.index}/${batch.total}: ` : "";

  for (let ai = 0; ai < attempts.length; ai++) {
    const att = attempts[ai]!;
    try {
      onProgress?.({
        label: `${batchPrefix}Generuję fiszki — próba ${ai + 1} z ${attempts.length}`,
        percent: 24 + Math.round(((ai + 1) / attempts.length) * 48),
      });
      const raw = await ollamaChat(model, att.messages, {
        ...OLLAMA_FLASH_BASE_OPTS,
        num_predict: flashcardNumPredict(count),
        format: att.format,
      });
      let cards = parseFlashcardsFromModel(raw);
      if (cards.length === 0) continue;
      cards = dedupeFlashcardsByFront(cards);
      if (cards.length < count) {
        cards = await topUpFlashcardsToTarget(
          model,
          context,
          count,
          detail,
          cards,
          onProgress,
        );
      }
      cards = cards.slice(0, count);
      if (cards.length < count) {
        lastParseError = new Error(
          `Za mało fiszek po uzupełnianiu (${cards.length}/${count}). Oczekiwano ${count} — spróbuj ponownie lub zmniejsz liczbę fiszek.`,
        );
        continue;
      }
      if (cards.length === 0) continue;
      onProgress?.({
        label: `${batchPrefix}Sprawdzam jakość i powtarzalność fiszek…`,
        percent: 94,
      });
      if (hasDuplicateNormalizedFronts(cards)) {
        lastParseError = new Error(
          "Powtórzone pytania na frontach. Spróbuj ponownie wygenerować zestaw.",
        );
        continue;
      }
      if (!outlineOk && isRepetitiveFlashcards(cards)) {
        lastParseError = new Error(
          "Model powtórzył to samo pytanie na wielu fiszkach. Spróbuj ponownie lub zmniejsz liczbę fiszek.",
        );
        continue;
      }
      if (hasMetaSummaryStyleBacks(cards)) {
        lastParseError = new Error(
          "Zbyt wiele ogólnych tyłów (omówiono/przedstawiono…). Spróbuj ponownie wygenerować zestaw.",
        );
        continue;
      }
      onProgress?.({ label: `${batchPrefix}Zestaw fiszek gotowy.`, percent: 99 });
      return cards;
    } catch (e) {
      lastParseError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw (
    lastParseError ??
    new Error(
      "Nie udało się uzyskać tablicy fiszek z modelu. Zaktualizuj Ollamę i upewnij się, że `ollama pull` pobrał model.",
    )
  );
}

/**
 * Wiele fiszek: osobne przebiegi na części materiału (chunki), żeby nie wysyłać całego PDFu w każdym promptcie.
 */
async function generateFromChunkSegments(
  model: string,
  count: number,
  detail: "short" | "medium" | "long",
  chunkRows: ChunkRow[],
  onProgress?: (p: FlashcardGenProgress) => void,
): Promise<{ front: string; back: string }[]> {
  const numSegments = Math.ceil(count / MATERIAL_SEGMENT_CARDS);
  const segmentGroups = splitChunksIntoSegments(chunkRows, numSegments);
  const cardCounts = distributeCardCounts(count, numSegments);
  const merged: { front: string; back: string }[] = [];

  for (let s = 0; s < numSegments; s++) {
    const rows = segmentGroups[s] ?? [];
    const segCtx = chunkRowsToContext(rows);
    const n = cardCounts[s] ?? 0;
    if (n <= 0) continue;
    if (!segCtx.trim()) {
      onProgress?.({
        label: `Materiał ${s + 1}/${numSegments}: pomijam pusty fragment…`,
        percent: 5 + Math.round(((s + 0.5) / numSegments) * 85),
      });
      continue;
    }

    onProgress?.({
      label: `Materiał ${s + 1}/${numSegments}: lista tematów i ${n} fiszek (z tej części PDF)…`,
      percent: 5 + Math.round((s / numSegments) * 85),
    });

    const { topics, outlineFromModel } = await buildTopicsForGeneration(
      model,
      segCtx,
      n,
      onProgress,
    );
    const part = await runFlashcardGenerationAttempts(
      model,
      segCtx,
      n,
      detail,
      topics,
      outlineFromModel,
      onProgress,
      { index: s + 1, total: numSegments },
    );
    merged.push(...part);
  }

  if (merged.length === 0) {
    throw new Error(
      "Brak treści w podzielonym materiale — sprawdź, czy plik został poprawnie zindeksowany.",
    );
  }

  return dedupeFlashcardsByFront(merged).slice(0, count);
}

/**
 * Lista tematów (outline) + generowanie fiszek przypiętych do kolejnych pozycji listy.
 */
export async function generateFlashcardsFromMaterial(
  model: string,
  context: string,
  count: number,
  detail: "short" | "medium" | "long",
  onProgress?: (p: FlashcardGenProgress) => void,
  options?: GenerateFlashcardsMaterialOptions,
): Promise<{ front: string; back: string }[]> {
  onProgress?.({ label: "Przygotowuję generowanie fiszek…", percent: 2 });

  if (
    options?.chunkRows &&
    options.chunkRows.length > 0 &&
    count > MATERIAL_SEGMENT_CARDS
  ) {
    return generateFromChunkSegments(
      model,
      count,
      detail,
      options.chunkRows,
      onProgress,
    );
  }

  const { topics, outlineFromModel } = await buildTopicsForGeneration(
    model,
    context,
    count,
    onProgress,
  );

  if (count <= FLASHCARD_BATCH_SIZE) {
    return runFlashcardGenerationAttempts(
      model,
      context,
      count,
      detail,
      topics,
      outlineFromModel,
      onProgress,
      null,
    );
  }

  const totalBatches = Math.ceil(count / FLASHCARD_BATCH_SIZE);
  const merged: { front: string; back: string }[] = [];
  for (let b = 0; b < totalBatches; b++) {
    const start = b * FLASHCARD_BATCH_SIZE;
    const n = Math.min(FLASHCARD_BATCH_SIZE, count - start);
    const slice = topics.slice(start, start + n);
    onProgress?.({
      label: `Generuję fiszki — partia ${b + 1} z ${totalBatches} (${n} z ${count} kart)…`,
      percent: 10 + Math.round(((b + 0.5) / totalBatches) * 80),
    });
    const part = await runFlashcardGenerationAttempts(
      model,
      context,
      n,
      detail,
      slice,
      outlineFromModel,
      onProgress,
      { index: b + 1, total: totalBatches },
    );
    merged.push(...part);
  }
  return merged;
}
