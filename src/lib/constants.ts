/** Ollama tag names — override via .env (Vite). */
export const OLLAMA_BASE_URL =
  import.meta.env.VITE_OLLAMA_URL ?? "http://127.0.0.1:11434";

/** Profile keys stored in localStorage and in DB */
export type ModelProfileId = "e2b-it" | "e4b-it";

export const MODEL_PROFILES: Record<
  ModelProfileId,
  { label: string; ollamaTag: string; description: string }
> = {
  "e2b-it": {
    label: "Gemma 4 E2B IT (lżejszy)",
    ollamaTag:
      import.meta.env.VITE_OLLAMA_MODEL_E2B_IT ?? "gemma4:e2b",
    description: "Słabsze komputery, mniej RAM.",
  },
  "e4b-it": {
    label: "Gemma 4 E4B IT (mocniejszy)",
    ollamaTag:
      import.meta.env.VITE_OLLAMA_MODEL_E4B_IT ?? "gemma4:e4b",
    description: "Lepsze komputery, wyższa jakość.",
  },
};

/** Embedding model for RAG (pull separately in Ollama). */
export const EMBEDDING_MODEL =
  import.meta.env.VITE_OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
