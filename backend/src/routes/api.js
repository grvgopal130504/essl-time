import express from "express";
import { config } from "../config.js";
import { localIPv4Addresses } from "../utils/network.js";
import { isDbHealthy, pingDb } from "../db/pool.js";
import {
  listAttendance,
  listDevices,
  listEmployees,
  listRawLogs,
  todayStats,
  queueCommand,
  setEmployeeName,
  listPinsSeen,
  timesheet,
  listFeed,
  countFeed,
} from "../db/repository.js";
import { feedDay, rolloverIfNeeded, bufferedFeed } from "../services/feedStore.js";
import { localDate } from "../services/attendanceRules.js";
import { recentPunches, recentRaw, deviceState, emitEmployee } from "../services/eventHub.js";
import { getName, setName } from "../services/employeeCache.js";

export const apiRouter = express.Router();

apiRouter.get("/health", async (_req, res) => {
  const db = await pingDb();
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    database: db ? "connected" : config.dbEnabled ? "disconnected" : "disabled",
    port: config.port,
    serverAddresses: localIPv4Addresses(),
    connectedDevices: deviceState.size,
  });
});

/**
 * What to type into the device's Cloud Server Setting screen.
 *
 * On a LAN the device needs this machine's IP and the port we listen on.
 * Behind a public host (Azure App Service, Front Door, any reverse proxy) it
 * needs the hostname instead, and port 80/443 — NOT the internal listen port.
 */
apiRouter.get("/setup", (_req, res) => {
  const ips = localIPv4Addresses();
  const hosted = !!config.publicHostname;

  const serverPort = config.devicePort || (hosted ? 80 : config.port);

  res.json({
    model: "eSSL K90 Pro",
    menuPath: "Menu → Comm → Cloud Server Setting",
    mode: hosted ? "hosted" : "lan",
    settings: {
      serverMode: "ADMS",
      enableDomainName: hosted ? "ON" : "OFF",
      serverAddress: hosted
        ? config.publicHostname
        : ips[0]?.address || "<your laptop IPv4>",
      serverPort,
      proxy: "OFF",
    },
    endpoint: hosted
      ? `http://${config.publicHostname}/iclock/cdata`
      : `http://${ips[0]?.address || "<ip>"}:${config.port}/iclock/cdata`,
    notes: hosted
      ? [
          "Enter the hostname only — no http:// prefix and no trailing slash.",
          "Port 80 is plain HTTP. Turn OFF 'HTTPS Only' in App Service or the device gets a 301 it won't follow.",
          "Try port 443 only after 80 works; eSSL TLS stacks are unreliable.",
          "Enable Web sockets in App Service, or the live dashboard won't connect.",
        ]
      : [
          "Use the interface on the same subnet as the device.",
          `Allow inbound TCP ${config.port} through the firewall.`,
        ],
    allDetectedIPs: ips,
  });
});

/**
 * Answers one question: "is my device actually talking to THIS server?"
 *
 * Necessary because a local instance and an Azure instance can share the same
 * database — so seeing device rows in the API proves nothing about which server
 * received them. The Host header is what actually distinguishes them.
 */
