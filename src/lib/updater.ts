import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export type UpdaterCheckResult =
  | { kind: "up-to-date"; currentVersion: string }
  | {
      kind: "available";
      currentVersion: string;
      version: string;
      body?: string;
      date?: string;
    }
  | { kind: "unavailable"; currentVersion: string; reason: string };

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getCurrentAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "dev";
  }
}

export async function checkForAppUpdate(): Promise<UpdaterCheckResult> {
  const currentVersion = await getCurrentAppVersion();
  if (!isTauri()) {
    return {
      kind: "unavailable",
      currentVersion,
      reason: "Updater działa tylko w aplikacji desktop.",
    };
  }
  try {
    const update = await check();
    if (!update) return { kind: "up-to-date", currentVersion };
    return {
      kind: "available",
      currentVersion,
      version: update.version,
      body: update.body ?? undefined,
      date: update.date ?? undefined,
    };
  } catch (e) {
    return {
      kind: "unavailable",
      currentVersion,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function checkForAppUpdateWithTimeout(
  timeoutMs = 10_000,
): Promise<UpdaterCheckResult> {
  return await Promise.race<UpdaterCheckResult>([
    checkForAppUpdate(),
    new Promise<UpdaterCheckResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            kind: "unavailable",
            currentVersion: "unknown",
            reason: `Timeout sprawdzania aktualizacji po ${timeoutMs} ms`,
          }),
        timeoutMs,
      ),
    ),
  ]);
}

export async function downloadAndInstallAppUpdate(
  onProgress?: (percent: number) => void,
): Promise<void> {
  const update = await check();
  if (!update) return;
  let downloaded = 0;
  let contentLength = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
        onProgress?.(0);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          onProgress?.(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        }
        break;
      case "Finished":
        onProgress?.(100);
        break;
      default:
        break;
    }
  });
}

export async function relaunchAfterUpdate(): Promise<void> {
  await relaunch();
}
