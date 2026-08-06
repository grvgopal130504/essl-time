import { config } from "../config.js";
import { safeQuery } from "../db/pool.js";
import { log } from "../utils/logger.js";

/**
 * The K90 Pro sends status=0 on virtually every record because nobody presses
 * the F1/F2 state keys. So direction is derived, not trusted.
 *
 * The day is split at HALF_DAY_BOUNDARY (default 13:00):
 *
 *   FIRST scan of the day                        -> CHECK IN  (and it never moves)
 *   later scan still in the FIRST half           -> RECORDED  (check-in stays put)
 *   any scan in the SECOND half                  -> CHECK OUT (the latest wins)
 *   scan within DEBOUNCE_SECONDS of the previous -> repeat, keeps the last role
 *
 * So 09:30 → 11:30 → 16:00 → 23:00 gives check-in 09:30 (unmoved by the 11:30)
 * and check-out 23:00 (the 16:00 is superseded).
 *
 * The de-bounce is a separate concern: real data shows PIN 8 scanning three
 * times inside 31 seconds. Without it an arrival double-tap reads as a departure.
 */

/** Local calendar date (YYYY-MM-DD) for an instant, using TZ_OFFSET. */
export function localDate(date, offset = config.tzOffset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const mins = m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  return new Date(date.getTime() + mins * 60000).toISOString().slice(0, 10);
}

/** Local wall-clock time (minutes past midnight) for an instant. */
function localMinutes(date, offset = config.tzOffset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const mins = m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  const shifted = new Date(date.getTime() + mins * 60000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function boundaryMinutes() {
  const m = /^(\d{1,2}):(\d{2})$/.exec(config.halfDayBoundary);
  return m ? +m[1] * 60 + +m[2] : 13 * 60;
}

/** Which half of the working day an instant falls in. */
export function dayHalf(date) {
  return localMinutes(date) < boundaryMinutes() ? "FIRST" : "SECOND";
}

const ROLE_LABEL = {
  CHECK_IN: "Check In",
  CHECK_OUT: "Check Out",
  RECORDED: "Recorded",
};

/** state key -> { firstAt, lastAt, lastRole } */
const dayState = new Map();
const key = (sn, pin, day) => `${sn}:${pin}:${day}`;

const result = (role, day, half, duplicate) => ({
  role,
  roleLabel: ROLE_LABEL[role],
  // Kept for anything still reading direction/directionLabel.
  direction: role === "CHECK_OUT" ? "OUT" : "IN",
  directionLabel: ROLE_LABEL[role],
  half,
  workDate: day,
  duplicate,
});

export function classifyPunch({ deviceSn, pin, punchTime }) {
  const t = punchTime instanceof Date ? punchTime : new Date(punchTime);
  const day = localDate(t);
  const half = dayHalf(t);
  const k = key(deviceSn, pin, day);
  const prev = dayState.get(k);

  // First scan of the day is the check-in, whichever half it lands in.
  if (!prev) {
    dayState.set(k, { firstAt: t.getTime(), lastAt: t.getTime(), lastRole: "CHECK_IN" });
    return result("CHECK_IN", day, half, false);
  }

  const gapSeconds = (t.getTime() - prev.lastAt) / 1000;

  if (gapSeconds >= 0 && gapSeconds < config.debounceSeconds) {
    // Anchored to the previous scan so this matches repository.timesheet() exactly.
    prev.lastAt = t.getTime();
    return result(prev.lastRole, day, half, true);
  }

  // Out-of-order arrival (backlog replay) — earliest scan owns the check-in.
  if (t.getTime() < prev.firstAt) {
    prev.firstAt = t.getTime();
    return result("CHECK_IN", day, half, false);
  }

  prev.lastAt = Math.max(prev.lastAt, t.getTime());

  // Still in the first half: check-in is already set and must not move.
  if (half === "FIRST") {
    prev.lastRole = "RECORDED";
    return result("RECORDED", day, half, false);
  }

  prev.lastRole = "CHECK_OUT";
  return result("CHECK_OUT", day, half, false);
}

/**
 * Warm the day state from the database so a server restart mid-shift doesn't
 * relabel someone's afternoon punch as a fresh arrival.
 */
export async function loadTodayState() {
  const res = await safeQuery(
    `SELECT device_sn, pin,
            MIN(punch_time) AS first_at,
            MAX(punch_time) AS last_at
       FROM attendance_logs
      WHERE ((punch_time AT TIME ZONE 'UTC') + $1::interval)::date
            = ((NOW() AT TIME ZONE 'UTC') + $1::interval)::date
      GROUP BY device_sn, pin`,
    [config.tzOffset]
  );
  if (!res) return 0;

  for (const r of res.rows) {
    const first = new Date(r.first_at).getTime();
    const last = new Date(r.last_at).getTime();
    dayState.set(key(r.device_sn, r.pin, localDate(new Date(first))), {
      firstAt: first,
      lastAt: last,
      lastDirection: last > first ? "OUT" : "IN",
    });
  }
  if (res.rows.length) log.ok(`Restored today's in/out state for ${res.rows.length} employee(s)`);
  return res.rows.length;
}

/** Drop yesterday's entries so the map doesn't grow forever. */
export function pruneDayState() {
  const today = localDate(new Date());
  let removed = 0;
  for (const k of dayState.keys()) {
    if (!k.endsWith(`:${today}`)) {
      dayState.delete(k);
      removed++;
    }
  }
  return removed;
}
