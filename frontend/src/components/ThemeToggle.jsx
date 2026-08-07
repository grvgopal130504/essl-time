import { THEME_ICON, THEME_LABEL, nextTheme } from "../lib/theme.js";
import { useTheme } from "../hooks/useTheme.js";

/**
 * One button that cycles System → Light → Dark. A three-way segmented control
 * would cost a third of the topbar on a phone for a setting people touch once.
 */
export default function ThemeToggle() {
  const { choice, resolved, cycle } = useTheme();
  const next = nextTheme(choice);

  return (
    <button
      type="button"
      className="pill theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${THEME_LABEL[choice]}. Switch to ${THEME_LABEL[next]}.`}
      title={
        choice === "system"
          ? `Theme: following your system (${resolved}). Click for ${THEME_LABEL[next]}.`
          : `Theme: ${THEME_LABEL[choice]}. Click for ${THEME_LABEL[next]}.`
      }
    >
      <span aria-hidden="true" className="theme-icon">
        {THEME_ICON[choice]}
      </span>
      <span className="hide-sm">{THEME_LABEL[choice]}</span>
    </button>
  );
}
