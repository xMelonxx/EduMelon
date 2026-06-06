import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  GEMINI_USAGE_UPDATED_EVENT,
  getGeminiUsagePercents,
  getGeminiUsageTodayByModel,
  getGeminiUsageTone,
} from "../lib/geminiUsage";
import {
  formatGeminiDailyLimitHint,
  getGeminiChatModelId,
  getGeminiChatModelInfo,
} from "../lib/geminiModels";
import { getAiProviderId } from "../lib/storage";
import { hasGeminiKey } from "../lib/ai/GeminiProvider";

export function GeminiUsageHeaderIndicator() {
  const [visible, setVisible] = useState(false);
  const [percent, setPercent] = useState(0);

  const keyOkRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const applyPercent = () => {
      const p = getGeminiUsagePercents(getGeminiChatModelId());
      if (!cancelled) {
        setVisible(true);
        setPercent(p.requestsDayPercent);
      }
    };

    const refresh = async (opts?: { skipKeyCheck?: boolean }) => {
      if (getAiProviderId() !== "gemini") {
        if (!cancelled) setVisible(false);
        return;
      }
      if (!opts?.skipKeyCheck) {
        const ok = await hasGeminiKey();
        keyOkRef.current = ok;
        if (!ok) {
          if (!cancelled) setVisible(false);
          return;
        }
      } else if (!keyOkRef.current) {
        return;
      }
      applyPercent();
    };

    void refresh();
    const onUpdate = () => void refresh({ skipKeyCheck: true });
    window.addEventListener(GEMINI_USAGE_UPDATED_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(GEMINI_USAGE_UPDATED_EVENT, onUpdate);
    };
  }, []);

  if (!visible) return null;

  const tone = getGeminiUsageTone(percent);
  const ringClass =
    tone === "danger"
      ? "text-primary"
      : tone === "warning"
        ? "text-amber-500"
        : "text-on-surface-variant";

  return (
    <Link
      to="/app/settings"
      title="Zużycie dziennego limitu zapytań Gemini"
      className={`inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-bold no-underline ${ringClass}`}
    >
      <span
        className="inline-block w-2 h-2 rounded-full bg-current opacity-80"
        style={{ boxShadow: `0 0 0 2px currentColor` }}
      />
      {percent}%
    </Link>
  );
}

export function GeminiUsagePanel() {
  const activeModelId = getGeminiChatModelId();
  const modelInfo = getGeminiChatModelInfo(activeModelId);
  const [activeStats, setActiveStats] = useState(() =>
    getGeminiUsagePercents(activeModelId),
  );
  const [otherModels, setOtherModels] = useState(() =>
    getGeminiUsageTodayByModel().filter((m) => m.modelId !== activeModelId),
  );

  useEffect(() => {
    const refresh = () => {
      const id = getGeminiChatModelId();
      setActiveStats(getGeminiUsagePercents(id));
      setOtherModels(getGeminiUsageTodayByModel().filter((m) => m.modelId !== id));
    };
    refresh();
    window.addEventListener(GEMINI_USAGE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(GEMINI_USAGE_UPDATED_EVENT, refresh);
  }, []);

  const { requestsDayPercent, requestsToday, limit } = activeStats;
  const tone = getGeminiUsageTone(requestsDayPercent);
  const barClass =
    tone === "danger"
      ? "bg-primary"
      : tone === "warning"
        ? "bg-amber-500"
        : "bg-primary/70";

  return (
    <div className="rounded-2xl bg-surface-container-high px-4 py-4 space-y-2">
      <p className="text-sm font-semibold text-on-surface m-0">Zużycie dzisiaj</p>
      {modelInfo && (
        <p className="text-xs text-on-surface-variant m-0">
          Model: {modelInfo.label} — {formatGeminiDailyLimitHint(modelInfo.id)}
        </p>
      )}
      <p className="text-sm text-on-surface-variant m-0">
        Dziś: {requestsToday} z {limit} zapytań ({requestsDayPercent}%)
      </p>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden">
        <div
          className={`h-full transition-all ${barClass}`}
          style={{ width: `${Math.min(100, requestsDayPercent)}%` }}
        />
      </div>
      {requestsDayPercent >= 90 && (
        <p className="text-xs text-primary m-0">
          Zbliżasz się do dziennego limitu konta Google.
        </p>
      )}
      {requestsToday > limit && (
        <p className="text-xs text-primary m-0">
          Limit może być wyczerpany — odczekaj do jutra lub sprawdź konto w Google AI
          Studio.
        </p>
      )}
      {otherModels.length > 0 && (
        <div className="pt-2 space-y-1 border-t border-outline-variant">
          <p className="text-xs font-semibold text-on-surface-variant m-0">
            Inne modele użyte dziś
          </p>
          {otherModels.map((m) => (
            <p key={m.modelId} className="text-xs text-on-surface-variant m-0">
              {m.label}: {m.requestsToday} / {m.limit} zapytań
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
