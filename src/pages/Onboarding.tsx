import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OllamaModelsFolderSection } from "../components/OllamaModelsFolderSection";
import {
  EMBEDDING_MODEL,
  MODEL_PROFILES,
  type ModelProfileId,
} from "../lib/constants";
import { ensureOllamaRunning } from "../lib/ollamaAutostart";
import { ollamaPull, ollamaTagsReachable } from "../lib/ollama";
import { saveUsageStatsToSupabase } from "../lib/supabase";
import {
  getOrCreateInstallId,
  getUsageStatsConsent,
  saveLocalProfile,
  setOllamaModelsDir,
  setOnboardingDone,
  setUsageStatsConsent,
  type LocalProfile,
} from "../lib/storage";

const STEPS = [
  "Ollama",
  "Jak się do Ciebie zwracać",
  "Uczelnia",
  "Kierunek",
  "Folder modeli",
  "Wybór modelu",
  "Gotowe",
] as const;

const OLLAMA_WIN = "https://ollama.com/download/windows";
const OTHER_FIELD_VALUE = "__other__";
const TERMS_VERSION = "2026-04-16";

const POPULAR_FIELDS_OF_STUDY = [
  "Psychologia",
  "Kierunek lekarski (medycyna)",
  "Zarządzanie",
  "Prawo",
  "Informatyka",
  "Pielęgniarstwo",
  "Fizjoterapia",
  "Ekonomia",
  "Finanse i rachunkowość",
  "Budownictwo",
  "Logistyka",
  "Filologia angielska",
  "Mechanika i budowa maszyn",
  "Biotechnologia",
  "Stosunki międzynarodowe",
  "Administracja",
  "Marketing i zarządzanie",
  "Zarządzanie i inżynieria produkcji",
  "Automatyka i robotyka",
  "Cyberbezpieczeństwo",
  "Data Science / analiza danych",
  "Sztuczna inteligencja (AI)",
  "Architektura",
  "Dietetyka",
  "Geodezja i kartografia",
  "Elektrotechnika",
  "Inżynieria środowiska",
  "Inżynieria biomedyczna",
  "Mechatronika",
  "Transport i logistyka (inżynierska)",
  "Energetyka",
  "Lotnictwo i kosmonautyka",
  "Pedagogika",
  "Socjologia",
  "Dziennikarstwo i komunikacja społeczna",
  "Filologia (inne języki)",
  "Historia",
  "Politologia",
  "Game development / tworzenie gier",
  "Zielone technologie / ochrona środowiska",
] as const;

const inputClass =
  "rounded-2xl bg-surface-container-high border-0 px-4 py-3 font-sans font-medium text-on-surface w-full max-w-md";

type PullStage = "chat" | "embedding";

type PullProgress = {
  stage: PullStage;
  status: string;
  completed: number;
  total: number;
  percent: number | null;
};

type SystemSpecs = {
  total_ram_gb: number;
  cpu_threads: number;
  gpu_names: string[];
};

