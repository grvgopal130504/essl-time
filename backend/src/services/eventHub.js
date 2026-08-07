import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { log } from "../utils/logger.js";

export const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Rolling in-memory buffers so a freshly-opened UI has something to show. */
const RING = 200;
export const recentPunches = [];
export const recentRaw = [];
export const deviceState = new Map(); // sn -> { sn, ip, lastSeen, firmware, punches }

function push(arr, item) {
  arr.unshift(item);
  if (arr.length > RING) arr.pop();
}

export function recordPunch(p) {
  push(recentPunches, p);
  bus.emit("punch", p);
}

/**
 * Empty the punch ring at the daily feed reset. Only the feed reads this
 * buffer — the timesheet reads Postgres — so clearing it loses nothing.
 * Returns how many were dropped.
 */
export function clearPunchBuffer() {
  const n = recentPunches.length;
  recentPunches.length = 0;
  return n;
}

export function recordRaw(entry) {
  push(recentRaw, entry);
  bus.emit("raw", entry);
}

/** An employee name was learned (from the device) or edited (from the dashboard). */
export function emitEmployee(emp) {
  bus.emit("employee", emp);
}

export function recordDevice({ sn, ip, firmware, name }) {
  if (!sn) return;
  const prev = deviceState.get(sn) || { sn, punches: 0 };
  const next = {
    ...prev,
    sn,
    ip: ip || prev.ip,
    firmware: firmware || prev.firmware,
    // A handshake must never wipe the human-assigned label.
    name: name !== undefined ? name : prev.name ?? null,
    lastSeen: new Date().toISOString(),
  };
  deviceState.set(sn, next);
  bus.emit("device", next);
}

/**
 * Rename a device from the dashboard. Kept in the same map the WebSocket
 * snapshot is built from, so every open tab sees the new label immediately.
 */
export function setDeviceLabel(sn, name) {
  if (!sn) return null;
  const prev = deviceState.get(sn) || { sn, punches: 0 };
  const next = { ...prev, sn, name: name || null };
  deviceState.set(sn, next);
  bus.emit("device", next);
  return next;
}

/**
 * Seed the in-memory map from the devices table at startup, so names (and the
 * device list itself) survive a restart instead of waiting for the next poll.
 */
export function hydrateDevices(rows = []) {
  for (const r of rows) {
    const sn = r.serial_number || r.sn;
    if (!sn || deviceState.has(sn)) continue;
    deviceState.set(sn, {
      sn,
      name: r.name || null,
      ip: r.ip_address || null,
      firmware: r.firmware || null,
      lastSeen: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      punches: 0,
    });
  }
  return deviceState.size;
}

export function bumpDevicePunchCount(sn) {
  const d = deviceState.get(sn);
  if (d) d.punches = (d.punches || 0) + 1;
}

export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const broadcast = (type, payload) => {
    const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  };

  bus.on("punch", (p) => broadcast("punch", p));
  bus.on("raw", (r) => broadcast("raw", r));
  bus.on("device", (d) => broadcast("device", d));
  bus.on("employee", (e) => broadcast("employee", e));
  // A new local day started — dashboards should empty their feed.
  bus.on("feed-reset", (r) => broadcast("feed-reset", r));

  wss.on("connection", (ws, req) => {
    log.info(`WebSocket client connected (${wss.clients.size} total) from ${req.socket.remoteAddress}`);
    ws.send(
      JSON.stringify({
        type: "snapshot",
        payload: {
          punches: recentPunches,
          raw: recentRaw.slice(0, 50),
          devices: [...deviceState.values()],
        },
        ts: new Date().toISOString(),
      })
    );
    ws.on("close", () => log.info(`WebSocket client disconnected (${wss.clients.size} left)`));
    ws.on("error", (e) => log.warn("WebSocket error:", e.message));
  });

  // keepalive
  setInterval(() => {
    for (const c of wss.clients) if (c.readyState === 1) c.ping();
  }, 30000).unref();

  return wss;
}
