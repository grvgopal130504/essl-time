/**
 * The device filter shared by the Live Feed and the Timesheet.
 *
 * Devices arrive in two shapes, exactly like punches do:
 *   - WebSocket    { sn, name, ip, lastSeen }
 *   - /api/devices { serial_number, name, ip_address, last_seen_at }
 *
 * Everything here normalises both, so a component never has to care which
 * source it got its list from.
 *
 * Kept out of the components so it can be tested without a browser —
 * see frontend/scripts/test-device-filter.js.
 */

export const ALL_DEVICES = "";

/** Serial number of a device row, whichever shape it came in. */
export const deviceSnOf = (d) => d?.sn || d?.serial_number || null;

/** Serial number a punch or timesheet row belongs to. */
export const rowSnOf = (r) => r?.deviceSn || r?.device_sn || null;

/** Human label for the dropdown: "Device K90-AAA111 - Main Gate". */
export function deviceLabel(d) {
  const sn = deviceSnOf(d);
  if (!sn) return "Unknown device";
  const name = (d.name || "").trim();
  return name ? `Device ${sn} - ${name}` : `Device ${sn}`;
}

/**
 * Options for the select, "All" first.
 *
 * Serials seen on punches but not (yet) in the device list are appended, so a
 * filter can never hide rows it has no option to select.
 */
export function deviceOptions(devices = [], extraSns = []) {
  const byS = new Map();
  for (const d of devices) {
    const sn = deviceSnOf(d);
    if (sn) byS.set(sn, { sn, label: deviceLabel(d), name: d.name || null });
  }
  for (const sn of extraSns) {
    if (sn && !byS.has(sn)) byS.set(sn, { sn, label: `Device ${sn}`, name: null });
  }
  return [
    { sn: ALL_DEVICES, label: "All" },
    ...[...byS.values()].sort((a, b) => a.sn.localeCompare(b.sn, undefined, { numeric: true })),
  ];
}

/** Distinct serials present in a list of punches / timesheet days. */
export const snsIn = (rows = []) => [...new Set(rows.map(rowSnOf).filter(Boolean))];

/** Empty selection means "All" — never filter on it. */
export function filterByDevice(rows = [], sn = ALL_DEVICES) {
  if (!sn) return rows;
  return rows.filter((r) => rowSnOf(r) === sn);
}

/* ---------- persistence ---------- */

export const DEVICE_FILTER_KEYS = {
  feed: "essl.deviceFilter.feed",
  timesheet: "essl.deviceFilter.timesheet",
};

export function loadDeviceFilter(key) {
  try {
    return window.localStorage.getItem(key) || ALL_DEVICES;
  } catch {
    // Private mode / storage disabled — the filter just won't persist.
    return ALL_DEVICES;
  }
}

export function saveDeviceFilter(key, sn) {
  try {
    if (sn) window.localStorage.setItem(key, sn);
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
