/**
 * Exercises the Timesheet's filter + sort logic without a browser.
 *
 *     npm --prefix frontend run test:view
 */
import assert from "node:assert/strict";
import { filterDays, sortDays, summarise, nextDir } from "../src/lib/timesheetView.js";

const day = (o) => ({
  deviceSn: "SN1",
  employeeName: null,
  checkIn: null,
  checkOut: null,
  checkInReceived: null,
  checkOutReceived: null,
  realHours: null,
  hours: null,
  effectiveScans: 2,
  needsReview: false,
  flags: [],
  dayType: "FULL_DAY",
  dayTypeLabel: "Full Day",
  ...o,
});

const DAYS = [
  day({
    pin: "14", employeeName: "Ravi Kumar", workDate: "2026-08-06",
    checkIn: "2026-08-06T04:00:00Z", checkOut: "2026-08-06T13:00:00Z",
    checkInReceived: "2026-08-06T04:00:05Z", checkOutReceived: "2026-08-06T13:00:04Z",
    hours: 9, realHours: 9, effectiveScans: 4,
    flags: [{ code: "MULTI_SCAN", label: "4 scans" }], needsReview: true,
  }),
  day({
    pin: "8", employeeName: "Anitha S", workDate: "2026-08-05",
    checkIn: "2026-08-05T04:00:00Z", checkOut: "2026-08-05T07:15:00Z",
    checkInReceived: "2026-08-05T04:00:03Z", checkOutReceived: "2026-08-05T07:15:02Z",
    hours: 3.25, realHours: 3.25, dayType: "HALF_DAY_FIRST", dayTypeLabel: "Half Day (1st)",
  }),
  day({
    pin: "22", workDate: "2026-08-06",
    checkIn: "2026-08-06T03:45:00Z",
    checkInReceived: "2026-08-06T03:45:02Z",
    effectiveScans: 1, dayType: "HALF_DAY_NO_OUT", dayTypeLabel: "Half Day",
    flags: [{ code: "SHORT_DAY", label: "Short day" }], needsReview: true,
  }),
  day({
    pin: "30", employeeName: "Suresh M", workDate: "2026-08-04",
    checkIn: "2026-08-04T07:00:00Z", checkOut: "2026-08-04T18:00:00Z",
    checkInReceived: "2026-08-04T04:00:00Z", checkOutReceived: "2026-08-04T12:00:00Z",
    hours: 11, realHours: 8,
    flags: [{ code: "CLOCK_DRIFT", label: "Clock off 3h" }], needsReview: true,
  }),
];

const pins = (rows) => rows.map((d) => d.pin);
let n = 0;
const it = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

console.log("filters");
it("no filters returns everything untouched", () =>
  assert.deepEqual(pins(filterDays(DAYS, {})), ["14", "8", "22", "30"]));

it("employee dropdown narrows to one person", () =>
  assert.deepEqual(pins(filterDays(DAYS, { employee: "SN1:8" })), ["8"]));

it("search matches a name, case-insensitively", () =>
  assert.deepEqual(pins(filterDays(DAYS, { query: "ravi" })), ["14"]));

it("search matches a PIN", () =>
  assert.deepEqual(pins(filterDays(DAYS, { query: "22" })), ["22"]));

it("search on an unnamed employee still finds them by PIN", () =>
  assert.deepEqual(pins(filterDays(DAYS, { query: "2" })), ["22"]));

it("day type filter", () =>
  assert.deepEqual(pins(filterDays(DAYS, { dayType: "HALF_NO_OUT" })), ["22"]));

/* Day type grouping — the point being that a half day is found by the half it
   was worked in, not by the label the classifier happened to give it. */
const DT = [
  day({ pin: "f", dayType: "FULL_DAY", dayTypeLabel: "Full Day",
        hasFirstHalf: true, hasSecondHalf: true }),
  day({ pin: "m", dayType: "HALF_DAY_FIRST", dayTypeLabel: "Half Day (1st)",
        hasFirstHalf: true, hasSecondHalf: false }),
  day({ pin: "a", dayType: "HALF_DAY_SECOND", dayTypeLabel: "Half Day (2nd)",
        hasFirstHalf: false, hasSecondHalf: true }),
  // One morning scan, never punched out.
  day({ pin: "mx", dayType: "HALF_DAY_NO_OUT", dayTypeLabel: "Half Day",
        effectiveScans: 1, hasFirstHalf: true, hasSecondHalf: false }),
  // One AFTERNOON scan, never punched out — the case that used to go missing.
  day({ pin: "ax", dayType: "HALF_DAY_NO_OUT", dayTypeLabel: "Half Day",
        effectiveScans: 1, hasFirstHalf: false, hasSecondHalf: true }),
];

console.log("day type grouping");
it("Full Day matches only full days", () =>
  assert.deepEqual(pins(filterDays(DT, { dayType: "FULL_DAY" })), ["f"]));

