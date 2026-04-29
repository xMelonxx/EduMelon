/**
 * Odczyt tablicy fiszek z odpowiedzi modelu (markdown, tekst wokół JSON, zachłanny regex).
 */

/**
 * Schema dla Ollama structured outputs — bez min/max na tablicy model często
 * ucina odpowiedź (np. ~16 elementów). Zawsze podawaj `count` z żądanej liczby fiszek.
 */
export const OLLAMA_FLASHCARDS_FORMAT = {
  type: "array",
  items: {
    type: "object",
    properties: {
      front: { type: "string" },
      back: { type: "string" },
    },
    required: ["front", "back"],
  },
} as const;

/** Tablica dokładnie `count` fiszek (constraint dla Ollama format / structured output). */
export function buildOllamaFlashcardsArraySchema(count: number) {
  return {
    type: "array",
    minItems: count,
    maxItems: count,
    items: {
      type: "object",
      properties: {
        front: { type: "string" },
        back: { type: "string" },
      },
      required: ["front", "back"],
      additionalProperties: false,
    },
  } as const;
}

function stripMarkdownCodeFences(s: string): string {
  let t = s.trim();
  /* Otwarcie nawet gdy w tej samej linii jest `[` po ```json */
  t = t.replace(/^```(?:json)?\s*/i, "");
  t = t.replace(/\r?\n?```\s*$/i, "");
  return t.trim();
}

