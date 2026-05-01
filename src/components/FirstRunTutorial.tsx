import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setTutorialActive, setTutorialSeen } from "../lib/storage";

type TutorialStep = {
  id: string;
  title: string;
  body: string;
  route: string;
  targetId?: string;
};

const STEPS: TutorialStep[] = [
  {
    id: "nav",
    title: "Nawigacja aplikacji",
    body: "Tutaj przechodzisz miedzy: Biblioteka, Wgrywanie, Fiszki, Testy i Ustawienia.",
    route: "/app/dashboard",
    targetId: "tour-nav-panel",
  },
  {
    id: "upload",
    title: "Wgrywanie materialow",
    body: "Najpierw wpisz customowa nazwe materialu, zeby latwiej go potem znalezc.",
    route: "/app/upload",
    targetId: "tour-upload-title",
  },
  {
    id: "upload-folder",
    title: "Foldery materialow",
    body: "Tutaj wybierasz folder i mozesz dodawac nowe foldery do porzadkowania materialow.",
    route: "/app/upload",
    targetId: "tour-upload-folder",
  },
  {
    id: "upload-start",
    title: "Start analizy",
    body: "Po wybraniu pliku kliknij ten przycisk, aby rozpoczac analize.",
    route: "/app/upload",
    targetId: "tour-upload-button",
  },
  {
    id: "summary",
    title: "Podglad PDF i chatbot",
    body: "W tym widoku czytasz material i analizujesz strony PDF.",
    route: "/app/tutorial/summary",
    targetId: "tutorial-pdf-viewer",
  },
  {
    id: "summary-chat",
    title: "Okno chatbota",
    body: "Po prawej widzisz pytanie uczestnika, po lewej odpowiedz chatbota. Dostepne sa 2 tryby: caly material albo konkretna strona.",
    route: "/app/tutorial/summary",
    targetId: "tutorial-chat-panel",
  },
  {
    id: "flashcards",
    title: "Modul fiszek",
    body: "Tu zaczynasz nauke fiszek i przechodzisz po kartach.",
    route: "/app/tutorial/flashcards",
    targetId: "tutorial-flashcards-start",
  },
  {
    id: "tests",
    title: "Modul testow",
    body: "Tutaj generujesz test i sprawdzasz wynik.",
    route: "/app/tutorial/tests",
    targetId: "tutorial-tests-generate",
  },
  {
    id: "performance",
    title: "Tryb dla slabszych komputerow",
    body: "W Ustawieniach wlacz tryb wydajnosci, gdy generowanie trwa za dlugo.",
    route: "/app/settings",
    targetId: "tour-settings-performance",
  },
  {
    id: "updates",
    title: "Aktualizacje aplikacji",
    body: "Sprawdzisz tutaj nowe wersje i zainstalujesz update.",
    route: "/app/settings",
    targetId: "tour-settings-updates",
  },
  {
    id: "feedback",
    title: "Zgloszenia problemow",
    body: "Tutaj wysylasz feedback i przejdziesz do zgloszen GitHub.",
    route: "/app/settings",
    targetId: "tour-settings-feedback",
  },
  {
    id: "finish",
    title: "Gotowe",
    body: "To wszystko. Teraz przejdz do wgrywania wlasnego materialu.",
    route: "/app/upload",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const y = style.overflowY;
    if ((y === "auto" || y === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function FirstRunTutorial({ open, onClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const step = STEPS[idx]!;

  useEffect(() => {
    if (!open || !started) return;
    if (location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [open, started, location.pathname, step.route, navigate]);

  useEffect(() => {
    if (!open || !started) return;
    const lookup = () => {
      if (!step.targetId) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(`[data-tour-id="${step.targetId}"]`) as HTMLElement | null;
      if (el) {
        const parent = findScrollParent(el);
        if (parent) {
          const parentRect = parent.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const offsetTop = elRect.top - parentRect.top + parent.scrollTop;
          const top = Math.max(0, offsetTop - parent.clientHeight / 2 + elRect.height / 2);
          parent.scrollTo({ top, behavior: "smooth" });
        } else {
          el.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
          });
        }
      }
      setTargetRect(el ? el.getBoundingClientRect() : null);
    };
    lookup();
    const t1 = setTimeout(lookup, 80);
    const t2 = setTimeout(lookup, 220);
    const t3 = setTimeout(lookup, 420);
    window.addEventListener("resize", lookup);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("resize", lookup);
    };
  }, [open, started, step.targetId, location.pathname]);

  useEffect(() => {
    if (!open) {
      setStarted(false);
      setIdx(0);
      setTargetRect(null);
    }
  }, [open]);

  const done = () => {
    setTutorialSeen(true);
    setTutorialActive(false);
    onClose();
  };

  const skip = () => {
    done();
  };

  const next = () => {
    if (idx >= STEPS.length - 1) {
      done();
      return;
    }
    setIdx((v) => v + 1);
  };

  const prev = () => setIdx((v) => Math.max(0, v - 1));

  const bubbleStyle = useMemo(() => {
    if (!targetRect) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      } as const;
    }
    const top = Math.min(window.innerHeight - 220, targetRect.bottom + 12);
    const left = Math.min(window.innerWidth - 380, Math.max(16, targetRect.left));
    return { top, left } as const;
  }, [targetRect]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[120] bg-black/25" />
      {started && targetRect && (
        <div
          className="fixed z-[121] rounded-2xl border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.2)] pointer-events-none"
          style={{
            left: targetRect.left - 4,
            top: targetRect.top - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}
      {!started ? (
        <div className="fixed z-[122] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(620px,calc(100vw-2rem))] rounded-3xl border border-outline-variant bg-surface-container-lowest shadow-melon p-6 md:p-8 space-y-4">
          <p className="text-[11px] uppercase tracking-wider font-bold text-primary m-0">
            Witamy w EduMelon
          </p>
          <h3 className="text-xl md:text-2xl font-extrabold text-on-surface m-0">
            Dzieki za instalacje aplikacji
          </h3>
          <p className="text-sm text-on-surface-variant m-0 leading-relaxed">
            EduMelon jest jeszcze rozwijany (wersja dev), ale juz teraz pomoze Ci szybko
            przerabiac materialy na podsumowania, fiszki i testy.
          </p>
          <p className="text-sm text-on-surface-variant m-0 leading-relaxed">
            Za chwile uruchomi sie krotki samouczek, w ktorym pokazemy kluczowe elementy
            aplikacji i gdzie zglaszac problemy lub pomysly.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={skip} className="bg-surface-container-high text-on-surface font-semibold px-3 py-2 rounded-xl text-xs">
              Pomin samouczek
            </button>
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="bg-primary text-on-primary font-bold px-4 py-2 rounded-xl text-xs ml-auto"
            >
              Rozpocznij szybki samouczek
            </button>
          </div>
        </div>
      ) : (
        <div className="fixed z-[122] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-melon p-4 space-y-3" style={bubbleStyle}>
          <p className="text-[11px] uppercase tracking-wider font-bold text-primary m-0">
            Samouczek {idx + 1}/{STEPS.length}
          </p>
          <p className="text-sm font-bold text-on-surface m-0">{step.title}</p>
          <p className="text-xs text-on-surface-variant m-0">{step.body}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={skip} className="bg-surface-container-high text-on-surface font-semibold px-3 py-2 rounded-xl text-xs">
              Pomin
            </button>
            {idx > 0 && (
              <button type="button" onClick={prev} className="bg-surface-container-high text-on-surface font-semibold px-3 py-2 rounded-xl text-xs">
                Wstecz
              </button>
            )}
            <button type="button" onClick={next} className="bg-primary text-on-primary font-bold px-3 py-2 rounded-xl text-xs ml-auto">
              {idx === STEPS.length - 1 ? "Zakoncz" : "Dalej"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
