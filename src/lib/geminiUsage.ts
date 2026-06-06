import {
  getGeminiChatModelId,
  getGeminiChatModelInfo,
  getGeminiDailyRequestLimit,
  migrateGeminiModelId,
} from "./geminiModels";

const KEY = "edumelon_gemini_usage";
export const GEMINI_USAGE_UPDATED_EVENT = "gemini-usage-updated";

export type GeminiModelUsage = {
  requestsToday: number;
  tokensThisMinute: number;
  minuteWindowStart: number;
};

export type GeminiUsageStore = {
  dateKey: string;
  byModel: Record<string, GeminiModelUsage>;
};

/** @deprecated Stary format — migrowany przy odczycie. */
type LegacyUsageSnapshot = {
  requestsToday?: number;
  tokensThisMinute?: number;
  dateKey?: string;
  minuteWindowStart?: number;
};

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyModelUsage(): GeminiModelUsage {
  return {
    requestsToday: 0,
    tokensThisMinute: 0,
    minuteWindowStart: Date.now(),
  };
}

function emptyStore(): GeminiUsageStore {
  return { dateKey: todayKey(), byModel: {} };
}

function normalizeModelUsage(usage: GeminiModelUsage, today: string, storeDateKey: string): GeminiModelUsage {
  let next = { ...usage };
  if (storeDateKey !== today) {
    next = { ...emptyModelUsage() };
  } else if (Date.now() - next.minuteWindowStart >= 60_000) {
    next = { ...next, minuteWindowStart: Date.now(), tokensThisMinute: 0 };
  }
  return next;
}

function migrateLegacyRaw(parsed: LegacyUsageSnapshot): GeminiUsageStore {
  const today = todayKey();
  const store = emptyStore();
  if (
    typeof parsed.requestsToday === "number" &&
    parsed.requestsToday > 0 &&
    parsed.dateKey === today
  ) {
    const modelId = getGeminiChatModelId();
    store.byModel[modelId] = {
      requestsToday: parsed.requestsToday,
      tokensThisMinute: Number(parsed.tokensThisMinute) || 0,
      minuteWindowStart:
        typeof parsed.minuteWindowStart === "number"
          ? parsed.minuteWindowStart
          : Date.now(),
    };
  }
  return store;
}

function readRawStore(): GeminiUsageStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as LegacyUsageSnapshot & Partial<GeminiUsageStore>;
    if (parsed.byModel && typeof parsed.byModel === "object") {
      return {
        dateKey: typeof parsed.dateKey === "string" ? parsed.dateKey : todayKey(),
        byModel: parsed.byModel as Record<string, GeminiModelUsage>,
      };
    }
    return migrateLegacyRaw(parsed);
  } catch {
    return emptyStore();
  }
}

function normalizeStore(store: GeminiUsageStore): GeminiUsageStore {
  const today = todayKey();
  let changed = store.dateKey !== today;

  const byModel: Record<string, GeminiModelUsage> = {};
  for (const [modelId, usage] of Object.entries(store.byModel)) {
    const normalized = normalizeModelUsage(usage, today, store.dateKey);
    if (
      normalized.requestsToday !== usage.requestsToday ||
      normalized.tokensThisMinute !== usage.tokensThisMinute ||
      normalized.minuteWindowStart !== usage.minuteWindowStart
    ) {
      changed = true;
    }
    if (normalized.requestsToday > 0 || normalized.tokensThisMinute > 0) {
      byModel[modelId] = normalized;
    }
  }

  const next: GeminiUsageStore = {
    dateKey: today,
    byModel,
  };

  if (changed || store.dateKey !== today) {
    writeRawStore(next);
  }
  return next;
}

function writeRawStore(store: GeminiUsageStore): void {
  localStorage.setItem(KEY, JSON.stringify(store));
  scheduleUsageUpdatedEvent();
}

let usageNotifyTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleUsageUpdatedEvent(): void {
  if (usageNotifyTimer !== null) return;
  usageNotifyTimer = setTimeout(() => {
    usageNotifyTimer = null;
    window.dispatchEvent(new Event(GEMINI_USAGE_UPDATED_EVENT));
  }, 300);
}

function peekStore(): GeminiUsageStore {
  const raw = readRawStore();
  const today = todayKey();
  const byModel: Record<string, GeminiModelUsage> = {};
  for (const [modelId, usage] of Object.entries(raw.byModel)) {
    byModel[modelId] = normalizeModelUsage(usage, today, raw.dateKey);
  }
  return { dateKey: today, byModel };
}

export function getGeminiModelUsage(modelId: string): GeminiModelUsage {
  const id = migrateGeminiModelId(modelId);
  const store = peekStore();
  return store.byModel[id] ?? emptyModelUsage();
}

export function recordGeminiUsage(opts: {
  modelId: string;
  tokens?: number;
}): GeminiModelUsage {
  const modelId = migrateGeminiModelId(opts.modelId);
  const store = normalizeStore(readRawStore());
  const current = store.byModel[modelId] ?? emptyModelUsage();
  const updated: GeminiModelUsage = {
    ...current,
    requestsToday: current.requestsToday + 1,
    tokensThisMinute: current.tokensThisMinute + (opts.tokens ?? 0),
  };
  const next: GeminiUsageStore = {
    ...store,
    byModel: { ...store.byModel, [modelId]: updated },
  };
  writeRawStore(next);
  return updated;
}

export type GeminiModelUsageStats = {
  modelId: string;
  label: string;
  requestsToday: number;
  limit: number;
  requestsDayPercent: number;
};

export function getGeminiUsagePercents(modelId?: string): GeminiModelUsageStats {
  const id = migrateGeminiModelId(modelId ?? getGeminiChatModelId());
  const usage = getGeminiModelUsage(id);
  const limit = getGeminiDailyRequestLimit(id);
  const requestsDayPercent = Math.min(
    100,
    limit > 0 ? Math.round((usage.requestsToday / limit) * 100) : 0,
  );
  return {
    modelId: id,
    label: getGeminiChatModelInfo(id)?.label ?? id,
    requestsToday: usage.requestsToday,
    limit,
    requestsDayPercent,
  };
}

/** Modele z co najmniej jednym zapytaniem dziś (do panelu zużycia). */
export function getGeminiUsageTodayByModel(): GeminiModelUsageStats[] {
  const store = peekStore();
  return Object.keys(store.byModel)
    .map((modelId) => getGeminiUsagePercents(modelId))
    .filter((s) => s.requestsToday > 0)
    .sort((a, b) => b.requestsToday - a.requestsToday);
}

export function getGeminiUsageTone(
  percent: number,
): "neutral" | "warning" | "danger" {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "neutral";
}

/** @deprecated Użyj getGeminiModelUsage — zachowane dla kompatybilności. */
export function peekGeminiUsage(): {
  requestsToday: number;
  tokensThisMinute: number;
  dateKey: string;
  minuteWindowStart: number;
} {
  const id = getGeminiChatModelId();
  const u = getGeminiModelUsage(id);
  return {
    requestsToday: u.requestsToday,
    tokensThisMinute: u.tokensThisMinute,
    dateKey: peekStore().dateKey,
    minuteWindowStart: u.minuteWindowStart,
  };
}
