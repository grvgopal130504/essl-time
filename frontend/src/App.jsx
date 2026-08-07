import { useEffect, useState } from "react";
import { api } from "./config.js";
import { useAdmsSocket } from "./hooks/useAdmsSocket.js";
import PunchFeed from "./components/PunchFeed.jsx";
import DevicePanel from "./components/DevicePanel.jsx";
import EmployeePanel from "./components/EmployeePanel.jsx";
import Timesheet from "./components/Timesheet.jsx";
import RawLogViewer from "./components/RawLogViewer.jsx";
import SetupCard from "./components/SetupCard.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

export default function App() {
  const { status, punches, rawLogs, devices, lastEventAt, names, lastNameUpdate, feedResetAt } =
    useAdmsSocket();
  const [tab, setTab] = useState("feed");
  const [health, setHealth] = useState(null);
  const [setup, setSetup] = useState(null);
  // Forces the "last seen" age to re-render even when no events are arriving.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () => {
      fetch(api("/api/health")).then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    };
    load();
    const t = setInterval(load, 15000);
    fetch(api("/api/setup")).then((r) => r.json()).then(setSetup).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const todayCount = punches.filter(
    (p) => new Date(p.punchTime || p.punch_time).toDateString() === new Date().toDateString()
  ).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">K90</div>
          <div>
            <h1>eSSL K90 Pro — Live Attendance</h1>
            <p className="sub">ADMS push receiver · local development</p>
          </div>
        </div>
        <div className="status-cluster">
          <span className={`pill ${status}`}>
            <i className="dot" /> {status}
          </span>
          <DeviceStatusPill devices={devices} tick={tick} />
          <span className={`pill ${health?.database === "connected" ? "connected" : "warn"}`}>
            DB: {health?.database ?? "…"}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <section className="stats">
        <Stat label="Punches today" value={todayCount} accent="green" />
        <Stat label="Total received" value={punches.length} />
        <Stat label="Devices seen" value={devices.length} />
        <Stat
          label="Last event"
          value={lastEventAt ? new Date(lastEventAt).toLocaleTimeString() : "—"}
          small
        />
      </section>

      <nav className="tabs">
        {[
          ["feed", `Live Feed${punches.length ? ` (${punches.length})` : ""}`],
          ["timesheet", "Timesheet"],
          ["employees", "Employees"],
          ["devices", "Devices"],
          ["raw", `Raw Requests${rawLogs.length ? ` (${rawLogs.length})` : ""}`],
          ["setup", "Device Setup"],
        ].map(([k, label]) => (
          <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "feed" && (
          <PunchFeed
            punches={punches}
            names={names}
            devices={devices}
            feedResetAt={feedResetAt}
          />
        )}
        {tab === "timesheet" && <Timesheet punches={punches} devices={devices} />}
        {tab === "employees" && <EmployeePanel devices={devices} nameUpdates={lastNameUpdate} />}
        {tab === "devices" && <DevicePanel devices={devices} />}
        {tab === "raw" && <RawLogViewer logs={rawLogs} />}
        {tab === "setup" && <SetupCard setup={setup} health={health} />}
      </main>
    </div>
  );
}

/**
 * The K90 Pro polls /iclock/getrequest roughly every 30s, so anything seen in
 * the last 2 minutes is genuinely online. Beyond that it's gone quiet.
 */
const ONLINE_WINDOW_MS = 120_000;

function DeviceStatusPill({ devices, tick }) {
  if (!devices.length) {
    return (
      <span className="pill" title="No device has contacted this server yet">
        <i className="dot" /> Device: waiting
      </span>
    );
  }

  const seenAt = (d) => new Date(d.lastSeen || d.last_seen_at || 0).getTime();
  const newest = [...devices].sort((a, b) => seenAt(b) - seenAt(a))[0];
  const sn = newest.sn || newest.serial_number || "unknown";
  const last = seenAt(newest);
  const age = Date.now() - last;
  const online = age < ONLINE_WINDOW_MS;

  const ago =
    !last ? "never"
    : age < 60_000 ? `${Math.max(1, Math.round(age / 1000))}s ago`
    : age < 3_600_000 ? `${Math.round(age / 60_000)}m ago`
    : age < 86_400_000 ? `${Math.round(age / 3_600_000)}h ago`
    : `${Math.round(age / 86_400_000)}d ago`;

  return (
    <span
      className={`pill ${online ? "connected" : "warn"}`}
      title={`${sn}${newest.ip ? ` · ${newest.ip}` : ""} · last contact ${ago}`}
      data-tick={tick}
    >
      <i className="dot" /> Device: {online ? "online" : ago}
      {devices.length > 1 && <span className="pill-sub"> +{devices.length - 1}</span>}
    </span>
  );
}

function Stat({ label, value, accent, small }) {
  return (
    <div className={`stat ${accent || ""}`}>
      <div className={small ? "stat-value small" : "stat-value"}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
