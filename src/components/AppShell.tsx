import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "../lib/theme";
import { loadLocalProfile } from "../lib/storage";
import {
  checkForAppUpdateWithTimeout,
  downloadAndInstallAppUpdate,
  getCurrentAppVersion,
  relaunchAfterUpdate,
} from "../lib/updater";

type NavDef = {
  to: string;
  label: string;
  icon: string;
  isActive: (pathname: string) => boolean;
};

const navItems: NavDef[] = [
  {
    to: "/app/dashboard",
    label: "My Library",
    icon: "book_2",
    isActive: (p) =>
      p === "/app/dashboard" ||
      p === "/app" ||
      p.startsWith("/app/summary/"),
  },
  {
    to: "/app/flashcards",
    label: "Flashcards",
    icon: "style",
    isActive: (p) => p.startsWith("/app/flashcards"),
  },
  {
    to: "/app/tests",
    label: "Testy",
    icon: "quiz",
    isActive: (p) => p.startsWith("/app/tests"),
  },
  {
    to: "/app/upload",
    label: "Wgrywanie",
    icon: "upload_file",
    isActive: (p) => p.startsWith("/app/upload"),
  },
  {
    to: "/app/settings",
    label: "Settings",
    icon: "settings",
    isActive: (p) => p.startsWith("/app/settings"),
  },
];

const themeOrder: ThemePreference[] = ["light", "dark", "system"];
const STARTUP_UPDATE_DISMISSED_VERSION_KEY = "edumelon_update_dismissed_version";
const POST_UPDATE_CHANGELOG_KEY = "edumelon_post_update_changelog";

function themeIcon(pref: ThemePreference): string {
  if (pref === "light") return "light_mode";
  if (pref === "dark") return "dark_mode";
  return "brightness_auto";
}

