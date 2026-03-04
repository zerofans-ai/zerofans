export type Theme = "light" | "dark";

const THEME_KEY = "zerofans.theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (value === "dark" || value === "light") {
      return value;
    }
  } catch {
    // ignore
  }

  return "light";
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.body.dataset.theme = theme;
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }
}

