-- eSSL K90 Pro ADMS schema

CREATE TABLE IF NOT EXISTS devices (
  id             SERIAL PRIMARY KEY,
  serial_number  TEXT UNIQUE NOT NULL,
  name           TEXT,
  ip_address     TEXT,
  firmware       TEXT,
  push_version   TEXT,
  last_seen_at   TIMESTAMPTZ,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_info       JSONB
);

CREATE TABLE IF NOT EXISTS employees (
  id             SERIAL PRIMARY KEY,
  device_sn      TEXT NOT NULL,
  pin            TEXT NOT NULL,
  name           TEXT,
  card_no        TEXT,
  privilege      INTEGER DEFAULT 0,
  department     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_sn, pin)
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id             BIGSERIAL PRIMARY KEY,
  device_sn      TEXT NOT NULL,
  pin            TEXT NOT NULL,
  punch_time     TIMESTAMPTZ NOT NULL,
  status         INTEGER,          -- 0=check-in 1=check-out 4=overtime-in 5=overtime-out
  verify_mode    INTEGER,          -- 1=fingerprint 4=card 15=face 25=palm
  work_code      TEXT,
  raw_line       TEXT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_sn, pin, punch_time, status)
);

CREATE INDEX IF NOT EXISTS idx_attlog_time  ON attendance_logs (punch_time DESC);
CREATE INDEX IF NOT EXISTS idx_attlog_pin   ON attendance_logs (device_sn, pin);

-- Today's live feed, exactly as the dashboard renders it.
--
-- This is deliberately SEPARATE from attendance_logs. It is wiped at the start
-- of every local day, so it must never be the source of truth for anything —
-- the timesheet reads attendance_logs, which is never touched by the reset.
-- It exists because the feed shows derived fields (the check-in/check-out role,
-- the repeat-scan flag) that attendance_logs does not store, and those would be
-- lost on a server restart if they only lived in memory.
CREATE TABLE IF NOT EXISTS live_feed (
  id             BIGSERIAL PRIMARY KEY,
  event_id       TEXT UNIQUE NOT NULL,   -- "<sn>-<pin>-<epoch ms>"
  device_sn      TEXT NOT NULL,
  pin            TEXT NOT NULL,
  employee_name  TEXT,
  punch_time     TIMESTAMPTZ NOT NULL,   -- device clock
  received_at    TIMESTAMPTZ NOT NULL,   -- server clock
  work_date      DATE NOT NULL,          -- local day, via TZ_OFFSET
  role           TEXT,                   -- CHECK_IN | CHECK_OUT | RECORDED
  role_label     TEXT,
  half           TEXT,                   -- FIRST | SECOND
  duplicate      BOOLEAN NOT NULL DEFAULT false,
  status         INTEGER,
  verify_mode    INTEGER,
  verify_label   TEXT
);

CREATE INDEX IF NOT EXISTS idx_live_feed_day  ON live_feed (work_date);
CREATE INDEX IF NOT EXISTS idx_live_feed_time ON live_feed (punch_time DESC);

-- Every raw HTTP hit from the device, for protocol debugging
CREATE TABLE IF NOT EXISTS device_raw_logs (
  id             BIGSERIAL PRIMARY KEY,
  device_sn      TEXT,
  method         TEXT,
  url            TEXT,
  query          JSONB,
  headers        JSONB,
  body           TEXT,
  remote_ip      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rawlogs_time ON device_raw_logs (created_at DESC);

-- Commands queued for the device to pick up on its next /iclock/getrequest poll
CREATE TABLE IF NOT EXISTS device_commands (
  id             BIGSERIAL PRIMARY KEY,
  device_sn      TEXT NOT NULL,
  command        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | done | failed
  response       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmd_pending ON device_commands (device_sn, status);