apiRouter.get("/diagnostics", async (_req, res) => {
  const thisHost = config.publicHostname || null;
  const rows = await listRawLogs(300);

  const isDevice = (r) => /iclock/i.test(r.headers?.["user-agent"] || "");
  const hostOf = (r) => r.headers?.host || "unknown";

  const deviceHits = rows.filter(isDevice);
  const byHost = {};
  for (const r of deviceHits) {
    const h = hostOf(r);
    if (!byHost[h]) byHost[h] = { host: h, hits: 0, lastAt: null, lastIp: null };
    byHost[h].hits++;
    if (!byHost[h].lastAt || r.created_at > byHost[h].lastAt) {
      byHost[h].lastAt = r.created_at;
      byHost[h].lastIp = r.remote_ip;
    }
  }

  const targets = Object.values(byHost).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  const reachedThisServer = thisHost ? targets.find((t) => t.host === thisHost) : targets[0];
  const last = targets[0] || null;
  const minsAgo = (t) => (t ? Math.round((Date.now() - new Date(t).getTime()) / 60000) : null);

  let verdict;
  if (!targets.length) {
    verdict = "No device has ever contacted any server. Check the device's Cloud Server Setting.";
  } else if (!reachedThisServer) {
    verdict =
      `The device is talking to "${last.host}", NOT this server (${thisHost}). ` +
      `These rows come from the shared database, not from traffic this instance received.`;
  } else if (minsAgo(reachedThisServer.lastAt) > 5) {
    verdict =
      `Device last reached this server ${minsAgo(reachedThisServer.lastAt)} minutes ago, then stopped. ` +
      `It polls every ~30s, so it has lost connectivity.`;
  } else {
    verdict = `Device is actively talking to this server (last contact ${minsAgo(
      reachedThisServer.lastAt
    )} min ago).`;
  }

  res.json({
    thisServer: thisHost || "local (no public hostname configured)",
    verdict,
    reachedThisServer: !!reachedThisServer,
    lastDeviceContact: last
      ? { host: last.host, at: last.lastAt, minutesAgo: minsAgo(last.lastAt), fromIp: last.lastIp }
      : null,
    // Every hostname the device has been seen talking to, newest first.
    devicesSeenTalkingTo: targets.map((t) => ({ ...t, minutesAgo: minsAgo(t.lastAt) })),
    note:
      "Rows are matched by the 'iClock' user-agent. A 301 redirect from Azure never " +
      "reaches this app, so blocked attempts will NOT appear here.",
  });
});

apiRouter.get("/punches", async (req, res) => {
  const limit = parseInt(req.query.limit || "100", 10);
  const rows = await listAttendance({
    limit,
    deviceSn: req.query.deviceSn || null,
    pin: req.query.pin || null,
  });
  // Fall back to the in-memory ring buffer if the DB is unavailable
  res.json(rows.length || isDbHealthy() ? rows : recentPunches.slice(0, limit));
});

/**
 * GET /api/feed?limit=50|100|300|all
 *
 * Today's live feed, newest first. Only ever reads live_feed, which is wiped at
 * local midnight — the timesheet reads attendance_logs and is unaffected.
 */
apiRouter.get("/feed", async (req, res) => {
  await rolloverIfNeeded();
  const workDate = feedDay();

  const raw = String(req.query.limit ?? "100").toLowerCase();
  const limit = raw === "all" || raw === "0" ? null : Math.min(parseInt(raw, 10) || 100, 5000);

  const rows = await listFeed(workDate, limit);
  const total = await countFeed(workDate);

  // Postgres down — serve what the ring buffer still holds for today.
  if (!rows.length && !isDbHealthy()) {
    const buffered = bufferedFeed();
    return res.json({
      workDate,
      total: buffered.length,
      limit,
      source: "memory",
      punches: limit === null ? buffered : buffered.slice(0, limit),
    });
  }

  res.json({ workDate, total, limit, source: "database", punches: rows });
});

apiRouter.get("/devices", async (_req, res) => {
  const rows = await listDevices();
  res.json(rows.length ? rows : [...deviceState.values()]);
});

apiRouter.get("/employees", async (req, res) => {
  res.json(await listEmployees(req.query.deviceSn || null));
});

apiRouter.get("/raw-logs", async (req, res) => {
  const limit = parseInt(req.query.limit || "100", 10);
  const rows = await listRawLogs(limit);
  res.json(rows.length ? rows : recentRaw.slice(0, limit));
});

apiRouter.get("/stats", async (_req, res) => {
  const s = await todayStats();
  res.json({
    ...s,
    liveBufferCount: recentPunches.length,
    devices: deviceState.size,
  });
});

/** Queue a raw ADMS command for the device to pick up on its next poll. */
apiRouter.post("/devices/:sn/command", express.json(), async (req, res) => {
  const { command } = req.body || {};
  if (!command) return res.status(400).json({ error: "command is required" });
  const row = await queueCommand(req.params.sn, command);
  res.json(row || { queued: false, reason: "database unavailable" });
});

/**
 * Ask the device to re-upload its user table.
 *
 * Firmware varies, so we queue both known forms — the device ignores what it
 * doesn't understand. CHECK makes it re-sync everything it holds; DATA QUERY
 * USERINFO asks specifically for users.
 */
