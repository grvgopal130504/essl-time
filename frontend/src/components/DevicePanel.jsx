import { useState } from "react";
import { api } from "../config.js";

export default function DevicePanel({ devices }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState("");

  if (!devices.length) {
    return (
      <div className="empty">
        <div className="empty-icon">▤</div>
        <h2>No device has connected yet</h2>
        <p>Once the K90 Pro reaches this server, it appears here with its serial number and IP.</p>
      </div>
    );
  }

  const syncUsers = async (sn) => {
    setBusy(sn);
    try {
      const r = await fetch(api(`/api/devices/${sn}/sync-users`), { method: "POST" });
      const j = await r.json();
      setMsg(j.id ? `Queued command #${j.id} — the device will pick it up on its next poll.` : JSON.stringify(j));
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(null);
  };

  return (
    <div className="cards">
      {msg && <div className="notice">{msg}</div>}
      {devices.map((d) => {
        const sn = d.sn || d.serial_number;
        const last = d.lastSeen || d.last_seen_at;
        const online = last && Date.now() - new Date(last).getTime() < 120000;
        return (
          <div key={sn} className="card">
            <div className="card-head">
              <h3 className="mono">{sn}</h3>
              <span className={`pill ${online ? "connected" : "warn"}`}>
                <i className="dot" /> {online ? "online" : "idle"}
              </span>
            </div>
            <dl className="kv">
              <dt>IP address</dt>
              <dd className="mono">{d.ip || d.ip_address || "—"}</dd>
              <dt>Firmware</dt>
              <dd>{d.firmware || "—"}</dd>
              <dt>Push version</dt>
              <dd>{d.push_version || "—"}</dd>
              <dt>Last seen</dt>
              <dd>{last ? new Date(last).toLocaleString() : "—"}</dd>
            </dl>
            <button className="btn" disabled={busy === sn} onClick={() => syncUsers(sn)}>
              {busy === sn ? "Queuing…" : "Request user list"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
