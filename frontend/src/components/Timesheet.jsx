import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../config.js";
import {
  COLUMNS,
  DAY_TYPES,
  FLAGS,
  empKey,
  filterDays,
  nextDir,
  sortDays,
  summarise,
} from "../lib/timesheetView.js";
import {
  DEVICE_FILTER_KEYS,
  deviceOptions,
  snsIn,
} from "../lib/deviceFilter.js";
import { useDeviceFilter } from "../hooks/useDeviceFilter.js";

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const time = (t) =>
  t ? new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";

const hhmm = (h) => {
  if (h === null || h === undefined) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

/**
 * Server-clock arrival time. Shows the date as well when the row reached the
 * server on a different day from the one it was filed under — which is exactly
 * what a wrong device date looks like.
 */
const received = (t, workDate) => {
  if (!t) return "—";
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  const localDay = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const clock = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return localDay === workDate ? clock : `${localDay.slice(5)} ${clock}`;
};

const DAY_BADGE = {
  FULL_DAY: "green",
  HALF_DAY_FIRST: "blue",
  HALF_DAY_SECOND: "blue",
  HALF_DAY_NO_OUT: "amber",
  ABSENT: "red",
  WEEKLY_OFF: "grey",
};

const SORT_ICON = { asc: "▲", desc: "▼" };

/**
 * "Half Day" alone doesn't say which half — but the filter groups on it, so the
 * badge should be able to explain itself on hover.
 */
const halfTitle = (d) => {
  const halves = [d.hasFirstHalf && "first half", d.hasSecondHalf && "second half"].filter(Boolean);
  if (!halves.length) return undefined;
  return `Scans in the ${halves.join(" and ")} of the day`;
};

function SortHeader({ col, sort, onSort }) {
  const active = sort.key === col.key && sort.dir;
  return (
    <th className="th-sortable" style={col.width ? { width: col.width } : undefined} title={col.title}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`th-sort${active ? " active" : ""}`}
        onClick={() => onSort(col.key)}
        title={
          active
            ? sort.dir === "asc"
              ? "Sorted ascending — click for descending"
              : "Sorted descending — click to clear"
            : "Click to sort ascending"
        }
      >
        <span>{col.label}</span>
        <span className="sort-icon" aria-hidden="true">{active ? SORT_ICON[sort.dir] : "⇅"}</span>
      </button>
    </th>
  );
}

