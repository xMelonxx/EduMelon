import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  GEMINI_EMBEDDING_MODEL,
} from "../constants";
import { getDefaultModelForProvider } from "./models";
import { recordGeminiUsage } from "../geminiUsage";
import type {
  AiOptions,
  AiProvider,
  ChatMessage,
  ImageChatMessage,
  StreamDelta,
} from "./types";
import { mapGeminiInvokeError, isGeminiRateLimitError } from "./geminiErrors";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Cache — unikaj setek invoke Tauri przy każdym odświeżeniu UI. */
let cachedHasKey: boolean | null = null;
let hasKeyCheckPromise: Promise<boolean> | null = null;

export function invalidateGeminiKeyCache(): void {
  cachedHasKey = null;
  hasKeyCheckPromise = null;
}

export async function hasGeminiKey(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  if (cachedHasKey !== null) return cachedHasKey;
  if (hasKeyCheckPromise) return hasKeyCheckPromise;
  hasKeyCheckPromise = invoke<boolean>("has_gemini_key")
    .then((ok) => {
      cachedHasKey = ok;
      return ok;
    })
    .catch(() => {
      cachedHasKey = false;
      return false;
    })
    .finally(() => {
      hasKeyCheckPromise = null;
    });
  return hasKeyCheckPromise;
}

type GeminiUsageMeta = {
  totalTokenCount?: number;
};

type GeminiGenerateResult = {
  content: string;
  usageMetadata?: GeminiUsageMeta;
};

type GeminiEmbedBatchResult = {
  embeddings: number[][];
  usageMetadata?: GeminiUsageMeta;
};

function toGeminiOptions(options?: AiOptions): {
  temperature?: number;
  num_predict?: number;
  format?: object | "json";
} | null {
  if (!options) return null;
  return {
    temperature: options.temperature,
    num_predict: options.numPredict,
    format: options.format,
  };
}

function recordUsage(modelId: string, meta?: GeminiUsageMeta): void {
  recordGeminiUsage({
    modelId,
    tokens: meta?.totalTokenCount ?? 0,
  });
}

const GEMINI_EMBED_BATCH_DELAY_MS = 500;

