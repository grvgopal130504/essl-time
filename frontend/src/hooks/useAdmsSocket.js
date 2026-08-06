import { useEffect, useState } from "react";
import { WS_URL } from "../config.js";

const MAX = 300;

/** Stable identity for a punch — same punch always produces the same key. */
const punchKey = (p) =>
  p.id || `${p.deviceSn || p.device_sn}-${p.pin}-${p.punchTime || p.punch_time}-${p.status}`;

/** Prepend `incoming` to `list`, dropping anything already present. */
function mergeUnique(list, incoming, keyOf) {
  const seen = new Set(list.map(keyOf));
  const fresh = incoming.filter((x) => !seen.has(keyOf(x)));
  if (!fresh.length) return list;
  return [...fresh, ...list].slice(0, MAX);
}

export function useAdmsSocket() {
  const [status, setStatus] = useState("connecting");
  const [punches, setPunches] = useState([]);
  const [rawLogs, setRawLogs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [lastEventAt, setLastEventAt] = useState(null);
  // `${deviceSn}:${pin}` -> name, kept live so renaming updates the feed instantly
  const [names, setNames] = useState({});
  const [lastNameUpdate, setLastNameUpdate] = useState(null);
  // Bumped when the server rolls the feed over to a new local day.
  const [feedResetAt, setFeedResetAt] = useState(null);

  useEffect(() => {
    let socket = null;
    let retry = 0;
    let timer = null;
    let disposed = false; // set once, on unmount — never flipped back

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");

      const ws = new WebSocket(WS_URL);
      socket = ws;

      ws.onopen = () => {
        if (disposed || socket !== ws) return ws.close();
        retry = 0;
        setStatus("connected");
      };

      ws.onmessage = (ev) => {
        // Ignore anything from a socket we've already replaced or discarded.
        if (disposed || socket !== ws) return;

        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        setLastEventAt(new Date().toISOString());

        switch (msg.type) {
          case "snapshot":
            setPunches((cur) => mergeUnique(cur, msg.payload.punches || [], punchKey));
            setRawLogs((cur) => mergeUnique(cur, msg.payload.raw || [], (r) => r.id));
            setDevices(msg.payload.devices || []);
            break;
          case "punch":
            setPunches((cur) => mergeUnique(cur, [msg.payload], punchKey));
            break;
          case "raw":
            setRawLogs((cur) => mergeUnique(cur, [msg.payload], (r) => r.id));
            break;
          case "device":
            setDevices((cur) => [msg.payload, ...cur.filter((d) => d.sn !== msg.payload.sn)]);
            break;
          // A new local day began — yesterday's punches are no longer the feed.
          case "feed-reset":
            setPunches([]);
            setFeedResetAt(msg.ts || new Date().toISOString());
            break;
          case "employee":
            setNames((cur) => ({
              ...cur,
              [`${msg.payload.deviceSn}:${msg.payload.pin}`]: msg.payload.name,
            }));
            setLastNameUpdate(msg.payload);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        // Only the *current* socket may schedule a reconnect. A socket that was
        // superseded (StrictMode double-mount, HMR) just dies quietly.
        if (disposed || socket !== ws) return;
        setStatus("disconnected");
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { status, punches, rawLogs, devices, lastEventAt, names, lastNameUpdate, feedResetAt };
}
