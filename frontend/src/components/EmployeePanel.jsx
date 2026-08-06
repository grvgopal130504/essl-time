import { useEffect, useState, useCallback } from "react";
import { api } from "../config.js";

export default function EmployeePanel({ devices, nameUpdates }) {
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(api("/api/pins"));
      setRows(await r.json());
    } catch {
      setMsg("Couldn't reach the backend.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A name arriving over the WebSocket (device sync or another browser tab)
  useEffect(() => {
    if (!nameUpdates) return;
    setRows((cur) =>
      cur.map((r) =>
        r.device_sn === nameUpdates.deviceSn && r.pin === nameUpdates.pin
          ? { ...r, name: nameUpdates.name }
          : r
      )
    );
  }, [nameUpdates]);

  const key = (r) => `${r.device_sn}:${r.pin}`;

  const save = async (r) => {
    const k = key(r);
    const name = (drafts[k] ?? r.name ?? "").trim();
    setSaving(k);
    try {
      const res = await fetch(api(`/api/employees/${r.device_sn}/${r.pin}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json();
      setRows((cur) => cur.map((x) => (key(x) === k ? { ...x, name: j.name } : x)));
      setDrafts((d) => {
        const { [k]: _, ...rest } = d;
        return rest;
      });
      setMsg(j.warning || `Saved “${j.name || "(cleared)"}” for PIN ${r.pin}`);
    } catch (e) {
      setMsg(e.message);
    }
    setSaving(null);
  };

  const syncFromDevice = async (sn) => {
    setMsg("Queuing sync…");
    try {
      const r = await fetch(api(`/api/devices/${sn}/sync-users`), { method: "POST" });
      const j = await r.json();
      setMsg(
        j.queued?.length
          ? `${j.queued.length} command(s) queued — the device responds within ~30s, then reload.`
          : j.reason || "Nothing queued."
      );
    } catch (e) {
      setMsg(e.message);
    }
  };

  if (loading) return <div className="empty"><p>Loading…</p></div>;

  if (!rows.length) {
    return (
      <div className="empty">
        <div className="empty-icon">👤</div>
        <h2>No PINs recorded yet</h2>
        <p>Once someone punches, their PIN appears here and you can attach a name to it.</p>
      </div>
    );
  }

  const sn = devices[0]?.sn || devices[0]?.serial_number || rows[0]?.device_sn;

  return (
    <div>
      <div className="emp-toolbar">
        <p className="muted small">
          Type a name and press Enter. Names apply to every past and future punch for that PIN.
        </p>
        <button className="btn" onClick={() => syncFromDevice(sn)}>
          Pull names from device
        </button>
      </div>

      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="tbl-scroll">
      <table className="emp-table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>PIN</th>
            <th>Name</th>
            <th style={{ width: 90 }}>Punches</th>
            <th style={{ width: 160 }}>Last punch</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = key(r);
            const value = drafts[k] ?? r.name ?? "";
            const dirty = drafts[k] !== undefined && drafts[k] !== (r.name ?? "");
            return (
              <tr key={k}>
                <td className="mono strong">{r.pin}</td>
                <td>
                  <input
                    className="emp-input"
                    value={value}
                    placeholder="unnamed"
                    onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && save(r)}
                  />
                </td>
                <td className="muted">{r.punch_count}</td>
                <td className="muted small">
                  {r.last_punch ? new Date(r.last_punch).toLocaleString() : "—"}
                </td>
                <td>
                  <button className="btn" disabled={!dirty || saving === k} onClick={() => save(r)}>
                    {saving === k ? "…" : "Save"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
