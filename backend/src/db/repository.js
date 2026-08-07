import { safeQuery } from "./pool.js";

export async function upsertDevice({ sn, ip, info = {}, pushVersion = null }) {
  return safeQuery(
    `INSERT INTO devices (serial_number, ip_address, firmware, push_version, last_seen_at, raw_info)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (serial_number) DO UPDATE
       SET ip_address   = COALESCE(EXCLUDED.ip_address, devices.ip_address),
           firmware     = COALESCE(EXCLUDED.firmware, devices.firmware),
           push_version = COALESCE(EXCLUDED.push_version, devices.push_version),
           raw_info     = COALESCE(EXCLUDED.raw_info, devices.raw_info),
           last_seen_at = NOW()
     RETURNING *`,
    [sn, ip, info.FWVersion || null, pushVersion, Object.keys(info).length ? info : null]
  );
}

export async function touchDevice(sn, ip) {
  return safeQuery(
    `INSERT INTO devices (serial_number, ip_address, last_seen_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (serial_number) DO UPDATE SET last_seen_at = NOW(), ip_address = COALESCE(EXCLUDED.ip_address, devices.ip_address)`,
    [sn, ip]
  );
}

export async function insertAttendance(rec) {
  const res = await safeQuery(
    `INSERT INTO attendance_logs (device_sn, pin, punch_time, status, verify_mode, work_code, raw_line)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (device_sn, pin, punch_time, status) DO NOTHING
     RETURNING *`,
    [rec.deviceSn, rec.pin, rec.punchTime, rec.status, rec.verifyMode, rec.workCode, rec.rawLine]
  );
  return res?.rows?.[0] || null;
}

export async function upsertEmployee(emp) {
  return safeQuery(
    `INSERT INTO employees (device_sn, pin, name, card_no, privilege, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (device_sn, pin) DO UPDATE
       SET name      = COALESCE(NULLIF(EXCLUDED.name, ''), employees.name),
           card_no   = COALESCE(NULLIF(EXCLUDED.card_no, ''), employees.card_no),
           privilege = EXCLUDED.privilege,
           updated_at = NOW()`,
    [emp.deviceSn, emp.pin, emp.name, emp.cardNo, emp.privilege]
  );
}

export async function insertRawLog(entry) {
  return safeQuery(
    `INSERT INTO device_raw_logs (device_sn, method, url, query, headers, body, remote_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.deviceSn, entry.method, entry.url, entry.query, entry.headers, entry.body, entry.remoteIp]
  );
}

export async function listAttendance({ limit = 100, deviceSn = null, pin = null } = {}) {
  const where = [];
  const params = [];
  if (deviceSn) { params.push(deviceSn); where.push(`device_sn = $${params.length}`); }
  if (pin) { params.push(pin); where.push(`pin = $${params.length}`); }
  params.push(Math.min(limit, 1000));
  const res = await safeQuery(
    `SELECT a.*, e.name AS employee_name
       FROM attendance_logs a
       LEFT JOIN employees e ON e.device_sn = a.device_sn AND e.pin = a.pin
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.punch_time DESC
      LIMIT $${params.length}`,
    params
  );
  return res?.rows || [];
}

/* ---------- live feed (today only, wiped at midnight) ---------- */

/**
 * Persist one feed event. Separate from attendance_logs on purpose: this table
 * is truncated daily, attendance_logs is not. Re-sent punches are ignored via
 * event_id rather than raising.
 */
export async function insertFeedEvent(p, workDate) {
  return safeQuery(
    `INSERT INTO live_feed
       (event_id, device_sn, pin, employee_name, punch_time, received_at, work_date,
        role, role_label, half, duplicate, status, verify_mode, verify_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      p.id,
      p.deviceSn,
      p.pin,
      p.employeeName ?? null,
      p.punchTime,
      p.receivedAt,
      workDate,
      p.role ?? null,
      p.roleLabel ?? null,
      p.half ?? null,
      !!p.duplicate,
      p.status ?? null,
      p.verifyMode ?? null,
      p.verifyLabel ?? null,
    ]
  );
}

