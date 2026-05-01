import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listFlashcards,
  listPresentations,
  type PresentationListRow,
} from "../lib/db";

type Row = PresentationListRow & { cardCount: number };

export function FlashcardsHub() {
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const pres = await listPresentations();
    const withCounts = await Promise.all(
      pres.map(async (p) => ({
        ...p,
        cardCount: (await listFlashcards(p.id)).length,
      })),
    );
    setRows(withCounts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-10 space-y-10">
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-secondary-container/30 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary-container/20 rounded-full blur-3xl -z-10 pointer-events-none" />

      <header className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant/70">
          Tryb nauki
        </span>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-surface">
          Flashcards
        </h1>
        <p className="text-on-surface-variant max-w-2xl">
          Wybierz prezentację, wygeneruj fiszki i ucz się. Nowe materiały dodasz w
          zakładce „Wgrywanie”.
        </p>
      </header>

      <section className="bg-surface-container-lowest rounded-3xl shadow-melonLg p-6 md:p-8">
        <h2 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">style</span>
          Twoje zestawy
        </h2>
        {rows.length === 0 ? (
          <p className="text-on-surface-variant">
            Brak materiałów.{" "}
            <Link
              to="/app/upload"
              className="text-primary font-semibold hover:underline"
            >
              Wgraj prezentację
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((p) => (
              <li
                key={p.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl bg-surface-container-low px-5 py-4 transition hover:bg-surface-container/80 border-l-4 border-transparent pl-4"
                style={{
                  borderLeftColor: p.folder_color ?? "transparent",
                }}
              >
                <div>
                  <p className="font-semibold text-on-surface">{p.title}</p>
                  <p className="text-sm text-on-surface-variant">
                    {p.subject ?? "Bez przedmiotu"} · {p.source_kind.toUpperCase()}{" "}
                    · {p.cardCount} fiszek
                  </p>
                </div>
                <Link
                  to={`/app/flashcards/${p.id}`}
                  data-tour-id="tour-flashcards-open-set"
                  className="inline-flex items-center justify-center gap-2 melon-gradient text-white font-bold px-6 py-3 rounded-full text-sm shadow-melon hover:opacity-95 transition-opacity"
                >
                  <span className="material-symbols-outlined text-lg">play_arrow</span>
                  Ucz się
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
