import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CreateStudyEventModal } from "../components/CreateStudyEventModal";
import { CreateFolderModal } from "../components/CreateFolderModal";
import { MODEL_PROFILES } from "../lib/constants";
import { isDevToolsEnabled } from "../lib/devtools";
import {
  createStudyEvent,
  deleteStudyEvent,
  getContinueLearningCard,
  getStudyStreak,
  getTodayTasksSummary,
  getWeeklyProgressStats,
  getWeakTopics,
  listPresentations,
  listRecentActivity,
  listStudyEventMaterials,
  listSubjectFolders,
  listUpcomingDeadlines,
  listPendingReminders,
  markReminderFired,
  updateStudyEvent,
  type ContinueLearningCard,
  type PresentationListRow,
  type RecentActivityRow,
  type StudyEventType,
  type StudyEventWithMaterialsRow,
  type StudyEventReminderAlertRow,
  type SubjectFolderRow,
  type TodayTasksSummary,
  type WeakTopicRow,
  type WeeklyProgressStats,
} from "../lib/db";
import { ollamaChat } from "../lib/ollama";
import { loadLocalProfile } from "../lib/storage";

type FolderBucket = {
  id: string | null;
  name: string;
  color: string;
  items: PresentationListRow[];
};

const AI_RECO_CACHE_KEY = "edumelon_ai_recommendation_cache_v1";
const AI_RECO_TTL_MS = 6 * 60 * 60 * 1000;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function sourceIcon(kind: string): string {
  return kind.toLowerCase() === "pdf" ? "picture_as_pdf" : "slideshow";
}