type OllamaDiagnosis = {
  ok: boolean;
  code: string;
  message: string;
  suggestion: string;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function recommendedProfileForSpecs(
  specs: SystemSpecs | null,
): { profile: ModelProfileId; reason: string } {
  if (!specs) {
    return {
      profile: "e2b-it",
      reason: "Nie udało się wykryć parametrów — bezpieczny wybór to lżejszy model.",
    };
  }
  const gpuText = (specs.gpu_names ?? []).join(" ").toLowerCase();
  const hasStrongerGpu =
    gpuText.includes("nvidia") ||
    gpuText.includes("geforce") ||
    gpuText.includes("rtx") ||
    gpuText.includes("quadro") ||
    gpuText.includes("radeon") ||
    gpuText.includes("rx ") ||
    gpuText.includes("arc");
  if (specs.total_ram_gb >= 16 && hasStrongerGpu) {
    return {
      profile: "e4b-it",
      reason: `Wykryto ${specs.total_ram_gb.toFixed(1)} GB RAM i wydajniejszą kartę graficzną — rekomendujemy mocniejszy model.`,
    };
  }
  if (specs.total_ram_gb >= 16) {
    return {
      profile: "e4b-it",
      reason: `Wykryto ${specs.total_ram_gb.toFixed(1)} GB RAM — możesz użyć mocniejszego modelu, ale GPU może wpływać na płynność.`,
    };
  }
  if (specs.total_ram_gb < 8) {
    return {
      profile: "e2b-it",
      reason: `Wykryto ${specs.total_ram_gb.toFixed(1)} GB RAM — lepszy będzie lżejszy model.`,
    };
  }
  return {
    profile: "e2b-it",
    reason: `Wykryto ${specs.total_ram_gb.toFixed(1)} GB RAM — rekomendujemy model E2B.`,
  };
}

function parsePullProgress(
  line: string,
  stage: PullStage,
): PullProgress | null {
  try {
    const parsed = JSON.parse(line) as {
      status?: string;
      completed?: number;
      total?: number;
    };
    const status = parsed.status?.trim() || "Pobieranie modelu…";
    const completed =
      typeof parsed.completed === "number" ? parsed.completed : 0;
    const total = typeof parsed.total === "number" ? parsed.total : 0;
    const percent =
      total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : null;
    return { stage, status, completed, total, percent };
  } catch {
    return { stage, status: line.trim(), completed: 0, total: 0, percent: null };
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [ollamaDiag, setOllamaDiag] = useState<OllamaDiagnosis | null>(null);
  const [name, setName] = useState("");
  const [uni, setUni] = useState("");
  const [selectedField, setSelectedField] = useState("");
  const [customField, setCustomField] = useState("");
  const [modelsDir, setModelsDir] = useState<string | null>(null);
  const [profile, setProfile] = useState<ModelProfileId>("e2b-it");
  const [profileTouched, setProfileTouched] = useState(false);
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);
  const [usageConsent, setUsageConsent] = useState(getUsageStatsConsent);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pullLog, setPullLog] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedField =
    selectedField === OTHER_FIELD_VALUE ? customField.trim() : selectedField.trim();

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  useEffect(() => {
    if (step !== 0) return;
    let cancelled = false;
    void (async () => {
      setOllamaChecking(true);
      try {
        const ok = await ensureOllamaRunning();
        if (!cancelled) {
          setOllamaOk(ok);
          setOllamaDiag(null);
        }
        if (!ok && isTauri()) {
          try {
            const diagnosis = await invoke<OllamaDiagnosis>("diagnose_ollama");
            if (!cancelled) {
              setOllamaDiag(diagnosis);
              setOllamaOk(diagnosis.ok);
            }
          } catch {
            // Keep fallback status from ensureOllamaRunning.
          }
        }
      } finally {
        if (!cancelled) setOllamaChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await invoke<SystemSpecs>("get_system_specs");
        if (!cancelled) setSpecs(s);
      } catch {
        if (!cancelled) setSpecs(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (profileTouched) return;
    const recommendation = recommendedProfileForSpecs(specs).profile;
    setProfile(recommendation);
  }, [specs, profileTouched]);

  const recheckOllama = async () => {
    setOllamaChecking(true);
    try {
      const ok = await ollamaTagsReachable();
      setOllamaOk(ok);
      setOllamaDiag(null);
    } finally {
      setOllamaChecking(false);
    }
  };

  const repairAndRecheckOllama = async () => {
    setOllamaChecking(true);
    setOllamaDiag(null);
    try {
      if (!isTauri()) {
        const ok = await ollamaTagsReachable();
        setOllamaOk(ok);
        if (!ok) {
          setOllamaDiag({
            ok: false,
            code: "not_tauri",
            message: "Tryb web: brak dostępu do diagnostyki systemowej.",
            suggestion: "Uruchom aplikację desktop, aby skorzystać z auto-naprawy.",
          });
        }
        return;
      }
      const diagnosis = await invoke<OllamaDiagnosis>("diagnose_ollama");
      setOllamaDiag(diagnosis);
      setOllamaOk(diagnosis.ok);
    } catch (e) {
      setOllamaOk(false);
      setOllamaDiag({
        ok: false,
        code: "diagnose_failed",
        message: "Nie udało się uruchomić diagnostyki Ollamy.",
        suggestion: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setOllamaChecking(false);
    }
  };

  const canContinue = (): boolean => {
    if (step === 0) return ollamaOk === true;
    if (step === 1) return name.trim().length > 1;
    if (step === 2) return uni.trim().length > 1;
    if (step === 3) return resolvedField.length > 1;
    if (step === 4) return true;
    return true;
  };

  const goNext = () => {
    if (!canContinue()) return;
    if (step === 4) {
      setOllamaModelsDir(modelsDir);
    }
    next();
  };

  const finish = async () => {
    const local: LocalProfile = {
      displayName: name.trim(),
      university: uni.trim(),
      fieldOfStudy: resolvedField,
      modelProfile: profile,
    };
    saveLocalProfile(local);
    setOllamaModelsDir(modelsDir);
    setUsageStatsConsent(usageConsent);
    if (usageConsent) {
      const res = await saveUsageStatsToSupabase({
        install_id: getOrCreateInstallId(),
        field_of_study: local.fieldOfStudy,
        model_profile: local.modelProfile,
      });
      if (!res.ok) {
        console.warn("Supabase usage_stats (onboarding):", res.error);
      }
    }
    setOnboardingDone();
    navigate("/app/dashboard", { replace: true });
  };

  const pullModels = async () => {
    setPulling(true);
    setError(null);
    setPullLog([]);
    setPullProgress({
      stage: "chat",
      status: "Przygotowanie pobierania…",
      completed: 0,
      total: 0,
      percent: null,
    });
    try {
      const tag = MODEL_PROFILES[profile].ollamaTag;
      await ollamaPull(tag, (line) => {
        setPullLog((prev) => [...prev.slice(-40), line]);
        setPullProgress(
          parsePullProgress(line, "chat") ?? {
            stage: "chat",
            status: "Pobieranie modelu czatu…",
            completed: 0,
            total: 0,
            percent: null,
          },
        );
      });
      setPullProgress({
        stage: "embedding",
        status: "Model czatu gotowy. Start pobierania embeddingów…",
        completed: 0,
        total: 0,
        percent: 0,
      });
      await ollamaPull(EMBEDDING_MODEL, (line) => {
        setPullLog((prev) => [...prev.slice(-40), line]);
        setPullProgress(
          parsePullProgress(line, "embedding") ?? {
            stage: "embedding",
            status: "Pobieranie modelu embeddingów…",
            completed: 0,
            total: 0,
            percent: null,
          },
        );
      });
      setPullProgress({
        stage: "embedding",
        status: "Modele pobrane pomyślnie.",
        completed: 1,
        total: 1,
        percent: 100,
      });
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4 md:p-8 bg-surface">
      <div className="w-full max-w-lg rounded-3xl bg-surface-container-lowest p-8 shadow-melon space-y-6">
        <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant m-0">
          Krok {step + 1} z {STEPS.length}: {STEPS[step]}
        </p>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-on-surface font-semibold m-0">
              EduMelon potrzebuje lokalnej Ollamy,
            </p>
            <div className="rounded-xl bg-surface-container-high px-4 py-3 text-xs text-on-surface-variant space-y-1">
              <p className="m-0 font-semibold text-on-surface">
                Instrukcja instalacji Ollamy (krok po kroku)
              </p>
              <p className="m-0">1) Kliknij „Pobierz Ollama”.</p>
              <p className="m-0">2) Uruchom pobrany instalator i zakończ instalację.</p>
              <p className="m-0">
                3) Otwórz Ollamę z menu Start (uruchomi się w tle).
              </p>
              <p className="m-0">
                4) Odczekaj 10-15 sekund, aż wystartuje lokalne API (`127.0.0.1:11434`).
              </p>
              <p className="m-0">
                5) Wróć do EduMelon i kliknij „Sprawdź ponownie”.
              </p>
              <p className="m-0">
                6) Jeśli dalej nie działa, kliknij „Napraw i sprawdź ponownie”.
              </p>
            </div>
            <div className="rounded-2xl bg-surface-container-high px-4 py-4 space-y-2">
              <p className="text-sm text-on-surface-variant m-0">
                Status:{" "}
                <span className="font-bold text-on-surface">
                  {ollamaChecking
                    ? "sprawdzam…"
                    : ollamaOk === null
                      ? "—"
                      : ollamaOk
                        ? "działa (localhost:11434)"
                        : "nie działa"}
                </span>
              </p>
              {!ollamaOk && (
                <>
                  <p className="text-xs text-on-surface-variant m-0">
                    Jeśli Ollama nie jest zainstalowana, pobierz ją. Jeśli jest
                    zainstalowana, uruchom (albo pozwól aplikacji spróbować ją
                    wystartować) i kliknij „Sprawdź ponownie”.
                  </p>
                  {ollamaDiag && (
                    <div className="rounded-xl bg-surface px-3 py-2 text-xs text-on-surface-variant space-y-1">
                      <p className="m-0 font-semibold text-on-surface">
                        Diagnostyka: {ollamaDiag.message}
                      </p>
                      <p className="m-0">{ollamaDiag.suggestion}</p>
                    </div>
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => openUrl(OLLAMA_WIN)}
                  className="bg-secondary-container text-on-secondary-container font-bold px-6 py-3 rounded-full"
                >
                  Pobierz Ollama
                </button>
                <button
                  type="button"
                  disabled={ollamaChecking}
                  onClick={() => void recheckOllama()}
                  className="melon-gradient text-white font-bold px-6 py-3 rounded-full shadow-melon disabled:opacity-50"
                >
                  {ollamaChecking ? "Sprawdzam…" : "Sprawdź ponownie"}
                </button>
                <button
                  type="button"
                  disabled={ollamaChecking}
                  onClick={() => void repairAndRecheckOllama()}
                  className="bg-surface text-on-surface font-bold px-6 py-3 rounded-full border border-outline/40 disabled:opacity-50"
                >
                  {ollamaChecking ? "Naprawiam…" : "Napraw i sprawdź ponownie"}
                </button>
              </div>
              {!ollamaOk && (
                <p className="text-[11px] text-on-surface-variant m-0 pt-1">
                  FAQ: 1) po instalacji zamknij i otwórz aplikację, 2) sprawdź czy
                  `ollama serve` działa, 3) upewnij się, że port 11434 nie jest zajęty.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface-variant">
            Jak się do Ciebie zwracać?
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Jan / Janku / Dr Kowalski"
              className={inputClass}
              autoFocus
            />
          </label>
        )}

        {step === 2 && (
          <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface-variant">
            Uczelnia
            <input
              value={uni}
              onChange={(e) => setUni(e.target.value)}
              placeholder="Politechnika …"
              className={inputClass}
              autoFocus
            />
          </label>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface-variant">
              Kierunek studiów
              <select
                value={selectedField}
                onChange={(e) => setSelectedField(e.target.value)}
                className={inputClass}
                autoFocus
              >
                <option value="" disabled>
                  Wybierz kierunek…
                </option>
                {POPULAR_FIELDS_OF_STUDY.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                <option value={OTHER_FIELD_VALUE}>Inne (wpisz własny)</option>
              </select>
            </label>
            {selectedField === OTHER_FIELD_VALUE && (
              <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface-variant">
                Wpisz swój kierunek
                <input
                  value={customField}
                  onChange={(e) => setCustomField(e.target.value)}
                  placeholder="Np. Analityka biznesowa"
                  className={inputClass}
                />
              </label>
            )}
            <div className="rounded-2xl bg-surface-container-high px-4 py-3 text-xs text-on-surface-variant space-y-1">
              <p className="m-0 font-semibold text-on-surface">Informacja o danych</p>
              <p className="m-0">
                Opcjonalnie możemy wysłać anonimowe statystyki użycia, żeby wiedzieć
                ile osób korzysta z aplikacji i z jakich kierunków.
              </p>
              <p className="m-0">
                Zakres: <code>install_id</code> (losowy identyfikator instalacji),{" "}
                <code>field_of_study</code>, <code>model_profile</code>,{" "}
                <code>last_seen_at</code>. Nie wysyłamy treści Twoich materiałów.
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-on-surface m-0">
              Gdzie zapisywać modele AI?
            </p>
            <OllamaModelsFolderSection
              value={modelsDir}
              onChange={setModelsDir}
              compact
            />
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant m-0">
              Wybierz profil modelu. Tagi nadpiszesz w{" "}
              <code className="text-on-surface">.env</code>.
            </p>
            <div className="rounded-2xl bg-surface-container-high px-4 py-3 space-y-1">
              <p className="text-sm font-semibold text-on-surface m-0">
                Rekomendacja sprzętowa
              </p>
              <p className="text-xs text-on-surface-variant m-0">
                {recommendedProfileForSpecs(specs).reason}
              </p>
              {specs && (
                <>
                  <p className="text-xs text-on-surface-variant m-0">
                    Parametry: {specs.total_ram_gb.toFixed(1)} GB RAM, {specs.cpu_threads} wątków CPU.
                  </p>
                  <p className="text-xs text-on-surface-variant m-0">
                    GPU:{" "}
                    {specs.gpu_names.length > 0
                      ? specs.gpu_names.join(", ")
                      : "nie wykryto / brak danych"}
                  </p>
                </>
              )}
            </div>
            {modelsDir && (
              <p className="text-xs text-primary font-medium m-0 rounded-xl bg-surface-container-high px-3 py-2">
                Ustaw <code>OLLAMA_MODELS</code> i zrestartuj Ollama przed
                pobieraniem, jeśli chcesz użyć wybranego folderu.
              </p>
            )}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="m"
                className="mt-1"
                checked={profile === "e2b-it"}
                onChange={() => {
                  setProfile("e2b-it");
                  setProfileTouched(true);
                }}
              />
              <span className="text-sm text-on-surface">
                {MODEL_PROFILES["e2b-it"].label} —{" "}
                {MODEL_PROFILES["e2b-it"].description}
                {recommendedProfileForSpecs(specs).profile === "e2b-it" && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Rekomendowany
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="m"
                className="mt-1"
                checked={profile === "e4b-it"}
                onChange={() => {
                  setProfile("e4b-it");
                  setProfileTouched(true);
                }}
              />
              <span className="text-sm text-on-surface">
                {MODEL_PROFILES["e4b-it"].label} —{" "}
                {MODEL_PROFILES["e4b-it"].description}
                {recommendedProfileForSpecs(specs).profile === "e4b-it" && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Rekomendowany
                  </span>
                )}
              </span>
            </label>
            <p className="text-xs text-on-surface-variant m-0">
              Czat: <code>{MODEL_PROFILES[profile].ollamaTag}</code> · embed:{" "}
              <code>{EMBEDDING_MODEL}</code>
            </p>
            <div className="rounded-2xl bg-surface-container-high px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-on-surface">
                <span className="material-symbols-outlined text-base text-primary">
                  info
                </span>
                <span
                  title="Pierwsze pobranie może potrwać kilka minut. Szybkość zależy od internetu i wielkości wybranego modelu."
                  className="font-medium"
                >
                  Podczas pobierania zobaczysz status i postęp modeli.
                </span>
              </div>
              <p className="text-xs text-on-surface-variant m-0">
                Nie zamykaj aplikacji, dopóki pasek nie dojdzie do końca. Model
                czatu pobiera się najpierw, embedding chwilę później.
              </p>
            </div>
            {pullProgress && (
              <div className="rounded-2xl bg-surface-container-high px-4 py-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-on-surface m-0">
                      {pullProgress.stage === "chat"
                        ? `Pobieranie modelu czatu: ${MODEL_PROFILES[profile].ollamaTag}`
                        : `Pobieranie embeddingów: ${EMBEDDING_MODEL}`}
                    </p>
                    <p className="text-xs text-on-surface-variant m-0">
                      {pullProgress.status}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary m-0">
                      {pullProgress.percent !== null
                        ? `${pullProgress.percent}%`
                        : "Trwa…"}
                    </p>
                    {pullProgress.total > 0 && (
                      <p className="text-[11px] text-on-surface-variant m-0">
                        {formatBytes(pullProgress.completed)} /{" "}
                        {formatBytes(pullProgress.total)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="h-2 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full rounded-full melon-gradient transition-all duration-300"
                    style={{
                      width:
                        pullProgress.percent !== null
                          ? `${pullProgress.percent}%`
                          : "35%",
                    }}
                  />
                </div>
              </div>
            )}
            {pullLog.length > 0 && (
              <pre className="text-[0.65rem] max-h-28 overflow-auto bg-surface-container-high rounded-xl p-3 m-0">
                {pullLog.join("\n")}
              </pre>
            )}
            {error && <p className="text-primary text-sm m-0">{error}</p>}
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <p className="text-on-surface font-medium m-0">
              Wszystko gotowe — możesz zacząć naukę.
            </p>
            <p className="text-sm text-on-surface-variant m-0">
              {name}, {uni}, {resolvedField}
            </p>
            <label className="flex items-start gap-3 cursor-pointer rounded-2xl bg-surface-container-high px-4 py-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={usageConsent}
                onChange={(e) => setUsageConsent(e.target.checked)}
              />
              <span className="text-xs text-on-surface-variant">
                Wyrażam zgodę na wysyłanie anonimowych statystyk użycia
                (ile instalacji korzysta i z jakiego kierunku). Ta zgoda jest
                wymagana do zakończenia onboardingu.
              </span>
            </label>
            <div className="rounded-2xl bg-surface-container-high px-4 py-3 text-xs text-on-surface-variant space-y-1">
              <p className="m-0 font-semibold text-on-surface">
                Warunki korzystania (wersja {TERMS_VERSION})
              </p>
              <p className="m-0">
                Aplikacja działa lokalnie i korzysta z Ollamy uruchomionej na Twoim
                komputerze. Odpowiadasz za legalność materiałów, które wgrywasz.
              </p>
              <p className="m-0">
                EduMelon może generować błędne odpowiedzi AI — traktuj wyniki jako
                wsparcie nauki, a nie źródło ostatecznej diagnozy/porady.
              </p>
              <p className="m-0">
                Zbieramy dokładnie te anonimowe dane statystyczne:
                <br />- losowy identyfikator instalacji
                <br />- wybrany kierunek studiów
                <br />- wybrany profil modelu
                <br />- znacznik czasu ostatniego uruchomienia
              </p>
              <p className="m-0">
                Nie zbieramy danych osobowych ani treści Twoich materiałów, pytań,
                fiszek i czatów.
              </p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer rounded-2xl bg-surface-container-high px-4 py-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
              />
              <span className="text-xs text-on-surface-variant">
                Akceptuję Warunki korzystania i rozumiem zasady działania aplikacji.
              </span>
            </label>
            {(!usageConsent || !termsAccepted) && (
              <p className="m-0 text-xs text-primary">
                Aby przejść dalej, zaznacz zgodę na wysyłanie anonimowych statystyk
                oraz akceptację Warunków korzystania.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          {step > 0 && step < 6 && (
            <button
              type="button"
              onClick={back}
              className="bg-secondary-container text-on-secondary-container font-bold px-6 py-3 rounded-full"
            >
              Wstecz
            </button>
          )}
          {step < 4 && (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue()}
              className="melon-gradient text-white font-bold px-8 py-3 rounded-full shadow-melon disabled:opacity-40"
            >
              Dalej
            </button>
          )}
          {step === 4 && (
            <button
              type="button"
              onClick={goNext}
              className="melon-gradient text-white font-bold px-8 py-3 rounded-full shadow-melon"
            >
              Dalej
            </button>
          )}
          {step === 5 && (
            <button
              type="button"
              onClick={() => void pullModels()}
              disabled={pulling}
              className="melon-gradient text-white font-bold px-8 py-3 rounded-full shadow-melon disabled:opacity-50"
            >
              {pulling ? "Pobieranie modeli…" : "Pobierz modele i kontynuuj"}
            </button>
          )}
          {step === 6 && (
            <button
              type="button"
              onClick={finish}
              disabled={!termsAccepted || !usageConsent}
              className="melon-gradient text-white font-bold px-10 py-3 rounded-full shadow-melon disabled:opacity-40"
            >
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
