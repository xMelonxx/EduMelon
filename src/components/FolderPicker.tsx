import { useCallback, useEffect, useState } from "react";
import { listSubjectFolders, type SubjectFolderRow } from "../lib/db";
import { CreateFolderModal } from "./CreateFolderModal";

type Props = {
  /** Wybrany folder lub null = bez folderu (tylko tytuł materiału). */
  value: string | null;
  onChange: (folderId: string | null) => void;
};

export function FolderPicker({ value, onChange }: Props) {
  const [folders, setFolders] = useState<SubjectFolderRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    setFolders(await listSubjectFolders());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = folders.find((f) => f.id === value);

  return (
    <>
      <div className="space-y-3">
        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Folder / przedmiot
          <div className="flex flex-col sm:flex-row gap-3 normal-case">
            <div className="relative flex-1">
              <select
                value={value ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange(v === "" ? null : v);
                }}
                className="w-full appearance-none rounded-2xl bg-surface-container-high border-0 px-4 py-3 pr-10 font-sans font-medium text-on-surface"
              >
                <option value="">— Bez folderu (opcjonalnie) —</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl">
                expand_more
              </span>
            </div>
            {selected && (
              <span
                className="shrink-0 self-center h-10 w-10 rounded-xl border border-outline-variant/30 shadow-sm"
                style={{ backgroundColor: selected.color }}
                title={selected.color}
              />
            )}
          </div>
        </label>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
        >
          <span className="material-symbols-outlined text-lg">create_new_folder</span>
          Nowy folder (przedmiot + kolor)
        </button>
      </div>

      <CreateFolderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          void refresh();
          onChange(id);
        }}
      />
    </>
  );
}
