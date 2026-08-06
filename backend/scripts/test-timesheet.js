/**
 * Runs the real timesheet SQL against a throwaway in-process Postgres (PGlite)
 * and checks the derived check-in / check-out / hours / Real Hrs values.
 *
 * No server, no Azure, no local Postgres install:
 *     npm i -D @electric-sql/pglite
 *     node backend/scripts/test-timesheet.js
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timesheetQuery } from "../src/db/repository.js";

const here = dirname(fileURLToPath(import.meta.url));
const TZ = "+05:30";
const DAY = "2026-08-06";

/** "09:30" IST -> the UTC instant Postgres stores. */
const ist = (hhmm, day = DAY) => new Date(`${day}T${hhmm}:00${TZ}`).toISOString();

/**
 * Each case: punches as [deviceClockTime, minutesAfterFirstThatItReachedServer].
 * The second number is what makes received_at independent of the device clock.
 */
const CASES = [
  { pin: "1", punches: [["09:30", 0], ["12:30", 180], ["13:30", 240], ["18:30", 540]],
    want: { checkIn: "09:30", checkOut: "18:30", hours: 9, realHours: 9, dayType: "FULL_DAY" } },
  { pin: "2", punches: [["09:30", 0], ["12:45", 195]],
    want: { checkIn: "09:30", checkOut: "12:45", hours: 3.25, realHours: 3.25, dayType: "HALF_DAY_FIRST" } },
  { pin: "3", punches: [["13:15", 0], ["18:30", 315]],
    want: { checkIn: "13:15", checkOut: "18:30", hours: 5.25, realHours: 5.25, dayType: "HALF_DAY_SECOND" } },
  { pin: "4", punches: [["12:50", 0], ["13:10", 20]],
    want: { checkIn: "12:50", checkOut: "13:10", hours: 0.33, realHours: 0.33, dayType: "FULL_DAY" } },
  // Single morning scan — the dashboard must be able to find this under
  // "Half Day (1st half)", so has_first_half has to survive the aggregation.
  { pin: "5", punches: [["12:59", 0]],
    want: { checkIn: "12:59", checkOut: null, hours: null, realHours: null,
            dayType: "HALF_DAY_NO_OUT", firstHalf: true, secondHalf: false } },
  // Single AFTERNOON scan. 13:00 is the boundary, so this is the second half.
  { pin: "6", punches: [["13:00", 0]],
    want: { checkIn: "13:00", checkOut: null, hours: null, realHours: null,
            dayType: "HALF_DAY_NO_OUT", firstHalf: false, secondHalf: true } },
  { pin: "7", punches: [["08:30", 0], ["11:30", 180], ["14:00", 330], ["20:00", 690]],
    want: { checkIn: "08:30", checkOut: "20:00", hours: 11.5, realHours: 11.5, dayType: "FULL_DAY" } },
  { pin: "8", punches: [["11:45", 0], ["12:15", 30], ["12:45", 60], ["12:55", 70]],
    want: { checkIn: "11:45", checkOut: "12:55", hours: 1.17, realHours: 1.17, dayType: "HALF_DAY_FIRST" } },
  { pin: "9", punches: [["13:30", 0], ["14:30", 60], ["17:00", 210], ["18:00", 270]],
    want: { checkIn: "13:30", checkOut: "18:00", hours: 4.5, realHours: 4.5, dayType: "HALF_DAY_SECOND" } },

  // De-bounce: three taps inside 31s must collapse to one effective scan.
  { pin: "20", punches: [["09:00", 0], ["09:00:12", 0.2], ["09:00:31", 0.5], ["18:00", 540]],
    want: { checkIn: "09:00", checkOut: "18:00", hours: 9, realHours: 9, effectiveScans: 2, repeatScans: 2 } },

  // Device clock 3h fast, but the punches really arrived 8h apart.
  { pin: "30", punches: [["12:30", 0], ["23:30", 480]],
    want: { hours: 11, realHours: 8, flag: "CLOCK_DRIFT" } },

  // Offline all day, whole backlog uploaded in one POST 2 min apart.
  { pin: "31", punches: [["09:00", 0], ["18:00", 2]],
    want: { hours: 9, realHours: 0.03, flag: "BATCH_UPLOAD" } },
];

const db = new PGlite();
const schema = readFileSync(join(here, "../src/db/schema.sql"), "utf8");
await db.exec(schema);

