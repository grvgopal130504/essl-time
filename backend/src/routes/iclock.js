import express from "express";
import { log } from "../utils/logger.js";
import { config } from "../config.js";
import {
  parseAttlog,
  parseOperlog,
  parseDeviceInfo,
  PUNCH_STATUS,
  VERIFY_MODES,
} from "../services/admsParser.js";
import {
  recordPunch,
  recordRaw,
  recordDevice,
  bumpDevicePunchCount,
  emitEmployee,
} from "../services/eventHub.js";
import { storeFeedEvent } from "../services/feedStore.js";
import {
  upsertDevice,
  touchDevice,
  insertAttendance,
  upsertEmployee,
  insertRawLog,
  popPendingCommands,
  completeCommand,
} from "../db/repository.js";

import { deviceGuard, clientIp } from "./guard.js";
import { getName, setName } from "../services/employeeCache.js";
import { classifyPunch } from "../services/attendanceRules.js";

export const iclockRouter = express.Router();

// Reject unknown serials / unlisted IPs before anything else touches the request.
iclockRouter.use(deviceGuard);

/* ------------------------------------------------------------------ */
/* Raw logger — every single byte the device sends is printed & stored */
/* ------------------------------------------------------------------ */
iclockRouter.use((req, res, next) => {
  const sn = req.query.SN || req.query.sn || null;
  const ip = clientIp(req);
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");

  console.log("\n" + "─".repeat(70));
  log.device(`${req.method} ${req.originalUrl}`);
  log.raw(`from ${ip}  SN=${sn || "?"}`);
  if (Object.keys(req.query).length) log.raw("query:", JSON.stringify(req.query));
  log.raw("headers:", JSON.stringify(req.headers));
  if (body && body !== '""') {
    log.raw("body:");
    console.log(body);
  } else {
    log.raw("body: <empty>");
  }
  console.log("─".repeat(70));

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    deviceSn: sn,
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    headers: req.headers,
    body: body && body !== '""' ? body : "",
    remoteIp: ip,
    createdAt: new Date().toISOString(),
  };
  recordRaw(entry);
  insertRawLog(entry);

  if (sn) {
    recordDevice({ sn, ip });
    touchDevice(sn, ip);
  }
  next();
});

/* ------------------------------------------------------------------ */
/* 1. Handshake — device asks for its operating config on boot         */
/*    GET /iclock/cdata?SN=xxx&options=all&pushver=2.4.1               */
/* ------------------------------------------------------------------ */
iclockRouter.get("/cdata", async (req, res) => {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";
  const info = parseDeviceInfo(req.body);
  const pushver = req.query.pushver || null;

  await upsertDevice({ sn, ip: clientIp(req), info, pushVersion: pushver });
  recordDevice({ sn, ip: clientIp(req), firmware: info.FWVersion });

  const stamp = Math.floor(Date.now() / 1000);
  const reply = [
    `GET OPTION FROM: ${sn}`,
    `Stamp=${stamp}`,
    `OpStamp=${stamp}`,
    `ErrorDelay=30`,
    `Delay=10`,
    `TransTimes=00:00;14:00`,
    `TransInterval=1`,
    `TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP FPImag UserPic`,
    `TimeZone=5.5`,
    `Realtime=1`,
    `Encrypt=0`,
    `ServerVer=2.4.1`,
    `PushProtVer=2.4.1`,
  ].join("\n");

  log.ok(`Handshake with device ${sn} — realtime push enabled`);
  res.type("text/plain").status(200).send(reply);
});

