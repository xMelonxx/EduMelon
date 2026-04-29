/** Eksport fiszek w formacie tab-separated dla importu w Quizlet. */

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

function buildQuizletTsv(rows: { front: string; back: string }[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return rows.map((r) => `${esc(r.front)}\t${esc(r.back)}`).join("\n");
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Zapisuje fiszki jako TSV. W aplikacji Tauri otwiera okno „Zapisz jako”;
 * w przeglądarce (dev) używa pobrania przez blob.
 */
export async function downloadQuizletTsv(
  rows: { front: string; back: string }[],
  filename = "edumelon-fiszki.txt",
): Promise<void> {
  const content = buildQuizletTsv(rows);
  if (rows.length === 0) return;

  if (isTauri()) {
    const path = await save({
      title: "Zapisz fiszki do importu w Quizlet",
      defaultPath: filename,
      filters: [
        { name: "Tekst / TSV", extensions: ["txt", "tsv"] },
        { name: "Wszystkie pliki", extensions: ["*"] },
      ],
    });
    if (path === null) return;
    await invoke("write_text_file", { path, contents: content });
    return;
  }

  const blob = new Blob([content], {
    type: "text/tab-separated-values;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
