import { useEffect, useMemo, useState } from "react";
import type { PresentationListRow, StudyEventType } from "../lib/db";

type Props = {
  open: boolean;
  busy?: boolean;
  items: PresentationListRow[];
  initial?: {
    id: string;
    title: string;
    eventType: StudyEventType;
    deadlineAt: string;
    notes: string | null;
    linkedPresentationIds: string[];
  } | null;
  onClose: () => void;
  onSubmit: (payload: {
    id?: string;
    title: string;
    eventType: StudyEventType;
    deadlineAt: string;
    notes: string | null;
    presentationIds: string[];
    reminderOffsetsMinutes: number[];
  }) => Promise<void>;
};

const typeOptions: { value: StudyEventType; label: string }[] = [
  { value: "kolokwium", label: "Kolokwium" },
  { value: "wejsciowka", label: "Wejściówka" },
  { value: "egzamin", label: "Egzamin" },
  { value: "projekt", label: "Projekt" },
];

const reminderOptions = [
  { value: 10080, label: "7 dni przed" },
  { value: 1440, label: "1 dzień przed" },
  { value: 120, label: "2 godziny przed" },
];

function toInputDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromInputDateTime(value: string): string {
  return new Date(value).toISOString();
}

function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayLocalYmd(): string {
  return toLocalYmd(new Date());
}

function formatDateLabel(value: string): string {
  if (!value) return "Wybierz datę";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Wybierz datę";
  return d.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(yyyyMmDd: string, delta: number): string {
  const base = yyyyMmDd ? new Date(`${yyyyMmDd}T00:00:00`) : new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + delta);
  return toLocalYmd(base);
}

function buildCalendarDays(yyyyMmDd: string): string[] {
  const base = yyyyMmDd ? new Date(`${yyyyMmDd}T00:00:00`) : new Date();
  const y = base.getFullYear();
  const m = base.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const out: string[] = [];
  for (let i = 0; i < startWeekday; i += 1) out.push("");
  for (let day = 1; day <= daysInMonth; day += 1) {
    out.push(toLocalYmd(new Date(y, m, day)));
  }
  return out;
}