export function Dashboard() {
  const devToolsEnabled = isDevToolsEnabled();
  const [items, setItems] = useState<PresentationListRow[]>([]);
  const [folders, setFolders] = useState<SubjectFolderRow[]>([]);
  const [continueCard, setContinueCard] = useState<ContinueLearningCard | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodayTasksSummary | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyProgressStats | null>(null);
  const [weakTopics, setWeakTopics] = useState<WeakTopicRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityRow[]>([]);
  const [streak, setStreak] = useState(0);
  const [deadlines, setDeadlines] = useState<StudyEventWithMaterialsRow[]>([]);
  const [reminders, setReminders] = useState<StudyEventReminderAlertRow[]>([]);
  const [eventMaterialsMap, setEventMaterialsMap] = useState<Record<string, PresentationListRow[]>>({});
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalBusy, setEventModalBusy] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState("");
  const [aiRecoBusy, setAiRecoBusy] = useState(false);
  const [aiRecoRefreshTick, setAiRecoRefreshTick] = useState(0);
  const [editingEvent, setEditingEvent] = useState<{
    id: string;
    title: string;
    eventType: StudyEventType;
    deadlineAt: string;
    notes: string | null;
    linkedPresentationIds: string[];
  } | null>(null);
  const profile = loadLocalProfile();

  const syncEventMaterials = useCallback(async (events: StudyEventWithMaterialsRow[]) => {
    const pairs = await Promise.all(
      events.map(async (event) => [event.id, await listStudyEventMaterials(event.id)] as const),
    );
    setEventMaterialsMap(Object.fromEntries(pairs));
  }, []);

  const refresh = useCallback(async () => {
    const [
      nextItems,
      nextFolders,
      nextContinueCard,
      nextTodayTasks,
      nextWeeklyStats,
      nextWeakTopics,
      nextRecentActivity,
      nextStreak,
      nextDeadlines,
      pendingReminders,
    ] = await Promise.all([
      listPresentations(),
      listSubjectFolders(),
      getContinueLearningCard(),
      getTodayTasksSummary(),
      getWeeklyProgressStats(),
      getWeakTopics(4),
      listRecentActivity(5),
      getStudyStreak(),
      listUpcomingDeadlines(3),
      listPendingReminders(new Date().toISOString()),
    ]);
    for (const reminder of pendingReminders) {
      await markReminderFired(reminder.reminder_id);
    }
    setItems(nextItems);
    setFolders(nextFolders);
    setContinueCard(nextContinueCard);
    setTodayTasks(nextTodayTasks);
    setWeeklyStats(nextWeeklyStats);
    setWeakTopics(nextWeakTopics);
    setRecentActivity(nextRecentActivity);
    setStreak(nextStreak);
    setDeadlines(nextDeadlines);
    setReminders(pendingReminders);
    await syncEventMaterials(nextDeadlines);
  }, [syncEventMaterials]);

  const folderBuckets = useMemo<FolderBucket[]>(() => {
    const byFolder = new Map<string, PresentationListRow[]>();
    for (const p of items) {
      const key = p.folder_id ?? "__no_folder__";
      const arr = byFolder.get(key) ?? [];
      arr.push(p);
      byFolder.set(key, arr);
    }
    const out: FolderBucket[] = folders.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      items: byFolder.get(f.id) ?? [],
    }));
    const noFolder = byFolder.get("__no_folder__") ?? [];
    if (noFolder.length > 0 || out.length === 0) {
      out.push({
        id: null,
        name: "Bez folderu",
        color: "#94A3B8",
        items: noFolder,
      });
    }
    return out;
  }, [folders, items]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fallbackRecommendation = useMemo(() => {
    const nearest = deadlines[0];
    const nearestHint = nearest
      ? (() => {
          const diff = new Date(nearest.deadline_at).getTime() - Date.now();
          const dayMs = 24 * 60 * 60 * 1000;
          if (diff <= 0) return `Najbliższy deadline: ${nearest.title} (termin minął).`;
          if (diff < dayMs) {
            return `Najbliższy deadline: ${nearest.title} (za ${Math.max(
              1,
              Math.round(diff / (60 * 60 * 1000)),
            )}h).`;
          }
          return `Najbliższy deadline: ${nearest.title} (za ${Math.ceil(diff / dayMs)} dni).`;
        })()
      : "";
    if (todayTasks && todayTasks.overdue_count > 0) {
      return `Masz zaległe deadline'y. Najpierw zrób szybki przegląd materiałów przypiętych do najbliższego wydarzenia. ${nearestHint}`.trim();
    }
    if (weakTopics.length > 0) {
      return `Skup się dziś na temacie „${weakTopics[0]!.title}” — ma najwyższy odsetek błędów. ${nearestHint}`.trim();
    }
    return `Dziś dobry moment, żeby rozwiązać jeden krótki test i utrwalić fiszki z ostatniego materiału. ${nearestHint}`.trim();
  }, [todayTasks, weakTopics, deadlines]);

  useEffect(() => {
    if (!todayTasks || !weeklyStats) {
      setAiRecommendation(fallbackRecommendation);
      return;
    }
    if (aiRecoRefreshTick === 0) {
      try {
        const rawCache = localStorage.getItem(AI_RECO_CACHE_KEY);
        if (rawCache) {
          const parsed = JSON.parse(rawCache) as { text?: string; generatedAt?: number };
          if (
            parsed.text &&
            typeof parsed.generatedAt === "number" &&
            Date.now() - parsed.generatedAt < AI_RECO_TTL_MS
          ) {
            setAiRecommendation(parsed.text);
            return;
          }
        }
      } catch {
        // brak cache lub uszkodzony zapis — po prostu generujemy na nowo
      }
    }
    let cancelled = false;
    void (async () => {
      setAiRecoBusy(true);
      setAiRecommendation((prev) => prev || fallbackRecommendation);
      try {
        const model = MODEL_PROFILES[profile?.modelProfile ?? "e2b-it"].ollamaTag;
        const context = {
          todayTasks,
          weeklyStats,
          weakTopics: weakTopics.slice(0, 3).map((w) => ({
            title: w.title,
            wrongRatio: Math.round(w.wrong_ratio * 100),
          })),
          deadlines: deadlines.slice(0, 3).map((d) => ({
            title: d.title,
            type: d.event_type,
            deadlineAt: d.deadline_at,
            materials: d.materials_count,
          })),
          streak,
          remindersCount: reminders.length,
        };
        const raw = await Promise.race<string>([
          ollamaChat(
            model,
            [
              {
                role: "system",
                content:
                  "Jesteś asystentem nauki. Napisz jedną konkretną rekomendację dnia po polsku, maksymalnie 180 znaków. Bez list i bez markdown. Jeśli istnieje najbliższy deadline, podaj ile czasu zostało do tego deadline'u.",
              },
              {
                role: "user",
                content: `Kontekst ucznia (JSON): ${JSON.stringify(context)}`,
              },
            ],
            { temperature: 0.2, num_predict: 80 },
          ),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("AI recommendation timeout")), 15000),
          ),
        ]);
        const cleaned = raw
          .replace(/\s+/g, " ")
          .replace(/^["'`]+|["'`]+$/g, "")
          .trim();
        if (!cancelled) {
          const next = cleaned || fallbackRecommendation;
          setAiRecommendation(next);
          try {
            localStorage.setItem(
              AI_RECO_CACHE_KEY,
              JSON.stringify({ text: next, generatedAt: Date.now() }),
            );
          } catch {
            // ignore cache errors
          }
        }
      } catch {
        if (!cancelled) {
          setAiRecommendation(fallbackRecommendation);
        }
      } finally {
        if (!cancelled) setAiRecoBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    profile,
    todayTasks,
    weeklyStats,
    weakTopics,
    deadlines,
    streak,
    reminders.length,
    fallbackRecommendation,
    aiRecoRefreshTick,
  ]);

  const openEditEvent = async (event: StudyEventWithMaterialsRow) => {
    const mats = eventMaterialsMap[event.id] ?? (await listStudyEventMaterials(event.id));
    setEditingEvent({
      id: event.id,
      title: event.title,
      eventType: event.event_type,
      deadlineAt: event.deadline_at,
      notes: event.notes,
      linkedPresentationIds: mats.map((m) => m.id),
    });
    setEventModalOpen(true);
  };

  const handleSubmitEvent = async (payload: {
    id?: string;
    title: string;
    eventType: StudyEventType;
    deadlineAt: string;
    notes: string | null;
    presentationIds: string[];
    reminderOffsetsMinutes: number[];
  }) => {
    setEventModalBusy(true);
    try {
      if (payload.id) {
        await updateStudyEvent(payload.id, {
          title: payload.title,
          eventType: payload.eventType,
          deadlineAt: payload.deadlineAt,
          notes: payload.notes,
          presentationIds: payload.presentationIds,
          reminderOffsetsMinutes: payload.reminderOffsetsMinutes,
        });
      } else {
        await createStudyEvent({
          title: payload.title,
          eventType: payload.eventType,
          deadlineAt: payload.deadlineAt,
          notes: payload.notes,
          presentationIds: payload.presentationIds,
          reminderOffsetsMinutes: payload.reminderOffsetsMinutes,
        });
      }
      setEventModalOpen(false);
      setEditingEvent(null);
      await refresh();
    } finally {
      setEventModalBusy(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    await deleteStudyEvent(id);
    await refresh();
  };

  const nowMs = Date.now();
  const formatDday = (iso: string) => {
    const diff = new Date(iso).getTime() - nowMs;
    const dayMs = 24 * 60 * 60 * 1000;
    if (diff <= 0) return "Termin minął";
    if (diff < dayMs) return `Za ${Math.max(1, Math.round(diff / (60 * 60 * 1000)))}h`;
    return `D-${Math.ceil(diff / dayMs)}`;
  };
  const formatDaysLeft = (iso: string) => {
    const diff = new Date(iso).getTime() - nowMs;
    const dayMs = 24 * 60 * 60 * 1000;
    if (diff <= 0) return "0 dni";
    return `${Math.ceil(diff / dayMs)} dni`;
  };
  const deadlineProgressPercent = (createdAtIso: string, deadlineIso: string) => {
    const created = new Date(createdAtIso).getTime();
    const deadline = new Date(deadlineIso).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(deadline) || deadline <= created) {
      return 100;
    }
    const elapsed = nowMs - created;
    const total = deadline - created;
    const pct = (elapsed / total) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-10 space-y-10">
      <section className="relative overflow-hidden rounded-[24px] bg-surface-container-low border border-outline-variant p-8 md:p-10 shadow-melon">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary-container/25 blur-3xl pointer-events-none" />
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-on-surface relative">
          Cześć{profile ? `, ${profile.displayName}` : ""}!
        </h2>
        <p className="text-on-surface-variant mt-2 relative max-w-2xl">
          {profile
            ? `${profile.university} · ${profile.fieldOfStudy}`
            : "Uzupełnij profil w ustawieniach."}
        </p>
        <p className="text-on-surface-variant mt-4 relative">
          Twoja biblioteka materiałów — wgrywaj prezentacje i wracaj do nauki w
          zakładce Flashcards.
        </p>
      </section>

      <section className="grid lg:grid-cols-3 gap-5">
        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon lg:col-span-2 space-y-3">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Kontynuuj naukę
          </p>
          {continueCard ? (
            <>
              <h3 className="text-xl font-extrabold text-on-surface m-0">{continueCard.title}</h3>
              <p className="text-sm text-on-surface-variant m-0">
                Ostatnia aktywność: {formatDate(continueCard.last_activity_at)}
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Link
                  to={`/app/summary/${continueCard.presentation_id}`}
                  className="bg-primary text-on-primary px-4 py-2 rounded-xl font-bold text-sm"
                >
                  Summary
                </Link>
                <Link
                  to="/app/flashcards"
                  className="bg-surface-container-high text-on-surface px-4 py-2 rounded-xl font-semibold text-sm"
                >
                  Flashcards
                </Link>
                <Link
                  to={`/app/tests/${continueCard.presentation_id}`}
                  className="bg-surface-container-high text-on-surface px-4 py-2 rounded-xl font-semibold text-sm"
                >
                  Test
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-on-surface-variant m-0">
              Brak materiałów — wgraj pierwszy plik, aby rozpocząć naukę.
            </p>
          )}
        </article>

        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon space-y-3">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Szybkie akcje
          </p>
          <div className="grid gap-2">
            <Link to="/app/upload" className="bg-primary text-on-primary px-4 py-2 rounded-xl text-sm font-bold text-center">
              Wgraj materiał
            </Link>
            <Link to="/app/flashcards" className="bg-surface-container-high text-on-surface px-4 py-2 rounded-xl text-sm font-semibold text-center">
              Generuj fiszki
            </Link>
            <Link to="/app/tests" className="bg-surface-container-high text-on-surface px-4 py-2 rounded-xl text-sm font-semibold text-center">
              Rozwiąż test
            </Link>
          </div>
        </article>
      </section>

      <section className="grid md:grid-cols-2 xl:grid-cols-4 gap-5">
        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Dzisiaj do zrobienia
          </p>
          <ul className="mt-3 text-sm text-on-surface space-y-2 pl-4">
            <li>{todayTasks?.recommended_flashcards ?? 20} fiszek do utrwalenia</li>
            <li>{todayTasks?.wrong_questions ?? 0} pytań do poprawy</li>
            <li>{todayTasks?.due_today_count ?? 0} deadline'ów na dziś</li>
            <li>{todayTasks?.overdue_count ?? 0} zaległych wydarzeń</li>
          </ul>
        </article>

        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Postęp tygodnia
          </p>
          <div className="mt-3 space-y-1 text-sm">
            <p className="m-0 text-on-surface">Aktywne dni: <strong>{weeklyStats?.active_days ?? 0}</strong></p>
            <p className="m-0 text-on-surface">Testy: <strong>{weeklyStats?.tests_completed ?? 0}</strong></p>
            <p className="m-0 text-on-surface">Średni wynik: <strong>{weeklyStats?.avg_score_percent ?? 0}%</strong></p>
          </div>
        </article>

        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Streak nauki
          </p>
          <p className="text-3xl font-black text-primary mt-3 mb-1">{streak}</p>
          <p className="text-sm text-on-surface-variant m-0">
            {streak === 1 ? "dzień z rzędu" : "dni z rzędu"}
          </p>
        </article>

        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Przypomnienia
          </p>
          <p className="text-3xl font-black text-primary mt-3 mb-1">{reminders.length}</p>
          <p className="text-sm text-on-surface-variant m-0">
            nowych alertów do deadline'ów
          </p>
        </article>
      </section>

      <section className="grid xl:grid-cols-2 gap-5">
        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
              Nadchodzące deadliny
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingEvent(null);
                setEventModalOpen(true);
              }}
              className="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-bold"
            >
              Dodaj deadline
            </button>
          </div>
          {deadlines.length === 0 ? (
            <p className="text-sm text-on-surface-variant mt-3">
              Brak deadline'ów. Dodaj pierwszy termin i przypnij materiały do nauki.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {deadlines.map((event) => (
                <div key={event.id} className="rounded-xl bg-surface-container p-3 border border-outline-variant/30">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-on-surface m-0">{event.title}</p>
                      <p className="text-xs text-on-surface-variant m-0">
                        {event.event_type} • {formatDate(event.deadline_at)} • {formatDday(event.deadline_at)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void openEditEvent(event)}
                        className="text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface"
                      >
                        Edytuj
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteEvent(event.id)}
                        className="text-xs px-2 py-1 rounded bg-error/15 text-error"
                      >
                        Usuń
                      </button>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-on-surface-variant mb-1">
                      <span>Do deadline'u: {formatDaysLeft(event.deadline_at)}</span>
                      <span>{deadlineProgressPercent(event.created_at, event.deadline_at)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${deadlineProgressPercent(
                            event.created_at,
                            event.deadline_at,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-2 m-0">
                    Materiały: {event.materials_count}
                  </p>
                  {(eventMaterialsMap[event.id] ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(eventMaterialsMap[event.id] ?? []).slice(0, 3).map((m) => (
                        <Link
                          key={m.id}
                          to={`/app/summary/${m.id}`}
                          className="text-[11px] bg-surface-container-high px-2 py-1 rounded-md text-on-surface"
                        >
                          {m.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Ostatnia aktywność
          </p>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-on-surface-variant mt-3">
              Brak aktywności. Rozwiąż pierwszy test lub dodaj nowy materiał.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentActivity.map((row, i) => (
                <div key={`${row.kind}-${i}-${row.created_at}`} className="rounded-xl bg-surface-container p-3">
                  <p className="text-sm font-semibold text-on-surface m-0">{row.title}</p>
                  <p className="text-xs text-on-surface-variant m-0">{row.meta}</p>
                  <p className="text-[11px] text-on-surface-variant mt-1 m-0">{formatDate(row.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="grid xl:grid-cols-2 gap-5">
        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
            Słabe obszary
          </p>
          {weakTopics.length === 0 ? (
            <p className="text-sm text-on-surface-variant mt-3">
              Brak danych o błędach. Po pierwszych testach pokażemy obszary do poprawy.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {weakTopics.map((topic) => (
                <div key={topic.presentation_id} className="rounded-xl bg-surface-container p-3">
                  <p className="text-sm font-semibold text-on-surface m-0">{topic.title}</p>
                  <p className="text-xs text-on-surface-variant m-0">
                    Błędne: {topic.wrong_count}/{topic.total_count} ({Math.round(topic.wrong_ratio * 100)}%)
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
              Rekomendacja AI dnia
            </p>
            {devToolsEnabled && (
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem(AI_RECO_CACHE_KEY);
                  } catch {
                    // ignore
                  }
                  setAiRecoRefreshTick((v) => v + 1);
                }}
                className="text-[11px] px-2 py-1 rounded-lg bg-surface-container-high text-on-surface font-semibold"
              >
                DEV: odśwież
              </button>
            )}
          </div>
          <p className="text-sm text-on-surface mt-3 mb-0">
            {aiRecoBusy ? "Analizuję Twoje postępy i układam rekomendację..." : aiRecommendation}
          </p>
        </article>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2 m-0">
              <span className="material-symbols-outlined text-secondary">folder_special</span>
              Moja biblioteka
            </h3>
            <button
              type="button"
              onClick={() => setCreateFolderOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-lg">create_new_folder</span>
              Nowy folder
            </button>
          </div>
          <p className="text-sm text-on-surface-variant m-0">
            Najpierw widzisz siatkę folderów. W środku każdego folderu jest siatka
            plików z ikoną, nazwą i datą utworzenia.
          </p>
          {folders.length === 0 && items.length === 0 ? (
            <p className="text-sm text-on-surface-variant m-0">
              Utwórz folder z nazwą przedmiotu i kolorem, potem wybierz go przy wgrywaniu pliku.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end">
          <Link to="/app/upload" className="text-sm font-bold text-primary hover:underline">
            + Dodaj plik
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="rounded-[24px] bg-surface-container-low border border-outline-variant p-10 text-center text-on-surface-variant">
            Brak plików.{" "}
            <Link to="/app/upload" className="text-primary font-semibold">
              Wgraj PDF lub PPTX
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {folderBuckets.map((bucket) => (
              <div
                key={bucket.id ?? "__no_folder__"}
                className="folder-card rounded-[24px] bg-surface-container-low border border-outline-variant p-5 shadow-melon"
                style={{ ["--folder-glow" as string]: bucket.color }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: bucket.color }}
                  />
                  <p className="font-bold text-on-surface text-lg m-0">{bucket.name}</p>
                  <span className="text-xs text-on-surface-variant">
                    ({bucket.items.length})
                  </span>
                </div>
                {bucket.items.length === 0 ? (
                  <div className="rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">
                    Brak plików w tym folderze.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {bucket.items.map((p) => (
                      <Link
                        key={p.id}
                        to={`/app/summary/${p.id}`}
                        className="rounded-2xl bg-surface-container-low p-3 hover:bg-surface-container transition"
                      >
                        <div className="flex justify-center mb-2">
                          <span className="material-symbols-outlined text-primary text-[32px]">
                            {sourceIcon(p.source_kind)}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-on-surface m-0 line-clamp-2 text-center">
                          {p.title}
                        </p>
                        <p className="text-[11px] text-on-surface-variant m-0 mt-1 text-center">
                          {formatDate(p.created_at)}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <CreateFolderModal
        open={createFolderOpen}
        onClose={() => setCreateFolderOpen(false)}
        onCreated={() => {
          void refresh();
        }}
      />
      <CreateStudyEventModal
        open={eventModalOpen}
        busy={eventModalBusy}
        items={items}
        initial={editingEvent}
        onClose={() => {
          if (eventModalBusy) return;
          setEventModalOpen(false);
          setEditingEvent(null);
        }}
        onSubmit={handleSubmitEvent}
      />
    </div>
  );
}
