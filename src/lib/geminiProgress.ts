/** Powody odrzucenia pytań — używane w komunikatach błędów. */
export type TestRejectReasonCounts = {
  invalid_shape: number;
  duplicate_options: number;
  quality_gate: number;
  duplicate_question: number;
  invalid_json: number;
};

/** Wspólny kształt postępu generowania AI (testy, fiszki, streszczenie). */
export type AiGenerationProgress = {
  label: string;
  percent: number;
  /** Indeks bieżącego kroku (0-based) — checklist w UI */
  stepIndex?: number;
  /** Etykiety kroków checklisty */
  steps?: readonly string[];
  /** Pasek „w toku” zamiast sztywnego procentu (długie oczekiwanie na API) */
  indeterminate?: boolean;
  /** Dodatkowa linia pod paskiem */
  detail?: string;
};

export const GEMINI_TEST_PROGRESS_STEPS = [
  "Przygotowanie",
  "Analiza materiału",
  "Tworzenie pytań",
  "Sprawdzanie odpowiedzi",
] as const;

export const GEMINI_FLASHCARD_PROGRESS_STEPS = [
  "Przygotowanie",
  "Tworzenie fiszek",
  "Sprawdzanie odpowiedzi",
] as const;

export const GEMINI_SUMMARY_PROGRESS_STEPS = [
  "Czytanie materiału",
  "Przygotowanie",
  "Pisanie streszczenia",
  "Wersja skrócona",
] as const;

const GEMINI_WAIT_MESSAGES_TESTS = [
  "Gemini analizuje materiał…",
  "Tworzę pytania na podstawie treści…",
  "To może potrwać kilka minut — pracuję nad zestawem…",
  "Sprawdzam wykresy i tabele w materiale…",
  "Dopracowuję pytania wielokrotnego wyboru…",
] as const;

const GEMINI_WAIT_MESSAGES_FLASHCARDS = [
  "Gemini czyta materiał…",
  "Tworzę fiszki na podstawie treści…",
  "To może potrwać chwilę — przygotowuję kartę po karcie…",
  "Dopracowuję pytania i odpowiedzi…",
] as const;

const GEMINI_WAIT_MESSAGES_SUMMARY = [
  "Gemini czyta materiał…",
  "Piszę streszczenie na podstawie treści…",
  "To może potrwać chwilę…",
  "Porządkuję najważniejsze informacje…",
] as const;

function polishQuestionCount(n: number): string {
  if (n === 1) return "1 pytanie";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} pytania`;
  }
  return `${n} pytań`;
}

function polishFlashcardCount(n: number): string {
  if (n === 1) return "1 fiszkę";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} fiszki`;
  }
  return `${n} fiszek`;
}

export function formatTestGenerationFailureMessage(params: {
  targetCount: number;
  parsedCount: number;
  afterQualityCount: number;
  finalCount: number;
  rejectReasons: TestRejectReasonCounts;
}): string {
  const { targetCount, parsedCount, afterQualityCount, finalCount, rejectReasons } =
    params;

  const lines: string[] = [
    `Nie udało się przygotować testu (${finalCount} z ${targetCount} pytań).`,
  ];

  if (parsedCount === 0) {
    if (rejectReasons.invalid_json > 0) {
      lines.push("Odpowiedź była nieczytelna lub w złym formacie.");
    } else {
      lines.push("Model nie zwrócił żadnych poprawnych pytań.");
    }
  } else {
    lines.push(`Model zwrócił ${polishQuestionCount(parsedCount)}.`);
    const qualityDropped = parsedCount - afterQualityCount;
    if (qualityDropped > 0) {
      lines.push(
        `${polishQuestionCount(qualityDropped)} odrzucono jako zbyt słabe lub niezgodne z materiałem.`,
      );
    }
    if (rejectReasons.duplicate_question > 0) {
      lines.push(
        `${polishQuestionCount(rejectReasons.duplicate_question)} było duplikatami.`,
      );
    }
    if (rejectReasons.duplicate_options > 0) {
      lines.push(
        `${polishQuestionCount(rejectReasons.duplicate_options)} miało powtarzające się odpowiedzi.`,
      );
    }
    if (rejectReasons.invalid_shape > 0) {
      lines.push(
        `${polishQuestionCount(rejectReasons.invalid_shape)} miało niepełną treść (brak opcji lub poprawnej odpowiedzi).`,
      );
    }
  }

  lines.push(
    "Spróbuj ponownie, wybierz łatwiejszy poziom albo zmniejsz liczbę pytań.",
  );
  return lines.join(" ");
}

