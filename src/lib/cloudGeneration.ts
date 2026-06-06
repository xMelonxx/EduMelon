import type { ChunkRow } from "./db";
import { getAiProviderId } from "./storage";

/** Gemini: jedno dopracowane zapytanie zamiast wielu małych (outline, top-up, paczki…). */
export function useSingleShotCloudGeneration(): boolean {
  return getAiProviderId() === "gemini";
}

/** Limit kontekstu w jednym prompcie (Gemini ma duże okno, ale trzymamy rozsądny pułap). */
export const MAX_CLOUD_GENERATION_CONTEXT_CHARS = 120_000;

export function materialContextFromChunks(
  chunks: ChunkRow[],
  maxChars = MAX_CLOUD_GENERATION_CONTEXT_CHARS,
): string {
  const sorted = [...chunks].sort(
    (a, b) => (a.slide_index ?? 0) - (b.slide_index ?? 0),
  );
  return sorted
    .map((c) => c.body)
    .join("\n\n")
    .slice(0, maxChars);
}

export function extractMarkdownSection(markdown: string, heading: string): string {
  const re = new RegExp(
    `^##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im",
  );
  const match = markdown.match(re);
  if (!match || match.index == null) return "";
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s/m);
  const body = (next >= 0 ? rest.slice(0, next) : rest).trim();
  return body.replace(/^-\s+/gm, "").replace(/\n+/g, " ").trim();
}