export default function Timesheet({ punches, devices = [] }) {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters — all applied in the browser to the range already loaded.
  const [employee, setEmployee] = useState("");   // "deviceSn:pin"
  const [query, setQuery] = useState("");         // free text over name + PIN
  const [dayType, setDayType] = useState("");
  const [flag, setFlag] = useState("");
  const [roster, setRoster] = useState([]);       // everyone who has ever punched
  // Device choice survives a reload — see hooks/useDeviceFilter.js.
  const [device, setDevice] = useDeviceFilter(DEVICE_FILTER_KEYS.timesheet);

  // Sorting — null direction means "server order" (newest date, then PIN).
  const [sort, setSort] = useState({ key: null, dir: null });
  const toggleSort = (key) =>
    setSort((s) => {
      const dir = s.key === key ? nextDir(s.dir) : "asc";
      return dir === null ? { key: null, dir: null } : { key, dir };
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(api(`/api/timesheet?from=${from}&to=${to}`));
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e.message);
      setData(null);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // The Employee Name dropdown lists everyone who has ever punched, not just
  // whoever appears in the current range — otherwise the list would shuffle
  // every time the dates change, and you could never select a missing person.
  useEffect(() => {
    let cancelled = false;
    fetch(api("/api/pins"))
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (cancelled) return;
        setRoster(
          rows
            .map((r) => ({ key: `${r.device_sn}:${r.pin}`, pin: r.pin, name: r.name }))
            .sort((a, b) =>
              (a.name || `￿${a.pin}`).localeCompare(b.name || `￿${b.pin}`, undefined, {
                numeric: true,
              })
            )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A new punch today may change someone's check-out — refresh quietly.
  useEffect(() => {
    if (!punches.length || to !== todayStr()) return;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [punches.length, to, load]);

  const setToday = () => {
    setFrom(todayStr());
    setTo(todayStr());
  };
  const setLast7 = () => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const p = (n) => String(n).padStart(2, "0");
    setFrom(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    setTo(todayStr());
  };

  const filtersActive = !!(employee || query.trim() || dayType || flag || device);
  const clearFilters = () => {
    setEmployee("");
    setQuery("");
    setDayType("");
    setFlag("");
    setDevice("");
  };

  // Every device known to the server, plus any serial present in this range.
  const deviceList = useMemo(
    () => deviceOptions(devices, snsIn(data?.days || [])),
    [devices, data]
  );

  // Employees are scoped per device, so narrowing the device narrows the roster
  // — otherwise the dropdown offers people who can't appear in the table.
  const visibleRoster = useMemo(
    () => (device ? roster.filter((r) => r.key.startsWith(`${device}:`)) : roster),
    [roster, device]
  );

  // A selected employee belongs to one device; switching device would leave a
  // selection that matches nothing, so drop it.
  useEffect(() => {
    if (device && employee && !employee.startsWith(`${device}:`)) setEmployee("");
  }, [device, employee]);

  const visible = useMemo(
    () =>
      data
        ? sortDays(filterDays(data.days, { employee, query, dayType, flag, device }), sort)
        : [],
    [data, employee, query, dayType, flag, device, sort]
  );

  const shown = useMemo(() => summarise(visible), [visible]);

  return (
    <div>
      <div className="ts-toolbar">
        <label className="ts-field">
          From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="ts-field">
          To <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn" onClick={setToday}>Today</button>
        <button className="btn" onClick={setLast7}>Last 7 days</button>
      </div>

      <div className="ts-toolbar ts-filters">
        <label className="ts-field ts-field-wide">
          Device
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            {deviceList.map((o) => (
              <option key={o.sn || "__all"} value={o.sn}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="ts-field ts-field-wide">
          Employee Name
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">All employees</option>
            {visibleRoster.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name ? `${r.name} (#${r.pin})` : `PIN ${r.pin}`}
              </option>
            ))}
          </select>
        </label>

        <label className="ts-field ts-field-wide">
          Search name or PIN
          <input
            type="search"
            value={query}
            placeholder="e.g. Ravi or 14"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <label className="ts-field">
          Day type
          <select value={dayType} onChange={(e) => setDayType(e.target.value)}>
            <option value="">All day types</option>
            {DAY_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>

        <label className="ts-field">
          Review flag
          <select value={flag} onChange={(e) => setFlag(e.target.value)}>
            <option value="">All rows</option>
            {FLAGS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>

        <button className="btn" onClick={clearFilters} disabled={!filtersActive}>
          Clear filters
        </button>

        {/* The card layout on phones hides the table header, so sorting needs
            its own control there. */}
        <label className="ts-field ts-sort-field">
          Sort by
          <select
            value={sort.key && sort.dir ? `${sort.key}:${sort.dir}` : ""}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              setSort(key ? { key, dir } : { key: null, dir: null });
            }}
          >
            <option value="">Default (newest first)</option>
            {COLUMNS.map((c) => (
              <optgroup key={c.key} label={c.label}>
                <option value={`${c.key}:asc`}>{c.label} ↑</option>
                <option value={`${c.key}:desc`}>{c.label} ↓</option>
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <p className="muted small ts-rule">
        Check-in = first scan of the day · Check-out = last scan · repeat scans within{" "}
        {data?.debounceSeconds ?? 120}s are ignored
      </p>
      <p className="muted small ts-rule">
        <strong>Hours</strong> uses the device's clock · <strong>Real Hrs</strong> uses the
        server's receive time. A gap over {data?.thresholds?.clockDriftHours ?? 1}h between them
        means the biometric's date/time is wrong.
      </p>

      {error && <div className="notice">Couldn't load timesheet: {error}</div>}
      {loading && !data && <div className="empty"><p>Loading…</p></div>}

      {data && (
        <>
          {/* Stats follow the filters, so a filtered view still adds up. */}
          <div className="stats ts-stats">
            <div className="stat">
              <div className="stat-value">{shown.employees}</div>
              <div className="stat-label">Employees</div>
            </div>
            <div className="stat green">
              <div className="stat-value">{hhmm(shown.hours)}</div>
              <div className="stat-label">Total hours</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {shown.fullDays}
                {shown.halfDays > 0 && (
                  <span className="muted" style={{ fontSize: 15 }}> +{shown.halfDays}½</span>
                )}
              </div>
              <div className="stat-label">Full / half days</div>
            </div>
            <div className={shown.absentDays ? "stat absentstat" : "stat"}>
              <div className="stat-value">{shown.absentDays}</div>
              <div className="stat-label">
                Absent
                {shown.weeklyOffDays > 0 && ` · ${shown.weeklyOffDays} weekly off`}
              </div>
            </div>
            <div className={shown.review ? "stat warnstat" : "stat"}>
              <div className="stat-value">{shown.review}</div>
              <div className="stat-label">Needs review</div>
            </div>
          </div>

          {filtersActive && (
            <div className="notice ts-filter-note">
              Showing <strong>{shown.days}</strong> of {data.days.length} day
              {data.days.length === 1 ? "" : "s"} in this range.
              <button className="btn btn-inline" onClick={clearFilters}>Clear filters</button>
            </div>
          )}

          {!filtersActive && data.totals.needsReview > 0 && (
            <div className="notice warn-notice">
              <strong>{data.totals.needsReview}</strong> day
              {data.totals.needsReview === 1 ? "" : "s"} need checking before payroll
              {data.totals.reviewedHours > 0 && <> — {hhmm(data.totals.reviewedHours)} of the total</>}.
              <button className="btn btn-inline" onClick={() => setFlag("__any")}>
                Show only these
              </button>
            </div>
          )}

          {!visible.length ? (
            <div className="empty">
              <div className="empty-icon">🗓</div>
              <h2>{filtersActive ? "No days match these filters" : "No attendance in this range"}</h2>
              {filtersActive && (
                <button className="btn" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
          ) : (
            <div className="ts-scroll">
            <table className="emp-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <SortHeader key={c.key} col={c} sort={sort} onSort={toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr
                    key={`${d.deviceSn}-${d.pin}-${d.workDate}`}
                    className={
                      d.dayType === "ABSENT"
                        ? "row-absent"
                        : d.dayType === "WEEKLY_OFF"
                          ? "row-off"
                          : d.needsReview
                            ? "row-warn"
                            : ""
                    }
                  >
                    {/* data-label drives the stacked card layout below 760px,
                        where the header row is hidden. */}
                    <td className="muted small ts-date" data-label="Date">{d.workDate}</td>
                    <td className="ts-name" data-label="Employee">
                      {d.employeeName ? (
                        <>
                          <strong>{d.employeeName}</strong>{" "}
                          <span className="muted mono small">#{d.pin}</span>
                        </>
                      ) : (
                        <span className="mono">PIN {d.pin}</span>
                      )}
                    </td>
                    <td className="mono" data-label="Check In">{time(d.checkIn)}</td>
                    <td className="mono" data-label="Check Out">
                      {d.complete ? (
                        time(d.checkOut)
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td
                      className="mono muted small"
                      data-label="In Received"
                      title={d.checkInReceived || ""}
                    >
                      {received(d.checkInReceived, d.workDate)}
                    </td>
                    <td
                      className="mono muted small"
                      data-label="Out Received"
                      title={d.checkOutReceived || ""}
                    >
                      {received(d.checkOutReceived, d.workDate)}
                    </td>
                    <td
                      data-label="Real Hrs"
                      className={
                        d.flags.some((f) => f.code === "CLOCK_DRIFT") ? "strong drift" : "muted"
                      }
                      title={
                        d.clockDrift === null
                          ? ""
                          : `Device and server disagree by ${d.clockDrift}h`
                      }
                    >
                      {hhmm(d.realHours)}
                    </td>
                    <td className={d.complete ? "strong" : "muted"} data-label="Hours">
                      {hhmm(d.hours)}
                    </td>
                    <td data-label="Day">
                      <span
                        className={`badge ${DAY_BADGE[d.dayType] || "grey"}`}
                        title={halfTitle(d)}
                      >
                        {d.dayTypeLabel}
                      </span>
                    </td>
                    <td className="muted small" data-label="Scans">
                      {d.effectiveScans}
                      {d.repeatScans > 0 && (
                        <span className="muted" title={`${d.repeatScans} repeat scan(s) ignored`}>
                          {" "}
                          (+{d.repeatScans})
                        </span>
                      )}
                    </td>
                    <td className="ts-flags" data-label="Review">
                      {d.flags.length ? (
                        d.flags.map((f) => (
                          <span key={f.code} className="badge amber flag-badge" title={f.detail}>
                            {f.label}
                          </span>
                        ))
                      ) : (
                        <span className="muted small ts-only-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
