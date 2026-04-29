import { useEffect, useState } from "react";
import {
  DEFAULT_FOLDER_COLOR,
  FOLDER_COLOR_PRESETS,
  isValidHexColor,
} from "../lib/folderColors";
import { insertSubjectFolder } from "../lib/db";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Wywoływane po zapisie z id nowego folderu. */
  onCreated: (folderId: string) => void;
};

export function CreateFolderModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_FOLDER_COLOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setColor(DEFAULT_FOLDER_COLOR);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      setError("Podaj nazwę przedmiotu.");
      return;
    }
    const c = isValidHexColor(color.trim()) ? color.trim() : DEFAULT_FOLDER_COLOR;
    setBusy(true);
    setError(null);
    try {
      const id = await insertSubjectFolder(n, c);
      onCreated(id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-folder-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-surface-container-lowest p-6 md:p-8 shadow-melonLg border border-outline-variant/20"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="create-folder-title"
          className="text-xl font-extrabold text-on-surface m-0"
        >
          Nowy folder przedmiotu
        </h2>
        <p className="text-sm text-on-surface-variant mt-2 mb-6">
          Nazwa przedmiotu i kolor ułatwią odróżnienie materiałów w bibliotece.
        </p>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4">
          Przedmiot
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Bazy danych"
            className="rounded-2xl bg-surface-container-high border-0 px-4 py-3 font-sans font-medium normal-case text-on-surface"
          />
        </label>

        <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
          Kolor folderu
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {FOLDER_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setColor(c)}
              className={`h-10 w-10 rounded-xl border-2 transition-transform hover:scale-105 ${
                color === c ? "border-primary ring-2 ring-primary/40" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-6">
          Własny kolor (hex)
          <div className="flex gap-3 items-center normal-case">
            <input
              type="color"
              value={isValidHexColor(color) ? color : DEFAULT_FOLDER_COLOR}
              onChange={(e) => setColor(e.target.value)}
              className="h-12 w-16 rounded-xl border-0 cursor-pointer bg-transparent"
            />
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#00695C"
              className="flex-1 rounded-2xl bg-surface-container-high border-0 px-4 py-3 font-mono text-sm text-on-surface"
            />
          </div>
        </label>

        {error && (
          <p className="text-sm text-error mb-4 bg-surface-container-high rounded-2xl px-4 py-2 border border-error/30">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-6 py-3 rounded-full font-bold text-on-surface-variant hover:bg-surface-container-high"
          >
            Anuluj
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="melon-gradient text-white font-bold px-8 py-3 rounded-full disabled:opacity-50"
          >
            {busy ? "Zapisywanie…" : "Utwórz folder"}
          </button>
        </div>
      </div>
    </div>
  );
}
