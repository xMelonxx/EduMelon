import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hasGeminiKey } from "../lib/ai/GeminiProvider";
import { ensureOllamaRunning } from "../lib/ollamaAutostart";
import { isOnboardingDone, loadLocalProfile } from "../lib/storage";
import { syncUsageStatsIfConsented } from "../lib/usageStats";

export function RootGate() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState("Przygotowuję aplikację…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profile = loadLocalProfile();
      const aiProvider = profile?.aiProvider ?? "ollama";

      if (aiProvider === "gemini") {
        const keyOk = await hasGeminiKey();
        if (cancelled) return;
        if (!keyOk || !isOnboardingDone()) {
          navigate("/onboarding", { replace: true });
          return;
        }
        void syncUsageStatsIfConsented();
        setMsg("Przechodzę do pulpitu…");
        navigate("/app/dashboard", { replace: true });
        return;
      }

      setMsg("Sprawdzanie Ollama…");
      const ok = await ensureOllamaRunning();
      if (cancelled) return;
      if (!ok) {
        navigate("/ollama", { replace: true });
        return;
      }
      if (!isOnboardingDone()) {
        navigate("/onboarding", { replace: true });
        return;
      }
      void syncUsageStatsIfConsented();
      setMsg("Przechodzę do pulpitu…");
      navigate("/app/dashboard", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-surface">
      <div className="rounded-3xl bg-surface-container-lowest px-10 py-8 shadow-melon text-center space-y-2 max-w-sm">
        <p className="text-xl font-extrabold text-primary m-0">EduMelon</p>
        <p className="text-on-surface-variant text-sm">{msg}</p>
      </div>
    </div>
  );
}