/* ------------------------------------------------------------------ */
/* 2. Data upload — attendance, users, etc.                            */
/*    POST /iclock/cdata?SN=xxx&table=ATTLOG&Stamp=...                 */
/* ------------------------------------------------------------------ */
iclockRouter.post("/cdata", async (req, res) => {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";
  const table = String(req.query.table || "").toUpperCase();
  const body = typeof req.body === "string" ? req.body : "";

  if (table === "ATTLOG") {
    const records = parseAttlog(body, sn);
    log.ok(`ATTLOG: ${records.length} record(s) from ${sn}`);

    for (const r of records) {
      const employeeName = getName(sn, r.pin);
      const derived = classifyPunch({ deviceSn: sn, pin: r.pin, punchTime: r.punchTime });
      const punch = {
        role: derived.role,
        roleLabel: derived.roleLabel,
        half: derived.half,
        direction: derived.direction,
        directionLabel: derived.directionLabel,
        workDate: derived.workDate,
        duplicate: derived.duplicate,
        id: `${sn}-${r.pin}-${r.punchTime.getTime()}`,
        deviceSn: sn,
        pin: r.pin,
        employeeName,
        punchTime: r.punchTime.toISOString(),
        status: r.status,
        statusLabel: r.statusLabel,
        verifyMode: r.verifyMode,
        verifyLabel: r.verifyLabel,
        workCode: r.workCode,
        rawLine: r.rawLine,
        receivedAt: new Date().toISOString(),
      };

      console.log(
        `\n  ${derived.duplicate ? "🔁" : "✅"}  PUNCH  →  ${
          employeeName || `Employee PIN: ${punch.pin}`
        }` +
          (employeeName ? `\n      PIN       : ${punch.pin}` : "") +
          `\n      Time      : ${r.punchTime.toLocaleString()}` +
          `\n      Recorded  : ${derived.roleLabel}${
            derived.duplicate
              ? "  (repeat scan — ignored)"
              : derived.role === "RECORDED"
                ? "  (first half — check-in unchanged)"
                : ""
          }` +
          `\n      Verified  : ${punch.verifyLabel}` +
          `\n      Device    : ${sn}\n`
      );

      recordPunch(punch);
      bumpDevicePunchCount(sn);
      // Two independent writes: attendance_logs feeds the timesheet and is kept
      // forever; live_feed is the dashboard's feed and is wiped nightly.
      insertAttendance(r);
      storeFeedEvent(punch).catch((e) => log.warn("Feed store failed:", e.message));
    }
    return res.type("text/plain").status(200).send(`OK: ${records.length}`);
  }

  if (table === "OPERLOG" || table === "USERINFO") {
    const users = parseOperlog(body, sn);
    if (users.length) {
      log.ok(`USERINFO: ${users.length} user(s) from ${sn}`);
      for (const u of users) {
        console.log(`  👤  PIN ${u.pin} — ${u.name || "(no name)"}  card=${u.cardNo || "-"}`);
        // Don't let a blank name from the device wipe a name you typed by hand.
        if (u.name) setName(sn, u.pin, u.name);
        upsertEmployee(u);
        emitEmployee({ deviceSn: sn, pin: u.pin, name: u.name || getName(sn, u.pin), source: "device" });
      }
    } else {
      log.info(`OPERLOG (non-user entries) from ${sn}`);
    }
    return res.type("text/plain").status(200).send(`OK: ${users.length}`);
  }

  log.info(`Unhandled table="${table}" from ${sn} — acknowledged anyway`);
  res.type("text/plain").status(200).send("OK");
});

/* ------------------------------------------------------------------ */
/* 3. Command polling — device asks "anything for me?" every N seconds */
/*    GET /iclock/getrequest?SN=xxx                                    */
/* ------------------------------------------------------------------ */
iclockRouter.get("/getrequest", async (req, res) => {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";

  // Some firmwares attach an INFO blob:
  // "Ver 8.0.4.3-20230515,12,24,1740,192.168.1.201,10,-1,0,0,100,1,0,0"
  //   [0]=firmware  [1]=users  [2]=fingerprints  [3]=attlog count  [4]=device IP
  if (req.query.INFO) {
    const f = String(req.query.INFO).split(",");
    recordDevice({ sn, ip: f[4] || clientIp(req), firmware: f[0] });
    await upsertDevice({
      sn,
      ip: f[4] || clientIp(req),
      info: { FWVersion: f[0], UserCount: f[1], FPCount: f[2], AttLogCount: f[3] },
    });
    log.info(`Device ${sn} info — ${f[0]} · ${f[1]} users · ${f[3]} attendance records`);
  }

  const rows = await popPendingCommands(sn);

  if (rows.length) {
    const payload = rows.map((r) => `C:${r.id}:${r.command}`).join("\n");
    log.ok(`Dispatching ${rows.length} command(s) to ${sn}`);
    return res.type("text/plain").status(200).send(payload);
  }
  res.type("text/plain").status(200).send("OK");
});

/* ------------------------------------------------------------------ */
/* 4. Command result callback                                          */
/*    POST /iclock/devicecmd?SN=xxx    body: ID=123&Return=0&CMD=DATA   */
/* ------------------------------------------------------------------ */
iclockRouter.post("/devicecmd", async (req, res) => {
  const body = typeof req.body === "string" ? req.body : "";
  const params = Object.fromEntries(new URLSearchParams(body.replace(/\n/g, "&")));
  if (params.ID) {
    log.info(`Command #${params.ID} result: Return=${params.Return} CMD=${params.CMD}`);
    completeCommand(parseInt(params.ID, 10), body);
  }
  res.type("text/plain").status(200).send("OK");
});

/* ------------------------------------------------------------------ */
/* 5. Misc endpoints some firmware versions call                       */
/* ------------------------------------------------------------------ */
iclockRouter.all("/ping", (_req, res) => res.type("text/plain").send("OK"));
iclockRouter.all("/fdata", (_req, res) => res.type("text/plain").send("OK"));
iclockRouter.all("/rtdata", (_req, res) => res.type("text/plain").send("OK"));
iclockRouter.all("/querydata", (_req, res) => res.type("text/plain").send("OK"));
iclockRouter.all("/registry", (req, res) => {
  const sn = req.query.SN || "UNKNOWN";
  log.ok(`Device ${sn} registering`);
  res.type("text/plain").send(`RegistryCode=${sn}`);
});

/* Catch-all inside /iclock — never leave the device hanging */
iclockRouter.all("*", (req, res) => {
  log.warn(`Unknown /iclock path: ${req.method} ${req.originalUrl} — replying OK`);
  res.type("text/plain").status(200).send("OK");
});

export { PUNCH_STATUS, VERIFY_MODES };
