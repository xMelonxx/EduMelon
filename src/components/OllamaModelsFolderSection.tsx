import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import {
  buildPowerShellSetUserEnv,
} from "../lib/ollamaModelsPath";

type Props = {
  value: string | null;
  onChange: (path: string | null) => void;
  compact?: boolean;
};

export function OllamaModelsFolderSection({
  value,
  onChange,
  compact,
}: Props) {
  const [showHelp, setShowHelp] = useState(false);

  const pick = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Wybierz folder na modele Ollama",
    });
    if (typeof dir === "string" && dir.length > 0) onChange(dir);
  };

  const copyPs = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(buildPowerShellSetUserEnv(value));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <p className="text-sm text-on-surface-variant m-0">
        Ollama zapisuje modele w swoim katalogu. Żeby użyć{" "}
        <strong className="text-on-surface">wybranego folderu</strong>, musisz
        ustawić zmienną <code className="text-on-surface">OLLAMA_MODELS</code>{" "}
        i <strong className="text-on-surface">zrestartować Ollama</strong> przed
        pierwszym <code className="text-on-surface">ollama pull</code>.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => void pick()}
          className="bg-secondary-container text-on-secondary-container font-bold px-5 py-2.5 rounded-full text-sm"
        >
          Wybierz folder
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-sm font-semibold text-on-surface-variant hover:text-on-surface underline"
        >
          Domyślna lokalizacja Ollama
        </button>
      </div>
      {value && (
        <div className="rounded-2xl bg-surface-container-high px-4 py-3 text-sm break-all font-mono text-on-surface">
          {value}
        </div>
      )}
      <button
        type="button"
        onClick={() => setShowHelp(!showHelp)}
        className="text-sm font-semibold text-primary hover:underline"
      >
        {showHelp ? "Ukryj" : "Pokaż"} instrukcję (Windows PowerShell)
      </button>
      {showHelp && value && (
        <div className="rounded-2xl bg-surface-container-low p-4 space-y-2 text-xs text-on-surface-variant">
          <p className="m-0">Uruchom PowerShell jako użytkownik i wklej (lub użyj „Kopiuj”):</p>
          <pre className="whitespace-pre-wrap break-all bg-surface-container-high rounded-xl p-3 text-on-surface m-0">
            {buildPowerShellSetUserEnv(value)}
          </pre>
          <button
            type="button"
            onClick={() => void copyPs()}
            className="melon-gradient text-white font-bold px-4 py-2 rounded-full text-xs"
          >
            Kopiuj polecenie
          </button>
          <p className="m-0">
            Potem zamknij i ponownie uruchom Ollama (ikona w zasobniku), aby
            wczytała zmienną.
          </p>
        </div>
      )}
    </div>
  );
}
