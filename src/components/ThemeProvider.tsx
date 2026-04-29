import { useEffect, type ReactNode } from "react";
import {
  applyTheme,
  getThemePreference,
  subscribeSystemTheme,
} from "../lib/theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme(getThemePreference());
    return subscribeSystemTheme(() => {
      if (getThemePreference() === "system") applyTheme("system");
    });
  }, []);

  return <>{children}</>;
}
