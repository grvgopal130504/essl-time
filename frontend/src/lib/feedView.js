/**
 * Merging the live WebSocket punches with the stored feed from /api/feed.
 *
 * Two sources describe the same events in different shapes:
 *   - WebSocket  camelCase, e.g. { id, deviceSn, punchTime, roleLabel }
 *   - /api/feed  snake_case from Postgres, e.g. { event_id, device_sn, punch_time }
 *
 * Kept out of the component so it can be tested without a browser —
 * see frontend/scripts/test-feed-view.js.
 */

export const PAGE_SIZES = [50, 100, 300, "all"];

/** Same punch from either source must produce the same key. */
export const feedKey = (p) =>
  p.id ||
  p.event_id ||
  `${p.deviceSn || p.device_sn}-${p.pin}-${p.punchTime || p.punch_time}`;

const punchMs = (p) => new Date(p.punchTime || p.punch_time).getTime();

/**
 * Newest first, de-duplicated. Live events win over stored ones for the same
 * key: a punch that just arrived over the socket carries the freshest employee
 * name, and the stored copy may predate a rename.
 */
export function mergeFeed(live = [], stored = []) {
  const byKey = new Map();
  for (const p of stored) byKey.set(feedKey(p), p);
  for (const p of live) byKey.set(feedKey(p), p);
  return [...byKey.values()].sort((a, b) => punchMs(b) - punchMs(a));
}

/** `limit === "all"` (or null) renders everything. */
export function pageOf(rows, limit) {
  if (limit === "all" || limit === null || limit === undefined) return rows;
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? rows.slice(0, n) : rows;
}

/** Keep only punches belonging to the given local day (YYYY-MM-DD). */
export function onlyDay(rows, workDate) {
  if (!workDate) return rows;
  return rows.filter((p) => {
    const d = new Date(p.punchTime || p.punch_time);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === workDate;
  });
}
