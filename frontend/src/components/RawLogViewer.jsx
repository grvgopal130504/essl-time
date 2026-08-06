import { useState } from "react";

export default function RawLogViewer({ logs }) {
  const [open, setOpen] = useState(null);

  if (!logs.length) {
    return (
      <div className="empty">
        <div className="empty-icon">{"</>"}</div>
        <h2>No raw requests yet</h2>
        <p>Every HTTP hit from the device is captured here verbatim — method, URL, headers, body.</p>
      </div>
    );
  }

  return (
    <div className="raw-list">
      {logs.map((l, i) => {
        const id = l.id || i;
        const url = l.url;
        const created = l.createdAt || l.created_at;
        const table = /table=([A-Za-z]+)/.exec(url || "")?.[1];
        return (
          <div key={id} className="raw-item">
            <button className="raw-head" onClick={() => setOpen(open === id ? null : id)}>
              <span className={`method ${l.method}`}>{l.method}</span>
              <span className="mono path">{url}</span>
              {table && <span className="badge blue">{table}</span>}
              <span className="raw-time">{new Date(created).toLocaleTimeString()}</span>
              <span className="chev">{open === id ? "▾" : "▸"}</span>
            </button>
            {open === id && (
              <div className="raw-body">
                <h4>From</h4>
                <pre>{l.remoteIp || l.remote_ip}</pre>
                <h4>Headers</h4>
                <pre>{JSON.stringify(l.headers, null, 2)}</pre>
                <h4>Body</h4>
                <pre>{l.body ? l.body.replace(/\t/g, "  ⇥  ") : "<empty>"}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