export function summaryStageToProgress(
  stage:
    | "idle"
    | "loading-context"
    | "building-prompt"
    | "generating-main"
    | "generating-short"
    | "done",
): AiGenerationProgress | null {
  switch (stage) {
    case "loading-context":
      return {
        label: "Czytam treść materiału…",
        percent: 15,
        stepIndex: 0,
        steps: GEMINI_SUMMARY_PROGRESS_STEPS,
      };
    case "building-prompt":
      return {
        label: "Przygotowuję materiał do streszczenia…",
        percent: 30,
        stepIndex: 1,
        steps: GEMINI_SUMMARY_PROGRESS_STEPS,
      };
    case "generating-main":
      return {
        label: "Piszę pełne streszczenie…",
        percent: 55,
        stepIndex: 2,
        steps: GEMINI_SUMMARY_PROGRESS_STEPS,
        indeterminate: true,
      };
    case "generating-short":
      return {
        label: "Tworzę krótką wersję do szybkiej powtórki…",
        percent: 85,
        stepIndex: 3,
        steps: GEMINI_SUMMARY_PROGRESS_STEPS,
        indeterminate: true,
      };
    case "done":
      return {
        label: "Gotowe.",
        percent: 100,
        stepIndex: 3,
        steps: GEMINI_SUMMARY_PROGRESS_STEPS,
      };
    default:
      return null;
  }
}

export function formatFlashcardGenerationFailureMessage(params: {
  targetCount: number;
  parsedCount: number;
  finalCount: number;
}): string {
  const { targetCount, parsedCount, finalCount } = params;
  if (parsedCount === 0) {
    return (
      `Nie udało się przygotować fiszek (${finalCount} z ${targetCount}). ` +
      "Model nie zwrócił poprawnej listy kart. Spróbuj ponownie lub zmniejsz liczbę fiszek."
    );
  }
  return (
    `Nie udało się przygotować fiszek (${finalCount} z ${targetCount}). ` +
    `Model zwrócił ${polishFlashcardCount(parsedCount)}, ale żadna nie przeszła weryfikacji. ` +
    "Spróbuj ponownie lub zmniejsz liczbę fiszek."
  );
}

type WaitMessageKind = "tests" | "flashcards" | "summary";

function waitMessagesFor(kind: WaitMessageKind): readonly string[] {
  switch (kind) {
    case "flashcards":
      return GEMINI_WAIT_MESSAGES_FLASHCARDS;
    case "summary":
      return GEMINI_WAIT_MESSAGES_SUMMARY;
    default:
      return GEMINI_WAIT_MESSAGES_TESTS;
  }
}

/** Aktualizuje etykietę co kilka sekund podczas długiego oczekiwania na Gemini. */
export async function runWithGeminiWaitProgress<T>(
  onProgress: ((p: AiGenerationProgress) => void) | undefined,
  base: AiGenerationProgress,
  fn: () => Promise<T>,
  options?: { heartbeatMs?: number; messageKind?: WaitMessageKind },
): Promise<T> {
  const heartbeatMs = options?.heartbeatMs ?? 3_000;
  const messages = waitMessagesFor(options?.messageKind ?? "tests");
  let tick = 0;
  onProgress?.({ ...base, indeterminate: true });
  const heartbeatId = setInterval(() => {
    tick += 1;
    onProgress?.({
      ...base,
      label: messages[tick % messages.length]!,
      indeterminate: true,
    });
  }, heartbeatMs);
  try {
    return await fn();
  } finally {
    clearInterval(heartbeatId);
  }
}
