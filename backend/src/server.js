import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { config, securityEnabled } from "./config.js";
import { log, banner } from "./utils/logger.js";
import { localIPv4Addresses } from "./utils/network.js";
import { pingDb } from "./db/pool.js";
import { iclockRouter } from "./routes/iclock.js";
import { apiRouter } from "./routes/api.js";
import { attachWebSocket } from "./services/eventHub.js";
import { loadEmployeeCache } from "./services/employeeCache.js";
import { loadTodayState, pruneDayState } from "./services/attendanceRules.js";
import { rolloverIfNeeded, startFeedRollover } from "./services/feedStore.js";

// Housekeeping: drop yesterday's in/out state once an hour.
setInterval(() => pruneDayState(), 3600_000).unref();

// The live feed holds one local day. This clears it at midnight; attendance_logs
// (and therefore the timesheet) is never touched by it. Prime it immediately so
// the first punch of the process doesn't trigger the initial rollover.
rolloverIfNeeded({ silent: true }).catch(() => {});
startFeedRollover();

const app = express();

// Behind Azure App Service the real client IP arrives in X-Forwarded-For.
if (config.trustProxy) app.set("trust proxy", true);

app.use(
  cors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: false,
  })
);

// The device posts tab-separated plain text with odd/absent content-types.
// Capture EVERYTHING as a raw string before any JSON parsing happens.
app.use(
  express.text({
    type: (req) => !String(req.headers["content-type"] || "").includes("application/json"),
    limit: "20mb",
  })
);
app.use(express.json({ limit: "20mb" }));

// Some eSSL/ZKTeco firmwares (e.g. K90 Pro Ver 8.0.4.3) append ".aspx" to every
// ADMS endpoint: /iclock/cdata.aspx, /iclock/getrequest.aspx, ...
// Strip it before routing so one set of handlers covers both styles.
app.use((req, _res, next) => {
  if (req.url.includes(".aspx")) req.url = req.url.replace(".aspx", "");
  next();
});

// ADMS / PUSH SDK protocol
app.use("/iclock", iclockRouter);

// Dashboard API
app.use("/api", apiRouter);

/**
 * If the dashboard has been built (frontend/dist), serve it from this same
 * process — one service, one port, no separate Vite server to keep alive.
 * Build it with:  npm --prefix frontend run build
 */
const distDir = path.resolve(__dirname, "../../frontend/dist");
const hasDashboard = fs.existsSync(path.join(distDir, "index.html"));

if (hasDashboard) {
  app.use(express.static(distDir));
}

app.get("/", (_req, res) => {
  if (hasDashboard) return res.sendFile(path.join(distDir, "index.html"));
  res.type("text/plain").send(
    `eSSL K90 Pro ADMS server is running.\n\n` +
      `Device endpoint : http://<this-ip>:${config.port}/iclock/cdata\n` +
      `Dashboard API   : http://localhost:${config.port}/api/health\n` +
      `WebSocket       : ws://localhost:${config.port}/ws\n\n` +
      `No dashboard build found. Run: npm --prefix frontend run build\n`
  );
});

// Anything else the device might try outside /iclock — log it and say OK.
// Browser navigations fall through to the dashboard's index.html instead.
app.all("*", (req, res) => {
  const wantsHtml =
    req.method === "GET" && String(req.headers.accept || "").includes("text/html");

  if (hasDashboard && wantsHtml) {
    return res.sendFile(path.join(distDir, "index.html"));
  }

  log.warn(`Unmatched request: ${req.method} ${req.originalUrl}`);
  if (req.body) console.log(req.body);
  res.type("text/plain").status(200).send("OK");
});

const server = http.createServer(app);
attachWebSocket(server);

server.listen(config.port, config.host, async () => {
  const ips = localIPv4Addresses();
  banner([
    "eSSL K90 Pro  —  ADMS Server",
    "",
    `Listening on   : ${config.host}:${config.port}`,
    `Dashboard API  : http://localhost:${config.port}/api/health`,
    `WebSocket      : ws://localhost:${config.port}/ws`,
    "",
    "Device settings (Menu → Comm → Cloud Server Setting):",
    `  Server Mode    : ADMS`,
    `  Domain Name    : OFF`,
    `  Server Address : ${ips[0]?.address || "<your laptop IPv4>"}`,
    `  Server Port    : ${config.port}`,
    `  Proxy          : OFF`,
    "",
    ips.length > 1 ? `Other IPs: ${ips.map((i) => `${i.address} (${i.iface})`).join(", ")}` : "",
    "Waiting for the device to connect...",
  ].filter((l) => l !== undefined));

  if (securityEnabled) {
    log.ok(
      `Device guard active — serials: ${config.allowedSerials.join(", ") || "any"} · IPs: ${
        config.allowedIps.join(", ") || "any"
      }`
    );
  } else if (config.isProduction) {
    log.warn(
      "NO DEVICE GUARD CONFIGURED. This endpoint is public and unauthenticated — " +
        "set ALLOWED_SERIALS and ALLOWED_DEVICE_IPS."
    );
  }

  if (config.dbEnabled) {
    const ok = await pingDb();
    if (ok) {
      log.ok("PostgreSQL connected");
      await loadEmployeeCache();
      await loadTodayState();
      // Drop any feed rows left over from a previous day before serving them.
      await rolloverIfNeeded();
    } else {
      log.warn("PostgreSQL unreachable — punches will still print & stream live");
    }
  } else {
    log.info("Database disabled (DB_ENABLED=false) — memory + console only");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log.error(`Port ${config.port} is already in use. Stop the other process or change PORT in .env`);
    process.exit(1);
  }
  log.error("Server error:", err.message);
});

process.on("SIGINT", () => {
  log.info("Shutting down...");
  server.close(() => process.exit(0));
});
