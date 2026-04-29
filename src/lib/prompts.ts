/** Szablony promptów (wersjonowane w kodzie). */

/**
 * Wspólne zasady treści fiszek — unikanie „streszczeń wykładu” zamiast faktów do zapamiętania.
 */
export const FLASHCARD_QUALITY_RULES_PL = [
  "Front: konkretne pytanie zamknięte lub pojęcie do sprawdzenia (np. „Jaki jest mechanizm …?”, „Wymień kryteria …”, „Czym charakteryzuje się …?”).",
  "ZAKAZ frontów-boilerplate: ogólnych tytułów rozdziałów w stylu „Podstawy A i B”, „Wprowadzenie do … całości” — zawęż do jednego zagadnienia z materiału.",
  "Tył (back): wyłącznie treść do nauki z materiału — definicja, lista punktów, mechanizm, nazwa leku/procedury, kryterium, typowy wynik badania, liczba.",
  "ZAKAZ tyłu-meta: zdań zaczynających się od „Omówiono…”, „Przedstawiono…”, „Wyjaśniono…”, „Zaprezentowano…”, „W tekście omówiono…”, „W materiale przedstawiono…” albo innych opisów „że omówiono temat” bez konkretnych faktów (nazw, mechanizmów, kryteriów).",
  "Zamiast „omówiono przyczyny i patofizjologię” — wypisz JEDEN konkretny fakt z materiału (np. definicja, czynnik, objaw, lek, zasada).",
].join(" ");

export function buildSummaryPrompt(context: string): { system: string; user: string } {
  return {
    system:
      "Jesteś asystentem nauki dla studenta. Odpowiadasz po polsku. Używaj WYŁĄCZNIE podanego kontekstu z materiału. Jeśli czegoś nie ma w kontekście, napisz: „brak w materiale”. Pisz zwięźle i konkretnie. Zwracaj wyłącznie poprawny Markdown.",
    user: `Na podstawie poniższego kontekstu z prezentacji przygotuj zwięzłe streszczenie w tym FORMACIE (markdown):

## Najważniejsze wnioski
- 4–6 krótkich punktów, każdy 1 zdanie, tylko konkret.

## Kluczowe pojęcia
- 6–10 haseł: **pojęcie** — krótkie objaśnienie (max 1 zdanie).

## Co zapamiętać na egzamin
- 3–5 punktów „must know”.

Zasady:
- Bez wstępów typu „na podstawie materiału...”.
- Bez emoji, bez zbędnych nagłówków, bez lania wody.
- Nie twórz długich akapitów.
- Jeśli informacja nie występuje w kontekście, napisz „brak w materiale”.
- Każdy punkt listy zaczynaj od "- ".
- Nie używaj "*" jako wypunktowania.
- Używaj tylko nagłówków poziomu "##".

Kontekst:
---
${context}
---
`,
  };
}

export function buildSummaryFormatterPrompt(rawSummary: string): {
  system: string;
  user: string;
} {
  return {
    system:
      "Jesteś redaktorem technicznym. Poprawiasz WYŁĄCZNIE format tekstu do czytelnego Markdown po polsku. Nie dopisuj nowych faktów i nie zmieniaj znaczenia.",
    user: `Przepisz poniższą analizę do czystego i czytelnego Markdown:

Wymagania:
- Zachowaj tylko te sekcje: "## Najważniejsze wnioski", "## Kluczowe pojęcia", "## Co zapamiętać na egzamin".
- Uporządkuj treść do krótkich list punktowanych.
- Usuń powtórzenia i artefakty typu "**", pojedyncze "*" oraz urwane zdania.
- Nie dodawaj informacji spoza tekstu wejściowego.

Tekst wejściowy:
---
${rawSummary}
---
`,
  };
}