apiRouter.post("/devices/:sn/sync-users", async (req, res) => {
  const sn = req.params.sn;
  const queued = [];
  for (const cmd of ["DATA QUERY USERINFO", "CHECK"]) {
    const row = await queueCommand(sn, cmd);
    if (row) queued.push({ id: row.id, command: cmd });
  }
  res.json(
    queued.length
      ? { queued, note: "The device picks these up on its next poll (within ~30s)." }
      : { queued: [], reason: "database unavailable — command queue needs Postgres" }
  );
});

/* ---------- timesheet ---------- */

/**
 * GET /api/timesheet?date=2026-08-05
 * GET /api/timesheet?from=2026-08-01&to=2026-08-05&pin=14
 *
 * Direction is derived: first scan of the day = in, last = out.
 * A day with a single scan reports hours: null and complete: false.
 */
apiRouter.get("/timesheet", async (req, res) => {
  const today = localDate(new Date());
  const from = req.query.from || req.query.date || today;
  const to = req.query.to || req.query.date || today;

  const rows = await timesheet({
    from,
    to,
    deviceSn: req.query.deviceSn || null,
    pin: req.query.pin || null,
    tzOffset: config.tzOffset,
    debounceSeconds: config.debounceSeconds,
    halfDayBoundary: config.halfDayBoundary,
  });

  const days = rows.map((r) => {
    const hours = r.hours === null ? null : Number(r.hours);
    // Server-clock span between the two punches arriving in Postgres.
    const realHours = r.real_hours === null ? null : Number(r.real_hours);
    const effectiveScans = r.effective_scans;
    const complete = effectiveScans > 1;

    // How far the device's own clock disagrees with the server's, in hours.
    const clockDrift =
      hours === null || realHours === null ? null : Number(Math.abs(hours - realHours).toFixed(2));

    // Both punches arrived in the same upload => the device was offline and
    // replayed a backlog. realHours is meaningless here, not evidence of drift.
    const batchUpload = realHours !== null && realHours * 60 < config.batchUploadMinutes;

    // Which halves of the day were actually worked
    let dayType, dayTypeLabel;
    if (!complete) {
      // Punched in but never out. They showed up, so it's credited as a half
      // day — but the hours stay unknown rather than being invented.
      dayType = "HALF_DAY_NO_OUT";
      dayTypeLabel = "Half Day";
    } else if (r.has_first_half && r.has_second_half) {
      dayType = "FULL_DAY";
      dayTypeLabel = "Full Day";
    } else if (r.has_first_half) {
      dayType = "HALF_DAY_FIRST";
      dayTypeLabel = "Half Day (1st)";
    } else {
      dayType = "HALF_DAY_SECOND";
      dayTypeLabel = "Half Day (2nd)";
    }

    // Flags never change the numbers — they only ask a human to look.
    const flags = [];
    if (!complete)
      flags.push({
        code: "SHORT_DAY",
        label: "Short day",
        detail:
          "Only one scan — no check-out recorded. Credited as a half day; actual hours unknown.",
      });
    if (hours !== null && hours > config.maxDayHours)
      flags.push({
        code: "LONG_DAY",
        label: `Over ${config.maxDayHours}h`,
        detail: `${hours}h is longer than expected. A late stray scan inflates first/last.`,
      });
    if (hours !== null && hours < config.minDayHours)
      flags.push({
        code: "SHORT_HOURS",
        label: `Under ${config.minDayHours}h`,
        detail: `Only ${hours}h between first and last scan.`,
      });
    if (dayType === "HALF_DAY_SECOND")
      flags.push({
        code: "NO_MORNING_SCAN",
        label: "No morning scan",
        detail: `First scan was after ${config.halfDayBoundary} — check whether an arrival scan was missed.`,
      });
    if (effectiveScans >= config.reviewMinScans)
      flags.push({
        code: "MULTI_SCAN",
        label: `${effectiveScans} scans`,
        detail:
          "More than two real scans — first/last ignores the middle ones, so this day may be ambiguous.",
      });
    if (batchUpload)
      flags.push({
        code: "BATCH_UPLOAD",
        label: "Batch upload",
        detail: `Both punches reached the server within ${config.batchUploadMinutes} min of each other — the device was offline and replayed its backlog. Real Hrs is not a usable cross-check for this day.`,
      });
    else if (clockDrift !== null && clockDrift > config.clockDriftHours)
      flags.push({
        code: "CLOCK_DRIFT",
        label: `Clock off ${clockDrift}h`,
        detail: `Device says ${hours}h, server received them ${realHours}h apart. The K90 Pro's date/time is likely wrong — check Menu → System → Date/Time.`,
      });

    return {
      deviceSn: r.device_sn,
      pin: r.pin,
      employeeName: r.employee_name || getName(r.device_sn, r.pin),
      workDate:
        r.work_date instanceof Date ? localDate(r.work_date) : String(r.work_date).slice(0, 10),
      checkIn: r.first_punch,
      checkOut: complete ? r.last_punch : null,
      // Server-clock timestamps for those same two punches.
      checkInReceived: r.first_received,
      checkOutReceived: complete ? r.last_received : null,
      scans: r.scans,
      effectiveScans,
      repeatScans: r.scans - effectiveScans,
      realHours,
      clockDrift,
      hours,
      complete,
      dayType,
      dayTypeLabel,
      // Which halves actually had a counted scan. dayType collapses these into
      // one label, but the dashboard needs them to group a single afternoon
      // scan (HALF_DAY_NO_OUT) under "second half" rather than losing it.
      hasFirstHalf: r.has_first_half,
      hasSecondHalf: r.has_second_half,
      flags,
      needsReview: flags.length > 0,
    };
  });

  const worked = days.filter((d) => d.hours !== null);
  res.json({
    from,
    to,
    rule: `check-in = first scan (never moves); check-out = latest scan; day split at ${config.halfDayBoundary}`,
    timezone: config.tzOffset,
    debounceSeconds: config.debounceSeconds,
    halfDayBoundary: config.halfDayBoundary,
    thresholds: {
      maxDayHours: config.maxDayHours,
      minDayHours: config.minDayHours,
      reviewMinScans: config.reviewMinScans,
      clockDriftHours: config.clockDriftHours,
      batchUploadMinutes: config.batchUploadMinutes,
    },
    totals: {
      employees: new Set(days.map((d) => `${d.deviceSn}:${d.pin}`)).size,
      completeDays: worked.length,
      incompleteDays: days.length - worked.length,
      needsReview: days.filter((d) => d.needsReview).length,
      fullDays: days.filter((d) => d.dayType === "FULL_DAY").length,
      halfDays: days.filter((d) => d.dayType.startsWith("HALF_DAY")).length,
      missingCheckOut: days.filter((d) => d.dayType === "HALF_DAY_NO_OUT").length,
      clockDrift: days.filter((d) => d.flags.some((f) => f.code === "CLOCK_DRIFT")).length,
      batchUploads: days.filter((d) => d.flags.some((f) => f.code === "BATCH_UPLOAD")).length,
      totalHours: Number(worked.reduce((s, d) => s + d.hours, 0).toFixed(2)),
      reviewedHours: Number(
        worked.filter((d) => d.needsReview).reduce((s, d) => s + d.hours, 0).toFixed(2)
      ),
    },
    days,
  });
});

