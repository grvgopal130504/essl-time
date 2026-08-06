import { config } from "../config.js";
import { localDate } from "./attendanceRules.js";
import { insertFeedEvent, purgeFeedExcept } from "../db/repository.js";
import { clearPunchBuffer, recentPunches, bus } from "./eventHub.js";
import { log } from "../utils/logger.js";

/**
 * The live feed's storage and its daily reset.
 *
 * Scope, stated plainly: this module only ever writes to and deletes from the
 * `live_feed` table. It does not reference attendance_logs, so no bug in the
 * reset can affect the timesheet — that data is written separately by
 * insertAttendance() and is never purged.
 *
 * The day boundary is the LOCAL day (TZ_OFFSET), not the server's timezone, so
 * the feed rolls over at local midnight whether this runs on a laptop in IST or
 * on Azure in UTC.
 */

let currentDay = null;

/** The local day the feed is currently holding. */
export const feedDay = () => localDate(new Date(), config.tzOffset);

/**
 * Wipe the feed if the local day has moved on. Safe to call as often as you
 * like — it is a no-op within the same day.
 *
 * Returns the new day if a reset happened, otherwise null.
 */
export async function rolloverIfNeeded({ silent = false } = {}) {
  const today = feedDay();
  if (currentDay === today) return null;

  const previous = currentDay;
  const firstRun = previous === null;
  currentDay = today;

  // On the FIRST call we are only learning today's date, not crossing midnight.
  // Clearing the ring here would silently drop punches that arrived between
  // startup and the first call — which is every punch, if the first call is
  // triggered by a punch. Only a real day change empties the buffer.
  const dropped = firstRun ? 0 : clearPunchBuffer();
  const purged = await purgeFeedExcept(today);

  if (!firstRun) {
    log.info(
      `Live feed reset for ${today} — cleared ${dropped} in-memory, ${purged} stored punch(es) from ${previous}. Timesheet data untouched.`
    );
    bus.emit("feed-reset", { workDate: today, previous });
  } else if (purged && !silent) {
    log.info(`Live feed: removed ${purged} punch(es) from previous days on startup.`);
  }
  return today;
}

/** Record a punch in the feed table, rolling the day over first if due. */
export async function storeFeedEvent(punch) {
  await rolloverIfNeeded();
  return insertFeedEvent(punch, feedDay());
}

/**
 * Check for a rollover every minute. A punch arriving after midnight also
 * triggers one, but a quiet night would otherwise leave yesterday on screen
 * until the first person badges in.
 */
export function startFeedRollover(intervalMs = 60_000) {
  const timer = setInterval(() => {
    rolloverIfNeeded().catch((e) => log.warn("Feed rollover failed:", e.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

/** Feed events held in memory — used when Postgres is unavailable. */
export const bufferedFeed = () => {
  const today = feedDay();
  return recentPunches.filter(
    (p) => localDate(new Date(p.punchTime), config.tzOffset) === today
  );
};
