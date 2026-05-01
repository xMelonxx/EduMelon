import { OLLAMA_BASE_URL } from "./constants";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function ollamaTagsReachable(): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      const ok = await invoke<boolean>("ollama_health");
      if (ok) return true;
    } catch {
      // Fall through to HTTP check as backup.
    }
  }

  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function ollamaListModels(): Promise<string[]> {
  if (isTauriRuntime()) {
    try {
      return await invoke<string[]>("ollama_list_models");
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : `Nie można odczytać listy modeli przez backend Tauri: ${String(e)}`,
      );
    }
  }

  const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!r.ok) throw new Error("Nie można odczytać listy modeli Ollama");
  const data = (await r.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

export async function ollamaPull(
  model: string,
  onLine?: (line: string) => void,
): Promise<void> {
  if (isTauriRuntime()) {
    const requestId = crypto.randomUUID();
    const eventName = `ollama-pull-progress-${requestId}`;
    const unlisten = await listen<string>(eventName, (event) => {
      if (typeof event.payload === "string" && onLine) onLine(event.payload);
    });
    try {
      await invoke<string>("ollama_pull_model_stream", {
        model,
        requestId,
      });
      return;
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : `Nie udało się pobrać modelu przez backend Tauri: ${String(e)}`,
      );
    } finally {
      unlisten();
    }
  }

  const r = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });
  if (!r.ok || !r.body) {
    throw new Error(`pull failed: ${r.status}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (line.trim() && onLine) onLine(line.trim());
    }
  }
}

export type OllamaChatOptions = {
  stream?: boolean;
  /** JSON Schema (structured) albo `"json"` — wymusza poprawny JSON w Ollamie. */
  format?: object | "json";
  temperature?: number;
  /** Max tokenów odpowiedzi (np. długa tablica fiszek). */
  num_predict?: number;
};

export type OllamaImageMessage = {
  role: string;
  content: string;
  /** Base64 PNG/JPEG (bez prefixu data URL). */
  images?: string[];
};

export async function ollamaChat(
  model: string,
  messages: { role: string; content: string }[],
  options?: OllamaChatOptions,
): Promise<string> {
  if (isTauriRuntime()) {
    try {
      return await invoke<string>("ollama_chat_backend", {
        model,
        messages,
        options: options ?? null,
      });
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : `Nie udało się wykonać chat przez backend Tauri: ${String(e)}`,
      );
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: options?.stream ?? false,
  };
  if (options?.format !== undefined) body.format = options.format;
  const ollamaOpts: Record<string, unknown> = {};
  if (options?.temperature !== undefined)
    ollamaOpts.temperature = options.temperature;
  if (options?.num_predict !== undefined)
    ollamaOpts.num_predict = options.num_predict;
  if (Object.keys(ollamaOpts).length > 0) body.options = ollamaOpts;
  const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`chat: ${r.status} ${t}`);
  }
  const data = (await r.json()) as {
    message?: { content?: string };
  };
  return data.message?.content ?? "";
}

/** Chat z obrazami (vision) — do OCR/odczytu slajdów będących obrazem. */
export async function ollamaChatWithImages(
  model: string,
  messages: OllamaImageMessage[],
  options?: OllamaChatOptions,
): Promise<string> {
  if (isTauriRuntime()) {
    try {
      return await invoke<string>("ollama_chat_with_images_backend", {
        model,
        messages,
        options: options ?? null,
      });
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : `Nie udało się wykonać chat(vision) przez backend Tauri: ${String(e)}`,
      );
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: options?.stream ?? false,
  };
  if (options?.format !== undefined) body.format = options.format;
  const ollamaOpts: Record<string, unknown> = {};
  if (options?.temperature !== undefined) {
    ollamaOpts.temperature = options.temperature;
  }
  if (options?.num_predict !== undefined) {
    ollamaOpts.num_predict = options.num_predict;
  }
  if (Object.keys(ollamaOpts).length > 0) body.options = ollamaOpts;
  const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`chat(vision): ${r.status} ${t}`);
  }
  const data = (await r.json()) as {
    message?: { content?: string };
  };
  return data.message?.content ?? "";
}

export async function ollamaEmbeddings(
  model: string,
  prompt: string,
): Promise<number[]> {
  if (isTauriRuntime()) {
    try {
      const embedding = await invoke<number[]>("ollama_embeddings", {
        model,
        prompt,
      });
      if (!embedding.length) throw new Error("Brak wektora embedding");
      return embedding;
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : `Nie udało się pobrać embeddingów przez backend Tauri: ${String(e)}`,
      );
    }
  }

  const r = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`embeddings: ${r.status} ${t}`);
  }
  const data = (await r.json()) as { embedding?: number[] };
  if (!data.embedding?.length) throw new Error("Brak wektora embedding");
  return data.embedding;
}
