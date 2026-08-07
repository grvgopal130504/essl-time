/**
 * Theme resolution and cycling, without a browser.
 *
 *     npm --prefix frontend run test:theme
 */
import assert from "node:assert/strict";
import {
  THEME_CYCLE,
  THEME_ICON,
  THEME_LABEL,
  isTheme,
  nextTheme,
  resolveTheme,
} from "../src/lib/theme.js";

let n = 0;
const it = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

console.log("validity");
it("only the three known choices are accepted", () => {
  assert.ok(isTheme("system") && isTheme("light") && isTheme("dark"));
  assert.equal(isTheme("solarized"), false);
  assert.equal(isTheme(null), false);
  assert.equal(isTheme(undefined), false);
});

it("every choice has a label and an icon", () =>
  THEME_CYCLE.forEach((t) => {
    assert.ok(THEME_LABEL[t], t);
    assert.ok(THEME_ICON[t], t);
  }));

console.log("cycling");
it("system -> light -> dark -> system", () => {
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
});

it("the cycle returns to where it started", () =>
  assert.equal(THEME_CYCLE.reduce((c) => nextTheme(c), "system"), "system"));

it("a corrupt stored value cycles from system rather than sticking", () =>
  assert.equal(nextTheme("solarized"), "light"));

console.log("resolution");
it("an explicit choice ignores the system preference entirely", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("dark", true), "dark");
});

it("system follows the OS", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

it("an unknown choice is treated as system, not as a theme name", () => {
  assert.equal(resolveTheme("solarized", false), "light");
  assert.equal(resolveTheme(undefined, true), "dark");
});

it("resolution never returns 'system' — the DOM only ever sees light or dark", () =>
  [true, false].forEach((dark) =>
    THEME_CYCLE.concat(["nonsense"]).forEach((c) =>
      assert.ok(["light", "dark"].includes(resolveTheme(c, dark)), `${c}/${dark}`)
    )
  ));

console.log(`\n${n} assertions passed`);