export function buildFlashcardsPrompt(
  context: string,
  count: number,
  detail: "short" | "medium" | "long",
  opts?: { strictJsonFooter?: boolean },
): { system: string; user: string } {
  const len =
    detail === "short"
      ? "1 zdanie"
      : detail === "medium"
        ? "2-3 zdania"
        : "4-6 zdań";
  const system = [
    "Jesteś generatorem fiszek do nauki. Odpowiedź to WYŁĄCZNIE poprawny JSON — jedna tablica.",
    'Format: [{"front":"…","back":"…"}, …]. front = konkretne pytanie lub pojęcie; back = odpowiedź z materiału.',
    "KRYTYCZNE: tylko pola \"front\" i \"back\" — nigdy \"query\"/\"answer\" ani \"termin\"/\"definicja\"/\"kontekst\".",
    FLASHCARD_QUALITY_RULES_PL,
    "Zasady treści: KAŻDA fiszka dotyczy INNEGO zagadnienia z tekstu (definicja, mechanizm, objaw, klasyfikacja, różnica, kryterium, liczba, etap).",
    "ZAKAZ: powielania tego samego pytania na froncie (także innymi słowami — to nadal duplikat).",
    "ZAKAZ: wielokrotnego użycia tylko tytułu prezentacji lub ogólnego tematu zamiast konkretnych pojęć z treści.",
    "Najpierw wypisz w myślach listę RÓŻNYCH faktów/pojęć z materiału (np. z różnych slajdów/akapitów), potem jedna fiszka = jeden punkt z tej listy.",
    "Zabronione: streszczenia całości, wstępy, markdown, ``` — tylko tablica JSON.",
    "Pierwszy znak odpowiedzi to [ , ostatni to ] . Język polski.",
  ].join(" ");

  const userBody = `Zadanie w dwóch krokach:
1) Przejrzyj materiał i wybierz dokładnie ${count} różnych zagadnień do zapamiętania (konkretne pojęcia, fakty, zależności z tekstu — nie sam ogólny temat dokumentu).
2) Dla każdego z tych ${count} zagadnień utwórz jedną fiszkę: front = krótkie pytanie lub nazwa pojęcia do sprawdzenia; back = wyjaśnienie w stylu: ${len}, oparte na tym fragmencie materiału.

Wymagania liczbowe (krytyczne):
- Tablica JSON musi mieć DOKŁADNIE ${count} elementów — ani jednej fiszki mniej, ani więcej. Policz elementy przed wysłaniem odpowiedzi.

Wymagania merytoryczne:
- Żadnych dwóch identycznych pól "front"; unikaj parafraz tego samego pytania (np. „Czym jest X?” i „Co to jest X?” to jedno zagadnienie — wybierz wtedy inne zagadnienie z materiału, żeby i tak było ${count} różnych tematów).
- Fronty mają dotyczyć różnych faktów z tekstu: definicja A, objaw B, leczenie C, przyczyna D — nie wielokrotnie „co to jest choroba X” w innej odmianie.
- Nie wstawiaj wielokrotnie tylko tytułu prezentacji zamiast pytań merytorycznych.
- Jeśli materiał jest krótki, rozłóż pytania na różne aspekty (definicja / etiologia / objaw / diagnostyka / leczenie), zamiast powtarzać to samo innymi słowami.

Materiał źródłowy:
---
${context}
---
`;

  if (opts?.strictJsonFooter) {
    return {
      system,
      user:
        userBody +
        "\n\nOstatnia linia: TYLKO tablica JSON — " +
        `${count} różnych par front/back. ` +
        'Przykład kształtu (nie kopiuj treści): [{"front":"Co oznacza termin X w tekście?","back":"Według materiału: …"}]',
    };
  }

  return {
    system,
    user: userBody,
  };
}

/** Drugi etap: dopytanie o brakujące fiszki (gdy pierwsza odpowiedź miała za mało elementów). */
export function buildFlashcardsTopUpPrompt(
  context: string,
  need: number,
  detail: "short" | "medium" | "long",
  existingFronts: string[],
): { system: string; user: string } {
  const len =
    detail === "short"
      ? "1 zdanie"
      : detail === "medium"
        ? "2-3 zdania"
        : "4-6 zdań";
  const system = [
    "Jesteś generatorem fiszek. Odpowiedź to WYŁĄCZNIE poprawny JSON — jedna tablica.",
    "KRYTYCZNE: tylko pola \"front\" i \"back\" — nigdy \"query\"/\"answer\" ani \"termin\"/\"definicja\"/\"kontekst\".",
    FLASHCARD_QUALITY_RULES_PL,
    "Generujesz WYŁĄCZNIE NOWE fiszki uzupełniające zestaw — nie kopiuj pytań z listy „już wygenerowane”.",
    "Każda nowa fiszka = inne zagadnienie niż na liście (nie parafrazuj tego samego).",
    "Tablica musi mieć dokładnie tyle elementów, ile podano w zadaniu.",
    "Język polski. Bez markdown, tylko JSON.",
  ].join(" ");

  const listed = existingFronts
    .slice(0, 40)
    .map((f, i) => `${i + 1}. ${f.slice(0, 200)}`)
    .join("\n");

  const user = `Brakuje jeszcze dokładnie ${need} fiszek w zestawie.

Już wygenerowane pytania (front) — NIE POWTARZAJ ich ani nie pytaj o to samo innymi słowami:
---
${listed || "(brak — błąd listy)"}
---

Na podstawie TEGO SAMEGO materiału wymyśl ${need} DODATKOWYCH, RÓŻNYCH od powyższych zagadnień.
Tablica JSON musi mieć DOKŁADNIE ${need} obiektów {"front":"…","back":"…"}.
Tył (back) w stylu: ${len}.

Materiał:
---
${context}
---
`;

  return { system, user };
}

