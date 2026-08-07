import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../config.js";
import { PAGE_SIZES, feedKey, mergeFeed, onlyDay, pageOf } from "../lib/feedView.js";
import {
  DEVICE_FILTER_KEYS,
  deviceOptions,
  filterByDevice,
  snsIn,
} from "../lib/deviceFilter.js";
import { useDeviceFilter } from "../hooks/useDeviceFilter.js";

const VERIFY_ICON = {
  Fingerprint: "☝",
  Face: "☺",
  Card: "▣",
  Palm: "✋",
  Password: "•••",
};

function fmt(t) {
  if (!t) return "—";
  const d = new Date(t);
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

/** Server receive time — seconds matter here, and the date if it differs. */
function fmtReceived(received, punchTime) {
  if (!received) return null;
  const r = new Date(received);
  const clock = r.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const sameDay = punchTime && new Date(punchTime).toDateString() === r.toDateString();
  return sameDay
    ? clock
    : `${r.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${clock}`;
}

const round = (n) => Math.round(n * 100) / 100;
const span = (h) => (h >= 1 ? `${round(h)}h` : `${Math.round(h * 60)}m`);

/**
 * Compare the device's clock against the server's for a single punch.
 *
 * A punch stamped in the FUTURE relative to the moment it arrived can only mean
 * the device's clock is ahead — nothing else explains it, so that is reported
 * as certain drift.
 *
 * A punch that arrives LATE is ambiguous on its own: the device may have been
 * offline and is replaying a backlog, or its clock may be slow. The feed says
 * "delayed" and leaves the verdict to the Timesheet, which has the whole day to
 * compare against.
 */
function clockOffset(punchTime, received, toleranceSeconds = 120) {
  if (!punchTime || !received) return null;
  const deltaSec = (new Date(received).getTime() - new Date(punchTime).getTime()) / 1000;
  if (Math.abs(deltaSec) <= toleranceSeconds) return null;
  const hours = Math.abs(deltaSec) / 3600;
  return deltaSec < 0
    ? {
      kind: "ahead",
      label: `clock ahead ${span(hours)}`,
      title: `The device stamped this punch ${span(hours)} in the future — its date/time is wrong. Check Menu → System → Date/Time.`,
    }
    : {
      kind: "delayed",
      label: `Clock Difference ${span(hours)}`,
      title: `Reached the server ${span(hours)} after the device's timestamp. Either the device was offline and replayed a backlog, or its clock is slow.`,
    };
}

function ago(t) {
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function PunchFeed({ punches, names = {}, devices = [], feedResetAt = null }) {
  // Today's stored feed. The socket only carries what arrived while this tab
  // was open; this is everything the server has for the current local day.
  const [stored, setStored] = useState({ punches: [], total: 0, workDate: null, source: null });
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(api(`/api/feed?limit=${limit}`));
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      setStored(await r.json());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload at the daily reset so the emptied feed is reflected immediately.
  useEffect(() => {
    if (feedResetAt) load();
  }, [feedResetAt, load]);

  // Live punches arriving after the initial fetch aren't in `stored`, so merge
  // them in rather than re-fetching on every punch.
  const today = useMemo(
    () => onlyDay(mergeFeed(punches, stored.punches), stored.workDate),
    [punches, stored.punches, stored.workDate]
  );

  const [device, setDevice] = useDeviceFilter(DEVICE_FILTER_KEYS.feed);
  // Serials seen today are folded in, so a device that punched but hasn't been
  // registered yet is still selectable.
  const options = useMemo(() => deviceOptions(devices, snsIn(today)), [devices, today]);

  const all = useMemo(() => filterByDevice(today, device), [today, device]);
  const visible = useMemo(() => pageOf(all, limit), [all, limit]);
  // With a device selected the server's total counts every device, so the
  // filtered length is the only honest number.
  const total = device ? all.length : Math.max(stored.total || 0, all.length);

  const deviceSelect = (
    <label className="feed-device">
      <span className="muted small">Device</span>
      <select value={device} onChange={(e) => setDevice(e.target.value)}>
        {options.map((o) => (
          <option key={o.sn || "__all"} value={o.sn}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const controls = (
    <div className="feed-toolbar">
      <span className="muted small">
        Showing <strong>{visible.length}</strong> of {total} punch{total === 1 ? "" : "es"} today
        {device && <> on <strong>{device}</strong></>}
        {stored.source === "memory" && (
          <span className="badge amber flag-badge" title="Postgres is unreachable — this is the in-memory buffer, which only holds what arrived since the server started.">
            {" "}memory only
          </span>
        )}
      </span>
      <div className="feed-pages">
        {deviceSelect}
        {PAGE_SIZES.map((n) => (
          <button
            key={n}
            className={`btn btn-page${String(limit) === String(n) ? " active" : ""}`}
            onClick={() => setLimit(n)}
          >
            {n === "all" ? "All" : n}
          </button>
        ))}
        <button className="btn btn-page" onClick={load} disabled={loading} title="Reload from the server">
          ⟳
        </button>
      </div>
    </div>
  );

  // Filtered everything away, but the day does have punches on other devices.
  if (!all.length && today.length) {
    return (
      <>
        {controls}
        <div className="empty">
          <div className="empty-icon">▤</div>
          <h2>No punches from this device today</h2>
          <p>
            {today.length} punch{today.length === 1 ? "" : "es"} arrived today from other devices.
          </p>
          <button className="btn" onClick={() => setDevice("")}>
            Show all devices
          </button>
        </div>
      </>
    );
  }

  if (!all.length) {
    return (
      <>
        {controls}
        {error && <div className="notice">Couldn't load the feed: {error}</div>}
        <div className="empty">
          <div className="empty-icon">☝</div>
          <h2>{loading ? "Loading today's feed…" : "Waiting for a punch…"}</h2>
          <p>
            Place a finger on the K90 Pro. The moment it authenticates, the record appears here
            instantly.
          </p>
          <p className="hint">
            The feed holds one day and clears itself at midnight. Past days stay in the Timesheet.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {controls}
      {error && <div className="notice">Couldn't load the feed: {error}</div>}
      <div className="feed">
        {visible.map((p, i) => {
          const pin = p.pin;
          const time = p.punchTime || p.punch_time;
          const verifyLabel = p.verifyLabel || p.verify_label || "";
          const sn = p.deviceSn || p.device_sn;
          // Server clock: when this punch actually reached the database.
          const receivedAt = p.receivedAt || p.received_at;
          const offset = clockOffset(time, receivedAt);
          // Derived role wins; fall back to the device's own status field.
          const statusLabel =
            p.roleLabel || p.directionLabel || p.statusLabel || p.status_label || `Status ${p.status}`;
          const isOut = p.role ? p.role === "CHECK_OUT" : /out/i.test(statusLabel);
          const isNeutral = p.role === "RECORDED";
          // Live rename wins, then whatever the server attached to the punch.
          const name = names[`${sn}:${pin}`] ?? p.employeeName ?? p.employee_name ?? null;
          const initials = name
            ? name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
            : String(pin).slice(-3);
          return (
            <div key={feedKey(p)} className={`punch ${i === 0 ? "newest" : ""}`}>
              <div className={`avatar ${isNeutral ? "neutral" : isOut ? "out" : "in"}`}>
                {initials}
              </div>
              <div className="punch-main">
                <div className="punch-row">
                  {name ? (
                    <>
                      <strong>{name}</strong>
                      <span className="name mono">PIN {pin}</span>
                    </>
                  ) : (
                    <strong>PIN {pin}</strong>
                  )}
                  <span
                    className={`badge ${isNeutral ? "grey" : isOut ? "red" : "green"}`}
                    title={
                      isNeutral
                        ? "First half of the day — check-in stays at the first scan"
                        : undefined
                    }
                  >
                    {statusLabel}
                  </span>
                  {p.duplicate && (
                    <span className="badge amber" title="Within the de-bounce window — not counted">
                      repeat scan
                    </span>
                  )}
                  {offset && (
                    <span
                      className={`badge ${offset.kind === "ahead" ? "red" : "amber"}`}
                      title={offset.title}
                    >
                      {offset.label}
                    </span>
                  )}
                </div>
                <div className="punch-meta">
                  <span title="Device clock — the time the K90 Pro stamped on this punch">
                    {fmt(time)}
                  </span>
                  {receivedAt && (
                    <>
                      <span className="sep">·</span>
                      <span
                        className={offset ? "drift" : undefined}
                        title="Server clock — when this punch reached the database"
                      >
                        recv {fmtReceived(receivedAt, time)}
                      </span>
                    </>
                  )}
                  <span className="sep">·</span>
                  <span>{VERIFY_ICON[verifyLabel] || "•"} {verifyLabel || "unknown verify"}</span>
                  <span className="sep hide-sm">·</span>
                  <span className="mono hide-sm">{sn}</span>
                </div>
              </div>
              <div className="punch-ago">{ago(time)}</div>
            </div>
          );
        })}
        {visible.length < all.length && (
          <button className="btn feed-more" onClick={() => setLimit("all")}>
            Show all {all.length} punches from today
          </button>
        )}
      </div>
    </>
  );
}
