/**
 * Light / dark theming.
 *
 * Three states, not two: "system" follows the OS and keeps following it, which
 * is what a dashboard left open on a wall-mounted screen wants when the machine
 * flips at dusk. An explicit "light" or "dark" pins it and stops listening.
 *
 * Only the resolved value ("light" | "dark") ever reaches the DOM — styles.css
 * keys off [data-theme], which is never "system".
 *
 * Kept out of the components so it can be tested without a browser —
 * see frontend/scripts/test-theme.js.
 */

export const THEME_KEY = "essl.theme";

/** What the toggle cycles through, in order. */
export const THEME_CYCLE = ["system", "light", "dark"];

export const THEME_LABEL = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** A crescent, a sun, a moon. */
export const THEME_ICON = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export const isTheme = (v) => THEME_CYCLE.includes(v);

export const nextTheme = (cur) =>
  THEME_CYCLE[(THEME_CYCLE.indexOf(isTheme(cur) ? cur : "system") + 1) % THEME_CYCLE.length];

/** "system" resolves against the OS; anything else is already an answer. */
export const resolveTheme = (choice, prefersDark) =>
  choice === "light" || choice === "dark" ? choice : prefersDark ? "dark" : "light";

/* ---------- browser edges ---------- */

const media = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** True when the OS asks for dark. Defaults to dark where we can't tell. */
export function prefersDark() {
  const m = media();
  return m ? m.matches : true;
}

export function loadTheme() {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : "system";
  } catch {
    // Private mode / storage disabled — the choice just won't persist.
    return "system";
  }
}

export function saveTheme(choice) {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* ignore */
  }
}

/** Paint the resolved theme onto <html>. Returns what it resolved to. */
export function applyTheme(choice) {
  const resolved = resolveTheme(choice, prefersDark());
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
  }
  return resolved;
}

/** Fires whenever the OS flips. Returns an unsubscribe function. */
export function onSystemThemeChange(fn) {
  const m = media();
  if (!m) return () => {};
  const handler = (e) => fn(e.matches);
  // Safari < 14 only has the deprecated form.
  if (m.addEventListener) m.addEventListener("change", handler);
  else m.addListener(handler);
  return () => {
    if (m.removeEventListener) m.removeEventListener("change", handler);
    else m.removeListener(handler);
  };
}
