import os from "node:os";

/** Return all non-internal IPv4 addresses of this machine. */
export function localIPv4Addresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push({ iface: name, address: a.address });
    }
  }
  return out;
}
