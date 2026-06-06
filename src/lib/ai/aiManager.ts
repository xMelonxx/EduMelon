import {
  MODEL_PROFILES,
  type ModelProfileId,
} from "../constants";
import {
  getAiModelId,
  getAiProviderId,
  loadLocalProfile,
  type LocalProfile,
} from "../storage";
import { getDefaultModelForProvider } from "./models";
import type { AiProvider, AiProviderId } from "./types";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";

export function getAiProvider(): AiProvider {
  const profile = loadLocalProfile();
  const providerId = profile?.aiProvider ?? getAiProviderId();
  const modelId = profile?.aiModel ?? getAiModelId();

  if (providerId === "gemini") {
    return new GeminiProvider(modelId);
  }
  return new OllamaProvider(modelId);
}

export function getAiProviderById(id: AiProviderId): AiProvider {
  const modelId = getDefaultModelForProvider(id);
  return id === "gemini" ? new GeminiProvider(modelId) : new OllamaProvider(modelId);
}

export function getGeminiProvider(): GeminiProvider {
  const p = getAiProvider();
  if (p instanceof GeminiProvider) return p;
  return new GeminiProvider(getDefaultModelForProvider("gemini"));
}

export function getActiveModelId(profile?: LocalProfile | null): string {
  const p = profile ?? loadLocalProfile();
  if (p?.aiModel) return p.aiModel;
  if ((p?.aiProvider ?? getAiProviderId()) === "gemini") {
    return getDefaultModelForProvider("gemini");
  }
  const mp: ModelProfileId = p?.modelProfile ?? "e2b-it";
  return MODEL_PROFILES[mp].ollamaTag;
}

export function isOllamaRequired(): boolean {
  return getAiProviderId() === "ollama";
}

export async function isActiveAiAvailable(): Promise<boolean> {
  return getAiProvider().isAvailable();
}

export function geminiBatchDelayMs(): number {
  return getAiProviderId() === "gemini" ? 500 : 0;
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

export { GeminiProvider, OllamaProvider };
