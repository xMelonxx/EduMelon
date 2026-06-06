import { OLLAMA_BASE_URL, EMBEDDING_MODEL } from "../constants";
import { getDefaultModelForProvider } from "./models";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AiOptions,
  AiProvider,
  ChatMessage,
  ImageChatMessage,
  StreamDelta,
} from "./types";
import { aiOptionsToOllama } from "./types";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseChatStreamPayload(payload: unknown): StreamDelta | null {
  if (payload == null) return null;
  if (
    typeof payload === "object" &&
    payload !== null &&
    "kind" in payload &&
    "delta" in payload
  ) {
    const k = (payload as { kind: string; delta: string }).kind;
    const d = (payload as { kind: string; delta: string }).delta;
    if (
      (k === "content" || k === "thinking") &&
      typeof d === "string" &&
      d.length > 0
    ) {
      return { kind: k, delta: d };
    }
  }
  return null;
}

export class OllamaProvider implements AiProvider {
  readonly id = "ollama" as const;

  constructor(
    private readonly defaultModelId: string = getDefaultModelForProvider("ollama"),
  ) {}

  private resolveModel(model: string): string {
    return model.trim() || this.defaultModelId;
  }

  async isAvailable(): Promise<boolean> {
    if (isTauriRuntime()) {
      try {
        const ok = await invoke<boolean>("ollama_health");
        if (ok) return true;
      } catch {
        // fall through
      }
    }
    try {
      const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: "GET" });
      return r.ok;
    } catch {
      return false;
    }
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options?: AiOptions,
  ): Promise<string> {
    const resolvedModel = this.resolveModel(model);
    const ollamaOpts = aiOptionsToOllama(options);
    if (isTauriRuntime()) {
      try {
        return await invoke<string>("ollama_chat_backend", {
          model: resolvedModel,
          messages,
          options: ollamaOpts ?? null,
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
      model: resolvedModel,
      messages,
      stream: ollamaOpts?.stream ?? false,
    };
    if (ollamaOpts?.format !== undefined) body.format = ollamaOpts.format;
    if (ollamaOpts?.think !== undefined) body.think = ollamaOpts.think;
    const ollamaInner: Record<string, unknown> = {};
    if (ollamaOpts?.temperature !== undefined)
      ollamaInner.temperature = ollamaOpts.temperature;
    if (ollamaOpts?.num_predict !== undefined)
      ollamaInner.num_predict = ollamaOpts.num_predict;
    if (Object.keys(ollamaInner).length > 0) body.options = ollamaInner;

    const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`chat: ${r.status} ${t}`);
    }
    const data = (await r.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  async chatWithImages(
    model: string,
    messages: ImageChatMessage[],
    options?: AiOptions,
  ): Promise<string> {
    const resolvedModel = this.resolveModel(model);
    const ollamaOpts = aiOptionsToOllama(options);
    if (isTauriRuntime()) {
      try {
        return await invoke<string>("ollama_chat_with_images_backend", {
          model: resolvedModel,
          messages,
          options: ollamaOpts ?? null,
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
      model: resolvedModel,
      messages,
      stream: ollamaOpts?.stream ?? false,
    };
    if (ollamaOpts?.format !== undefined) body.format = ollamaOpts.format;
    if (ollamaOpts?.think !== undefined) body.think = ollamaOpts.think;
    const ollamaInner: Record<string, unknown> = {};
    if (ollamaOpts?.temperature !== undefined)
      ollamaInner.temperature = ollamaOpts.temperature;
    if (ollamaOpts?.num_predict !== undefined)
      ollamaInner.num_predict = ollamaOpts.num_predict;
    if (Object.keys(ollamaInner).length > 0) body.options = ollamaInner;

    const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`chat(vision): ${r.status} ${t}`);
    }
    const data = (await r.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  async chatStream(
    model: string,
    messages: ChatMessage[],
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void> {
    const resolvedModel = this.resolveModel(model);
    const ollamaOpts = aiOptionsToOllama(options);
    if (isTauriRuntime()) {
      const requestId = crypto.randomUUID();
      const eventName = `ollama-chat-stream-${requestId}`;
      const unlisten = await listen<unknown>(eventName, (event) => {
        const d = parseChatStreamPayload(event.payload);
        if (d) onDelta(d);
      });
      try {
        await invoke("ollama_chat_stream_backend", {
          model: resolvedModel,
          messages,
          options: ollamaOpts ?? null,
          requestId,
        });
        return;
      } finally {
        unlisten();
      }
    }

    const body: Record<string, unknown> = {
      model: resolvedModel,
      messages,
      stream: true,
    };
    if (ollamaOpts?.format !== undefined) body.format = ollamaOpts.format;
    if (ollamaOpts?.think !== undefined) body.think = ollamaOpts.think;
    const ollamaInner: Record<string, unknown> = {};
    if (ollamaOpts?.temperature !== undefined)
      ollamaInner.temperature = ollamaOpts.temperature;
    if (ollamaOpts?.num_predict !== undefined)
      ollamaInner.num_predict = ollamaOpts.num_predict;
    if (Object.keys(ollamaInner).length > 0) body.options = ollamaInner;

    const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok || !r.body) {
      const t = await r.text();
      throw new Error(`chat stream: ${r.status} ${t}`);
    }
    await consumeOllamaStream(r.body, onDelta);
  }

  async chatWithImagesStream(
    model: string,
    messages: ImageChatMessage[],
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void> {
    const resolvedModel = this.resolveModel(model);
    const ollamaOpts = aiOptionsToOllama(options);
    if (isTauriRuntime()) {
      const requestId = crypto.randomUUID();
      const eventName = `ollama-chat-stream-${requestId}`;
      const unlisten = await listen<unknown>(eventName, (event) => {
        const d = parseChatStreamPayload(event.payload);
        if (d) onDelta(d);
      });
      try {
        await invoke("ollama_chat_with_images_stream_backend", {
          model: resolvedModel,
          messages,
          options: ollamaOpts ?? null,
          requestId,
        });
        return;
      } finally {
        unlisten();
      }
    }

    const body: Record<string, unknown> = {
      model: resolvedModel,
      messages,
      stream: true,
    };
    if (ollamaOpts?.format !== undefined) body.format = ollamaOpts.format;
    if (ollamaOpts?.think !== undefined) body.think = ollamaOpts.think;
    const ollamaInner: Record<string, unknown> = {};
    if (ollamaOpts?.temperature !== undefined)
      ollamaInner.temperature = ollamaOpts.temperature;
    if (ollamaOpts?.num_predict !== undefined)
      ollamaInner.num_predict = ollamaOpts.num_predict;
    if (Object.keys(ollamaInner).length > 0) body.options = ollamaInner;

    const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok || !r.body) {
      const t = await r.text();
      throw new Error(`chat vision stream: ${r.status} ${t}`);
    }
    await consumeOllamaStream(r.body, onDelta);
  }

  async embeddings(text: string): Promise<number[]> {
    const prompt = text.slice(0, 8000);
    if (isTauriRuntime()) {
      try {
        const embedding = await invoke<number[]>("ollama_embeddings", {
          model: EMBEDDING_MODEL,
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
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`embeddings: ${r.status} ${t}`);
    }
    const data = (await r.json()) as { embedding?: number[] };
    if (!data.embedding?.length) throw new Error("Brak wektora embedding");
    return data.embedding;
  }
}

async function consumeOllamaStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (d: StreamDelta) => void,
): Promise<void> {
  const reader = body.getReader();
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
        if (msg?.content) onDelta({ kind: "content", delta: msg.content });
        if (msg?.thinking) onDelta({ kind: "thinking", delta: msg.thinking });
      } catch {
        /* skip */
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

export const ollamaProvider = new OllamaProvider();
