/** Paleta folderów przedmiotów (kontrast na jasnym i ciemnym tle). */
export const FOLDER_COLOR_PRESETS = [
  "#C62828",
  "#AD1457",
  "#6A1B9A",
  "#283593",
  "#1565C0",
  "#00695C",
  "#2E7D32",
  "#F57F17",
  "#E65100",
  "#5D4037",
] as const;

export const DEFAULT_FOLDER_COLOR = FOLDER_COLOR_PRESETS[5]!;

export function isValidHexColor(s: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(s.trim());
}
