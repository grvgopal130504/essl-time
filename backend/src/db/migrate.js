import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool.js";
import { log, banner } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const pool = getPool();
  if (!pool) {
    log.error("No database configured. Set DATABASE_URL in backend/.env");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  log.info("Applying schema...");
  await pool.query(sql);
  banner([
    "Migration complete",
    "Tables: devices, employees, attendance_logs,",
    "        live_feed, device_raw_logs, device_commands",
  ]);
  await pool.end();
}

main().catch((err) => {
  log.error("Migration failed:", err.message);
  process.exit(1);
});
