export type ThemePreference = "light" | "dark" | "system";
export type AccentPresetId = "default" | "mint" | "violet" | "ocean" | "sunset";

const KEY = "edumelon_theme";
const KEY_ACCENT = "edumelon_theme_accent";

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

export const ACCENT_PRESETS: Record<AccentPresetId, string | null> = {
  default: null,
  mint: "#4ade80",
  violet: "#8b5cf6",
  ocean: "#0ea5e9",
  sunset: "#f97316",
};

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function parseHex(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${clampByte(r).toString(16).padStart(2, "0")}${clampByte(g)
    .toString(16)
    .padStart(2, "0")}${clampByte(b).toString(16).padStart(2, "0")}`;
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = parseHex(hex);
  const [tr, tg, tb] = target;
  return toHex([
    r + (tr - r) * amount,
    g + (tg - g) * amount,
    b + (tb - b) * amount,
  ]);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => v / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastText(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.45 ? "#08120c" : "#ffffff";
}

export function getAccentColor(): string | null {
  try {
    const raw = localStorage.getItem(KEY_ACCENT);
    if (!raw) return null;
    return HEX6_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setAccentColor(hex: string | null): void {
  if (hex == null) {
    localStorage.removeItem(KEY_ACCENT);
    applyAccentTheme();
    return;
  }
  const normalized = hex.trim();
  if (!HEX6_RE.test(normalized)) return;
  localStorage.setItem(KEY_ACCENT, normalized.toLowerCase());
  applyAccentTheme();
}

export function applyAccentTheme(): void {
  const root = document.documentElement;
  const accent = getAccentColor();
  if (!accent) {
    root.style.removeProperty("--c-primary");
    root.style.removeProperty("--c-primary-container");
    root.style.removeProperty("--c-on-primary");
    return;
  }
  root.style.setProperty("--c-primary", accent);
  root.style.setProperty("--c-primary-container", mix(accent, [255, 255, 255], 0.18));
  root.style.setProperty("--c-on-primary", contrastText(accent));
}

/** Stosuje klasę `dark` na <html> zgodnie z preferencją. */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  let dark = false;
  if (pref === "dark") dark = true;
  else if (pref === "light") dark = false;
  else {
    dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  root.classList.toggle("dark", dark);
  applyAccentTheme();
}

export function subscribeSystemTheme(callback: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fn = () => callback();
  mq.addEventListener?.("change", fn);
  return () => mq.removeEventListener?.("change", fn);
}
