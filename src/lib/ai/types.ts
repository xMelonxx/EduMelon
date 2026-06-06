export type AiProviderId = "ollama" | "gemini";

export type ChatMessage = {
  role: string;
  content: string;
};

export type ImageChatMessage = {
  role: string;
  content: string;
  /** Base64 PNG/JPEG (bez prefixu data URL). */
  images?: string[];
};

export type AiOptions = {
  stream?: boolean;
  format?: object | "json";
  temperature?: number;
  numPredict?: number;
  think?: boolean;
};

export type StreamDelta = {
  kind: "content" | "thinking";
  delta: string;
};

export type GeminiUsageMetadata = {
  totalTokenCount?: number;
};

export interface AiProvider {
  readonly id: AiProviderId;
  isAvailable(): Promise<boolean>;
  chat(
    model: string,
    messages: ChatMessage[],
    options?: AiOptions,
  ): Promise<string>;
  chatStream(
    model: string,
    messages: ChatMessage[],
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void>;
  chatWithImages(
    model: string,
    messages: ImageChatMessage[],
    options?: AiOptions,
  ): Promise<string>;
  chatWithImagesStream(
    model: string,
    messages: ImageChatMessage[],
    options: AiOptions | undefined,
    onDelta: (d: StreamDelta) => void,
  ): Promise<void>;
  embeddings(text: string): Promise<number[]>;
}

/** Map AiOptions → Ollama payload shape. */
export function aiOptionsToOllama(options?: AiOptions): {
  stream?: boolean;
  format?: object | "json";
  temperature?: number;
  num_predict?: number;
  think?: boolean;
} | undefined {
  if (!options) return undefined;
  return {
    stream: options.stream,
    format: options.format,
    temperature: options.temperature,
    num_predict: options.numPredict,
    think: options.think,
  };
}
