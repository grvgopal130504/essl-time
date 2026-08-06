import { safeQuery } from "../db/pool.js";
import { log } from "../utils/logger.js";

/**
 * PIN -> name lookup held in memory so every incoming punch can be labelled
 * without a database round-trip (and still works if Postgres is down).
 * Key is `${deviceSn}:${pin}`.
 */
const names = new Map();

const key = (sn, pin) => `${sn}:${pin}`;

export function getName(sn, pin) {
  return names.get(key(sn, pin)) || null;
}

export function setName(sn, pin, name) {
  if (name) names.set(key(sn, pin), name);
  else names.delete(key(sn, pin));
}

export function allNames() {
  return [...names.entries()].map(([k, name]) => {
    const idx = k.indexOf(":");
    return { deviceSn: k.slice(0, idx), pin: k.slice(idx + 1), name };
  });
}

/** Warm the cache from the database on startup. */
export async function loadEmployeeCache() {
  const res = await safeQuery(`SELECT device_sn, pin, name FROM employees WHERE name IS NOT NULL`);
  if (!res) return 0;
  for (const r of res.rows) setName(r.device_sn, r.pin, r.name);
  if (res.rows.length) log.ok(`Loaded ${res.rows.length} employee name(s) from database`);
  return res.rows.length;
}
