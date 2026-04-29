import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listPresentations,
  listTestQuestionsForPresentation,
  type PresentationListRow,
} from "../lib/db";

type Row = PresentationListRow & { questionCount: number };

function fileNameFromPath(path: string | null): string {
  if (!path) return "Bez nazwy pliku";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Bez nazwy pliku";
}

export function TestsHub() {
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const pres = await listPresentations();
    const withCounts = await Promise.all(
      pres.map(async (p) => ({
        ...p,
        questionCount: (await listTestQuestionsForPresentation(p.id)).length,
      })),
    );
    setRows(withCounts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-container-padding py-stack-lg space-y-stack-lg">
      <header className="space-y-4">
        <span className="text-label-caps font-semibold uppercase tracking-widest text-primary">
          Witaj ponownie
        </span>
        <h1 className="text-h1 font-heading font-bold text-on-surface">Testy</h1>
        <p className="text-body-lg text-on-surface-variant max-w-2xl">
          Zweryfikuj wiedzę na podstawie wgranych materiałów. EduMelon analizuje
          pliki i tworzy gotowe zestawy pytań klinicznych.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-gutter">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">
            search
          </span>
          <input
            placeholder="Szukaj materiałów lub tematów..."
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-xl py-3 pl-12 pr-4 outline-none focus:border-primary text-on-surface"
          />
        </div>
        <Link
          to="/app/upload"
          className="bg-primary text-on-primary px-6 py-3 rounded-xl font-heading font-semibold text-sm inline-flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined">upload_file</span>
          Wgraj nowe materiały
        </Link>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
        {rows.length === 0 ? (
          <article className="col-span-full bg-surface-container-low rounded-[24px] border border-outline-variant p-container-padding text-on-surface-variant">
            Brak materiałów. Wgraj prezentację, aby wygenerować testy.
          </article>
        ) : (
          <ul className="contents">
            {rows.map((p) => (
              <li
                key={p.id}
                className="bg-surface-container-low border border-outline-variant rounded-[24px] p-container-padding transition-all duration-300 hover:border-primary/40 group"
              >
                <div className="flex items-start justify-between gap-3 mb-6">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[28px]">
                      {p.source_kind.toLowerCase() === "pdf" ? "description" : "slideshow"}
                    </span>
                  </div>
                  <span className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold uppercase rounded-full">
                    {(p.subject ?? "Bez przedmiotu").slice(0, 24)} / {p.source_kind.toUpperCase()}
                  </span>
                </div>
                <h3 className="font-heading text-h3 text-on-surface mb-2 group-hover:text-primary transition-colors">
                  {p.title || "Bez nazwy użytkownika"}
                </h3>
                <p className="text-body-sm text-on-surface-variant mb-8 line-clamp-2">
                  {fileNameFromPath(p.file_path)}
                </p>
                <div className="flex items-center justify-between pt-6 border-t border-outline-variant">
                  <p className="text-xs uppercase tracking-wide font-mono text-primary">
                    {p.questionCount > 0
                      ? `${p.questionCount} pytań gotowych`
                      : "Brak testu"}
                  </p>
                  <Link
                    to={`/app/tests/${p.id}`}
                    className="bg-primary text-on-primary px-4 py-2 rounded-lg font-bold text-sm hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    Otwórz test
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