/** Tablica stringów z etapu „lista tematów” (outline). */
export function parseJsonStringArray(raw: string): string[] | null {
  const cleaned = stripMarkdownCodeFences(raw);
  const attempts: string[] = [cleaned];
  const extracted = extractBalancedJsonArray(cleaned);
  if (extracted && extracted !== cleaned) attempts.push(extracted);
  for (const chunk of attempts) {
    try {
      const data: unknown = JSON.parse(chunk);
      if (Array.isArray(data)) {
        const out = data
          .map((x) => String(x).trim())
          .filter((s) => s.length > 0);
        return out.length > 0 ? out : null;
      }
      if (data && typeof data === "object") {
        const o = data as Record<string, unknown>;
        for (const k of ["topics", "tematy", "etykiety", "items", "data", "lista"]) {
          const v = o[k];
          if (Array.isArray(v)) {
            const out = v
              .map((x) => String(x).trim())
              .filter((s) => s.length > 0);
            if (out.length > 0) return out;
          }
        }
      }
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Wycina pierwszy top-level JSON array z uwzględnieniem stringów (nie łamie się na `]` w treści).
 */
function extractBalancedJsonArray(raw: string): string | null {
  const s = raw.trim();
  const start = s.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let i = start;
  while (i < s.length) {
    const c = s[i]!;
    if (inString) {
      if (c === "\\") {
        i++;
        if (i < s.length && s[i] === "u" && i + 4 < s.length) {
          const h = s.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(h)) i += 5;
        } else if (i < s.length) i++;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      i++;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

/** Pierwszy zbalansowany obiekt JSON `{ ... }` (np. gdy model zwraca podsumowanie zamiast tablicy). */
function extractBalancedJsonObject(raw: string): string | null {
  const s = raw.trim();
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let i = start;
  while (i < s.length) {
    const c = s[i]!;
    if (inString) {
      if (c === "\\") {
        i++;
        if (i < s.length && s[i] === "u" && i + 4 < s.length) {
          const h = s.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(h)) i += 5;
        } else if (i < s.length) i++;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

function readStringField(
  r: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Jedna fiszka z obiektu JSON — modele często dają query/answer lub termin/definicja zamiast front/back. */
function cardPairFromRecord(r: Record<string, unknown>): {
  front: string;
  back: string;
} | null {
  const termin = readStringField(
    r,
    "termin",
    "term",
    "pojecie",
    "pojęcie",
    "haslo",
    "hasło",
    "nazwa_pojecia",
    "nazwa_pojęcia",
  );
  const definicja = readStringField(
    r,
    "definicja",
    "definicia",
    "wyjasnienie",
    "wyjaśnienie",
    "opis_merytoryczny",
  );
  const kontekst = readStringField(
    r,
    "kontekst",
    "kontekst_tematyczny",
    "dzial",
    "dział",
    "obszar",
  );
  if (termin && definicja) {
    const back = kontekst ? `${kontekst}\n\n${definicja}` : definicja;
    return { front: termin, back };
  }
  if (kontekst && definicja && !termin) {
    return { front: kontekst, back: definicja };
  }

  const front = readStringField(
    r,
    "front",
    "query",
    "prompt",
    "question",
    "q",
    "nazwa",
    "tytul",
    "tytuł",
    "temat",
    "topic",
    "pytanie",
    "title",
    "zagadnienie",
  );
  const back = readStringField(
    r,
    "back",
    "answer",
    "response",
    "reply",
    "details",
    "definicja",
    "definicia",
    "treść",
    "tresc",
    "szczegoly",
    "szczegóły",
    "content",
    "tekst",
    "opis",
    "odpowiedz",
    "odpowiedź",
    "szczegoly_opis",
  );
  if (front && back) return { front, back };
  return null;
}

/**
 * Gdy JSON jest ucięty w połowie tablicy — wyciąga kompletne obiekty `{...}` po kolei.
 */
function salvageCardsFromPartialJsonArray(raw: string): {
  front: string;
  back: string;
}[] | null {
  const s = raw.trim();
  const bracket = s.indexOf("[");
  if (bracket < 0) return null;
  let pos = bracket + 1;
  const out: { front: string; back: string }[] = [];
  while (pos < s.length) {
    while (pos < s.length && /[\s,\r\n]/.test(s[pos]!)) pos++;
    if (pos >= s.length || s[pos] === "]") break;
    if (s[pos] !== "{") break;
    const slice = s.slice(pos);
    const objStr = extractBalancedJsonObject(slice);
    if (!objStr) break;
    try {
      const obj = JSON.parse(objStr) as Record<string, unknown>;
      const pair = cardPairFromRecord(obj);
      if (pair) out.push(pair);
    } catch {
      break;
    }
    pos += objStr.length;
  }
  return out.length > 0 ? out : null;
}

/** Para query/answer w surowym tekście (gdy JSON jest niepoprawny). */
function regexSalvageQueryAnswerPairs(
  cleaned: string,
): { front: string; back: string }[] | null {
  const re =
    /"(?:query|prompt)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"(?:answer|response|reply)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
  const out: { front: string; back: string }[] = [];
  let m: RegExpExecArray | null;
  const unesc = (s: string) =>
    s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  while ((m = re.exec(cleaned)) !== null) {
    const front = unesc(m[1]!).trim();
    const back = unesc(m[2]!).trim();
    if (front.length > 0 && back.length > 0) out.push({ front, back });
  }
  return out.length > 0 ? out : null;
}

/** Para termin/definicja (częsty format modeli zamiast front/back). */
function regexSalvageTerminDefinicjaPairs(
  cleaned: string,
): { front: string; back: string }[] | null {
  const unesc = (s: string) =>
    s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  const out: { front: string; back: string }[] = [];

  const reTD =
    /"termin"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"definicja"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = reTD.exec(cleaned)) !== null) {
    const front = unesc(m[1]!).trim();
    const back = unesc(m[2]!).trim();
    if (front.length > 0 && back.length > 0) out.push({ front, back });
  }
  if (out.length > 0) return out;

  const reDT =
    /"definicja"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"termin"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
  while ((m = reDT.exec(cleaned)) !== null) {
    const back = unesc(m[1]!).trim();
    const front = unesc(m[2]!).trim();
    if (front.length > 0 && back.length > 0) out.push({ front, back });
  }
  return out.length > 0 ? out : null;
}

/** Tablice „sekcji” / „podproblemów” w złożonych JSON-ach podsumowań (nie front/back). */
const POLISH_SECTION_ARRAY_KEYS = [
  "sekcje",
  "sekcja",
  "sektory",
  "sektor",
  "podproblemy",
  "podproblemy_tematyczne",
  "punkty",
  "zagadnienia",
  "elementy",
  "bloki",
  "obszary",
] as const;

/** Jedna sekcja z JSON-a podsumowania (tytuł+treść albo tytuł+punkty). */
function appendCardsFromSectionItem(
  s: Record<string, unknown>,
  out: { front: string; back: string }[],
): void {
  const direct = cardPairFromRecord(s);
  if (direct) {
    out.push(direct);
    return;
  }
  const sectionTitle = readStringField(
    s,
    "tytuł",
    "tytul",
    "nazwa",
    "temat",
    "title",
    "naglowek",
    "nagłówek",
  );
  const punkty = s.punkty;
  if (Array.isArray(punkty) && sectionTitle) {
    for (const raw of punkty) {
      if (typeof raw !== "string") continue;
      const p = raw.trim();
      if (p.length === 0) continue;
      out.push({ front: p, back: sectionTitle });
    }
  }
}

/**
 * Gdy `JSON.parse` całości się wywali (ucięty stream), wycinamy kompletne `{…}` z tablic `sekcje` / `sektory`.
 */
function salvageParsePolishSummaryLayout(
  cleaned: string,
): { front: string; back: string }[] | null {
  const keys = ["sekcje", "sektory", "podproblemy"] as const;
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*\\[`, "i");
    const m = cleaned.match(re);
    if (!m || m.index === undefined) continue;
    let pos = m.index + m[0].length;
    const out: { front: string; back: string }[] = [];
    while (pos < cleaned.length) {
      while (pos < cleaned.length && /[\s,\r\n]/.test(cleaned[pos])) pos++;
      if (cleaned[pos] === "]") break;
      if (cleaned[pos] !== "{") break;
      const slice = cleaned.slice(pos);
      const objStr = extractBalancedJsonObject(slice);
      if (!objStr) break;
      try {
        const obj = JSON.parse(objStr) as Record<string, unknown>;
        appendCardsFromSectionItem(obj, out);
      } catch {
        break;
      }
      pos += objStr.length;
    }
    if (out.length > 0) return out;
  }
  return null;
}

/**
 * Modele często zwracają „podsumowanie” z polskimi kluczami zamiast front/back.
 */
function coerceFromPolishSummaryShape(
  o: Record<string, unknown>,
): { front: string; back: string }[] | null {
  for (const key of POLISH_SECTION_ARRAY_KEYS) {
    const arr = o[key];
    if (!Array.isArray(arr)) continue;
    const out: { front: string; back: string }[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      appendCardsFromSectionItem(item as Record<string, unknown>, out);
    }
    if (out.length > 0) return out;
  }
  return null;
}

/**
 * Obiekt root: { "tytuł", "tematy": ["...", ...] } — często zamiast tablicy fiszek.
 */
function coerceRootTematyStrings(
  o: Record<string, unknown>,
): { front: string; back: string }[] | null {
  const tematy = o.tematy;
  if (!Array.isArray(tematy)) return null;
  const title = readStringField(
    o,
    "tytuł",
    "tytul",
    "title",
    "nazwa",
  );
  if (!title) return null;
  const out: { front: string; back: string }[] = [];
  const seen = new Set<string>();
  for (const raw of tematy) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (t.length === 0) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ front: t, back: title });
  }
  return out.length > 0 ? out : null;
}

/** Gdy JSON jest zepsuty, ale w tekście są zamknięte pary "tytuł"/"treść". */
function regexSalvageTytulTrescPairs(
  cleaned: string,
): { front: string; back: string }[] | null {
  const re =
    /"(?:tytuł|tytul)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"(?:treść|tresc)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
  const out: { front: string; back: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const unesc = (s: string) =>
      s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    const front = unesc(m[1]).trim();
    const back = unesc(m[2]).trim();
    if (front.length > 0 && back.length > 0) out.push({ front, back });
  }
  return out.length > 0 ? out : null;
}

function normalizeCards(data: unknown): { front: string; back: string }[] | null {
  if (Array.isArray(data)) {
    const out: { front: string; back: string }[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const x = item as Record<string, unknown>;
      const pair = cardPairFromRecord(x);
      if (pair) out.push(pair);
    }
    return out.length > 0 ? out : null;
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const fromTematy = coerceRootTematyStrings(o);
    if (fromTematy) return fromTematy;
    const single = cardPairFromRecord(o);
    if (single) return [single];
    const fromSummary = coerceFromPolishSummaryShape(o);
    if (fromSummary) return fromSummary;
    for (const key of ["cards", "flashcards", "items", "data", "fiszki"]) {
      const v = o[key];
      if (Array.isArray(v)) {
        const n = normalizeCards(v);
        if (n) return n;
      }
    }
  }
  return null;
}

/**
 * Parsuje odpowiedź modelu do listy fiszek.
 */
export function parseFlashcardsFromModel(raw: string): {
  front: string;
  back: string;
}[] {
  const cleaned = stripMarkdownCodeFences(raw);

  const attempts: string[] = [cleaned];
  const extractedObj = extractBalancedJsonObject(cleaned);
  if (extractedObj && extractedObj !== cleaned) attempts.push(extractedObj);
  const extracted = extractBalancedJsonArray(cleaned);
  if (extracted && extracted !== cleaned) attempts.push(extracted);

  for (const chunk of attempts) {
    try {
      const parsed: unknown = JSON.parse(chunk);
      const cards = normalizeCards(parsed);
      if (cards) return cards;
    } catch {
      /* next */
    }
  }

  const salvaged = salvageParsePolishSummaryLayout(cleaned);
  if (salvaged && salvaged.length > 0) return salvaged;

  const regexPairs = regexSalvageTytulTrescPairs(cleaned);
  if (regexPairs && regexPairs.length > 0) return regexPairs;

  const partialArr = salvageCardsFromPartialJsonArray(cleaned);
  if (partialArr && partialArr.length > 0) return partialArr;

  const qaPairs = regexSalvageQueryAnswerPairs(cleaned);
  if (qaPairs && qaPairs.length > 0) return qaPairs;

  const terminDef = regexSalvageTerminDefinicjaPairs(cleaned);
  if (terminDef && terminDef.length > 0) return terminDef;

  const preview = raw.trim().slice(0, 280).replace(/\s+/g, " ");
  throw new Error(
    `Model nie zwrócił poprawnej tablicy JSON z fiszkami (front/back). ` +
      `Spróbuj ponownie lub zmniejsz liczbę fiszek. Fragment odpowiedzi: «${preview}${raw.length > 280 ? "…" : ""}»`,
  );
}
