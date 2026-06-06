import { useEffect, useState } from "react";
import {
  getDefaultModelForProvider,
  getModelsForProvider,
  type ModelOption,
} from "../lib/ai/models";
import { formatGeminiDailyLimitHint } from "../lib/geminiModels";
import { isGeminiChatModelId } from "../lib/geminiModels";
import {
  GEMINI_USAGE_UPDATED_EVENT,
  getGeminiUsagePercents,
} from "../lib/geminiUsage";
import type { AiProviderId } from "../lib/constants";

type Props = {
  aiProvider: AiProviderId;
  aiModel: string;
  onProviderChange: (provider: AiProviderId) => void;
  onModelChange: (model: ModelOption) => void;
  compact?: boolean;
  /** Ukryj przełącznik chmura/lokalnie (np. onboarding Ollama). */
  lockProvider?: boolean;
};

export function AiModelSelector({
  aiProvider,
  aiModel,
  onProviderChange,
  onModelChange,
  compact,
  lockProvider,
}: Props) {
  const [, setUsageTick] = useState(0);

  useEffect(() => {
    if (aiProvider !== "gemini") return;
    const refresh = () => setUsageTick((n) => n + 1);
    window.addEventListener(GEMINI_USAGE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(GEMINI_USAGE_UPDATED_EVENT, refresh);
  }, [aiProvider]);

  const handleProviderSwitch = (provider: AiProviderId) => {
    onProviderChange(provider);
    const models = getModelsForProvider(provider);
    const keep =
      models.find((m) => m.id === aiModel) ??
      models.find((m) => m.id === getDefaultModelForProvider(provider)) ??
      models[0];
    if (keep) onModelChange(keep);
  };

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {!compact && (
        <div>
          <h4 className="text-base font-bold text-on-surface m-0">
            Silnik sztucznej inteligencji
          </h4>
          <p className="text-sm text-on-surface-variant mt-1 mb-0">
            Wybierz, skąd aplikacja ma czerpać wiedzę.
          </p>
        </div>
      )}

      {!lockProvider && (
      <div className="flex p-1 bg-surface-container-high rounded-xl">
        <button
          type="button"
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            aiProvider === "gemini"
              ? "bg-surface-container-lowest text-on-surface shadow-sm"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
          onClick={() => handleProviderSwitch("gemini")}
        >
          Chmura Gemini
        </button>
        <button
          type="button"
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            aiProvider === "ollama"
              ? "bg-surface-container-lowest text-on-surface shadow-sm"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
          onClick={() => handleProviderSwitch("ollama")}
        >
          Lokalnie (Ollama)
        </button>
      </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-semibold text-on-surface m-0">Wersja modelu</p>
        <div className="grid gap-3">
          {getModelsForProvider(aiProvider).map((model) => {
            const isSelected = aiModel === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => onModelChange(model)}
                className={`p-4 rounded-2xl border-2 text-left transition-all w-full ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant hover:border-outline bg-surface-container-high"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-on-surface">{model.name}</span>
                  {model.badge && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${model.badgeColor ?? "bg-surface-container text-on-surface-variant"}`}
                    >
                      {model.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed m-0 text-left">
                  {model.description}
                </p>
                {model.provider === "gemini" && isGeminiChatModelId(model.id) && (
                  <>
                    <p className="text-xs text-on-surface-variant mt-2 mb-0 text-left">
                      {formatGeminiDailyLimitHint(model.id)}
                    </p>
                    {(() => {
                      const usage = getGeminiUsagePercents(model.id);
                      if (usage.requestsToday <= 0) return null;
                      return (
                        <p className="text-xs text-primary mt-1 mb-0 text-left font-medium">
                          Dziś: {usage.requestsToday} / {usage.limit} zapytań
                        </p>
                      );
                    })()}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { type ModelOption };
export { AVAILABLE_MODELS } from "../lib/ai/models";
