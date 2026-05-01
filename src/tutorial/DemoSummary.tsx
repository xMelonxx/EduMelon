import { Link } from "react-router-dom";
import { demoChatPrompts, demoPdfPages } from "./mockData";

export function DemoSummary() {
  const sample = demoChatPrompts[0]!;

  return (
    <div className="w-full px-4 md:px-8 py-6 md:py-8 space-y-6">
      <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary">
        Tryb demo samouczka
      </div>
      <div>
        <Link to="/app/dashboard" className="text-sm font-semibold text-primary hover:underline">
          Powrot
        </Link>
        <h2 className="text-3xl font-extrabold text-on-surface m-0 mt-2">Podglad materialu (demo)</h2>
      </div>

      <section className="grid xl:grid-cols-[2.3fr_1fr] gap-5 items-start">
        <div data-tour-id="tutorial-pdf-viewer" className="rounded-3xl bg-surface-container-lowest p-5 shadow-melon h-[72vh] overflow-y-auto space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant m-0">Podglad PDF</h3>
          {demoPdfPages.map((p) => (
            <article key={p.page} className="rounded-2xl bg-white text-black p-4 shadow-sm">
              <p className="text-xs font-bold mb-1">Strona {p.page}</p>
              <p className="text-sm font-semibold mb-2">{p.title}</p>
              <p className="text-sm leading-6">{p.content}</p>
            </article>
          ))}
        </div>

        <div data-tour-id="tutorial-chat-panel" className="rounded-3xl bg-surface-container-low p-5 shadow-inner h-[72vh] flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant m-0">Chatbot (demo)</h3>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-semibold bg-primary text-on-primary"
            >
              Caly material
            </button>
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-semibold bg-surface-container-high text-on-surface"
            >
              Konkretna strona
            </button>
          </div>
          <div className="rounded-2xl bg-surface-container-high/80 p-4 flex-1 min-h-0 overflow-y-auto text-sm space-y-2">
            <div className="ml-auto max-w-[92%] rounded-2xl bg-primary/20 px-3 py-2" data-tour-id="tutorial-chat-input">
              {sample.question}
            </div>
            <div className="max-w-[95%] rounded-2xl bg-surface-container-lowest px-3 py-2" data-tour-id="tutorial-chat-send">
              {sample.answer}
            </div>
          </div>
          <p className="text-xs text-on-surface-variant m-0">
            Dymek po prawej to pytanie uczestnika, po lewej odpowiedz chatbota.
          </p>
        </div>
      </section>
    </div>
  );
}
