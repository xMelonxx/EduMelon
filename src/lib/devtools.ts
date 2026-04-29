const DEVTOOLS_KEY = "edumelon_devtools_enabled";

export function isDevToolsEnabled(): boolean {
  try {
    return sessionStorage.getItem(DEVTOOLS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevToolsEnabled(enabled: boolean): void {
  try {
    sessionStorage.setItem(DEVTOOLS_KEY, enabled ? "1" : "0");
  } catch {
    // ignore storage failures
  }
}

