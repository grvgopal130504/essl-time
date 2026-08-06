/**
 * Filtering and sorting for the Timesheet table.
 *
 * Kept out of the component so it can be exercised without a browser —
 * see frontend/scripts/test-timesheet-view.js.
 */

/**
 * Day-type filter options.
 *
 * These are grouped by *which half was actually worked*, not by the dayType
 * label alone. That matters because a single afternoon scan is classified
 * HALF_DAY_NO_OUT — so filtering on the raw label would hide it from
 * "Half Day (2nd)", which is exactly where someone looking for afternoon-only
 * days expects to find it.
 */
export const DAY_TYPES = [
  ["FULL_DAY", "Full Day"],
  ["HALF_ANY", "Half Day — any"],
  ["HALF_FIRST", "Half Day (1st half)"],
  ["HALF_SECOND", "Half Day (2nd half)"],
  ["HALF_NO_OUT", "Half Day (no check-out)"],
];

const isHalf = (d) => d.dayType.startsWith("HALF_DAY");

/**
 * Fall back to the raw label when a server hasn't sent the half flags yet, so
 * an older backend degrades to the previous behaviour instead of matching
 * nothing.
 */
const inFirstHalf = (d) => d.hasFirstHalf ?? d.dayType === "HALF_DAY_FIRST";
const inSecondHalf = (d) => d.hasSecondHalf ?? d.dayType === "HALF_DAY_SECOND";

const DAY_TYPE_MATCH = {
  FULL_DAY: (d) => d.dayType === "FULL_DAY",
  HALF_ANY: isHalf,
  HALF_FIRST: (d) => isHalf(d) && inFirstHalf(d),
  HALF_SECOND: (d) => isHalf(d) && inSecondHalf(d),
  HALF_NO_OUT: (d) => d.dayType === "HALF_DAY_NO_OUT",
};

export const FLAGS = [
  ["__any", "Any flag"],
  ["SHORT_DAY", "Short day"],
  ["LONG_DAY", "Over max hours"],
  ["SHORT_HOURS", "Under min hours"],
  ["NO_MORNING_SCAN", "No morning scan"],
  ["MULTI_SCAN", "Multiple scans"],
  ["CLOCK_DRIFT", "Clock drift"],
  ["BATCH_UPLOAD", "Batch upload"],
  ["__none", "No flags (clean days)"],
];

export const COLUMNS = [
  { key: "workDate", label: "Date", width: 110 },
  { key: "employee", label: "Employee" },
  { key: "checkIn", label: "Check In", width: 96 },
  { key: "checkOut", label: "Check Out", width: 100 },
  {
    key: "checkInReceived", label: "In Received", width: 105,
    title: "Server clock — when the check-in punch reached the database",
  },
  {
    key: "checkOutReceived", label: "Out Received", width: 108,
    title: "Server clock — when the check-out punch reached the database",
  },
  {
    key: "realHours", label: "Real Hrs", width: 100,
    title: "Gap between the two received timestamps. Unaffected by the device's own clock.",
  },
  { key: "hours", label: "Hours", width: 100 },
  { key: "dayType", label: "Day", width: 120 },
  { key: "scans", label: "Scans", width: 80 },
  { key: "flags", label: "Review", width: 180 },
];

/**
 * How each column is sorted. Returning null pushes a row to the bottom in both
 * directions — a missing check-out is "unknown", not "earliest" or "latest".
 */
const SORTERS = {
  workDate: (d) => d.workDate,
  employee: (d) => (d.employeeName || `PIN ${d.pin}`).toLowerCase(),
  checkIn: (d) => (d.checkIn ? new Date(d.checkIn).getTime() : null),
  checkOut: (d) => (d.checkOut ? new Date(d.checkOut).getTime() : null),
  checkInReceived: (d) => (d.checkInReceived ? new Date(d.checkInReceived).getTime() : null),
  checkOutReceived: (d) => (d.checkOutReceived ? new Date(d.checkOutReceived).getTime() : null),
  realHours: (d) => d.realHours,
  hours: (d) => d.hours,
  dayType: (d) => d.dayTypeLabel,
  scans: (d) => d.effectiveScans,
  flags: (d) => d.flags.length,
};

export const empKey = (d) => `${d.deviceSn ?? d.device_sn}:${d.pin}`;

/** none -> asc -> desc -> none */
export const nextDir = (dir) => (dir === null ? "asc" : dir === "asc" ? "desc" : null);

export function filterDays(days, { employee = "", query = "", dayType = "", flag = "" } = {}) {
  const q = query.trim().toLowerCase();
  return days.filter((d) => {
    if (employee && empKey(d) !== employee) return false;
    if (dayType && !(DAY_TYPE_MATCH[dayType] ?? ((x) => x.dayType === dayType))(d)) return false;
    if (flag === "__any" && !d.flags.length) return false;
    if (flag === "__none" && d.flags.length) return false;
    if (flag && flag !== "__any" && flag !== "__none" && !d.flags.some((f) => f.code === flag))
      return false;
    if (q && !`${d.employeeName || ""} ${d.pin}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Array.prototype.sort is stable, so rows that tie keep the server's ordering
 * (newest date first, then PIN) underneath the chosen column.
 */
export function sortDays(days, { key, dir }) {
  if (!key || !dir || !SORTERS[key]) return days;
  const get = SORTERS[key];
  const mul = dir === "asc" ? 1 : -1;
  return [...days].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    // Unknowns sink to the bottom whichever way the column is pointing.
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "string") return av.localeCompare(bv, undefined, { numeric: true }) * mul;
    return (av - bv) * mul;
  });
}

/** Totals for whatever survived the filters, so a filtered view still adds up. */
export function summarise(days) {
  const worked = days.filter((d) => d.hours !== null);
  return {
    days: days.length,
    employees: new Set(days.map(empKey)).size,
    hours: Number(worked.reduce((s, d) => s + d.hours, 0).toFixed(2)),
    review: days.filter((d) => d.needsReview).length,
    fullDays: days.filter((d) => d.dayType === "FULL_DAY").length,
    halfDays: days.filter((d) => d.dayType.startsWith("HALF_DAY")).length,
  };
}
