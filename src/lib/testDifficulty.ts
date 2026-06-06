export type TestDifficulty = "light" | "standard" | "hard" | "exam";

const KEY = "edumelon_test_difficulty";

export const DEFAULT_TEST_DIFFICULTY: TestDifficulty = "exam";

export type TestDifficultyOption = {
  id: TestDifficulty;
  label: string;
  hint: string;
};

/** Opcje UI — bez skali 1–5 w copy (reguła workspace). */
export const TEST_DIFFICULTY_OPTIONS: TestDifficultyOption[] = [
  {
    id: "light",
    label: "Łagodny",
    hint: "Podstawy i przypomnienie — do pierwszej powtórki materiału.",
  },
  {
    id: "standard",
    label: "Standardowy",
    hint: "Typowe pytania kolokwialne — trzeba rozumieć, nie tylko zapamiętać.",
  },
  {
    id: "hard",
    label: "Trudny",
    hint: "Łączenie kilku faktów, mechanizmy i konsekwencje.",
  },
  {
    id: "exam",
    label: "Egzaminacyjny",
    hint: "Skomplikowane i podchwytliwe — część pytań łączy kilka zagadnień naraz.",
  },
];

export function isTestDifficulty(value: string): value is TestDifficulty {
  return TEST_DIFFICULTY_OPTIONS.some((o) => o.id === value);
}