/** Newest first. `limit = null` means every punch of the day. */
export async function listFeed(workDate, limit = null) {
  const params = [workDate];
  let cap = "";
  if (limit !== null) {
    params.push(limit);
    cap = ` LIMIT $${params.length}`;
  }
  const res = await safeQuery(
    `SELECT * FROM live_feed WHERE work_date = $1::date ORDER BY punch_time DESC, id DESC${cap}`,
    params
  );
  return res?.rows || [];
}

export async function countFeed(workDate) {
  const res = await safeQuery(
    `SELECT COUNT(*)::int AS n FROM live_feed WHERE work_date = $1::date`,
    [workDate]
  );
  return res?.rows?.[0]?.n ?? 0;
}

/**
 * The daily reset. Scoped to live_feed by name — it cannot reach
 * attendance_logs, so the timesheet is safe by construction.
 */
export async function purgeFeedExcept(workDate) {
  const res = await safeQuery(`DELETE FROM live_feed WHERE work_date <> $1::date`, [workDate]);
  return res?.rowCount ?? 0;
}

/**
 * Friendly label for a device, typed by a human on the Devices tab.
 * The row is created if the device hasn't handshaken yet, so a name can be
 * pre-assigned to a serial before it ever connects.
 */
export async function setDeviceName(sn, name) {
  const res = await safeQuery(
    `INSERT INTO devices (serial_number, name)
     VALUES ($1, $2)
     ON CONFLICT (serial_number) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [sn, name || null]
  );
  return res?.rows?.[0] || null;
}

export async function listDevices() {
  const res = await safeQuery(`SELECT * FROM devices ORDER BY last_seen_at DESC NULLS LAST`);
  return res?.rows || [];
}

/** Manually set/clear a name for a PIN (dashboard editing). */
export async function setEmployeeName(deviceSn, pin, name) {
  const res = await safeQuery(
    `INSERT INTO employees (device_sn, pin, name, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (device_sn, pin) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING *`,
    [deviceSn, pin, name || null]
  );
  return res?.rows?.[0] || null;
}

/** Every PIN that has ever punched, with its name if known. */
export async function listPinsSeen(deviceSn = null) {
  const params = [];
  let where = "";
  if (deviceSn) {
    params.push(deviceSn);
    where = "WHERE a.device_sn = $1";
  }
  const res = await safeQuery(
    `SELECT a.device_sn,
            a.pin,
            e.name,
            COUNT(*)::int      AS punch_count,
            MAX(a.punch_time)  AS last_punch
       FROM attendance_logs a
       LEFT JOIN employees e ON e.device_sn = a.device_sn AND e.pin = a.pin
       ${where}
      GROUP BY a.device_sn, a.pin, e.name
      ORDER BY MAX(a.punch_time) DESC`,
    params
  );
  return res?.rows || [];
}

export async function listEmployees(deviceSn = null) {
  const res = deviceSn
    ? await safeQuery(`SELECT * FROM employees WHERE device_sn = $1 ORDER BY pin`, [deviceSn])
    : await safeQuery(`SELECT * FROM employees ORDER BY device_sn, pin`);
  return res?.rows || [];
}

export async function listRawLogs(limit = 100) {
  const res = await safeQuery(
    `SELECT * FROM device_raw_logs ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 500)]
  );
  return res?.rows || [];
}

/**
 * Daily timesheet — first scan of the day is the arrival, last is the departure.
 *
 * Day boundaries use TZ_OFFSET rather than the server's timezone, so results are
 * identical on your laptop and on Azure (which runs in UTC).
 *
 * Two clocks are reported side by side:
 *
 *   punch_time  — the DEVICE's clock. What the fingerprint reader believed the
 *                 time was. Wrong if the K90 Pro's RTC has drifted or was reset.
 *   received_at — the SERVER's clock (DEFAULT NOW()). Set when the row was
 *                 written to Postgres, so it cannot be corrupted by the device.
 *
 * `hours` comes from punch_time, `real_hours` from received_at. When the two
 * disagree the device clock is suspect — that is the whole point of carrying
 * both. See the CLOCK_DRIFT flag in routes/api.js.
 */