export function AppShell() {
  const location = useLocation();
  const profile = loadLocalProfile();
  const [, setThemeTick] = useState(0);
  const themePref = getThemePreference();
  const [startupUpdate, setStartupUpdate] = useState<{
    version: string;
    body?: string;
  } | null>(null);
  const [startupUpdateBusy, setStartupUpdateBusy] = useState(false);
  const [startupUpdateProgress, setStartupUpdateProgress] = useState<number | null>(null);
  const [startupUpdateError, setStartupUpdateError] = useState<string | null>(null);
  const [startupCheckInFlight, setStartupCheckInFlight] = useState(false);
  const [postUpdateNotice, setPostUpdateNotice] = useState<{
    version: string;
    body?: string;
  } | null>(null);

  const cycleTheme = () => {
    const i = themeOrder.indexOf(themePref);
    const next = themeOrder[(i + 1) % themeOrder.length]!;
    setThemePreference(next);
    setThemeTick((x) => x + 1);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (startupCheckInFlight) return;
      setStartupCheckInFlight(true);
      void (async () => {
        try {
          // Best-effort cleanup; does not block startup.
          try {
            await invoke<number>("cleanup_stale_update_temp_files", {
              maxAgeHours: 48,
            });
          } catch {
            // ignore cleanup errors
          }
          const result = await checkForAppUpdateWithTimeout(10_000);
          if (result.kind !== "available") return;
          const dismissedVersion = localStorage.getItem(STARTUP_UPDATE_DISMISSED_VERSION_KEY);
          if (dismissedVersion === result.version) return;
          setStartupUpdate({ version: result.version, body: result.body });
        } finally {
          setStartupCheckInFlight(false);
        }
      })();
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    void (async () => {
      const raw = localStorage.getItem(POST_UPDATE_CHANGELOG_KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { version?: string; body?: string };
        if (!parsed.version) {
          localStorage.removeItem(POST_UPDATE_CHANGELOG_KEY);
          return;
        }
        const currentVersion = await getCurrentAppVersion();
        if (currentVersion === parsed.version) {
          setPostUpdateNotice({ version: parsed.version, body: parsed.body });
        }
      } catch {
        // ignore malformed values
      } finally {
        // Show once after successful restart into the expected version.
        localStorage.removeItem(POST_UPDATE_CHANGELOG_KEY);
      }
    })();
  }, []);

  const installStartupUpdateNow = async () => {
    if (!startupUpdate) return;
    setStartupUpdateBusy(true);
    setStartupUpdateError(null);
    setStartupUpdateProgress(0);
    try {
      localStorage.setItem(
        POST_UPDATE_CHANGELOG_KEY,
        JSON.stringify({
          version: startupUpdate.version,
          body: startupUpdate.body,
        }),
      );
      await downloadAndInstallAppUpdate((percent) => setStartupUpdateProgress(percent));
      await relaunchAfterUpdate();
    } catch (e) {
      localStorage.removeItem(POST_UPDATE_CHANGELOG_KEY);
      setStartupUpdateError(e instanceof Error ? e.message : String(e));
      setStartupUpdateBusy(false);
    }
  };

  const dismissStartupUpdate = () => {
    if (startupUpdate) {
      localStorage.setItem(STARTUP_UPDATE_DISMISSED_VERSION_KEY, startupUpdate.version);
    }
    setStartupUpdate(null);
    setStartupUpdateBusy(false);
    setStartupUpdateProgress(null);
    setStartupUpdateError(null);
  };

  return (
    <div className="flex min-h-screen bg-surface text-on-surface">
      {postUpdateNotice && (
        <div className="fixed left-1/2 top-6 z-[90] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-melon p-4 space-y-3">
          <p className="text-sm font-bold text-on-surface m-0">
            Zaktualizowano aplikację do wersji {postUpdateNotice.version}
          </p>
          {postUpdateNotice.body?.trim() ? (
            <pre className="text-xs whitespace-pre-wrap max-h-[40vh] overflow-y-auto rounded-xl bg-surface-container p-3 text-on-surface-variant m-0">
              {postUpdateNotice.body.trim()}
            </pre>
          ) : (
            <p className="text-xs text-on-surface-variant m-0">
              Aktualizacja zakończona pomyślnie.
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setPostUpdateNotice(null)}
              className="bg-primary text-on-primary font-bold px-4 py-2 rounded-xl text-xs"
            >
              OK
            </button>
          </div>
        </div>
      )}
      {startupUpdate && (
        <div className="fixed right-4 top-4 z-[80] w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-melon p-4 space-y-3">
          <p className="text-sm font-bold text-on-surface m-0">
            Dostępna nowa aktualizacja ({startupUpdate.version})
          </p>
          {startupUpdate.body?.trim() ? (
            <p className="text-xs text-on-surface-variant m-0 line-clamp-4">
              {startupUpdate.body.trim()}
            </p>
          ) : (
            <p className="text-xs text-on-surface-variant m-0">
              Pojawiła się nowa wersja aplikacji.
            </p>
          )}
          {startupUpdateProgress != null && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${startupUpdateProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-on-surface-variant m-0">
                Pobieranie: {startupUpdateProgress}%
              </p>
            </div>
          )}
          {startupUpdateError && (
            <p className="text-xs text-error m-0">
              Nie udało się zaktualizować: {startupUpdateError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={startupUpdateBusy}
              onClick={() => void installStartupUpdateNow()}
              className="bg-primary text-on-primary font-bold px-4 py-2 rounded-xl text-xs disabled:opacity-50"
            >
              {startupUpdateBusy ? "Pobieram…" : "Pobierz i zainstaluj teraz"}
            </button>
            <button
              type="button"
              disabled={startupUpdateBusy}
              onClick={dismissStartupUpdate}
              className="bg-surface-container-high text-on-surface font-semibold px-4 py-2 rounded-xl text-xs disabled:opacity-50"
            >
              Pobierz później
            </button>
          </div>
        </div>
      )}
      <aside className="hidden md:flex flex-col w-64 shrink-0 bg-surface-container-low border-r border-outline-variant py-8 z-40">
        <div className="px-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center">
              <span
                className="material-symbols-outlined text-primary text-[22px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                nutrition
              </span>
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-primary leading-tight font-heading">
                EduMelon
              </h1>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/80 font-heading">
                AI Study Companion
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 space-y-1">
          {navItems.map((item) => {
            const active = item.isActive(location.pathname);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/app/dashboard"}
                className={() =>
                  [
                    "flex items-center gap-3 px-4 py-3 mx-2 text-sm font-medium tracking-wide transition-all duration-200 rounded-xl",
                    active
                      ? "bg-primary text-on-primary shadow-melon"
                      : "text-on-surface-variant hover:bg-surface-container hover:text-primary",
                  ].join(" ")
                }
              >
                <span
                  className="material-symbols-outlined text-xl"
                  style={
                    active ? { fontVariationSettings: "'FILL' 1" } : undefined
                  }
                >
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="sticky top-0 z-50 flex items-center justify-between px-4 md:px-8 h-16 bg-surface-container-lowest border-b border-outline-variant">
          <div className="md:hidden font-black text-primary tracking-tight font-heading">
            EduMelon
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-heading">
            <span className="text-on-surface-variant font-medium">
              Hub
            </span>
            <span className="text-primary font-bold border-b-2 border-primary pb-0.5">
              Tests
            </span>
          </div>
          <div className="flex items-center gap-2 pl-2">
            <button
              type="button"
              onClick={cycleTheme}
              title={`Motyw: ${themePref} — kliknij, by zmienić`}
              className="flex flex-col items-center gap-0.5 rounded-full p-2 text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-2xl">
                {themeIcon(themePref)}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:block">
                {themePref}
              </span>
            </button>
            <span className="material-symbols-outlined text-on-surface-variant text-2xl">
              account_circle
            </span>
            <span className="text-sm font-semibold text-on-surface-variant hidden sm:inline max-w-[140px] truncate">
              {profile?.displayName ?? "Profil"}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
