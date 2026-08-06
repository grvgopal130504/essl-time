/**
 * Simulates an eSSL K90 Pro punch so you can test the full pipeline
 * without touching the device.
 *
 *   npm run simulate                  -> random PIN, check-in, now
 *   node scripts/simulate-punch.js 1001 0
 */
import "dotenv/config";

const PORT = process.env.PORT || 8081;
const BASE = process.env.SIM_BASE || `http://127.0.0.1:${PORT}`;
const SN = process.env.SIM_SN || "SIM0000000001";

const pin = process.argv[2] || String(1000 + Math.floor(Math.random() * 5));
const status = process.argv[3] ?? "0";

function deviceTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": "iClock Proxy/1.09" },
    body,
  });
  return `${res.status} ${await res.text()}`;
}

async function main() {
  console.log(`Simulating device ${SN} against ${BASE}\n`);

  // 1. handshake
  const hs = await fetch(`${BASE}/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1&language=69`);
  console.log("Handshake ->", hs.status);
  console.log((await hs.text()).split("\n").slice(0, 3).join("\n"), "...\n");

  // 2. push a user record
  const user = `USER PIN=${pin}\tName=Test Employee ${pin}\tPri=0\tPasswd=\tCard=0\tGrp=1\tTZ=0000000000000000`;
  console.log("USERINFO ->", await post(`${BASE}/iclock/cdata?SN=${SN}&table=OPERLOG`, user));

  // 3. push the punch:  PIN \t time \t status \t verify \t workcode
  const line = `${pin}\t${deviceTime()}\t${status}\t1\t0\t0\t0`;
  console.log("ATTLOG   ->", await post(`${BASE}/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, line));

  // 4. poll for commands
  const gr = await fetch(`${BASE}/iclock/getrequest?SN=${SN}`);
  console.log("getrequest ->", gr.status, await gr.text());

  console.log(`\nDone. PIN ${pin} punched at ${deviceTime()} (status ${status}).`);
  console.log("Check the backend console and the dashboard at http://localhost:5115");
}

main().catch((e) => {
  console.error("Simulation failed:", e.message);
  console.error("Is the backend running?  cd backend && npm run dev");
  process.exit(1);
});
