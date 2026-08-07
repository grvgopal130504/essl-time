import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  loadTheme,
  nextTheme,
  onSystemThemeChange,
  saveTheme,
} from "../lib/theme.js";

/**
 * The theme choice ("system" | "light" | "dark") and what it currently resolves
 * to. Applied to <html> on every change, and re-applied when the OS flips —
 * but only while the choice is still "system".
 */
export function useTheme() {
  const [choice, setChoice] = useState(loadTheme);
  const [resolved, setResolved] = useState(() => applyTheme(loadTheme()));

  useEffect(() => {
    setResolved(applyTheme(choice));
    saveTheme(choice);
  }, [choice]);

  useEffect(() => {
    if (choice !== "system") return undefined;
    return onSystemThemeChange(() => setResolved(applyTheme("system")));
  }, [choice]);

  const cycle = useCallback(() => setChoice((c) => nextTheme(c)), []);

  return { choice, resolved, setTheme: setChoice, cycle };
}
