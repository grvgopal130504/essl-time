import pg from "pg";
import { config } from "../config.js";
import { log } from "../utils/logger.js";

const { Pool } = pg;

let pool = null;
let healthy = false;

export function getPool() {
  if (!config.dbEnabled) return null;
  if (!config.databaseUrl) {
    log.warn("DATABASE_URL is empty — running without a database.");
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      ssl: config.databaseUrl.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", (err) => log.error("PG pool error:", err.message));
  }
  return pool;
}

export function isDbHealthy() {
  return healthy;
}

export async function pingDb() {
  const p = getPool();
  if (!p) {
    healthy = false;
    return false;
  }
  try {
    await p.query("SELECT 1");
    healthy = true;
    return true;
  } catch (err) {
    healthy = false;
    log.error("DB ping failed:", err.message);
    return false;
  }
}

/** Safe query — never throws, so a DB outage can't stop the device from being ACKed. */
export async function safeQuery(text, params = []) {
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(text, params);
    healthy = true;
    return res;
  } catch (err) {
    healthy = false;
    log.error("DB query failed:", err.message);
    return null;
  }
}
