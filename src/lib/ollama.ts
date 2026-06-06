import { OLLAMA_BASE_URL } from "./constants";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ollamaProvider } from "./ai/OllamaProvider";

export type { ChatMessage, ImageChatMessage, AiOptions, StreamDelta } from "./ai/types";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function ollamaTagsReachable(): Promise<boolean> {
  return ollamaProvider.isAvailable();
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

/** @deprecated Użyj getAiProvider().chat — zachowane dla kompatybilności. */
export type OllamaChatOptions = {
  stream?: boolean;
  format?: object | "json";
  temperature?: number;
  num_predict?: number;
  think?: boolean;
};

/** @deprecated */
export type OllamaImageMessage = {
  role: string;
  content: string;
  images?: string[];
};

/** @deprecated */
export type ChatStreamDelta = {
  kind: "content" | "thinking";
  delta: string;
};

function mapLegacyOptions(options?: OllamaChatOptions) {
  if (!options) return undefined;
  return {
    stream: options.stream,
    format: options.format,
    temperature: options.temperature,
    numPredict: options.num_predict,
    think: options.think,
  };
}

/** @deprecated */
export async function ollamaChat(
  model: string,
  messages: { role: string; content: string }[],
  options?: OllamaChatOptions,
): Promise<string> {
  return ollamaProvider.chat(model, messages, mapLegacyOptions(options));
}

/** @deprecated */
export async function ollamaChatWithImages(
  model: string,
  messages: OllamaImageMessage[],
  options?: OllamaChatOptions,
): Promise<string> {
  return ollamaProvider.chatWithImages(model, messages, mapLegacyOptions(options));
}

/** @deprecated */
export async function ollamaChatStream(
  model: string,
  messages: { role: string; content: string }[],
  options: OllamaChatOptions | undefined,
  onDelta: (d: ChatStreamDelta) => void,
): Promise<void> {
  return ollamaProvider.chatStream(model, messages, mapLegacyOptions(options), onDelta);
}

/** @deprecated */
export async function ollamaChatWithImagesStream(
  model: string,
  messages: OllamaImageMessage[],
  options: OllamaChatOptions | undefined,
  onDelta: (d: ChatStreamDelta) => void,
): Promise<void> {
  return ollamaProvider.chatWithImagesStream(
    model,
    messages,
    mapLegacyOptions(options),
    onDelta,
  );
}

/** @deprecated */
export async function ollamaEmbeddings(
  model: string,
  prompt: string,
): Promise<number[]> {
  void model;
  return ollamaProvider.embeddings(prompt);
}
