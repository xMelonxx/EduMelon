import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureOllamaRunning } from "../lib/ollamaAutostart";
import { isOnboardingDone } from "../lib/storage";
import { syncUsageStatsIfConsented } from "../lib/usageStats";

export function RootGate() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState("Sprawdzanie Ollama…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      // Best effort: anonimowe statystyki (jeśli użytkownik wyraził zgodę).
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
