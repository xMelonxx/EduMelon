import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import {
  hasGeminiKey,
  saveGeminiKey,
  testGeminiKey,
} from "../lib/ai/GeminiProvider";

const AI_STUDIO_URL = "https://aistudio.google.com/app/apikey";

type Props = {
  onReadyChange?: (ready: boolean) => void;
  compact?: boolean;
};

export function GeminiKeySetup({ onReadyChange, compact }: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notifyReady = async (ready: boolean) => {
    onReadyChange?.(ready);
    if (ready) {
      setSaved(true);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setKeyInput(text.trim());
    } catch {
      setError("Nie udało się odczytać schowka. Wklej klucz ręcznie (Ctrl+V).");
    }
  };

  const testAndSave = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveGeminiKey(keyInput.trim());
      await testGeminiKey();
      setKeyInput("");
      await notifyReady(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onReadyChange?.(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void hasGeminiKey().then((ok) => {
      if (ok) {
        setSaved(true);
        onReadyChange?.(true);
      }
    });
  }, [onReadyChange]);

  return (
    <div className={`space-y-4 ${compact ? "" : ""}`}>
      <p className="text-sm text-on-surface-variant m-0">
        Krok 1: Utwórz darmowy klucz API w Google AI Studio.
      </p>
      <button
        type="button"
        onClick={() => openUrl(AI_STUDIO_URL)}
        className="bg-secondary-container text-on-secondary-container font-bold px-6 py-3 rounded-full"
      >
        Otwórz Google AI Studio
      </button>

      <p className="text-sm text-on-surface-variant m-0">
        Krok 2: Wklej klucz API poniżej.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 max-w-md">
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="AIza…"
          className="rounded-2xl bg-surface-container-high border-0 px-4 py-3 font-sans font-medium text-on-surface flex-1 min-w-0"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => void pasteFromClipboard()}
          className="bg-surface-container-high text-on-surface font-bold px-4 py-3 rounded-full whitespace-nowrap"
        >
          Wklej ze schowka
        </button>
      </div>

      <p className="text-sm text-on-surface-variant m-0">Krok 3: Zapisz i sprawdź połączenie.</p>
      <button
        type="button"
        disabled={busy || keyInput.trim().length < 10}
        onClick={() => void testAndSave()}
        className="melon-gradient text-white font-bold px-6 py-3 rounded-full shadow-melon disabled:opacity-50"
      >
        {busy ? "Sprawdzam…" : "Testuj i zapisz"}
      </button>

      {saved && (
        <p className="text-sm font-semibold text-primary m-0 flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">check_circle</span>
          Klucz działa — możesz korzystać z Gemini.
        </p>
      )}
      {error && <p className="text-primary text-sm m-0">{error}</p>}
    </div>
  );
}