/* ---------- employee names ---------- */

/** Every PIN that has punched, with its name if known. */
apiRouter.get("/pins", async (req, res) => {
  const rows = await listPinsSeen(req.query.deviceSn || null);
  if (rows.length) return res.json(rows);

  // DB unavailable — derive from the live buffer so the tab still works.
  const seen = new Map();
  for (const p of recentPunches) {
    const k = `${p.deviceSn}:${p.pin}`;
    const cur = seen.get(k);
    if (cur) cur.punch_count++;
    else
      seen.set(k, {
        device_sn: p.deviceSn,
        pin: p.pin,
        name: getName(p.deviceSn, p.pin),
        punch_count: 1,
        last_punch: p.punchTime,
      });
  }
  res.json([...seen.values()]);
});

/** Set or clear the name for a PIN. */
apiRouter.put("/employees/:sn/:pin", express.json(), async (req, res) => {
  const { sn, pin } = req.params;
  const name = (req.body?.name ?? "").toString().trim().slice(0, 120);

  setName(sn, pin, name);
  const row = await setEmployeeName(sn, pin, name);
  emitEmployee({ deviceSn: sn, pin, name: name || null, source: "manual" });

  res.json({
    deviceSn: sn,
    pin,
    name: name || null,
    persisted: !!row,
    ...(row ? {} : { warning: "Saved in memory only — database unavailable" }),
  });
});