it("Half Day — any catches every half day", () =>
  assert.deepEqual(pins(filterDays(DT, { dayType: "HALF_ANY" })), ["m", "a", "mx", "ax"]));

it("1st half includes a morning-only day with no check-out", () =>
  assert.deepEqual(pins(filterDays(DT, { dayType: "HALF_FIRST" })), ["m", "mx"]));

it("2nd half includes an AFTERNOON-only day with no check-out", () =>
  assert.deepEqual(pins(filterDays(DT, { dayType: "HALF_SECOND" })), ["a", "ax"]));

it("no check-out still selectable on its own", () =>
  assert.deepEqual(pins(filterDays(DT, { dayType: "HALF_NO_OUT" })), ["mx", "ax"]));

it("a full day is never returned by a half-day filter", () =>
  assert.equal(
    ["HALF_ANY", "HALF_FIRST", "HALF_SECOND", "HALF_NO_OUT"]
      .flatMap((t) => pins(filterDays(DT, { dayType: t })))
      .includes("f"),
    false
  ));

it("falls back to the raw label when the server omits the half flags", () => {
  const legacy = DT.map(({ hasFirstHalf, hasSecondHalf, ...rest }) => rest);
  assert.deepEqual(pins(filterDays(legacy, { dayType: "HALF_FIRST" })), ["m"]);
  assert.deepEqual(pins(filterDays(legacy, { dayType: "HALF_SECOND" })), ["a"]);
  assert.deepEqual(pins(filterDays(legacy, { dayType: "HALF_ANY" })), ["m", "a", "mx", "ax"]);
});

it("a specific flag", () =>
  assert.deepEqual(pins(filterDays(DAYS, { flag: "CLOCK_DRIFT" })), ["30"]));

it("'any flag' keeps only rows needing review", () =>
  assert.deepEqual(pins(filterDays(DAYS, { flag: "__any" })), ["14", "22", "30"]));

it("'no flags' keeps only clean rows", () =>
  assert.deepEqual(pins(filterDays(DAYS, { flag: "__none" })), ["8"]));

it("filters combine", () =>
  assert.deepEqual(pins(filterDays(DAYS, { flag: "__any", dayType: "FULL_DAY" })), ["14", "30"]));

it("no match returns empty, not everything", () =>
  assert.deepEqual(pins(filterDays(DAYS, { query: "nobody" })), []));

console.log("sorting");
it("no direction leaves server order alone", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: null, dir: null })), ["14", "8", "22", "30"]));

it("hours ascending", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "hours", dir: "asc" })), ["8", "14", "30", "22"]));

it("hours descending — nulls still last", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "hours", dir: "desc" })), ["30", "14", "8", "22"]));

it("Real Hrs sorts independently of Hours", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "realHours", dir: "desc" })), ["14", "30", "8", "22"]));

it("employee name ascending, unnamed sorts under 'PIN'", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "employee", dir: "asc" })), ["8", "22", "14", "30"]));

it("date ascending", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "workDate", dir: "asc" })), ["30", "8", "14", "22"]));

it("date descending is stable — 14 before 22 as the server sent them", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "workDate", dir: "desc" })), ["14", "22", "8", "30"]));

it("check-out ascending puts the missing one last", () =>
  assert.equal(pins(sortDays(DAYS, { key: "checkOut", dir: "asc" })).at(-1), "22"));

it("check-out descending ALSO puts the missing one last", () =>
  assert.equal(pins(sortDays(DAYS, { key: "checkOut", dir: "desc" })).at(-1), "22"));

it("scans ascending", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "scans", dir: "asc" })), ["22", "8", "30", "14"]));

it("review column sorts by number of flags", () =>
  assert.equal(pins(sortDays(DAYS, { key: "flags", dir: "asc" }))[0], "8"));

it("sorting never mutates the input", () => {
  const before = pins(DAYS);
  sortDays(DAYS, { key: "hours", dir: "desc" });
  assert.deepEqual(pins(DAYS), before);
});

it("an unknown sort key is ignored rather than throwing", () =>
  assert.deepEqual(pins(sortDays(DAYS, { key: "nope", dir: "asc" })), ["14", "8", "22", "30"]));

console.log("sort cycle");
it("none -> asc -> desc -> none", () => {
  assert.equal(nextDir(null), "asc");
  assert.equal(nextDir("asc"), "desc");
  assert.equal(nextDir("desc"), null);
});

console.log("totals");
it("totals follow the filters", () => {
  const s = summarise(filterDays(DAYS, { flag: "__any" }));
  assert.equal(s.days, 3);
  assert.equal(s.employees, 3);
  assert.equal(s.review, 3);
  // 9 + 11; PIN 22 has no hours and must not count as zero-with-a-day.
  assert.equal(s.hours, 20);
  assert.equal(s.fullDays, 2);
  assert.equal(s.halfDays, 1);
});

it("empty selection totals to zero, not NaN", () => {
  const s = summarise([]);
  assert.equal(s.hours, 0);
  assert.equal(s.employees, 0);
});

console.log(`\n${n} assertions passed`);
