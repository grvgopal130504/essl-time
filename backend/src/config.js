import "dotenv/config";

const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  // Azure App Service injects PORT. Locally we default to 8081.
  port: parseInt(process.env.PORT || "8081", 10),
  host: process.env.HOST || "0.0.0.0",

  databaseUrl: process.env.DATABASE_URL || "",
  dbEnabled: (process.env.DB_ENABLED || "true").toLowerCase() === "true",
  tzOffset: process.env.TZ_OFFSET || "+05:30",

  // Scans closer together than this (same employee) count as one.
  // Real data shows triple-scans inside 31 seconds.
  debounceSeconds: parseInt(process.env.DEBOUNCE_SECONDS || "120", 10),

  // Splits the working day. Punches before this are "first half", after are
  // "second half". Check-in comes from the first half, check-out from the second.
  halfDayBoundary: process.env.HALF_DAY_BOUNDARY || "13:00",

  // Review thresholds — days breaching these are flagged, never auto-corrected.
  maxDayHours: parseFloat(process.env.MAX_DAY_HOURS || "12"),
  minDayHours: parseFloat(process.env.MIN_DAY_HOURS || "1"),
  reviewMinScans: parseInt(process.env.REVIEW_MIN_SCANS || "3", 10),

  // Device clock vs server clock. `hours` comes from the device's punch_time,
  // `realHours` from the server's received_at. If they disagree by more than
  // this, the device's RTC is suspect (wrong date/time on the biometric).
  clockDriftHours: parseFloat(process.env.CLOCK_DRIFT_HOURS || "1"),

  // ...unless the punches all landed in the same upload. An offline device
  // replays its backlog in one POST, so every received_at is seconds apart and
  // realHours collapses to ~0 through no fault of the clock.
  batchUploadMinutes: parseFloat(process.env.BATCH_UPLOAD_MINUTES || "5"),

  // App Service sets WEBSITE_HOSTNAME automatically (e.g. essl-adms.azurewebsites.net).
  // Set PUBLIC_HOSTNAME yourself if you're behind a custom domain or another host.
  publicHostname: process.env.PUBLIC_HOSTNAME || process.env.WEBSITE_HOSTNAME || "",

  // Port the DEVICE should be told to use. Public hosts terminate on 80/443,
  // which is not the port this process listens on.
  devicePort: parseInt(process.env.DEVICE_PORT || "0", 10) || null,

  // Behind Azure's front-end load balancer the real client IP is in X-Forwarded-For.
  trustProxy: (process.env.TRUST_PROXY || "false").toLowerCase() === "true",

  // Security. Empty list = no restriction (fine on a LAN, NOT for a public endpoint).
  allowedSerials: list(process.env.ALLOWED_SERIALS),
  allowedIps: list(process.env.ALLOWED_DEVICE_IPS),

  // Which browser origins may call /api and /ws. Empty = allow any (local dev).
  corsOrigins: list(process.env.CORS_ORIGINS),

  isProduction: (process.env.NODE_ENV || "development") === "production",
};

export const securityEnabled = config.allowedSerials.length > 0 || config.allowedIps.length > 0;