async function pause(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

export async function saveGeminiKey(key: string): Promise<void> {
  await invoke("save_gemini_key", { key });
  invalidateGeminiKeyCache();
  cachedHasKey = true;
}

export async function deleteGeminiKey(): Promise<void> {
  await invoke("delete_gemini_key");
  invalidateGeminiKeyCache();
}

export async function testGeminiKey(model?: string): Promise<void> {
  await invoke("test_gemini_key", {
    model: model?.trim() || getDefaultModelForProvider("gemini"),
  });
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;

  constructor(private readonly defaultModelId: string = getDefaultModelForProvider("gemini")) {}

  private resolveModel(model?: string): string {
    return model?.trim() || this.defaultModelId;
  }

  async isAvailable(): Promise<boolean> {
    return hasGeminiKey();
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options?: AiOptions,
  ): Promise<string> {
    if (!isTauriRuntime()) {
      throw new Error(
        "Gemini działa tylko w aplikacji desktopowej. Uruchom EduMelon przez Tauri.",
      );
    }
    try {
      const result = await invoke<GeminiGenerateResult>("gemini_generate_content", {
        model: this.resolveModel(model),
        messages,
        options: toGeminiOptions(options),
      });
      recordUsage(this.resolveModel(model), result.usageMetadata);
      return result.content;
    } catch (e) {
      throw mapGeminiInvokeError(e);
    }
  }

  async chatWithImages(
    model: string,
    messages: ImageChatMessage[],
    options?: AiOptions,
  ): Promise<string> {
    if (!isTauriRuntime()) {
      throw new Error(
        "Gemini działa tylko w aplikacji desktopowej. Uruchom EduMelon przez Tauri.",
      );
    }
    try {
      const mapped = messages.map((m) => ({
        role: m.role,
        content: m.content,
        images: m.images,
        image_mime_types: m.images?.map(() => "image/jpeg"),
      }));
      const result = await invoke<GeminiGenerateResult>(
        "gemini_generate_content_with_images",
        {
          model: this.resolveModel(model),
          messages: mapped,
          options: toGeminiOptions(options),
        },
      );
      recordUsage(this.resolveModel(model), result.usageMetadata);
      return result.content;
    } catch (e) {
      throw mapGeminiInvokeError(e);
    }
  }

  /** Cały plik PDF — model widzi tekst, wykresy, tabele i schematy. */
  async chatWithPdf(
    model: string,
    system: string,
    user: string,
    pdfPath: string,
    options?: AiOptions,
  ): Promise<string> {
    if (!isTauriRuntime()) {
      throw new Error(
        "Gemini działa tylko w aplikacji desktopowej. Uruchom EduMelon przez Tauri.",
      );
    }
    try {
      const result = await invoke<GeminiGenerateResult>(
        "gemini_generate_content_with_pdf",
        {
          model: this.resolveModel(model),
          system,
          user,
          pdfPath,
          options: toGeminiOptions(options),
        },
      );
      recordUsage(this.resolveModel(model), result.usageMetadata);
      return result.content;
    } catch (e) {
      throw mapGeminiInvokeError(e);
    }
  }

  async chatStream(
    model: string,
    messages: ChatMessage[],
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void> {
    await this.runStream(model, messages, null, options, onDelta);
  }

  async chatWithImagesStream(
    model: string,
    messages: ImageChatMessage[],
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void> {
    await this.runStream(
      model,
      [],
      messages,
      options,
      onDelta,
    );
  }

  private async runStream(
    model: string,
    messages: ChatMessage[],
    imageMessages: ImageChatMessage[] | null,
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void> {
    if (!isTauriRuntime()) {
      throw new Error(
        "Gemini działa tylko w aplikacji desktopowej. Uruchom EduMelon przez Tauri.",
      );
    }
    const requestId = crypto.randomUUID();
    const deltaEvent = `gemini-stream-${requestId}`;
    const doneEvent = `gemini-stream-done-${requestId}`;

    let usageMeta: GeminiUsageMeta | undefined;

    const unlistenDelta = await listen<{ kind: string; delta: string }>(
      deltaEvent,
      (event) => {
        const p = event.payload;
        if (p?.kind === "content" && p.delta) {
          onDelta({ kind: "content", delta: p.delta });
        }
      },
    );
    const unlistenDone = await listen<{ usageMetadata?: GeminiUsageMeta }>(
      doneEvent,
      (event) => {
        usageMeta = event.payload?.usageMetadata;
      },
    );

    try {
      const mappedImages = imageMessages?.map((m) => ({
        role: m.role,
        content: m.content,
        images: m.images,
        image_mime_types: m.images?.map(() => "image/jpeg"),
      }));
      await invoke("gemini_stream_generate_content", {
        model: this.resolveModel(model),
        messages,
        options: toGeminiOptions(options),
        requestId,
        withImages: Boolean(imageMessages?.length),
        imageMessages: mappedImages ?? null,
      });
      recordUsage(this.resolveModel(model), usageMeta);
    } catch (e) {
      throw mapGeminiInvokeError(e);
    } finally {
      unlistenDelta();
      unlistenDone();
    }
  }

  async embeddings(text: string): Promise<number[]> {
    const [vec] = await this.embeddingsBatch([text]);
    return vec!;
  }

  /** Batch API — jedno żądanie HTTP na wiele fragmentów (import plików). */
  async embeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!isTauriRuntime()) {
      throw new Error(
        "Gemini działa tylko w aplikacji desktopowej. Uruchom EduMelon przez Tauri.",
      );
    }

    const BATCH = 32;
    const out: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000));
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const result = await invoke<GeminiEmbedBatchResult>(
            "gemini_batch_embed_content",
            {
              model: GEMINI_EMBEDDING_MODEL,
              texts: slice,
            },
          );
          recordUsage(GEMINI_EMBEDDING_MODEL, result.usageMetadata);
          if (!result.embeddings?.length) {
            throw new Error("Brak wektorów embedding");
          }
          out.push(...result.embeddings);
          lastError = null;
          break;
        } catch (e) {
          lastError = mapGeminiInvokeError(e);
          if (isGeminiRateLimitError(lastError) && attempt < 3) {
            await pause(65_000);
            continue;
          }
          throw lastError;
        }
      }

      if (lastError) throw lastError;

      if (i + BATCH < texts.length) {
        await pause(GEMINI_EMBED_BATCH_DELAY_MS);
      }
    }

    return out;
  }
}

export const geminiProvider = new GeminiProvider();
