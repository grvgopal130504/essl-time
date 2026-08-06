import { config } from "../config.js";

/**
 * ZKTeco / eSSL PUSH SDK ("ADMS") payloads are tab-separated lines.
 *
 * ATTLOG line:
 *   PIN \t YYYY-MM-DD HH:MM:SS \t Status \t VerifyMode \t WorkCode \t Reserved...
 *
 * OPERLOG / USERINFO line:
 *   USER PIN=1\tName=John\tPri=0\tPasswd=\tCard=123\tGrp=1\tTZ=...
 */

export const VERIFY_MODES = {
  0: "Password",
  1: "Fingerprint",
  2: "Password",
  3: "Card",
  4: "Card",
  15: "Face",
  16: "Fingerprint+Password",
  25: "Palm",
};

export const PUNCH_STATUS = {
  0: "Check In",
  1: "Check Out",
  2: "Break Out",
  3: "Break In",
  4: "Overtime In",
  5: "Overtime Out",
};

/** Device sends "2026-08-05 09:15:33" with no zone. Attach the configured offset. */
export function parseDeviceTime(str) {
  if (!str) return null;
  const s = String(str).trim().replace(" ", "T");
  const iso = /[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}${config.tzOffset}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function splitLines(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function parseAttlog(body, deviceSn) {
  const out = [];
  for (const line of splitLines(body)) {
    const parts = line.split(/\t+/);
    if (parts.length < 2) continue;
    const punchTime = parseDeviceTime(parts[1]);
    if (!punchTime) continue;
    const status = parts[2] !== undefined && parts[2] !== "" ? parseInt(parts[2], 10) : null;
    const verifyMode = parts[3] !== undefined && parts[3] !== "" ? parseInt(parts[3], 10) : null;
    out.push({
      deviceSn,
      pin: parts[0].trim(),
      punchTime,
      status: Number.isNaN(status) ? null : status,
      verifyMode: Number.isNaN(verifyMode) ? null : verifyMode,
      workCode: parts[4] || null,
      rawLine: line,
      statusLabel: PUNCH_STATUS[status] ?? `Status ${status ?? "?"}`,
      verifyLabel: VERIFY_MODES[verifyMode] ?? `Mode ${verifyMode ?? "?"}`,
    });
  }
  return out;
}

export function parseOperlog(body, deviceSn) {
  const users = [];
  for (const line of splitLines(body)) {
    if (!line.startsWith("USER")) continue;
    const kv = {};
    for (const token of line.replace(/^USER\s*/, "").split(/\t+/)) {
      const idx = token.indexOf("=");
      if (idx > 0) kv[token.slice(0, idx).trim()] = token.slice(idx + 1).trim();
    }
    if (!kv.PIN) continue;
    users.push({
      deviceSn,
      pin: kv.PIN,
      name: kv.Name || null,
      cardNo: kv.Card || null,
      privilege: parseInt(kv.Pri || "0", 10) || 0,
    });
  }
  return users;
}

/** Handshake body from the device: "key=value" pairs separated by commas/newlines. */
export function parseDeviceInfo(body) {
  const info = {};
  for (const token of String(body || "").split(/[,\r\n]+/)) {
    const idx = token.indexOf("=");
    if (idx > 0) info[token.slice(0, idx).trim()] = token.slice(idx + 1).trim();
  }
  return info;
}
