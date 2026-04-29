import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ollamaTagsReachable } from "../lib/ollama";

const OLLAMA_WIN = "https://ollama.com/download/windows";

export function OllamaGate() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const recheck = useCallback(async () => {
    setChecking(true);
    setErr(null);
    try {
      const ok = await ollamaTagsReachable();
      if (ok) navigate("/", { replace: true });
      else setErr("Ollama nadal nie odpowiada na http://127.0.0.1:11434");
    } finally {
      setChecking(false);
    }
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-surface">
      <div className="w-full max-w-md rounded-3xl bg-surface-container-lowest p-8 shadow-melon space-y-5">
        <h2 className="text-2xl font-extrabold text-on-surface m-0">
          Lokalne AI (Ollama)
        </h2>
        <p className="text-on-surface-variant text-sm leading-relaxed m-0">
          EduMelon potrzebuje uruchomionej Ollama na tym komputerze. Zainstaluj
          ją, uruchom, a potem kliknij „Sprawdź ponownie”.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => openUrl(OLLAMA_WIN)}
            className="bg-secondary-container text-on-secondary-container font-bold px-6 py-3 rounded-full"
          >
            Pobierz Ollama
          </button>
          <button
            type="button"
            disabled={checking}
            onClick={() => void recheck()}
            className="melon-gradient text-white font-bold px-6 py-3 rounded-full shadow-melon disabled:opacity-50"
          >
            {checking ? "Sprawdzam…" : "Sprawdź ponownie"}
          </button>
        </div>
        {err && <p className="text-primary text-sm m-0">{err}</p>}
      </div>
    </div>
  );
}