export async function timesheet(opts) {
  const { text, params } = timesheetQuery(opts);
  const res = await safeQuery(text, params);
  return res?.rows || [];
}

/**
 * The timesheet SQL, separated from its execution so tests can run it against a
 * throwaway Postgres without needing the app's connection pool.
 */
export function timesheetQuery({
  from,
  to,
  deviceSn = null,
  pin = null,
  tzOffset,
  debounceSeconds = 120,
  halfDayBoundary = "13:00",
  today,
  includeAbsent = true,
}) {
  const params = [tzOffset, from, to, `${debounceSeconds} seconds`, halfDayBoundary];
  // $6 only exists when the absence CTEs do — Postgres rejects a bind with more
  // parameters than the statement actually references.
  if (includeAbsent) params.push(today);
  let extra = "";
  if (deviceSn) {
    params.push(deviceSn);
    extra += ` AND a.device_sn = $${params.length}`;
  }
  if (pin) {
    params.push(pin);
    extra += ` AND a.pin = $${params.length}`;
  }

  // The columns both halves of the UNION must produce, in this order.
  const COLS = `device_sn, pin, employee_name, work_date,
                first_punch, last_punch, first_received, last_received,
                scans, effective_scans, has_first_half, has_second_half,
                hours, real_hours`;

  const text = `WITH marked AS (
       SELECT a.device_sn,
              a.pin,
              a.punch_time,
              a.received_at,
              ((a.punch_time AT TIME ZONE 'UTC') + $1::interval)::date AS work_date
         FROM attendance_logs a
        WHERE ((a.punch_time AT TIME ZONE 'UTC') + $1::interval)::date BETWEEN $2::date AND $3::date
              ${extra}
     ),
     seq AS (
       SELECT m.*,
              -- Which half of the working day this scan falls in
              (((m.punch_time AT TIME ZONE 'UTC') + $1::interval)::time < $5::time) AS first_half,
              LAG(m.punch_time) OVER (
                PARTITION BY m.device_sn, m.pin, m.work_date ORDER BY m.punch_time
              ) AS prev_time
         FROM marked m
     ),
     eff AS (
       -- A scan "counts" unless it lands within the de-bounce window of the
       -- previous scan. Same rule the live classifier applies.
       SELECT s.*, (s.prev_time IS NULL OR s.punch_time - s.prev_time >= $4::interval) AS counted
         FROM seq s
     ),
     agg AS (
       SELECT f.device_sn,
              f.pin,
              e.name                                            AS employee_name,
              f.work_date,
              -- Check-in is the earliest counted scan and never moves.
              MIN(f.punch_time) FILTER (WHERE f.counted)        AS first_punch,
              -- Check-out is the latest counted scan.
              MAX(f.punch_time) FILTER (WHERE f.counted)        AS last_punch,
              -- Server-clock arrival time of those same two rows. Ordered by
              -- punch_time (not received_at) so they pair with the punches above
              -- even when a backlog uploads out of order.
              (array_agg(f.received_at ORDER BY f.punch_time)
                 FILTER (WHERE f.counted))[1]                   AS first_received,
              (array_agg(f.received_at ORDER BY f.punch_time DESC)
                 FILTER (WHERE f.counted))[1]                   AS last_received,
              COUNT(*)::int                                     AS scans,
              COUNT(*) FILTER (WHERE f.counted)::int            AS effective_scans,
              COALESCE(bool_or(f.counted AND f.first_half), false)       AS has_first_half,
              COALESCE(bool_or(f.counted AND NOT f.first_half), false)   AS has_second_half
         FROM eff f
         LEFT JOIN employees e ON e.device_sn = f.device_sn AND e.pin = f.pin
        GROUP BY f.device_sn, f.pin, e.name, f.work_date
     ),
     worked AS (
       SELECT a.*,
              -- Device-clock span.
              CASE WHEN a.last_punch > a.first_punch
                   THEN ROUND(EXTRACT(EPOCH FROM (a.last_punch - a.first_punch)) / 3600.0, 2)
              END AS hours,
              -- Server-clock span. Immune to a wrong RTC on the device; equals
              -- ~0 when the device dumped the whole day in one batch upload.
              CASE WHEN a.last_received IS NOT NULL
                    AND a.first_received IS NOT NULL
                    AND a.effective_scans > 1
                   THEN ROUND(
                          EXTRACT(EPOCH FROM (a.last_received - a.first_received)) / 3600.0, 2)
              END AS real_hours
         FROM agg a
     )${
       includeAbsent
         ? `,
     /* ---- absence ----------------------------------------------------------
        An absent day has no punches, so there is nothing to aggregate — the row
        has to be manufactured. Everyone who has ever punched is crossed with
        every date in the range, and days that produced no scans at all are what
        remain.

        Two deliberate limits:
          * only from each person's FIRST ever punch onward, so a range that
            predates someone joining doesn't invent months of absence for them;
          * only up to YESTERDAY ($6 is today's local date), because someone who
            hasn't badged in at 10am today is not absent, just not in yet.
     ------------------------------------------------------------------------ */
     roster AS (
       SELECT a.device_sn,
              a.pin,
              MIN(((a.punch_time AT TIME ZONE 'UTC') + $1::interval)::date) AS first_seen
         FROM attendance_logs a
        WHERE TRUE ${extra}
        GROUP BY a.device_sn, a.pin
     ),
     cal AS (
       SELECT gs::date AS work_date
         FROM generate_series($2::date, LEAST($3::date, $6::date - 1), interval '1 day') gs
     ),
     absent AS (
       SELECT r.device_sn,
              r.pin,
              e.name                    AS employee_name,
              c.work_date,
              NULL::timestamptz         AS first_punch,
              NULL::timestamptz         AS last_punch,
              NULL::timestamptz         AS first_received,
              NULL::timestamptz         AS last_received,
              0                         AS scans,
              0                         AS effective_scans,
              false                     AS has_first_half,
              false                     AS has_second_half,
              NULL::numeric             AS hours,
              NULL::numeric             AS real_hours
         FROM roster r
         CROSS JOIN cal c
         LEFT JOIN employees e ON e.device_sn = r.device_sn AND e.pin = r.pin
        WHERE c.work_date >= r.first_seen
          AND NOT EXISTS (
                SELECT 1 FROM worked w
                 WHERE w.device_sn = r.device_sn
                   AND w.pin = r.pin
                   AND w.work_date = c.work_date
              )
     )`
         : ""
     }
     SELECT ${COLS} FROM worked${
       includeAbsent ? `\n     UNION ALL\n     SELECT ${COLS} FROM absent` : ""
     }
      ORDER BY work_date DESC, pin`;

  return { text, params };
}

export async function todayStats() {
  const res = await safeQuery(
    `SELECT COUNT(*)::int AS total,
            COUNT(DISTINCT pin)::int AS unique_employees
       FROM attendance_logs
      WHERE punch_time >= date_trunc('day', NOW())`
  );
  return res?.rows?.[0] || { total: 0, unique_employees: 0 };
}

/* ---------- device command queue ---------- */

export async function queueCommand(deviceSn, command) {
  const res = await safeQuery(
    `INSERT INTO device_commands (device_sn, command) VALUES ($1, $2) RETURNING *`,
    [deviceSn, command]
  );
  return res?.rows?.[0] || null;
}

export async function popPendingCommands(deviceSn, limit = 5) {
  const res = await safeQuery(
    `UPDATE device_commands
        SET status = 'sent', sent_at = NOW()
      WHERE id IN (
        SELECT id FROM device_commands
         WHERE device_sn = $1 AND status = 'pending'
         ORDER BY id LIMIT $2
      )
      RETURNING *`,
    [deviceSn, limit]
  );
  return res?.rows || [];
}

export async function completeCommand(id, response) {
  return safeQuery(
    `UPDATE device_commands SET status = 'done', response = $2, completed_at = NOW() WHERE id = $1`,
    [id, response]
  );
}
