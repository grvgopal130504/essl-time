import { config } from "../config.js";
import { log } from "../utils/logger.js";

/**
 * ADMS has no authentication of any kind — a device just POSTs to a URL.
 * Once this server is reachable from the internet, anyone who discovers the URL
 * can fabricate attendance records. These two checks are the minimum defence:
 *
 *   ALLOWED_SERIALS      comma-separated device serial numbers
 *   ALLOWED_DEVICE_IPS   comma-separated public IPs (or CIDR prefixes) of your sites
 *
 * Leaving either empty disables that check — acceptable on a private LAN, not in Azure.
 */

const norm = (ip) => String(ip || "").replace("::ffff:", "").trim();

export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  // Azure sends "ip:port" in X-Forwarded-For
  const bare = fwd.includes(":") && fwd.split(":").length === 2 ? fwd.split(":")[0] : fwd;
  return norm(bare || req.socket.remoteAddress) || "unknown";
}

/** Matches an exact IP, or a prefix ending in "." (e.g. "203.0.113." covers the /24). */
function ipAllowed(ip) {
  if (!config.allowedIps.length) return true;
  return config.allowedIps.some((rule) =>
    rule.endsWith(".") ? ip.startsWith(rule) : ip === rule
  );
}

function serialAllowed(sn) {
  if (!config.allowedSerials.length) return true;
  return !!sn && config.allowedSerials.includes(sn);
}

const rejected = new Map(); // key -> count, so we log once per offender per minute

function noteRejection(key, detail) {
  const now = Date.now();
  const prev = rejected.get(key);
  if (!prev || now - prev.at > 60000) {
    log.warn(`REJECTED ${detail}`);
    rejected.set(key, { at: now, count: 1 });
  } else {
    prev.count++;
  }
}

export function deviceGuard(req, res, next) {
  const ip = clientIp(req);
  const sn = req.query.SN || req.query.sn || null;

  if (!ipAllowed(ip)) {
    noteRejection(`ip:${ip}`, `request from unlisted IP ${ip} (${req.method} ${req.originalUrl})`);
    return res.status(403).type("text/plain").send("Forbidden");
  }

  if (!serialAllowed(sn)) {
    noteRejection(`sn:${sn}`, `unknown device serial "${sn}" from ${ip}`);
    return res.status(403).type("text/plain").send("Forbidden");
  }

  next();
}
