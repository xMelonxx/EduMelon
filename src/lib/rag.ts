import { getAiProvider, getGeminiProvider } from "./ai/aiManager";
import { getAiProviderId } from "./storage";
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
  return getAiProvider().embeddings(text);
}

/** Wiele embeddingów — batch dla Gemini, sekwencyjnie dla Ollama. */
export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (getAiProviderId() === "gemini") {
    const vecs = await getGeminiProvider().embeddingsBatch(texts);
    onProgress?.(texts.length, texts.length);
    return vecs;
  }

  const out: number[][] = [];
  const total = texts.length;
  for (let i = 0; i < texts.length; i++) {
    out.push(await embedText(texts[i]!));
    onProgress?.(i + 1, total);
  }
  return out;
}

export type RetrieveTopKResult = {
  chunks: ChunkRow[];
  providerMismatch: boolean;
};

function chunkEmbeddingProvider(c: ChunkRow): string {
  return c.embedding_provider ?? "ollama";
}

export async function retrieveTopK(
  query: string,
  chunks: ChunkRow[],
  k: number,
): Promise<ChunkRow[]> {
  const result = await retrieveTopKDetailed(query, chunks, k);
  return result.chunks;
}

export async function retrieveTopKDetailed(
  query: string,
  chunks: ChunkRow[],
  k: number,
): Promise<RetrieveTopKResult> {
  if (chunks.length === 0) return { chunks: [], providerMismatch: false };

  const activeProvider = getAiProviderId();
  const withEmb = chunks.filter(
    (c) => c.embedding && chunkEmbeddingProvider(c) === activeProvider,
  );

  if (withEmb.length === 0) {
    const anyEmb = chunks.filter((c) => c.embedding);
    if (anyEmb.length > 0) {
      return { chunks: [], providerMismatch: true };
    }
    return { chunks: chunks.slice(0, k), providerMismatch: false };
  }

  const qv = await embedText(query);
  const scored = withEmb
    .map((c) => ({
      c,
      s: cosineSimilarity(qv, JSON.parse(c.embedding!) as number[]),
    }))
    .sort((a, b) => b.s - a.s);
  return {
    chunks: scored.slice(0, k).map((x) => x.c),
    providerMismatch: false,
  };
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
