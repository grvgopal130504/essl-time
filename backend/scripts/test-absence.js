/**
 * Absence detection, against a throwaway Postgres (PGlite).
 *
 * An absent day has no punches, so there is no row to aggregate — it has to be
 * manufactured by crossing the roster with the calendar. This checks that the
 * manufacturing has the right boundaries and doesn't invent days.
 *
 *     npm --prefix backend run test:absence
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timesheetQuery } from "../src/db/repository.js";

const here = dirname(fileURLToPath(import.meta.url));
const TZ = "+05:30";

const db = new PGlite();
await db.exec(readFileSync(join(here, "../src/db/schema.sql"), "utf8"));

/*  August 2026
      Mon 03  Tue 04  Wed 05  Thu 06  Fri 07  Sat 08  SUN 09  Mon 10
    Ravi  (14): worked 03, 04,     06,             , absent 05, 07
    Anitha (8): first punch on 06 — nothing before that is her absence
    "today" for the test is Mon 10, so 09 (Sunday) and 07 are judged, 10 is not.
*/
const punch = (pin, day, hhmm) =>
  db.query(
    `INSERT INTO attendance_logs (device_sn, pin, punch_time, status) VALUES ('SN1',$1,$2,0)`,
    [pin, `2026-08-${day}T${hhmm}:00${TZ}`]
  );

for (const day of ["03", "04", "06"]) {
  await punch("14", day, "09:30");
  await punch("14", day, "18:30");
}
await punch("8", "06", "09:30");
await punch("8", "06", "18:30");
await punch("8", "10", "09:30"); // today — must not be judged

await db.query(`INSERT INTO employees (device_sn, pin, name) VALUES ('SN1','14','Ravi Kumar')`);

const TODAY = "2026-08-10";
const WEEK_OFF = new Set([0]); // Sunday

async function run(opts = {}) {
  const { text, params } = timesheetQuery({
    from: "2026-08-01",
    to: "2026-08-10",
    tzOffset: TZ,
    debounceSeconds: 120,
    halfDayBoundary: "13:00",
    today: TODAY,
    ...opts,
  });
  const { rows } = await db.query(text, params);
  // Mirrors the ABSENT / WEEKLY_OFF branch in routes/api.js.
  return rows.map((r) => {
    const workDate = r.work_date instanceof Date
      ? r.work_date.toISOString().slice(0, 10)
      : String(r.work_date).slice(0, 10);
    const noScans = r.effective_scans === 0;
    const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay();
    return {
      pin: r.pin,
      workDate,
      dayType: noScans
        ? WEEK_OFF.has(weekday) ? "WEEKLY_OFF" : "ABSENT"
        : r.has_first_half && r.has_second_half ? "FULL_DAY" : "HALF_DAY",
      hours: r.hours === null ? null : Number(r.hours),
      name: r.employee_name,
    };
  });
}

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      got      ${JSON.stringify(got)}\n      expected ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};

const rows = await run();
const forPin = (p, type) =>
  rows.filter((r) => r.pin === p && (!type || r.dayType === type)).map((r) => r.workDate).sort();

console.log("the rule");
check(
  // The 8th is a SATURDAY and is a working day by default — only Sunday is in
  // WEEK_OFF_DAYS. Set WEEK_OFF_DAYS=0,6 for a five-day week.
  "Ravi is absent on the days he never punched",
  forPin("14", "ABSENT"),
  ["2026-08-05", "2026-08-07", "2026-08-08"]
);
check("Ravi's worked days are still full days", forPin("14", "FULL_DAY"), [
  "2026-08-03", "2026-08-04", "2026-08-06",
]);

console.log("boundaries");
check(
  "nothing before an employee's first ever punch",
  // Anitha's first punch is the 6th, so the 1st-5th are not her absence.
  forPin("8", "ABSENT"),
  ["2026-08-07", "2026-08-08"]
);
check(
  "today is never judged — she hasn't finished the day",
  rows.some((r) => r.workDate === TODAY && r.dayType === "ABSENT"),
  false
);
check(
  "today's real punches still appear",
  rows.some((r) => r.workDate === TODAY && r.pin === "8" && r.dayType !== "ABSENT"),
  true
);
check("Sunday the 9th is a weekly off, not an absence", forPin("14", "WEEKLY_OFF"), ["2026-08-09"]);
check(
  "nobody is absent on the Sunday",
  rows.filter((r) => r.workDate === "2026-08-09" && r.dayType === "ABSENT").length,
  0
);

console.log("shape");
check("absent rows carry no hours", rows.filter((r) => r.dayType === "ABSENT" && r.hours !== null).length, 0);
check(
  "absent rows still carry the employee name",
  rows.find((r) => r.pin === "14" && r.dayType === "ABSENT")?.name,
  "Ravi Kumar"
);
check(
  "one row per employee per judged day, no duplicates",
  rows.length,
  new Set(rows.map((r) => `${r.pin}:${r.workDate}`)).size
);

console.log("switches");
const noAbsent = await run({ includeAbsent: false });
check("absent=false returns only real punches", noAbsent.every((r) => r.hours !== null || r.dayType !== "ABSENT"), true);
check("absent=false row count matches the punched days", noAbsent.length, 5);

const onlyRavi = await run({ pin: "14" });
check("the pin filter also scopes the absences", new Set(onlyRavi.map((r) => r.pin)).size, 1);
check("Ravi's absences survive the pin filter", onlyRavi.filter((r) => r.dayType === "ABSENT").length, 3);

console.log("empty range");
const future = await run({ from: "2026-09-01", to: "2026-09-05" });
check("a range after everyone's last punch invents nothing", future.length, 0);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
await db.close();
process.exit(failed ? 1 : 0);
