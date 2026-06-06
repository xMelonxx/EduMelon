import type { AiProviderId } from "../constants";
import { MODEL_PROFILES, type ModelProfileId } from "../constants";
import { GEMINI_CHAT_MODELS } from "../geminiModels";

export type ModelBadge =
  | "Rekomendowany"
  | "Lokalny"
  | "Limitowany"
  | "Eksperymentalny";

export interface ModelOption {
  id: string;
  name: string;
  provider: AiProviderId;
  description: string;
  badge?: ModelBadge;
  badgeColor?: string;
}

const OLLAMA_MODELS: ModelOption[] = [
  {
    id: "gemma4:e2b",
    name: "Gemma 4 (Lżejszy)",
    provider: "ollama",
    description:
      "Działa w 100% na Twoim komputerze. Wymaga mniej pamięci RAM, dobry dla starszych laptopów.",
    badge: "Lokalny",
    badgeColor: "bg-surface-container-high text-on-surface",
  },
  {
    id: "gemma4:e4b",
    name: "Gemma 4 (Mocniejszy)",
    provider: "ollama",
    description:
      "Lokalny model o wyższej inteligencji. Wymaga mocnej karty graficznej i min. 16 GB RAM.",
    badge: "Lokalny",
    badgeColor: "bg-surface-container-high text-on-surface",
  },
];

const GEMINI_MODEL_OPTIONS: ModelOption[] = GEMINI_CHAT_MODELS.map((m) => ({
  id: m.id,
  name: m.label,
  provider: "gemini" as const,
  description: m.description,
  badge: m.badge,
  badgeColor: m.badgeColor,
}));

export const AVAILABLE_MODELS: ModelOption[] = [
  ...GEMINI_MODEL_OPTIONS,
  ...OLLAMA_MODELS,
];

const MODEL_BY_ID = new Map(AVAILABLE_MODELS.map((m) => [m.id, m] as const));

export function isKnownModelId(id: string): boolean {
  return MODEL_BY_ID.has(id);
}

export function getModelOption(id: string): ModelOption | undefined {
  return MODEL_BY_ID.get(id);
}

export function getModelsForProvider(provider: AiProviderId): ModelOption[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === provider);
}

export function getDefaultModelForProvider(provider: AiProviderId): string {
  const first = getModelsForProvider(provider)[0];
  if (first) return first.id;
  return provider === "gemini" ? "gemini-3.5-flash" : "gemma4:e2b";
}

export function modelProfileIdFromOllamaTag(tag: string): ModelProfileId | null {
  const entry = (
    Object.entries(MODEL_PROFILES) as [ModelProfileId, (typeof MODEL_PROFILES)[ModelProfileId]][]
  ).find(([, v]) => v.ollamaTag === tag);
  return entry?.[0] ?? null;
}

export function ollamaTagFromModelProfileId(id: ModelProfileId): string {
  return MODEL_PROFILES[id].ollamaTag;
}