export function getStoredTestDifficulty(): TestDifficulty {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && isTestDifficulty(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_TEST_DIFFICULTY;
}

export function setStoredTestDifficulty(difficulty: TestDifficulty): void {
  localStorage.setItem(KEY, difficulty);
}

export function getTestDifficultyOption(
  difficulty: TestDifficulty,
): TestDifficultyOption {
  return (
    TEST_DIFFICULTY_OPTIONS.find((o) => o.id === difficulty) ??
    TEST_DIFFICULTY_OPTIONS.find((o) => o.id === DEFAULT_TEST_DIFFICULTY)!
  );
}

/** Ile pytań w całym teście ma łączyć kilka zagadnień (poziom egzaminacyjny: 20%). */
export function getMultiTopicQuestionCount(totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  return Math.max(1, Math.round(totalQuestions * 0.2));
}

/** Linia do system prompt (Gemini / Ollama). */
export function getTestDifficultySystemLine(difficulty: TestDifficulty): string {
  switch (difficulty) {
    case "light":
      return "Poziom trudności: łagodny — pytania o podstawy, definicje i proste przypomnienie faktów z materiału.";
    case "standard":
      return "Poziom trudności: standardowy — pytania kolokwialne wymagające zrozumienia, nie trywialnego recall.";
    case "hard":
      return "Poziom trudności: trudny — wymagaj łączenia wielu faktów, mechanizmów przyczynowo-skutkowych i różnicowania.";
    case "exam":
      return "Poziom trudności: egzaminacyjny — pytania skomplikowane, podchwytliwe; mechanizmy, diagnostyka różnicowa, skutki kliniczne; część pytań musi jednocześnie łączyć wiedzę z kilku zagadnień.";
  }
}

/** Blok wymagań w user prompt (tekst / PDF). */
export function getTestDifficultyRequirements(
  difficulty: TestDifficulty,
  questionCount?: number,
): string {
  switch (difficulty) {
    case "light":
      return `- Pytania sprawdzają **podstawową wiedzę** z materiału — definicje, kluczowe terminy, proste zależności.
- Dystraktory mogą być oczywistsze niż na egzaminie, ale nadal merytoryczne.
- Unikaj wieloetapowego rozumowania i skrajnie podchwytliwych sformułowań.
- Około **10%** pytań negatywnych (np. „Które NIE…") — reszta pozytywna.`;
    case "standard":
      return `- Pytania wymagają **zrozumienia** treści — nie wystarczy suchy recall jednej definicji.
- Preferuj: zastosowanie pojęć, proste porównania, „dlaczego / kiedy".
- Dystraktory brzmią sensownie, lecz są błędne w kontekście pytania.
- Około **15%** pytań negatywnych — reszta pozytywna.`;
    case "hard":
      return `- Pytania wymagają **syntezy** — łączenie co najmniej dwóch faktów z materiału.
- Preferuj: mechanizmy, przyczyny/skutki, różnicowanie, interpretację danych z tekstu.
- Dystraktory muszą być merytorycznie poprawne w **innym** kontekście.
- Około **20%** pytań negatywnych — reszta pozytywna.`;
    case "exam": {
      const multiTopic =
        questionCount != null
          ? `- **Dokładnie ${getMultiTopicQuestionCount(questionCount)}** z ${questionCount} pytań (**20%**) musi jednocześnie sprawdzać wiedzę z **kilku różnych zagadnień** materiału — student musi połączyć wiele faktów naraz, a nie odpowiedzieć z jednego fragmentu.`
          : `- **20%** pytań musi jednocześnie sprawdzać wiedzę z kilku różnych zagadnień materiału.`;
      return `- Pytania **skomplikowane** i **podchwytliwe** — wymagają uwagi, precyzyjnego czytania i eliminacji pozornie poprawnych dystraktorów.
- Unikaj trywialnego „co to jest X?”; preferuj: mechanizmy, przyczyny/skutki, różnicowanie, zastosowanie kliniczne, interpretację danych.
- Dystraktory merytorycznie poprawne w **innym** kontekście — mają kuszić studenta, który zna pojęcia, ale nie rozumie niuansów.
${multiTopic}
- Około **20%** pytań negatywnych (np. „Które stwierdzenie NIE jest prawdziwe…") — reszta pozytywna.`;
    }
  }
}

/** Blueprint dla generacji paczkami (Ollama). */
export function getTestDifficultyBlueprint(
  difficulty: TestDifficulty,
  questionsInBatch?: number,
): string {
  const levelLine =
    difficulty === "light"
      ? "poziom: łagodny — podstawy i przypomnienie"
      : difficulty === "standard"
        ? "poziom: standardowy — zrozumienie i typowe kolokwium"
        : difficulty === "hard"
          ? "poziom: trudny — synteza wielu faktów z fragmentu"
          : "poziom: egzaminacyjny — skomplikowane, podchwytliwe, cross-page reasoning";

  const synthesisRule =
    difficulty === "light"
      ? "pytania mogą opierać się na jednym kluczowym fakcie z paczki"
      : difficulty === "standard"
        ? "co najmniej jedno pytanie powinno wymagać zastosowania pojęcia z kontekstu"
        : difficulty === "hard"
          ? "co najmniej jedno pytanie ma wymagać powiązania 2+ faktów z kontekstu"
          : questionsInBatch != null && questionsInBatch >= 2
            ? `co najmniej jedno pytanie w tej paczce ma łączyć kilka różnych zagadnień/slajdów naraz (w całym teście ok. 20% takich pytań)`
            : "pytania skomplikowane i podchwytliwe; w całym teście ok. 20% pytań łączy kilka zagadnień naraz";

  const examExtra =
    difficulty === "exam"
      ? "\n- sformułowania podchwytliwe: dystraktory kuszą studenta znającego pojęcia, ale nie rozumiejącego niuansów"
      : "";

  return `Difficulty Blueprint:
- ${levelLine},
- ${synthesisRule}.${examExtra}`;
}

/** Dodatkowe zasady w pętli Ollama (paczki slajdów). */
export function getTestDifficultyOllamaChunkRules(difficulty: TestDifficulty): string {
  switch (difficulty) {
    case "light":
      return `- pytanie może sprawdzać definicję lub prosty fakt z paczki;
- cross-page reasoning opcjonalne;`;
    case "standard":
      return `- pytanie ma sprawdzać zrozumienie pojęć z paczki;
- cross-page reasoning zalecane, gdy paczka obejmuje wiele slajdów;`;
    case "hard":
      return `- pytanie ma sprawdzać mechanizm, różnicowanie albo skutek kliniczny;
- wymagaj cross-page reasoning (łączenie min. 2 faktów z paczki);`;
    case "exam":
      return `- pytania skomplikowane i podchwytliwe — bez oczywistej odpowiedzi;
- pytanie ma sprawdzać mechanizm, różnicowanie albo skutek kliniczny;
- wymagaj cross-page reasoning (łączenie min. 2 faktów z paczki);
- gdy paczka obejmuje różne tematy: twórz pytania łączące kilka zagadnień naraz (w całym teście ok. 20% pytań ma spełniać ten warunek);`;
  }
}

/** System prompt dla pętli Ollama (paczki slajdów). */
export function getTestDifficultyOllamaSystem(difficulty: TestDifficulty): string {
  const base =
    "Jesteś akademickim twórcą pytań egzaminacyjnych. Dystraktory muszą być merytorycznie poprawne w innym kontekście. Zwracasz WYŁĄCZNIE tablicę JSON.";
  return `${base} ${getTestDifficultySystemLine(difficulty)}`;
}

/** Przymiotnik do „Wygeneruj … pytania” w user prompt. */
export function getTestDifficultyAdjective(difficulty: TestDifficulty): string {
  switch (difficulty) {
    case "light":
      return "łagodne";
    case "standard":
      return "standardowe";
    case "hard":
      return "trudne";
    case "exam":
      return "skomplikowane, podchwytliwe egzaminacyjne";
  }
}
