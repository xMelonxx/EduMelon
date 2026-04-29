import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { OllamaModelsFolderSection } from "../components/OllamaModelsFolderSection";
import {
  EMBEDDING_MODEL,
  MODEL_PROFILES,
  type ModelProfileId,
} from "../lib/constants";
import {
  ollamaListModels,
  ollamaPull,
  ollamaTagsReachable,
} from "../lib/ollama";
import {
  ACCENT_PRESETS,
  getThemePreference,
  getAccentColor,
  setAccentColor,
  setThemePreference,
  type ThemePreference,
  type AccentPresetId,
} from "../lib/theme";
import {
  getOllamaModelsDir,
  getOrCreateInstallId,
  loadLocalProfile,
  saveLocalProfile,
  setOllamaModelsDir,
} from "../lib/storage";
import {
  saveFeedbackWithAttachmentsToSupabase,
  type FeedbackType,
} from "../lib/supabase";
import { isDevToolsEnabled, setDevToolsEnabled } from "../lib/devtools";
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  getCurrentAppVersion,
  relaunchAfterUpdate,
  type UpdaterCheckResult,
} from "../lib/updater";

const OLLAMA_WIN = "https://ollama.com/download/windows";
const GITHUB_REPO_ISSUES = "https://github.com/xMelonxx/EduMelon/issues/new";
const MAX_FEEDBACK_ATTACHMENTS = 3;
const MAX_FEEDBACK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const FEEDBACK_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function Settings() {
  const [profile, setProfile] = useState(loadLocalProfile());
  const [model, setModel] = useState<ModelProfileId>(
    profile?.modelProfile ?? "e2b-it",
  );
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [accentColor, setAccentColorState] = useState<string>(getAccentColor() ?? "#4ade80");
  const [accentPreset, setAccentPreset] = useState<AccentPresetId | "custom">(
    (() => {
      const current = getAccentColor();
      if (!current) return "default";
      const hit = (Object.entries(ACCENT_PRESETS) as [AccentPresetId, string | null][])
        .find(([, color]) => color?.toLowerCase() === current.toLowerCase());
      return hit?.[0] ?? "custom";
    })(),
  );
  const [modelsDir, setModelsDir] = useState<string | null>(getOllamaModelsDir);
  const [health, setHealth] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [pullLog, setPullLog] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const [appVersion, setAppVersion] = useState("...");
  const [updateState, setUpdateState] = useState<UpdaterCheckResult | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateReadyToRestart, setUpdateReadyToRestart] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("suggestion");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [feedbackFiles, setFeedbackFiles] = useState<File[]>([]);
  const [versionTapCount, setVersionTapCount] = useState(0);
  const [devToolsUnlockedMsg, setDevToolsUnlockedMsg] = useState<string | null>(null);
  const devToolsEnabled = isDevToolsEnabled();

  useEffect(() => {
    void (async () => {
      setAppVersion(await getCurrentAppVersion());
      setHealth(await ollamaTagsReachable());
      try {
        if (await ollamaTagsReachable()) {
          setModels(await ollamaListModels());
        }
      } catch {
        setModels([]);
      }
    })();
  }, []);

  const save = () => {
    if (!profile) return;
    const next = { ...profile, modelProfile: model };
    saveLocalProfile(next);
    setProfile(next);
    alert("Zapisano profil lokalnie.");
  };

  const pullCurrent = async () => {
    setPulling(true);
    setPullLog([]);
    try {
      const tag = MODEL_PROFILES[model].ollamaTag;
      await ollamaPull(tag, (l) => setPullLog((p) => [...p.slice(-30), l]));
      await ollamaPull(EMBEDDING_MODEL, (l) =>
        setPullLog((p) => [...p.slice(-30), l]),
      );
      setModels(await ollamaListModels());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const setThemeAndApply = (t: ThemePreference) => {
    setTheme(t);
    setThemePreference(t);
  };

  const applyAccentPreset = (preset: AccentPresetId) => {
    setAccentPreset(preset);
    const color = ACCENT_PRESETS[preset];
    if (!color) {
      setAccentColor(null);
      return;
    }
    setAccentColorState(color);
    setAccentColor(color);
  };

  const applyCustomAccent = (hex: string) => {
    setAccentPreset("custom");
    setAccentColorState(hex);
    setAccentColor(hex);
  };

  const checkUpdates = async () => {
    setUpdateBusy(true);
    setUpdateProgress(null);
    setUpdateReadyToRestart(false);
    try {
      const result = await checkForAppUpdate();
      setUpdateState(result);
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    setUpdateProgress(0);
    try {
      await downloadAndInstallAppUpdate((p) => setUpdateProgress(p));
      setUpdateReadyToRestart(true);
    } catch (e) {
      setUpdateState({
        kind: "unavailable",
        currentVersion: appVersion,
        reason: e instanceof Error ? e.message : String(e),
      });
      setUpdateProgress(null);
    } finally {
      setUpdateBusy(false);
    }
  };

  const submitFeedback = async () => {
    const message = feedbackMessage.trim();
    if (message.length < 10) {
      setFeedbackStatus("Napisz proszę trochę więcej (min. 10 znaków).");
      return;
    }
    setFeedbackBusy(true);
    setFeedbackStatus(null);
    try {
      const res = await saveFeedbackWithAttachmentsToSupabase(
        {
        type: feedbackType,
        message,
        contact: feedbackContact,
        install_id: getOrCreateInstallId(),
        app_version: appVersion,
        model_profile: profile?.modelProfile ?? "unknown",
        os: navigator.userAgent,
        },
        feedbackFiles,
      );
      if (res.ok) {
        setFeedbackMessage("");
        setFeedbackContact("");
        setFeedbackFiles([]);
        setFeedbackStatus("Dzięki! Zgłoszenie zostało wysłane.");
      } else {
        setFeedbackStatus(`Nie udało się wysłać: ${res.error}`);
      }
    } finally {
      setFeedbackBusy(false);
    }
  };

  const addFeedbackFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next: File[] = [...feedbackFiles];
    for (const file of Array.from(incoming)) {
      if (!FEEDBACK_ALLOWED_MIME_TYPES.has(file.type)) {
        setFeedbackStatus(`Pominięto ${file.name}: dozwolone PNG/JPG/WEBP.`);
        continue;
      }
      if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
        setFeedbackStatus(`Pominięto ${file.name}: max rozmiar to 5 MB.`);
        continue;
      }
      if (next.length >= MAX_FEEDBACK_ATTACHMENTS) {
        setFeedbackStatus("Możesz dodać maksymalnie 3 zdjęcia.");
        break;
      }
      next.push(file);
    }
    setFeedbackFiles(next);
  };

  const openGithubIssue = (kind: "bug" | "feature") => {
    const titlePrefix = kind === "bug" ? "[Bug]" : "[Feature]";
    const body = [
      "## Opis",
      "",
      kind === "bug" ? "Co się stało?" : "Jaki problem ma rozwiązać ta funkcja?",
      "",
      "## Kroki / pomysł",
      "- ",
      "",
      "## Kontekst techniczny (auto)",
      `- App version: ${appVersion}`,
      `- Model profile: ${profile?.modelProfile ?? "unknown"}`,
      `- User agent: ${navigator.userAgent}`,
    ].join("\n");
    const url =
      `${GITHUB_REPO_ISSUES}?title=${encodeURIComponent(`${titlePrefix} `)}` +
      `&body=${encodeURIComponent(body)}`;
    void openUrl(url);
  };

  const handleVersionTap = () => {
    const currentEnabled = isDevToolsEnabled();
    if (currentEnabled) return;
    const next = versionTapCount + 1;
    if (next >= 7) {
      setDevToolsEnabled(true);
      setVersionTapCount(0);
      setDevToolsUnlockedMsg("Dev tools odblokowane!");
      return;
    }
    setVersionTapCount(next);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 md:py-10 space-y-8">
      <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-8 space-y-4 shadow-melon">
        <h3 className="text-lg font-bold text-on-surface m-0 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            brightness_auto
          </span>
          Wygląd
        </h3>
        <p className="text-sm text-on-surface-variant m-0">
          Tryb jasny, ciemny lub zgodny z systemem.
        </p>
        {(devToolsEnabled || devToolsUnlockedMsg) && (
          <p className="text-xs text-on-surface-variant m-0">
            {devToolsUnlockedMsg ?? "Dev tools odblokowane!"}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setThemeAndApply(t)}
              className={
                theme === t
                  ? "bg-primary text-on-primary font-bold px-5 py-2.5 rounded-xl text-sm"
                  : "bg-surface-container-high text-on-surface font-semibold px-5 py-2.5 rounded-full text-sm"
              }
            >
              {t === "light" ? "Jasny" : t === "dark" ? "Ciemny" : "System"}
            </button>
          ))}
        </div>
        <div className="pt-2 space-y-3">
          <p className="text-sm text-on-surface-variant m-0">
            Kolor akcentu (przyciski, aktywne elementy, wskaźniki)
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["default", "Domyślny"],
                ["mint", "Mięta"],
                ["violet", "Fiolet"],
                ["ocean", "Ocean"],
                ["sunset", "Sunset"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => applyAccentPreset(id)}
                className={
                  accentPreset === id
                    ? "bg-primary text-on-primary font-bold px-4 py-2 rounded-xl text-xs"
                    : "bg-surface-container-high text-on-surface font-semibold px-4 py-2 rounded-xl text-xs"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm text-on-surface-variant">
            Własny kolor:
            <input
              type="color"
              value={accentColor}
              onChange={(e) => applyCustomAccent(e.target.value)}
              className="h-9 w-14 rounded-lg border border-outline-variant bg-transparent cursor-pointer"
            />
            <code className="bg-surface-container-high px-2 py-1 rounded-lg text-xs text-on-surface">
              {accentColor}
            </code>
          </label>
        </div>
      </section>

      <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-8 space-y-4 shadow-melon">
        <h3 className="text-lg font-bold text-on-surface m-0 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            folder_special
          </span>
          Lokalizacja modeli Ollama
        </h3>
        <OllamaModelsFolderSection
          value={modelsDir}
          onChange={(p) => {
            setModelsDir(p);
            setOllamaModelsDir(p);
          }}
        />
      </section>

      <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-8 shadow-melon">
        <h2 className="text-2xl font-extrabold text-on-surface m-0 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">settings</span>
          Ustawienia
        </h2>
        <p className="text-on-surface-variant mt-3">
          Ollama:{" "}
          {health === null
            ? "…"
            : health
              ? "działa (localhost:11434)"
              : "niedostępna"}
        </p>
        {!health && (
          <button
            type="button"
            onClick={() => openUrl(OLLAMA_WIN)}
            className="mt-4 bg-secondary-container text-on-secondary-container font-bold px-6 py-3 rounded-full"
          >
            Pobierz Ollama
          </button>
        )}
      </section>

      <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-8 space-y-4 shadow-melon">
        <h3 className="text-lg font-bold text-on-surface m-0 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">system_update</span>
          Aktualizacje aplikacji
        </h3>
        <p className="text-sm text-on-surface-variant m-0">
          Wersja aplikacji:{" "}
          <button
            type="button"
            onClick={handleVersionTap}
            className="font-semibold text-on-surface underline decoration-dotted underline-offset-4"
          >
            {appVersion}
          </button>
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={updateBusy}
            onClick={() => void checkUpdates()}
            className="bg-primary text-on-primary font-bold px-6 py-3 rounded-xl disabled:opacity-50"
          >
            {updateBusy ? "Sprawdzam…" : "Sprawdź aktualizacje"}
          </button>
          {updateState?.kind === "available" && !updateReadyToRestart && (
            <button
              type="button"
              disabled={updateBusy}
              onClick={() => void installUpdate()}
              className="bg-surface-container-high text-on-surface font-bold px-6 py-3 rounded-xl disabled:opacity-50"
            >
              {updateBusy ? "Pobieram…" : `Pobierz ${updateState.version}`}
            </button>
          )}
          {updateReadyToRestart && (
            <button
              type="button"
              onClick={() => void relaunchAfterUpdate()}
              className="bg-primary text-on-primary font-bold px-6 py-3 rounded-xl"
            >
              Uruchom ponownie i zaktualizuj
            </button>
          )}
        </div>
        {updateProgress != null && (
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${updateProgress}%` }}
              />
            </div>
            <p className="text-xs text-on-surface-variant m-0">{updateProgress}%</p>
          </div>
        )}
        {updateState?.kind === "up-to-date" && (
          <p className="text-sm text-on-surface-variant m-0">
            Masz najnowszą wersję ({updateState.currentVersion}).
          </p>
        )}
        {updateState?.kind === "available" && (
          <div className="space-y-2">
            <p className="text-sm text-on-surface-variant m-0">
              Dostępna nowa wersja: <strong className="text-on-surface">{updateState.version}</strong>
              {updateState.date ? ` (${new Date(updateState.date).toLocaleDateString("pl-PL")})` : ""}
            </p>
            <div className="rounded-xl bg-surface-container-high px-4 py-3 space-y-2">
              <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant m-0">
                Co nowego
              </p>
              {updateState.body?.trim() ? (
                <pre className="m-0 whitespace-pre-wrap break-words text-xs text-on-surface-variant font-sans">
                  {updateState.body.trim()}
                </pre>
              ) : (
                <p className="text-xs text-on-surface-variant m-0">
                  Brak changelogu w release notes tej wersji.
                </p>
              )}
            </div>
          </div>
        )}
        {updateState?.kind === "unavailable" && (
          <p className="text-sm text-on-surface-variant m-0">
            Nie udało się sprawdzić aktualizacji: {updateState.reason}
          </p>
        )}
      </section>

      <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-8 space-y-4 shadow-melon">
        <h3 className="text-lg font-bold text-on-surface m-0 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">chat</span>
          Zgłoś problem lub pomysł
        </h3>
        <p className="text-sm text-on-surface-variant m-0">
          Możesz wysłać feedback bez konta (Supabase) albo otworzyć issue na GitHub.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["bug", "Błąd"],
              ["suggestion", "Sugestia"],
              ["idea", "Pomysł"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFeedbackType(id)}
              className={
                feedbackType === id
                  ? "bg-primary text-on-primary font-bold px-4 py-2 rounded-xl text-xs"
                  : "bg-surface-container-high text-on-surface font-semibold px-4 py-2 rounded-xl text-xs"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          value={feedbackMessage}
          onChange={(e) => setFeedbackMessage(e.target.value)}
          placeholder="Opisz problem albo pomysł (co działa źle / czego brakuje / jak to odtworzyć)."
          className="w-full min-h-28 rounded-2xl bg-surface-container-high text-on-surface border border-outline-variant/40 px-4 py-3"
        />
        <input
          value={feedbackContact}
          onChange={(e) => setFeedbackContact(e.target.value)}
          placeholder="Kontakt (opcjonalnie): email / Discord / IG"
          className="w-full rounded-2xl bg-surface-container-high text-on-surface border border-outline-variant/40 px-4 py-3"
        />
        <div className="space-y-2">
          <label className="inline-flex items-center gap-3 text-sm text-on-surface-variant">
            Dodaj zrzuty ekranu (max 3, PNG/JPG/WEBP do 5 MB):
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => addFeedbackFiles(e.target.files)}
              className="block text-xs"
            />
          </label>
          {feedbackFiles.length > 0 && (
            <div className="rounded-xl bg-surface-container-high px-3 py-2 space-y-1">
              {feedbackFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-on-surface-variant truncate">
                    {file.name} ({Math.round(file.size / 1024)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFeedbackFiles((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-xs font-semibold text-primary"
                  >
                    Usuń
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void submitFeedback()}
            disabled={feedbackBusy}
            className="bg-primary text-on-primary font-bold px-6 py-3 rounded-xl disabled:opacity-50"
          >
            {feedbackBusy ? "Wysyłam…" : "Wyślij anonimowo"}
          </button>
          <button
            type="button"
            onClick={() => openGithubIssue("bug")}
            className="bg-surface-container-high text-on-surface font-bold px-6 py-3 rounded-xl"
          >
            Zgłoś błąd na GitHub
          </button>
          <button
            type="button"
            onClick={() => openGithubIssue("feature")}
            className="bg-surface-container-high text-on-surface font-bold px-6 py-3 rounded-xl"
          >
            Zasugeruj funkcję na GitHub
          </button>
        </div>
        {feedbackStatus && (
          <p className="text-xs text-on-surface-variant m-0">{feedbackStatus}</p>
        )}
        <p className="text-[11px] text-on-surface-variant m-0">
          Uwaga: feedback zapisuje treść zgłoszenia + kontekst techniczny (wersja appki,
          model, user-agent). Załączniki trafiają do prywatnego storage. Nie wysyłamy
          treści Twoich materiałów.
        </p>
      </section>

      <section className="rounded-[24px] bg-surface-container-low border border-outline-variant p-8 space-y-4">
        <h3 className="text-lg font-bold text-on-surface m-0">Model AI</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="m"
            className="mt-1"
            checked={model === "e2b-it"}
            onChange={() => setModel("e2b-it")}
          />
          <span className="text-on-surface">
            {MODEL_PROFILES["e2b-it"].label}{" "}
            <code className="text-sm bg-surface-container-high px-2 py-0.5 rounded-lg">
              {MODEL_PROFILES["e2b-it"].ollamaTag}
            </code>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="m"
            className="mt-1"
            checked={model === "e4b-it"}
            onChange={() => setModel("e4b-it")}
          />
          <span className="text-on-surface">
            {MODEL_PROFILES["e4b-it"].label}{" "}
            <code className="text-sm bg-surface-container-high px-2 py-0.5 rounded-lg">
              {MODEL_PROFILES["e4b-it"].ollamaTag}
            </code>
          </span>
        </label>
        <p className="text-sm text-on-surface-variant">
          Embedding:{" "}
          <code className="text-on-surface">{EMBEDDING_MODEL}</code>
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            className="melon-gradient text-white font-bold px-8 py-3 rounded-full shadow-melon"
          >
            Zapisz profil
          </button>
          <button
            type="button"
            disabled={pulling || !health}
            onClick={() => void pullCurrent()}
            className="bg-surface-container-highest text-on-surface font-bold px-8 py-3 rounded-full disabled:opacity-50"
          >
            {pulling ? "Pobieranie…" : "Pobierz modele"}
          </button>
        </div>
        {pullLog.length > 0 && (
          <pre className="text-xs bg-surface-container-high rounded-2xl p-4 max-h-28 overflow-auto">
            {pullLog.join("\n")}
          </pre>
        )}
        {models.length > 0 && (
          <p className="text-xs text-on-surface-variant break-words">
            Zainstalowane: {models.join(", ")}
          </p>
        )}
      </section>

    </div>
  );
}
