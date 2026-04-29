import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPicker } from "../components/FolderPicker";
import { ingestFileFromPath, type IngestProgress } from "../lib/ingest";

export function Upload() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [progress, setProgress] = useState<IngestProgress | null>(null);

  const pickAndIngest = async () => {
    const path = await open({
      multiple: false,
      filters: [
        {
          name: "Prezentacja",
          extensions: ["pdf", "pptx"],
        },
      ],
    });
    if (!path || typeof path !== "string") return;
    const base = path.split(/[/\\]/).pop() ?? "prezentacja";
    if (!title.trim()) setTitle(base.replace(/\.(pdf|pptx)$/i, ""));
    setBusy(true);
    setLog(null);
    setProgress({ label: "Startuję import…", percent: 1 });
    try {
      const t = title.trim() || base.replace(/\.(pdf|pptx)$/i, "");
      const id = await ingestFileFromPath(path, t, folderId, {
        onProgress: (p) => setProgress(p),
      });
      setLog(`Zapisano materiał.`);
      navigate(`/app/summary/${id}`);
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-10">
      <div className="relative rounded-[24px] bg-surface-container-low border border-outline-variant p-8 md:p-10 shadow-melon overflow-hidden">
        <div className="absolute -right-20 top-0 h-64 w-64 rounded-full bg-secondary-container/40 blur-3xl pointer-events-none" />
        <div className="relative space-y-6">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-3xl">
              cloud_upload
            </span>
            <div>
              <h2 className="text-2xl font-extrabold text-on-surface m-0">
                Wgrywanie i analiza
              </h2>
              <p className="text-sm text-on-surface-variant mt-1">
                PDF lub PPTX → tekst → chunking → embedding (Ollama)
              </p>
            </div>
          </div>
          <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Tytuł (opcjonalnie)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="np. Wykład 3"
              className="rounded-2xl bg-surface-container-high border-0 px-4 py-3 font-sans font-medium normal-case text-on-surface"
            />
          </label>
          <FolderPicker value={folderId} onChange={setFolderId} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void pickAndIngest()}
            className="w-full sm:w-auto bg-primary text-on-primary font-bold px-10 py-4 rounded-xl shadow-melon disabled:opacity-50"
          >
            {busy ? "Przetwarzanie…" : "Wybierz plik i analizuj"}
          </button>
          {progress && (
            <div className="rounded-2xl bg-surface-container-low p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-on-surface">
                <span>{progress.label}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="text-xs text-on-surface-variant m-0">
                Przy większych plikach analiza treści może potrwać chwilę.
              </p>
            </div>
          )}
          {log && (
            <p className="text-sm text-on-surface-variant bg-surface-container-low rounded-2xl px-4 py-3">
              {log}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
