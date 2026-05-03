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
  /**
   * `false` wyłącza tryb „thinking” u modeli Ollamy (np. Gemma 4) — krótsza odpowiedź przy `format: json`.
   * @see https://docs.ollama.com/capabilities/thinking
   */
  think?: boolean;
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
  if (options?.think !== undefined) body.think = options.think;
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
  if (options?.think !== undefined) body.think = options.think;
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

/** Fragment strumienia chat z Ollamy (`content` = odpowiedź, `thinking` = proces u niektórych modeli). */
export type ChatStreamDelta = {
  kind: "content" | "thinking";
  delta: string;
};

function parseChatStreamPayload(payload: unknown): ChatStreamDelta | null {
  if (payload == null) return null;
  if (typeof payload === "object" && payload !== null && "kind" in payload && "delta" in payload) {
    const k = (payload as { kind: string; delta: string }).kind;
    const d = (payload as { kind: string; delta: string }).delta;
    if ((k === "content" || k === "thinking") && typeof d === "string" && d.length > 0) {
      return { kind: k, delta: d };
    }
  }
  return null;
}

/** Chat ze strumieniowaniem tokenów (jak w podglądzie Ollamy). */
export async function ollamaChatStream(
  model: string,
  messages: { role: string; content: string }[],
  options: OllamaChatOptions | undefined,
  onDelta: (d: ChatStreamDelta) => void,
): Promise<void> {
  if (isTauriRuntime()) {
    const requestId = crypto.randomUUID();
    const eventName = `ollama-chat-stream-${requestId}`;
    const unlisten = await listen<unknown>(eventName, (event) => {
      const d = parseChatStreamPayload(event.payload);
      if (d) onDelta(d);
    });
    try {
      await invoke("ollama_chat_stream_backend", {
        model,
        messages,
        options: options ?? null,
        requestId,
      });
      return;
    } finally {
      unlisten();
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (options?.format !== undefined) body.format = options.format;
  if (options?.think !== undefined) body.think = options.think;
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
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`chat stream: ${r.status} ${t}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = pending.indexOf("\n");
      if (nl === -1) break;
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line) continue;
      try {
        const v = JSON.parse(line) as {
          message?: { content?: string; thinking?: string };
        };
        const msg = v.message;
        if (msg?.content)
          onDelta({ kind: "content", delta: msg.content });
        if (msg?.thinking)
          onDelta({ kind: "thinking", delta: msg.thinking });
      } catch {
        /* jedna linia uszkodzona — pomiń */
      }
    }
  }
  const tail = pending.trim();
  if (tail) {
    try {
      const v = JSON.parse(tail) as {
        message?: { content?: string; thinking?: string };
      };
      if (v.message?.content)
        onDelta({ kind: "content", delta: v.message.content });
      if (v.message?.thinking)
        onDelta({ kind: "thinking", delta: v.message.thinking });
    } catch {
      /* ignore */
    }
  }
}

/** Chat vision ze strumieniowaniem. */
export async function ollamaChatWithImagesStream(
  model: string,
  messages: OllamaImageMessage[],
  options: OllamaChatOptions | undefined,
  onDelta: (d: ChatStreamDelta) => void,
): Promise<void> {
  if (isTauriRuntime()) {
    const requestId = crypto.randomUUID();
    const eventName = `ollama-chat-stream-${requestId}`;
    const unlisten = await listen<unknown>(eventName, (event) => {
      const d = parseChatStreamPayload(event.payload);
      if (d) onDelta(d);
    });
    try {
      await invoke("ollama_chat_with_images_stream_backend", {
        model,
        messages,
        options: options ?? null,
        requestId,
      });
      return;
    } finally {
      unlisten();
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (options?.format !== undefined) body.format = options.format;
  if (options?.think !== undefined) body.think = options.think;
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
  if (!r.ok || !r.body) {
    const t = await r.text();
    throw new Error(`chat vision stream: ${r.status} ${t}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = pending.indexOf("\n");
      if (nl === -1) break;
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line) continue;
      try {
        const v = JSON.parse(line) as {
          message?: { content?: string; thinking?: string };
        };
        const msg = v.message;
        if (msg?.content)
          onDelta({ kind: "content", delta: msg.content });
        if (msg?.thinking)
          onDelta({ kind: "thinking", delta: msg.thinking });
      } catch {
        /* ignore */
      }
    }
  }
  const tail = pending.trim();
  if (tail) {
    try {
      const v = JSON.parse(tail) as {
        message?: { content?: string; thinking?: string };
      };
      if (v.message?.content)
        onDelta({ kind: "content", delta: v.message.content });
      if (v.message?.thinking)
        onDelta({ kind: "thinking", delta: v.message.thinking });
    } catch {
      /* ignore */
    }
  }
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
