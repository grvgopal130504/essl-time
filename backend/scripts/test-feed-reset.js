/**
 * The daily live-feed reset, against a real Postgres (PGlite).
 *
 * The point of this test is the guarantee the feature rests on: clearing the
 * feed must not touch attendance_logs, because the timesheet reads that table.
 *
 *     npm --prefix backend run test:feed-reset
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
await db.exec(readFileSync(join(here, "../src/db/schema.sql"), "utf8"));

const TODAY = "2026-08-06";
const YESTERDAY = "2026-08-05";

const addFeed = (pin, day, hhmm) =>
  db.query(
    `INSERT INTO live_feed
       (event_id, device_sn, pin, punch_time, received_at, work_date, role, role_label, duplicate)
     VALUES ($1,'SN1',$2,$3,$3,$4::date,'CHECK_IN','Check In',false)
     ON CONFLICT (event_id) DO NOTHING`,
    [`SN1-${pin}-${day}-${hhmm}`, pin, `${day}T${hhmm}:00+05:30`, day]
  );

const addAttendance = (pin, day, hhmm) =>
  db.query(
    `INSERT INTO attendance_logs (device_sn, pin, punch_time, status) VALUES ('SN1',$1,$2,0)`,
    [pin, `${day}T${hhmm}:00+05:30`]
  );

// Two days of activity, written to both tables exactly as the server does.
for (const [day, times] of [[YESTERDAY, ["09:00", "18:00"]], [TODAY, ["09:30", "13:30", "18:30"]]]) {
  for (const t of times) {
    await addFeed("14", day, t);
    await addAttendance("14", day, t);
  }
}

const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n;
const feedTotal = () => count(`SELECT COUNT(*)::int AS n FROM live_feed`);
const feedFor = (d) => count(`SELECT COUNT(*)::int AS n FROM live_feed WHERE work_date = $1::date`, [d]);
const attendanceTotal = () => count(`SELECT COUNT(*)::int AS n FROM attendance_logs`);
const attendanceDays = async () =>
  (await db.query(
    `SELECT DISTINCT ((punch_time AT TIME ZONE 'UTC') + '+05:30'::interval)::date AS d
       FROM attendance_logs ORDER BY d`
  )).rows.map((r) => (r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10)));

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};

console.log("before the reset");
check("feed holds both days", await feedTotal(), 5);
check("attendance holds both days", await attendanceTotal(), 5);

// This is the exact statement in repository.purgeFeedExcept().
const purged = await db.query(`DELETE FROM live_feed WHERE work_date <> $1::date`, [TODAY]);

console.log("after the reset");
check("yesterday's feed rows were deleted", purged.affectedRows, 2);
check("feed now holds today only", await feedTotal(), 3);
check("today's feed is intact", await feedFor(TODAY), 3);
check("yesterday's feed is gone", await feedFor(YESTERDAY), 0);

console.log("the guarantee");
check("attendance_logs is COMPLETELY untouched", await attendanceTotal(), 5);
check("both days still available to the timesheet", await attendanceDays(), [YESTERDAY, TODAY]);

console.log("re-running the reset");
const again = await db.query(`DELETE FROM live_feed WHERE work_date <> $1::date`, [TODAY]);
check("is idempotent — nothing left to delete", again.affectedRows, 0);
check("attendance still untouched", await attendanceTotal(), 5);

console.log("duplicate delivery");
await addFeed("14", TODAY, "09:30"); // device re-sends the same batch
check("the same event is not stored twice", await feedFor(TODAY), 3);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
await db.close();
process.exit(failed ? 1 : 0);
