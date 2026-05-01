import { useState } from "react";
import { demoFlashcards } from "./mockData";

export function DemoFlashcards() {
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const card = demoFlashcards[idx]!;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary">
        Tryb demo samouczka
      </div>
      <div data-tour-id="tutorial-flashcards-entry" className="rounded-3xl bg-surface-container-lowest p-6 shadow-melon space-y-4">
        <h2 className="text-2xl font-extrabold text-on-surface m-0">Fiszki (demo)</h2>
        <p className="text-sm text-on-surface-variant m-0">
          Zestaw demo: {demoFlashcards.length} kart, w tym karty trudne do powtorek.
        </p>
        <div className="rounded-2xl bg-surface-container-low p-6 text-center space-y-4">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant m-0">
            {showBack ? "Odpowiedz" : "Pytanie"} ({idx + 1}/{demoFlashcards.length})
          </p>
          <p className="text-xl font-bold text-on-surface m-0">{showBack ? card.back : card.front}</p>
          {card.difficult ? (
            <p className="text-xs font-semibold text-error m-0">Oznaczone jako trudne</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-tour-id="tutorial-flashcards-start"
            onClick={() => setShowBack((v) => !v)}
            className="melon-gradient text-white font-bold px-5 py-2 rounded-full text-sm"
          >
            {showBack ? "Pokaz pytanie" : "Odwroc karte"}
          </button>
          <button
            type="button"
            data-tour-id="tutorial-flashcards-next"
            onClick={() => {
              setShowBack(false);
              setIdx((v) => (v + 1) % demoFlashcards.length);
            }}
            className="bg-surface-container-high text-on-surface font-bold px-5 py-2 rounded-full text-sm"
          >
            Nastepna
          </button>
        </div>
      </div>
    </div>
  );
}
