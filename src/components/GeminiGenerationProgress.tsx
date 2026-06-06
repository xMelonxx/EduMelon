import type { AiGenerationProgress } from "../lib/geminiProgress";

type Props = {
  progress: AiGenerationProgress;
  elapsedSec: number;
  /** Opcjonalna wskazówka pod paskiem (np. o podziale materiału) */
  hint?: string;
  title?: string;
};

export function GeminiGenerationProgress({
  progress,
  elapsedSec,
  hint,
  title = "Generowanie",
}: Props) {
  const { label, percent, stepIndex, steps, indeterminate, detail } = progress;
  const showChecklist = steps && steps.length > 0 && stepIndex !== undefined;

  return (
    <div
      className="rounded-3xl border border-primary/25 bg-surface-container-low/90 p-4 md:p-5 shadow-inner space-y-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-on-surface font-semibold leading-snug m-0">{title}</p>
        <span className="tabular-nums text-on-surface-variant font-medium">
          {elapsedSec}s
        </span>
      </div>

      {showChecklist && (
        <ol className="grid gap-1.5 sm:grid-cols-2 m-0 p-0 list-none">
          {steps.map((step, i) => {
            const done = i < stepIndex!;
            const active = i === stepIndex;
            return (
              <li
                key={step}
                className={`flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 ${
                  active
                    ? "bg-primary/10 text-primary font-semibold"
                    : done
                      ? "text-on-surface-variant"
                      : "text-on-surface-variant/60"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-base shrink-0 ${
                    done ? "text-primary" : active ? "text-primary animate-pulse" : ""
                  }`}
                  aria-hidden
                >
                  {done ? "check_circle" : active ? "progress_activity" : "radio_button_unchecked"}
                </span>
                <span>{step}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-on-surface font-medium leading-snug m-0">{label}</p>
          {!indeterminate && (
            <span className="tabular-nums text-on-surface-variant text-xs font-semibold">
              {Math.min(100, Math.max(0, percent))}%
            </span>
          )}
        </div>
        <div className="h-2.5 w-full rounded-full bg-surface-container-high overflow-hidden relative">
          {indeterminate ? (
            <div
              className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-secondary to-primary animate-[gemini-wait_1.8s_ease-in-out_infinite]"
              style={{ left: 0 }}
            />
          ) : (
            <div
              className="h-full rounded-full bg-gradient-to-r from-secondary to-primary transition-[width] duration-300 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, percent))}%`,
              }}
            />
          )}
        </div>
        {(detail || hint) && (
          <p className="text-xs text-on-surface-variant m-0 leading-relaxed">
            {detail ?? hint}
          </p>
        )}
      </div>
    </div>
  );
}
