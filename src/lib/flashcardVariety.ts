/**
 * Wykrywanie „leniwych” zestawów: to samo pytanie innymi słowami / te same słowa kluczowe na każdej fiszce.
 */

const PL_STOP = new Set([
  "na",
  "w",
  "z",
  "do",
  "od",
  "że",
  "i",
  "a",
  "o",
  "u",
  "jest",
  "są",
  "się",
  "nie",
  "jak",
  "co",
  "czym",
  "czy",
  "jaki",
  "jaka",
  "jakie",
  "to",
  "ten",
  "ta",
  "te",
  "dla",
  "przy",
  "po",
  "pod",
  "nad",
  "tego",
  "tej",
  "tym",
  "oraz",
  "albo",
  "lub",
  "bardzo",
  "tylko",
  "ich",
  "nim",
  "też",
  "także",
  "który",
  "która",
  "które",
  "gdy",
  "jeśli",
  "aby",
  "przez",
  "przed",
  "między",
  "bez",
  "ponad",
  "tak",
  "nie",
  "więc",
  "czyli",
  "albo",
]);

function significantWords(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PL_STOP.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function normalizeFront(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.?!…]+$/u, "");
}

/**
 * Zwraca true, gdy zestaw wygląda na powtarzalny (identyczne lub bardzo podobne fronty).
 */
export function isRepetitiveFlashcards(
  cards: { front: string; back: string }[],
): boolean {
  if (cards.length < 2) return false;

  const normalized = cards.map((c) => normalizeFront(c.front));
  const uniq = new Set(normalized);
  if (uniq.size <= 1) return true;

  const n = cards.length;
  if (n >= 3 && uniq.size < Math.max(2, Math.ceil(n * 0.65))) return true;
  if (n >= 5 && uniq.size < Math.ceil(n * 0.55)) return true;

  /* Zbyt podobne zdania pytające (te same słowa merytoryczne, inna składnia). */
  const wordSets = normalized.map((s) => significantWords(s));
  let pairSum = 0;
  let pairCount = 0;
  let maxJac = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const jac = jaccard(wordSets[i]!, wordSets[j]!);
      pairSum += jac;
      pairCount++;
      if (jac > maxJac) maxJac = jac;
    }
  }
  const avgJac = pairCount > 0 ? pairSum / pairCount : 0;

  if (n >= 3 && maxJac >= 0.72) return true;
  if (n >= 4 && avgJac >= 0.38) return true;
  if (n >= 6 && avgJac >= 0.32) return true;

  /* Wspólny długi początek (parafrazy „Czym jest… / Co to jest…”). */
  const short = normalized.map((s) => s.slice(0, 48));
  const prefMap = new Map<string, number>();
  for (const p of short) {
    prefMap.set(p, (prefMap.get(p) ?? 0) + 1);
  }
  const maxPref = Math.max(...prefMap.values(), 0);
  if (n >= 4 && maxPref / n >= 0.72) return true;

  return false;
}

/** Tył wygląda na „metastreszczenie” wykładu zamiast faktu do nauki. */
const META_BACK_START_RE =
  /^\s*(?:(?:omówiono|przedstawiono|wyjaśniono|zaprezentowano|przeanalizowano|przedstawiono)\b|w\s+tekście\s+(?:omówiono|wyjaśniono|przedstawiono)\b|w\s+materiale\s+(?:omówiono|przedstawiono|wyjaśniono)\b|w\s+prezentacji\s+(?:omówiono|przedstawiono)\b)/i;

/**
 * Zwraca true, gdy zbyt wiele fiszek ma tyły w stylu „Omówiono…”, „Przedstawiono…” itd.
 */
export function hasMetaSummaryStyleBacks(
  cards: { front: string; back: string }[],
): boolean {
  if (cards.length === 0) return false;
  let bad = 0;
  for (const c of cards) {
    if (META_BACK_START_RE.test(c.back.trim())) bad++;
  }
  const threshold = Math.max(1, Math.ceil(cards.length * 0.18));
  return bad >= threshold;
}

/** Wykrywa identyczne fronty (po normalizacji). */
export function hasDuplicateNormalizedFronts(
  cards: { front: string; back: string }[],
): boolean {
  const seen = new Set<string>();
  for (const c of cards) {
    const k = c.front.trim().toLowerCase().replace(/\s+/g, " ");
    if (k.length === 0) continue;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}