for (const c of CASES) {
  const base = new Date(ist(c.punches[0][0].slice(0, 5))).getTime();
  for (const [clock, offsetMin] of c.punches) {
    const [h, m, s = "00"] = clock.split(":");
    const punchTime = new Date(`${DAY}T${h}:${m}:${s}${TZ}`).toISOString();
    const receivedAt = new Date(base + offsetMin * 60000).toISOString();
    await db.query(
      `INSERT INTO attendance_logs (device_sn, pin, punch_time, status, received_at)
       VALUES ($1, $2, $3, 0, $4)`,
      ["TESTSN", c.pin, punchTime, receivedAt]
    );
  }
}

const { text, params } = timesheetQuery({
  from: DAY, to: DAY, tzOffset: TZ, debounceSeconds: 120, halfDayBoundary: "13:00",
});
const { rows } = await db.query(text, params);

// Mirrors the dayType/flag logic in routes/api.js.
const CLOCK_DRIFT_HOURS = 1;
const BATCH_UPLOAD_MINUTES = 5;
const derive = (r) => {
  const complete = r.effective_scans > 1;
  const hours = r.hours === null ? null : Number(r.hours);
  const realHours = r.real_hours === null ? null : Number(r.real_hours);
  const drift = hours === null || realHours === null ? null : Math.abs(hours - realHours);
  const batch = realHours !== null && realHours * 60 < BATCH_UPLOAD_MINUTES;
  const dayType = !complete
    ? "HALF_DAY_NO_OUT"
    : r.has_first_half && r.has_second_half
      ? "FULL_DAY"
      : r.has_first_half
        ? "HALF_DAY_FIRST"
        : "HALF_DAY_SECOND";
  const flags = [];
  if (batch) flags.push("BATCH_UPLOAD");
  else if (drift !== null && drift > CLOCK_DRIFT_HOURS) flags.push("CLOCK_DRIFT");
  return { complete, hours, realHours, dayType, flags };
};

const hhmm = (t) =>
  t === null || t === undefined
    ? null
    : new Date(new Date(t).getTime() + 330 * 60000).toISOString().slice(11, 16);

let failed = 0;
const check = (pin, field, got, want) => {
  const ok = got === want || (got === null && want === null);
  if (!ok) {
    failed++;
    console.log(`  ✗ PIN ${pin} ${field}: got ${got}, expected ${want}`);
  }
  return ok;
};

console.log(
  "PIN".padEnd(5) + "Check In".padEnd(10) + "Check Out".padEnd(11) +
  "Real Hrs".padEnd(10) + "Hours".padEnd(8) + "Day".padEnd(17) + "Flags"
);
console.log("-".repeat(78));

for (const c of CASES) {
  const r = rows.find((x) => x.pin === c.pin);
  if (!r) { failed++; console.log(`  ✗ PIN ${c.pin}: no row returned`); continue; }
  const d = derive(r);
  const checkIn = hhmm(r.first_punch);
  const checkOut = d.complete ? hhmm(r.last_punch) : null;

  console.log(
    String(c.pin).padEnd(5) + String(checkIn).padEnd(10) + String(checkOut ?? "—").padEnd(11) +
    String(d.realHours ?? "—").padEnd(10) + String(d.hours ?? "—").padEnd(8) +
    d.dayType.padEnd(17) + (d.flags.join(",") || "—")
  );

  const w = c.want;
  if (w.checkIn !== undefined) check(c.pin, "checkIn", checkIn, w.checkIn);
  if (w.checkOut !== undefined) check(c.pin, "checkOut", checkOut, w.checkOut);
  if (w.hours !== undefined) check(c.pin, "hours", d.hours, w.hours);
  if (w.realHours !== undefined) check(c.pin, "realHours", d.realHours, w.realHours);
  if (w.dayType !== undefined) check(c.pin, "dayType", d.dayType, w.dayType);
  if (w.effectiveScans !== undefined) check(c.pin, "effectiveScans", r.effective_scans, w.effectiveScans);
  if (w.repeatScans !== undefined) check(c.pin, "repeatScans", r.scans - r.effective_scans, w.repeatScans);
  if (w.flag !== undefined) check(c.pin, "flag", d.flags.includes(w.flag), true);
  if (w.firstHalf !== undefined) check(c.pin, "hasFirstHalf", r.has_first_half, w.firstHalf);
  if (w.secondHalf !== undefined) check(c.pin, "hasSecondHalf", r.has_second_half, w.secondHalf);
}

console.log("-".repeat(78));
console.log(failed ? `${failed} assertion(s) FAILED` : "All assertions passed");
await db.close();
process.exit(failed ? 1 : 0);
