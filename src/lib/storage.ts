import type { AiProviderId, ModelProfileId } from "./constants";
import {
  getDefaultModelForProvider,
  isKnownModelId,
  modelProfileIdFromOllamaTag,
  ollamaTagFromModelProfileId,
} from "./ai/models";
import {
  isGeminiChatModelId,
  migrateGeminiModelId,
  type GeminiChatModelId,
} from "./geminiModels";

const KEY_ONBOARDING = "edumelon_onboarding_done";
const KEY_PROFILE = "edumelon_profile";
const KEY_MODEL = "edumelon_model_profile";
const KEY_OLLAMA_MODELS_DIR = "edumelon_ollama_models_dir";
const KEY_INSTALL_ID = "edumelon_install_id";
const KEY_USAGE_STATS_CONSENT = "edumelon_usage_stats_consent";
const KEY_LOW_SPEC_TEST_MODE = "edumelon_low_spec_test_mode";
const KEY_TUTORIAL_SEEN = "edumelon_tutorial_seen";
const KEY_TUTORIAL_ACTIVE = "edumelon_tutorial_active";

export type LocalProfile = {
  displayName: string;
  university: string;
  fieldOfStudy: string;
  modelProfile: ModelProfileId;
  aiProvider?: AiProviderId;
  /** Wybrany model API (np. gemini-2.5-flash, gemma4:e2b). */
  aiModel?: string;
  /** @deprecated Użyj aiModel — zachowane dla migracji. */
  geminiChatModel?: GeminiChatModelId;
};

function normalizeLocalProfile(p: LocalProfile): LocalProfile {
  const aiProvider = p.aiProvider ?? "ollama";

  let aiModel = p.aiModel;
  if (!aiModel) {
    if (aiProvider === "gemini" && p.geminiChatModel) {
      aiModel = p.geminiChatModel;
    } else {
      aiModel = ollamaTagFromModelProfileId(p.modelProfile ?? "e2b-it");
    }
  }

  if (!isKnownModelId(aiModel)) {
    if (aiProvider === "gemini") {
      aiModel = migrateGeminiModelId(aiModel);
    } else {
      aiModel = getDefaultModelForProvider(aiProvider);
    }
  }

  let modelProfile = p.modelProfile ?? "e2b-it";
  const fromTag = modelProfileIdFromOllamaTag(aiModel);
  if (fromTag) modelProfile = fromTag;

  const next: LocalProfile = {
    ...p,
    aiProvider,
    aiModel,
    modelProfile,
  };

  if (aiProvider === "gemini" && isGeminiChatModelId(aiModel)) {
    next.geminiChatModel = aiModel;
  }

  return next;
}

export function isOnboardingDone(): boolean {
  return localStorage.getItem(KEY_ONBOARDING) === "1";
}

export function setOnboardingDone(): void {
  localStorage.setItem(KEY_ONBOARDING, "1");
}

export function saveLocalProfile(p: LocalProfile): void {
  const normalized = normalizeLocalProfile(p);
  localStorage.setItem(KEY_PROFILE, JSON.stringify(normalized));
  localStorage.setItem(KEY_MODEL, normalized.modelProfile);
}

export function loadLocalProfile(): LocalProfile | null {
  const raw = localStorage.getItem(KEY_PROFILE);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as LocalProfile;
    return normalizeLocalProfile(p);
  } catch {
    return null;
  }
}

export function getAiModelId(): string {
  const p = loadLocalProfile();
  if (p?.aiModel) return p.aiModel;
  return getDefaultModelForProvider(p?.aiProvider ?? getDefaultAiProviderForNewUser());
}

export function getAiProviderId(): AiProviderId {
  return loadLocalProfile()?.aiProvider ?? "ollama";
}

export function getDefaultAiProviderForNewUser(): AiProviderId {
  return "gemini";
}

export function getStoredModelProfile(): ModelProfileId | null {
  const m = localStorage.getItem(KEY_MODEL) as ModelProfileId | null;
  if (m === "e2b-it" || m === "e4b-it") return m;
  return null;
}

/** Katalog na modele Ollama — użytkownik ustawia też zmienną OLLAMA_MODELS (patrz README). */
export function getOllamaModelsDir(): string | null {
  return localStorage.getItem(KEY_OLLAMA_MODELS_DIR);
}

export function setOllamaModelsDir(path: string | null): void {
  if (path == null || path === "") {
    localStorage.removeItem(KEY_OLLAMA_MODELS_DIR);
  } else {
    localStorage.setItem(KEY_OLLAMA_MODELS_DIR, path);
  }
}

/** Stały anonimowy identyfikator instalacji do prostych statystyk usage. */
export function getOrCreateInstallId(): string {
  const existing = localStorage.getItem(KEY_INSTALL_ID);
  if (existing && existing.trim().length > 0) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY_INSTALL_ID, id);
  return id;
}

export function getUsageStatsConsent(): boolean {
  return localStorage.getItem(KEY_USAGE_STATS_CONSENT) === "1";
}

export function setUsageStatsConsent(enabled: boolean): void {
  if (enabled) localStorage.setItem(KEY_USAGE_STATS_CONSENT, "1");
  else localStorage.removeItem(KEY_USAGE_STATS_CONSENT);
}

export function getLowSpecTestModeEnabled(): boolean {
  return localStorage.getItem(KEY_LOW_SPEC_TEST_MODE) === "1";
}

export function setLowSpecTestModeEnabled(enabled: boolean): void {
  if (enabled) localStorage.setItem(KEY_LOW_SPEC_TEST_MODE, "1");
  else localStorage.removeItem(KEY_LOW_SPEC_TEST_MODE);
}

export function getTutorialSeen(): boolean {
  return localStorage.getItem(KEY_TUTORIAL_SEEN) === "1";
}

export function setTutorialSeen(seen: boolean): void {
  if (seen) localStorage.setItem(KEY_TUTORIAL_SEEN, "1");
  else localStorage.removeItem(KEY_TUTORIAL_SEEN);
}

export function resetTutorialSeen(): void {
  localStorage.removeItem(KEY_TUTORIAL_SEEN);
}

export function isTutorialActive(): boolean {
  return localStorage.getItem(KEY_TUTORIAL_ACTIVE) === "1";
}

export function setTutorialActive(active: boolean): void {
  if (active) localStorage.setItem(KEY_TUTORIAL_ACTIVE, "1");
  else localStorage.removeItem(KEY_TUTORIAL_ACTIVE);
  window.dispatchEvent(new Event("edumelon:tutorial-active-changed"));
}
