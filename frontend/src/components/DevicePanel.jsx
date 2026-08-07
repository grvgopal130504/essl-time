import { useEffect, useState } from "react";
import { api } from "../config.js";
import { deviceSnOf } from "../lib/deviceFilter.js";

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
        const sn = deviceSnOf(d);
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
            <DeviceNameField sn={sn} name={d.name || ""} />
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

/**
 * The device's display name. Purely cosmetic — every record still keys on the
 * serial number — but it is what the Live Feed and Timesheet filters show.
 *
 * The saved name arrives back over the WebSocket, so the input tracks the prop
 * unless the user is mid-edit (`dirty`), which would otherwise yank their text
 * away as they type.
 */
function DeviceNameField({ sn, name }) {
  const [value, setValue] = useState(name);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState("idle"); // idle | saving | saved | error
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dirty) setValue(name);
  }, [name, dirty]);

  const save = async () => {
    const next = value.trim().slice(0, 60);
    if (next === (name || "")) {
      setDirty(false);
      return;
    }
    setState("saving");
    setError("");
    try {
      const r = await fetch(api(`/api/devices/${sn}/name`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const j = await r.json();
      setDirty(false);
      setState("saved");
      if (j.warning) setError(j.warning);
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setState("error");
      setError(e.message);
    }
  };

  return (
    <div className="device-name">
      <label className="ts-field ts-field-wide">
        Device name
        <input
          type="text"
          value={value}
          maxLength={60}
          placeholder="e.g. Main Gate"
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
            setState("idle");
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setValue(name);
              setDirty(false);
            }
          }}
        />
      </label>
      <button className="btn" onClick={save} disabled={state === "saving" || !dirty}>
        {state === "saving" ? "Saving…" : "Save"}
      </button>
      {state === "saved" && !error && <span className="badge green">saved</span>}
      {error && <span className="badge amber flag-badge" title={error}>{error}</span>}
    </div>
  );
}
