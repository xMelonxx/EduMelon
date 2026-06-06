import type { ChunkRow } from "./db";
import { getGeminiChatModelId, getGeminiChatModelInfo } from "./geminiModels";

export function filterChunksByPageRange(
  chunks: ChunkRow[],
  range: { start: number; end: number } | undefined,
): ChunkRow[] {
  if (!range) return chunks;
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  return chunks.filter((c) => {
    const p = c.slide_index ?? 1;
    return p >= lo && p <= hi;
  });
}

/** Maks. znaków całego materiału — wg okna kontekstu modelu Gemini. */
export function getFullMaterialCharBudget(): number {
  const info = getGeminiChatModelInfo(getGeminiChatModelId());
  if (info?.limits.contextMax) {
    return Math.min(950_000, Math.floor(info.limits.contextMax * 3.2));
  }
  return 950_000;
}

/** Cały tekst wykładu/PDF (chunki po kolei), bez próbkowania. */
export function buildFullTestMaterialContext(
  chunks: ChunkRow[],
  range?: { start: number; end: number },
): { context: string; chunkCount: number; charCount: number; truncated: boolean } {
  const scoped = filterChunksByPageRange(chunks, range);
  const sorted = [...scoped].sort(
    (a, b) => (a.slide_index ?? 0) - (b.slide_index ?? 0),
  );
  const budget = getFullMaterialCharBudget();
  const parts: string[] = [];
  let total = 0;
  let truncated = false;

  for (const c of sorted) {
    const body = c.body.trim();
    if (!body) continue;
    if (total + body.length + 2 > budget) {
      const room = budget - total;
      if (room > 400) {
        parts.push(`${body.slice(0, room)}\n[… dalsza treść obcięta — limit kontekstu modelu …]`);
        truncated = true;
      }
      break;
    }
    parts.push(body);
    total += body.length + 2;
  }

  return {
    context: parts.join("\n\n"),
    chunkCount: parts.length,
    charCount: total,
    truncated,
  };
}

export function geminiTestNumPredict(questionCount: number): number {
  return Math.min(32_768, Math.max(8192, questionCount * 650 + 3072));
}
