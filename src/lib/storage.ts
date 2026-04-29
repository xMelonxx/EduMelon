import type { ModelProfileId } from "./constants";

const KEY_ONBOARDING = "edumelon_onboarding_done";
const KEY_PROFILE = "edumelon_profile";
const KEY_MODEL = "edumelon_model_profile";
const KEY_OLLAMA_MODELS_DIR = "edumelon_ollama_models_dir";
const KEY_INSTALL_ID = "edumelon_install_id";
const KEY_USAGE_STATS_CONSENT = "edumelon_usage_stats_consent";

export type LocalProfile = {
  displayName: string;
  university: string;
  fieldOfStudy: string;
  modelProfile: ModelProfileId;
};

export function isOnboardingDone(): boolean {
  return localStorage.getItem(KEY_ONBOARDING) === "1";
}

export function setOnboardingDone(): void {
  localStorage.setItem(KEY_ONBOARDING, "1");
}

export function saveLocalProfile(p: LocalProfile): void {
  localStorage.setItem(KEY_PROFILE, JSON.stringify(p));
  localStorage.setItem(KEY_MODEL, p.modelProfile);
}

export function loadLocalProfile(): LocalProfile | null {
  const raw = localStorage.getItem(KEY_PROFILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalProfile;
  } catch {
    return null;
  }
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