/** Etap 1: lista N odrębnych etykiet tematów — wymusza różnorodność zamiast wielu pytań o jedną chorobę. */
export function buildTopicOutlinePrompt(
  count: number,
  context: string,
): { system: string; user: string } {
  const system = [
    "Odpowiadasz WYŁĄCZNIE poprawnym JSON-em: jedna tablica stringów (pierwszy znak [ ).",
    "ZAKAZ: zwracania obiektu { \"tytuł\": ..., \"tematy\": [...] } — tylko tablica, np. [\"etykieta1\",\"etykieta2\",...].",
    "Każdy string to krótka etykieta tematu (2–12 słów) opisująca JEDNO zagadnienie z materiału.",
    "Etykiety muszą być merytorycznie RÓŻNE: inne pojęcie, inna choroba, inny mechanizm, inny lek, inny narząd lub inny rozdział — nie wolno wkleić tego samego tytułu N razy.",
    "Jeśli cały materiał dotyczy wyłącznie jednej choroby, użyj N różnych ASPEKTÓW (np. definicja, etiologia, patogeneza, objaw, badanie, leczenie, lek, powikłanie, rokowanie) — każda etykieta inna.",
    "ZAKAZ: wielokrotnego użycia tej samej nazwy choroby w każdej etykiecie, jeśli w tekście są też inne jednostki.",
    "Bez markdown, bez komentarzy — tylko tablica JSON.",
  ].join(" ");

  const user = `Wymyśl dokładnie ${count} różnych etykiet tematów do fiszek z poniższego materiału.

Wymagania:
- Tablica JSON musi mieć DOKŁADNIE ${count} elementów — stringów.
- Każda etykieta inna; nie parafrazuj tej samej myśli innymi słowami.

Materiał:
---
${context}
---
`;

  return { system, user };
}

/** Etap 2: fiszki przypisane do listy tematów (kolejność 1:1). */
export function buildFlashcardsPromptWithOutline(
  context: string,
  count: number,
  detail: "short" | "medium" | "long",
  topicLabels: string[],
  opts?: { strictJsonFooter?: boolean },
): { system: string; user: string } {
  const len =
    detail === "short"
      ? "1 zdanie"
      : detail === "medium"
        ? "2-3 zdania"
        : "4-6 zdań";

  const labels = topicLabels
    .slice(0, count)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const system = [
    "Jesteś generatorem fiszek. Odpowiedź to WYŁĄCZNIE poprawny JSON — jedna tablica.",
    'Format: [{"front":"…","back":"…"}, …].',
    "KRYTYCZNE: używaj WYŁĄCZNIE pól \"front\" i \"back\" w każdym obiekcie — ZAKAZ kluczy: \"query\", \"answer\", \"prompt\", \"termin\", \"definicja\", \"kontekst\" (to psuje import).",
    FLASHCARD_QUALITY_RULES_PL,
    "Masz ustaloną listę tematów — fiszka nr i dotyczy WYŁĄCZNIE tematu nr i z listy (nie mieszaj z innymi pozycjami).",
    "Front: wąskie pytanie lub pojęcie z tematu i (nie kopiuj bezkrytycznie całej etykiety jako pytania — zawęź do jednego aspektu: definicja / przyczyna / objaw / leczenie / rozpoznanie).",
    "Back: konkretne fakty z materiału w stylu podanym w zadaniu — nie opis „że przedmiot został omówiony”.",
    "Jedna fiszka = jeden punkt z listy — nie jedna choroba na cały zestaw.",
    "Zabronione: streszczenia, markdown, ```.",
    "Język polski. Pierwszy znak odpowiedzi to [ .",
  ].join(" ");

  const userBody = `Poniżej jest dokładnie ${count} tematów (jedna fiszka na każdy, w tej kolejności):
---
${labels}
---

Dla każdego tematu i utwórz jedną fiszkę: front = jedno konkretne pytanie lub pojęcie do sprawdzenia (nie ogólny tytuł rozdziału); back = ${len} — wyłącznie fakty z materiału przypisane do tego tematu, bez zdań „omówiono/przedstawiono…”.

Wymagania:
- Tablica JSON: DOKŁADNIE ${count} obiektów (indeks 0 = temat 1, itd.).
- Nie twórz fiszek o „zapaleniu płuc” na wszystkich pozycjach, jeśli temat 2–15 dotyczy innych zagadnień z listy.
- Jeśli któryś temat z listy jest wąski, i tak ogranicz się do niego — nie wstawiaj treści z innych tematów.

Materiał źródłowy:
---
${context}
---
`;

  if (opts?.strictJsonFooter) {
    return {
      system,
      user:
        userBody +
        "\n\nOstatnia linia: TYLKO tablica JSON — " +
        `${count} obiektów. Kolejność = kolejność listy tematów. `,
    };
  }

  return { system, user: userBody };
}
