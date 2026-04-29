import { EMBEDDING_MODEL } from "./constants";
import { ollamaEmbeddings } from "./ollama";
import type { ChunkRow } from "./db";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export async function embedText(text: string): Promise<number[]> {
  return ollamaEmbeddings(EMBEDDING_MODEL, text.slice(0, 8000));
}

export async function retrieveTopK(
  query: string,
  chunks: ChunkRow[],
  k: number,
): Promise<ChunkRow[]> {
  if (chunks.length === 0) return [];
  const withEmb = chunks.filter((c) => c.embedding);
  if (withEmb.length === 0) {
    return chunks.slice(0, k);
  }
  const qv = await embedText(query);
  const scored = withEmb
    .map((c) => ({
      c,
      s: cosineSimilarity(qv, JSON.parse(c.embedding!) as number[]),
    }))
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.c);
}

/** Proste dzielenie długiego PDF na chunki tekstowe */
export function chunkPlainText(text: string, maxLen = 1200): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (t.length <= maxLen) return [t];
  const parts: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(start + maxLen, t.length);
    if (end < t.length) {
      const cut = t.lastIndexOf("\n\n", end);
      if (cut > start + 200) end = cut;
    }
    parts.push(t.slice(start, end).trim());
    start = end;
  }
  return parts.filter(Boolean);
}
