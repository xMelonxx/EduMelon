import { useMemo, useState } from "react";
import { demoGenerationTimeline, demoTestQuestions } from "./mockData";

export function DemoTests() {
  const [phase, setPhase] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const progress = demoGenerationTimeline[Math.min(phase, demoGenerationTimeline.length - 1)] ?? 0;

  const score = useMemo(() => {
    return demoTestQuestions.reduce((acc, q, i) => acc + (selected[i] === q.correct ? 1 : 0), 0);
  }, [selected]);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary">
        Tryb demo samouczka
      </div>
      <section data-tour-id="tutorial-tests-entry" className="rounded-3xl bg-surface-container-lowest p-6 shadow-melon space-y-4">
        <h2 className="text-2xl font-extrabold text-on-surface m-0">Testy (demo)</h2>
        <p className="text-sm text-on-surface-variant m-0">
          Pokazujemy symulacje generowania testu i przykladowy wynik.
        </p>

        {!submitted ? (
          <>
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-on-surface-variant m-0">Progres generowania: {progress}%</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-tour-id="tutorial-tests-generate"
                onClick={() => setPhase((p) => Math.min(p + 1, demoGenerationTimeline.length - 1))}
                className="melon-gradient text-white font-bold px-5 py-2 rounded-full text-sm"
              >
                Symuluj krok generowania
              </button>
              <button
                type="button"
                onClick={() => setPhase(demoGenerationTimeline.length - 1)}
                className="bg-surface-container-high text-on-surface font-bold px-5 py-2 rounded-full text-sm"
              >
                Dokoncz generowanie
              </button>
            </div>

            {progress === 100 && (
              <div className="space-y-4">
                {demoTestQuestions.map((q, qi) => (
                  <article key={q.question} className="rounded-2xl bg-surface-container-low p-4 space-y-2">
                    <p className="font-semibold text-on-surface m-0">{qi + 1}. {q.question}</p>
                    <div className="grid gap-2">
                      {q.options.map((opt, oi) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            const copy = [...selected];
                            copy[qi] = oi;
                            setSelected(copy);
                          }}
                          className={`text-left rounded-xl px-3 py-2 text-sm ${
                            selected[qi] === oi
                              ? "bg-primary/20 border border-primary/40"
                              : "bg-surface-container-high"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
                <button
                  type="button"
                  data-tour-id="tutorial-tests-submit"
                  onClick={() => setSubmitted(true)}
                  className="bg-primary text-on-primary font-bold px-5 py-2 rounded-full text-sm"
                >
                  Zakoncz test (demo)
                </button>
              </div>
            )}
          </>
        ) : (
          <div data-tour-id="tutorial-tests-result" className="rounded-2xl bg-surface-container-low p-5 space-y-2">
            <p className="text-lg font-bold text-on-surface m-0">Wynik demo: {score}/{demoTestQuestions.length}</p>
            <p className="text-sm text-on-surface-variant m-0">
              Przykladowe wyjasnienie blednej odpowiedzi: {demoTestQuestions[0]?.explanation}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
