export default function SetupCard({ setup, health }) {
  const s = setup?.settings;
  const hosted = setup?.mode === "hosted";

  return (
    <div className="cards">
      <div className="card wide">
        <div className="card-head">
          <h3>Configure the K90 Pro</h3>
          {setup && (
            <span className={`badge ${hosted ? "blue" : "green"}`}>
              {hosted ? "Hosted (public)" : "Local network"}
            </span>
          )}
        </div>
        <p className="muted">
          On the device: {setup?.menuPath || "Menu → Comm → Cloud Server Setting"}
        </p>
        <table className="setup-table">
          <tbody>
            <tr><td>Server Mode</td><td className="mono">{s?.serverMode || "ADMS"}</td></tr>
            <tr>
              <td>Enable Domain Name</td>
              <td className="mono strong">{s?.enableDomainName ?? "…"}</td>
            </tr>
            <tr>
              <td>Server Address</td>
              <td className="mono strong">{s?.serverAddress || "…"}</td>
            </tr>
            <tr>
              <td>Server Port</td>
              <td className="mono strong">{s?.serverPort ?? "…"}</td>
            </tr>
            <tr><td>Proxy</td><td className="mono">OFF</td></tr>
          </tbody>
        </table>

        {setup?.endpoint && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Device will POST to <code>{setup.endpoint}</code>
          </p>
        )}

        {!hosted && setup?.allDetectedIPs?.length > 1 && (
          <p className="muted small">
            Multiple network interfaces detected — use the one on the same subnet as the device:{" "}
            {setup.allDetectedIPs.map((i) => `${i.address} (${i.iface})`).join(", ")}
          </p>
        )}
      </div>

      <div className="card wide">
        <div className="card-head">
          <h3>{hosted ? "Before the device will connect" : "Checklist"}</h3>
        </div>
        <ul className="check">
          {(setup?.notes || []).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
          {!hosted && <li>Laptop and K90 Pro on the same LAN / subnet</li>}
          <li>
            Server uptime: {health ? `${health.uptimeSeconds}s` : "—"} · Database:{" "}
            {health?.database ?? "—"}
          </li>
        </ul>
      </div>
    </div>
  );
}
