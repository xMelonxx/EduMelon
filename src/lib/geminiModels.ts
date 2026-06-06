import { loadLocalProfile } from "./storage";

export type GeminiModelBadge =
  | "Rekomendowany"
  | "Limitowany"
  | "Eksperymentalny";

/** Chat modele dostępne w Google AI Studio (limity orientacyjne — free tier). */
export type GeminiChatModelId =
  | "gemini-3.5-flash"
  | "gemini-3.1-flash-lite"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-3-flash-preview"
  | "gemini-2.5-pro"
  | "gemini-3.1-pro-preview";

export type GeminiModelLimits = {
  /** Żądań na minutę (orientacyjnie) */
  rpm: number;
  /** Tokenów na minutę */
  tpm: number | null;
  /** Żądań na dzień (orientacyjnie) */
  rpd: number;
  /** Maks. tokenów kontekstu */
  contextMax: number;
};

export type GeminiChatModelInfo = {
  id: GeminiChatModelId;
  label: string;
  description: string;
  badge?: GeminiModelBadge;
  badgeColor?: string;
  limits: GeminiModelLimits;
};

export const DEFAULT_GEMINI_CHAT_MODEL: GeminiChatModelId = "gemini-3.5-flash";

/** Stare ID → aktualny model (migracja profilu). */
export const LEGACY_GEMINI_MODEL_MIGRATION: Record<string, GeminiChatModelId> = {
  "gemini-2.0-flash": "gemini-3.5-flash",
  "gemini-2.0-flash-thinking-exp": "gemini-3-flash-preview",
  "gemini-2.0-pro-exp": "gemini-2.5-pro",
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-1.5-pro": "gemini-2.5-pro",
};

/**
 * Limity free tier — orientacyjne; dokładne wartości zależą od projektu w AI Studio.
 * Źródło: ai.google.dev/gemini-api/docs/rate-limits
 */
export const GEMINI_CHAT_MODELS: GeminiChatModelInfo[] = [
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description:
      "Najnowszy, szybki model na co dzień — fiszki, testy, czat i długie PDF-y.",
    badge: "Rekomendowany",
    badgeColor: "bg-secondary-container text-on-secondary-container",
    limits: { rpm: 15, tpm: 1_000_000, rpd: 1500, contextMax: 1_000_000 },
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    description:
      "Najszybszy i najlżejszy — idealny przy dużej liczbie krótkich zadań.",
    limits: { rpm: 15, tpm: 1_000_000, rpd: 1500, contextMax: 1_000_000 },
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Sprawdzony stabilny model — dobry wybór, gdy nowszy jest niedostępny.",
    limits: { rpm: 15, tpm: 1_000_000, rpd: 1500, contextMax: 1_000_000 },
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    description: "Lekki i szybki — proste fiszki, krótkie streszczenia.",
    limits: { rpm: 30, tpm: 1_000_000, rpd: 1500, contextMax: 1_000_000 },
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash (Preview)",
    description:
      "Mocniejszy flash w wersji testowej — trudniejsze zadania, limity mogą być niższe.",
    badge: "Eksperymentalny",
    badgeColor: "bg-surface-container-highest text-on-surface",
    limits: { rpm: 10, tpm: 1_000_000, rpd: 1500, contextMax: 1_000_000 },
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description:
      "Wyższa jakość rozumowania, ale bardzo mały dzienny limit — tylko kluczowe zadania.",
    badge: "Limitowany",
    badgeColor: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    limits: { rpm: 5, tpm: 250_000, rpd: 100, contextMax: 1_000_000 },
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    description:
      "Najmocniejszy logicznie w wersji testowej — ok. 50 zapytań dziennie na darmowym planie.",
    badge: "Limitowany",
    badgeColor: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    limits: { rpm: 2, tpm: 32_000, rpd: 50, contextMax: 2_000_000 },
  },
];

const MODEL_BY_ID = new Map(
  GEMINI_CHAT_MODELS.map((m) => [m.id, m] as const),
);

export function isGeminiChatModelId(id: string): id is GeminiChatModelId {
  return MODEL_BY_ID.has(id as GeminiChatModelId);
}

export function migrateGeminiModelId(id: string): GeminiChatModelId {
  if (isGeminiChatModelId(id)) return id;
  return LEGACY_GEMINI_MODEL_MIGRATION[id] ?? DEFAULT_GEMINI_CHAT_MODEL;
}

export function getGeminiChatModelInfo(
  id: string,
): GeminiChatModelInfo | undefined {
  return MODEL_BY_ID.get(id as GeminiChatModelId);
}

export function getGeminiChatModelId(): GeminiChatModelId {
  const profile = loadLocalProfile();
  const fromAiModel = profile?.aiModel;
  if (fromAiModel) return migrateGeminiModelId(fromAiModel);
  const fromLegacy = profile?.geminiChatModel;
  if (fromLegacy) return migrateGeminiModelId(fromLegacy);
  const fromEnv = import.meta.env.VITE_GEMINI_CHAT_MODEL;
  if (fromEnv) return migrateGeminiModelId(fromEnv);
  return DEFAULT_GEMINI_CHAT_MODEL;
}

export function getGeminiDailyRequestLimit(modelId?: string): number {
  const id = modelId ? migrateGeminiModelId(modelId) : getGeminiChatModelId();
  return getGeminiChatModelInfo(id)?.limits.rpd ?? 1500;
}

/** Opis limitu dziennego dla studentów (bez RPM/TPM). */
export function formatGeminiDailyLimitHint(modelId?: string): string {
  const id = modelId ? migrateGeminiModelId(modelId) : getGeminiChatModelId();
  const info = getGeminiChatModelInfo(id);
  if (!info) return "Limit zależy od planu Google AI Studio.";
  const { rpd } = info.limits;
  if (rpd <= 100) {
    return `Plan darmowy: ok. ${rpd} zapytań dziennie dla tego modelu.`;
  }
  return `Plan darmowy: ok. ${rpd} zapytań dziennie.`;
}