export function CreateStudyEventModal({
  open,
  busy = false,
  items,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<StudyEventType>("kolokwium");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("09:00");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(todayLocalYmd());
  const [notes, setNotes] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedReminders, setSelectedReminders] = useState<number[]>([10080, 1440, 120]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setEventType(initial.eventType);
      const dateTime = toInputDateTime(initial.deadlineAt);
      setDeadlineDate(dateTime.slice(0, 10));
      setDeadlineTime(dateTime.slice(11, 16) || "09:00");
      setCalendarCursor(dateTime.slice(0, 10) || todayLocalYmd());
      setNotes(initial.notes ?? "");
      setSelectedIds(initial.linkedPresentationIds);
    } else {
      setTitle("");
      setEventType("kolokwium");
      setDeadlineDate("");
      setDeadlineTime("09:00");
      setCalendarCursor(todayLocalYmd());
      setNotes("");
      setSelectedIds([]);
    }
    setSelectedReminders([10080, 1440, 120]);
    setCalendarOpen(false);
    setError(null);
  }, [open, initial]);

  const grouped = useMemo(() => {
    const map = new Map<string, PresentationListRow[]>();
    for (const item of items) {
      const key = item.folder_name ?? "Bez folderu";
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [items]);
  const calendarDays = useMemo(
    () => buildCalendarDays(calendarCursor),
    [calendarCursor],
  );
  const monthTitle = useMemo(() => {
    const d = new Date(`${calendarCursor}T00:00:00`);
    return d.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  }, [calendarCursor]);

  if (!open) return null;

  const togglePresentation = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleReminder = (value: number) => {
    setSelectedReminders((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
    );
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Podaj tytuł wydarzenia.");
      return;
    }
    if (!deadlineDate) {
      setError("Wybierz termin wydarzenia.");
      return;
    }
    const dateTimeRaw = `${deadlineDate}T${deadlineTime || "09:00"}`;
    setError(null);
    await onSubmit({
      id: initial?.id,
      title: trimmed,
      eventType,
      deadlineAt: fromInputDateTime(dateTimeRaw),
      notes: notes.trim() ? notes.trim() : null,
      presentationIds: selectedIds,
      reminderOffsetsMinutes: selectedReminders.length > 0 ? selectedReminders : [1440],
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-[24px] bg-surface-container-low border border-outline-variant p-6 md:p-8 shadow-melonLg max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-extrabold text-on-surface m-0">
          {initial ? "Edytuj deadline" : "Nowy deadline"}
        </h2>
        <p className="text-sm text-on-surface-variant mt-2 mb-6">
          Dodaj wydarzenie i przypnij materiały, z których chcesz się uczyć.
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Tytuł
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="np. Kolokwium z układu oddechowego"
              className="rounded-xl bg-surface-container-high border border-outline-variant/40 px-4 py-3 normal-case text-on-surface"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Typ
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as StudyEventType)}
              className="rounded-xl bg-surface-container-high border border-outline-variant/40 px-4 py-3 normal-case text-on-surface"
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Termin
            <div className="relative">
              <button
                type="button"
                onClick={() => setCalendarOpen((v) => !v)}
                className="w-full rounded-xl bg-surface-container-high border border-outline-variant/40 px-4 py-3 normal-case text-on-surface text-left flex items-center justify-between"
              >
                <span>{formatDateLabel(deadlineDate)}</span>
                <span className="material-symbols-outlined text-base">calendar_month</span>
              </button>
              {calendarOpen && (
                <div className="absolute z-30 mt-2 w-full rounded-xl border border-outline-variant bg-surface-container p-3 shadow-melon">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => setCalendarCursor((v) => shiftMonth(v, -1))}
                      className="h-8 w-8 rounded-lg bg-surface-container-high text-on-surface"
                    >
                      <span className="material-symbols-outlined text-sm">chevron_left</span>
                    </button>
                    <p className="text-sm font-bold normal-case m-0">{monthTitle}</p>
                    <button
                      type="button"
                      onClick={() => setCalendarCursor((v) => shiftMonth(v, 1))}
                      className="h-8 w-8 rounded-lg bg-surface-container-high text-on-surface"
                    >
                      <span className="material-symbols-outlined text-sm">chevron_right</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-[11px] text-on-surface-variant normal-case mb-1">
                    {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((d) => (
                      <span key={d} className="text-center py-1">
                        {d}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((date, i) =>
                      date ? (
                        <button
                          key={date}
                          type="button"
                          onClick={() => {
                            setDeadlineDate(date);
                            setCalendarOpen(false);
                          }}
                          className={`h-8 rounded-md text-xs normal-case ${
                            deadlineDate === date
                              ? "bg-primary text-on-primary font-bold"
                              : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
                          }`}
                        >
                          {new Date(`${date}T00:00:00`).getDate()}
                        </button>
                      ) : (
                        <span key={`blank-${i}`} className="h-8" />
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          </label>
          <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Godzina
            <input
              type="time"
              value={deadlineTime}
              onChange={(e) => setDeadlineTime(e.target.value)}
              className="rounded-xl bg-surface-container-high border border-outline-variant/40 px-4 py-3 normal-case text-on-surface"
            />
          </label>
          <p className="text-xs text-on-surface-variant m-0 md:col-span-2">Kliknij Termin, aby otworzyć kalendarz.</p>
          <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant md:col-span-2">
            Notatka (opcjonalnie)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-xl bg-surface-container-high border border-outline-variant/40 px-4 py-3 normal-case text-on-surface resize-y"
            />
          </label>
        </div>

        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
            Przypomnienia
          </p>
          <div className="flex flex-wrap gap-2">
            {reminderOptions.map((r) => {
              const active = selectedReminders.includes(r.value);
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => toggleReminder(r.value)}
                  className={
                    active
                      ? "px-3 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold"
                      : "px-3 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-semibold"
                  }
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
            Materiały do nauki
          </p>
          {grouped.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Brak materiałów do przypięcia.</p>
          ) : (
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {grouped.map(([groupName, groupItems]) => (
                <div key={groupName} className="rounded-xl bg-surface-container p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant m-0 mb-2">
                    {groupName}
                  </p>
                  <div className="space-y-2">
                    {groupItems.map((item) => (
                      <label key={item.id} className="flex items-center gap-3 text-sm text-on-surface">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => togglePresentation(item.id)}
                        />
                        <span>{item.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-error mt-4 bg-error/10 rounded-xl px-4 py-2 border border-error/30">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-6 py-3 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-high"
          >
            Anuluj
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="bg-primary text-on-primary font-bold px-8 py-3 rounded-xl disabled:opacity-50"
          >
            {busy ? "Zapisywanie…" : initial ? "Zapisz zmiany" : "Dodaj deadline"}
          </button>
        </div>
      </div>
    </div>
  );
}
