# eSSL K90 Pro → Local Node.js (ADMS)

Monorepo that receives fingerprint punches from an **eSSL K90 Pro** over the ZKTeco **ADMS / PUSH SDK** protocol, prints them to the console, stores them in PostgreSQL, and streams them live to a React dashboard over WebSocket.

```
K90 Pro  ──ADMS/HTTP──▶  Node.js backend (:8081)  ──WebSocket──▶  React dashboard (:5115)
                                  │
                                  └──▶ PostgreSQL + console output
```

## Layout

```
essl-time/
├── backend/                    Node.js + Express ADMS server
│   ├── src/
│   │   ├── server.js           entry point, WS attach, catch-all logging
│   │   ├── config.js
│   │   ├── routes/
│   │   │   ├── iclock.js       ADMS protocol (/iclock/*) — the device talks here
│   │   │   └── api.js          dashboard REST API (/api/*)
│   │   ├── services/
│   │   │   ├── admsParser.js   tab-separated ATTLOG / USERINFO parsing
│   │   │   └── eventHub.js     in-memory ring buffers + WebSocket broadcast
│   │   ├── db/                 pool, schema.sql, migrate.js, repository.js
│   │   └── utils/              logger, network
│   ├── scripts/simulate-punch.js   fake a punch without the device
│   └── .env
└── frontend/                   React 18 + Vite dashboard
    └── src/
        ├── App.jsx
        ├── hooks/useAdmsSocket.js  auto-reconnecting WebSocket
        └── components/         PunchFeed, DevicePanel, RawLogViewer, SetupCard
```

## Quick start

```bash
# 1. install
npm run install:all

# 2. create the tables (once)
npm run migrate

# 3. terminal A — backend
npm run backend

# 4. terminal B — dashboard
npm run frontend
```

Or just double-click `start.bat` (opens both).

- Backend: http://localhost:8081
- Dashboard (dev): http://localhost:5115

For a permanent install, build the dashboard instead and let the backend serve it
on port 8081 — one process, one port, nothing extra to keep alive:

```bash
npm run build      # then open http://<server-ip>:8081
```

## Test without the device

```bash
npm run simulate            # random PIN, check-in
npm run simulate -- 1001 1  # PIN 1001, check-out
```

The punch appears in the backend console **and** in the dashboard instantly.

## Tests

```bash
npm test                                  # everything
npm run test:timesheet                    # attendance rules, against a real Postgres
npm --prefix backend  run test:feed-reset # the daily reset can't touch attendance_logs
npm --prefix backend  run test:feed-rollover # the in-memory half of the reset
npm --prefix frontend run test:view       # timesheet filters + sorting
npm --prefix frontend run test:feed       # feed merge + paging
```

`test:timesheet` runs the **real** timesheet SQL against a throwaway in-process
Postgres (PGlite — a dev dependency, nothing to install or connect to) over a
dozen seeded days: normal shifts, half days, missing check-outs, de-bounced
triple-taps, a device whose clock is 3h fast, and an offline backlog upload. It
prints the resulting timesheet and asserts every check-in, check-out, `Hours`,
`Real Hrs` and flag.

`test:feed-reset` seeds two days into both `live_feed` and `attendance_logs`,
runs the purge, and asserts the feed lost yesterday while `attendance_logs` kept
every row — the guarantee the whole feature rests on.

`test:feed-rollover` forces a day change by moving `TZ_OFFSET` instead of waiting
for midnight, and checks the in-memory buffer clears only on a real rollover.

`test:view` and `test:feed` exercise the dashboard's filter, sort, merge and
paging logic (`frontend/src/lib/`) with no browser required.

## Point the K90 Pro at your laptop

1. Find your laptop's IPv4: `ipconfig` — or just open http://localhost:8081/api/setup, which prints the exact values to enter.
2. Allow inbound TCP 8081 through Windows Firewall:
   ```powershell
   netsh advfirewall firewall add rule name="ESSL ADMS 8081" dir=in action=allow protocol=TCP localport=8081
   ```
3. On the device: **Menu → Comm → Cloud Server Setting**

   | Setting | Value |
   |---|---|
   | Server Mode | ADMS |
   | Enable Domain Name | OFF |
   | Server Address | your laptop IPv4 (e.g. 192.168.1.100) |
   | Server Port | 8081 |
   | Proxy | OFF |

4. Save. The device reboots its comm stack and hits `GET /iclock/cdata?SN=...` within ~30s. You'll see the handshake in the backend console and the device on the **Devices** tab.
5. Punch a finger. The console prints:

   ```
   ✅  PUNCH  →  Employee PIN: 1001
       Time      : 05/08/2026, 12:11:27
       Type      : Check In
       Verified  : Fingerprint
       Device    : XXXXXXXXXXX
   ```

## ADMS endpoints implemented

| Endpoint | Purpose |
|---|---|
| `GET /iclock/cdata` | Handshake — server returns the device's operating config (`Realtime=1` enables instant push) |
| `POST /iclock/cdata?table=ATTLOG` | Attendance records (tab-separated) |
| `POST /iclock/cdata?table=OPERLOG` | User records / operation log |
| `GET /iclock/getrequest` | Device polls for queued commands |
| `POST /iclock/devicecmd` | Device reports command results |
| `*` | Anything else is logged verbatim and answered `OK` |

Some firmwares (confirmed on **K90 Pro Ver 8.0.4.3-20230515**) append `.aspx` to every endpoint — `/iclock/cdata.aspx`, `/iclock/getrequest.aspx`. `server.js` strips the suffix before routing, so both styles hit the same handlers. If the device keeps re-sending the same ATTLOG batch over and over, it means it isn't receiving a proper `OK: <count>` — check for `[WARN] Unknown /iclock path` in the console.

Every request — method, URL, query, headers, raw body — is printed to the console, stored in `device_raw_logs`, and shown on the dashboard's **Raw Requests** tab. That tab is how you decode any firmware-specific quirk in your particular K90 Pro.

## Dashboard API

| Route | Description |
|---|---|
| `GET /api/health` | Server + DB status, detected IPs |
| `GET /api/setup` | Exact values to type into the device |
| `GET /api/punches?limit=100` | Attendance, newest first |
| `GET /api/feed?limit=50\|100\|300\|all` | Today's live feed from `live_feed`, newest first, with the day's total |
| `GET /api/devices` | Known devices + last seen |
| `GET /api/employees` | Users synced from the device |
| `GET /api/timesheet?from=&to=` | Daily in/out/hours per employee, plus server-clock receive times and `realHours` |
| `GET /api/pins` | Every PIN that has punched, with name + punch count |
| `PUT /api/employees/:sn/:pin` | Set or clear a name — body `{"name":"Ravi Kumar"}` |
| `GET /api/raw-logs` | Raw request history |
| `GET /api/stats` | Today's totals |
| `POST /api/devices/:sn/sync-users` | Queue `DATA QUERY USERINFO` for the device |
| `ws://localhost:8081/ws` | Live `punch` / `raw` / `device` events |

## Database

Tables created by `npm run migrate`: `devices`, `employees`, `attendance_logs`, `live_feed`, `device_raw_logs`, `device_commands`. Duplicate punches are de-duplicated by `(device_sn, pin, punch_time, status)`.

**Re-run `npm run migrate` after pulling this change** — it creates the new
`live_feed` table. It's `CREATE TABLE IF NOT EXISTS`, so it's safe to run on an
existing database and won't touch your attendance history.

The server **never fails a device request because of the database** — if Postgres is unreachable, punches still print and stream live, and the device still gets its `OK`.

## How check-in / check-out is decided

The K90 Pro sends `status=0` on virtually every record, because that field is only
set when someone presses an F1/F2 state key before scanning — which nobody does.
So direction is **derived, not trusted**:

The day is split at `HALF_DAY_BOUNDARY` (default 13:00):

- **First scan of the day** → Check In — **and it never moves**
- **Later scan still in the first half** → Recorded (check-in stays put)
- **Any scan in the second half** → Check Out — the latest one wins
- **A scan within `DEBOUNCE_SECONDS` (default 120) of the previous** → repeat scan,
  keeps the previous role

Worked example — 09:30, 11:30, 16:00, 23:00:

| Punch | Recorded as | Result |
|---|---|---|
| 09:30 | Check In | check-in 09:30 |
| 11:30 | Recorded | check-in still 09:30 |
| 16:00 | Check Out | check-out 16:00 |
| 23:00 | Check Out | check-out 23:00 |

**Day types**, from which halves were actually worked:

| Type | Meaning |
|---|---|
| `FULL_DAY` | Scans in both halves |
| `HALF_DAY_FIRST` | Only first-half scans — e.g. 09:30 → 11:30 |
| `HALF_DAY_SECOND` | Only second-half scans — flagged `NO_MORNING_SCAN` |
| `HALF_DAY_NO_OUT` | Punched in, never out — **credited as a half day**, hours left unknown |

`HALF_DAY_NO_OUT` is a policy choice: the person turned up, so the day counts as
half. The hours stay `null` rather than being invented, and the row is flagged
`SHORT_DAY` so someone confirms it before payroll.

Day boundaries use `TZ_OFFSET`, not the server's timezone, so results are identical
on a laptop in IST and on Azure in UTC.

**Known limits of first/last:**

- A day with a single scan reports `hours: null` and shows **missing** in the
  Timesheet — it can't be guessed.
- Lunch breaks are included in the total, since only the outer two scans count.
- A stray late-evening scan inflates the day. Real example from this device:
  PIN 14 on 29 Jun scanned at 08:00 and again at 23:01 → 15.03 hours.

## The live feed holds one day

Punches are written to **two independent tables**:

| Table | Holds | Lifetime |
|---|---|---|
| `attendance_logs` | every punch, raw | **forever** — this is what the Timesheet reads |
| `live_feed` | today's punches plus the derived role / repeat-scan labels | **wiped at local midnight** |

The feed is stored, not just buffered, so a server restart mid-shift no longer
empties it — and the derived "Check In / Recorded / Check Out" labels survive,
which they can't in `attendance_logs` (it doesn't have columns for them).

**The reset only ever touches `live_feed`.** The delete is
`DELETE FROM live_feed WHERE work_date <> today` — it names one table and cannot
reach `attendance_logs`, so past days remain complete in the Timesheet. There is
a test that asserts exactly this.

The day boundary is the **local** day via `TZ_OFFSET`, same as everywhere else.
Rollover is triggered by whichever comes first: a punch arriving after midnight,
a 60-second timer, or server startup. When it fires, connected dashboards get a
`feed-reset` WebSocket event and clear themselves immediately.

**Paging.** `GET /api/feed?limit=50|100|300|all` returns today's punches, newest
first, with the day's true total alongside. The dashboard has 50 / 100 / 300 /
All buttons and shows `Showing 50 of 312 punches today`. Live punches arriving
over the socket are merged into the loaded page rather than triggering a refetch.

If Postgres is unreachable the endpoint falls back to the in-memory ring buffer
and marks the response `source: "memory"`, which the dashboard shows as a badge.

## Filtering and sorting the Timesheet

Below the date range there is a filter row. Everything in it is applied **in the
browser** to the range already loaded, so it responds instantly and costs no
extra queries:

| Filter | Notes |
|---|---|
| **Employee Name** | Dropdown of everyone who has ever punched, from `/api/pins` — not just whoever appears in the current range, so the list doesn't reshuffle when you change dates |
| **Search name or PIN** | Free text, matches either field |
| **Day type** | Full Day, Half Day — any, Half Day (1st half), Half Day (2nd half), Half Day (no check-out) |
| **Review flag** | One specific flag, or `Any flag` / `No flags (clean days)` |

The four stat tiles recalculate to match whatever is on screen, so a filtered
view still adds up.

**The Day type filter groups by which half was worked, not by the label.** This
matters for one specific case: a person who scans once in the afternoon and never
punches out is classified `HALF_DAY_NO_OUT`, because the hours can't be known.
Filtering on the raw label would hide that day from "Half Day (2nd half)" —
which is precisely where someone hunting for afternoon-only days would look. So:

| Option | Matches |
|---|---|
| `Half Day — any` | any `HALF_DAY_*` |
| `Half Day (1st half)` | any half day with a counted morning scan — includes `HALF_DAY_NO_OUT` |
| `Half Day (2nd half)` | any half day with a counted afternoon scan — includes `HALF_DAY_NO_OUT` |
| `Half Day (no check-out)` | `HALF_DAY_NO_OUT` only |

The API sends `hasFirstHalf` / `hasSecondHalf` per day to make this possible;
hovering the Day badge says which halves were worked.

**Sorting** — every column header is a button with a `⇅` icon. Clicking cycles:

```
⇅ default (newest date, then PIN)  →  ▲ ascending  →  ▼ descending  →  ⇅ default
```

Two deliberate choices:

- **Unknowns always sink to the bottom**, in both directions. A day with no
  check-out has `hours: null` — that is *unknown*, not zero, so it should never
  sort as if it were the shortest day.
- **The sort is stable**, so rows tied on the chosen column keep the server's
  ordering underneath.

On phones the header row is hidden by the card layout, so sorting moves into a
**Sort by** dropdown in the filter row.

`npm --prefix frontend run test:view` covers all of this — 27 assertions over the
filter predicates, the sort comparators, the null-sinking rule and the totals.

## Two clocks: `Hours` vs `Real Hrs`

Every row in `attendance_logs` carries two timestamps:

| Column | Whose clock | Can it lie? |
|---|---|---|
| `punch_time` | the **device's** RTC | **Yes** — a K90 Pro that lost power, was reset, or never had its date set will stamp punches with a wrong date/time |
| `received_at` | the **server's** clock (`DEFAULT NOW()`) | No — Postgres sets it when the row is written |

So the Timesheet reports both spans side by side:

- **Hours** = `check-out − check-in`, using `punch_time` (device clock)
- **Real Hrs** = `Out Received − In Received`, using `received_at` (server clock)

On a healthy device the two agree. When they don't, the device's date/time is
wrong — and `Real Hrs` tells you what actually happened. Column order in the
Timesheet is:

```
Check In | Check Out | In Received | Out Received | Real Hrs | Hours | Day | Scans | Review
```

Worked example — the K90 Pro's clock is **3 hours fast**:

| | Value |
|---|---|
| Check In (device) | 12:30 |
| Check Out (device) | 23:30 |
| In Received (server) | 09:30 |
| Out Received (server) | 17:30 |
| **Hours** | 11.00 |
| **Real Hrs** | 8.00 |
| Flag | `CLOCK_DRIFT` — *Device says 11h, server received them 8h apart* |

**The batch-upload exception.** If the device is offline all day it replays its
whole backlog in a single POST, so every `received_at` lands seconds apart and
`Real Hrs` collapses to ~0. That is not clock drift. When both punches arrive
within `BATCH_UPLOAD_MINUTES` of each other the day is flagged `BATCH_UPLOAD`
instead, and `Real Hrs` should be ignored for that row.

**Review flags.** Because of those limits, the Timesheet flags days rather than
trusting them silently. Flags never change the numbers — they ask a human to look:

| Flag | Trigger | Env var |
|---|---|---|
| `SHORT_DAY` | Only one scan — no check-out, credited as half day | — |
| `LONG_DAY` | Hours above the threshold | `MAX_DAY_HOURS` (12) |
| `SHORT_HOURS` | Hours below the threshold | `MIN_DAY_HOURS` (1) |
| `NO_MORNING_SCAN` | First scan came after the half-day boundary | `HALF_DAY_BOUNDARY` |
| `MULTI_SCAN` | 3+ real scans, so middle scans were discarded | `REVIEW_MIN_SCANS` (3) |
| `CLOCK_DRIFT` | `Hours` and `Real Hrs` disagree — device date/time is wrong | `CLOCK_DRIFT_HOURS` (1) |
| `BATCH_UPLOAD` | Both punches arrived in one upload, so `Real Hrs` is meaningless | `BATCH_UPLOAD_MINUTES` (5) |

`CLOCK_DRIFT` and `BATCH_UPLOAD` are mutually exclusive — a batch upload
suppresses the drift check, because a delayed upload is not a broken clock.

**In the live feed**, each punch also shows its `recv` time next to the device
timestamp. A single punch can't be judged as harshly as a whole day, so the feed
reports only what it can prove:

| Badge | Meaning |
|---|---|
| `clock ahead 3h` | The device stamped the punch **in the future** relative to when it arrived. Nothing but a wrong device clock explains this. |
| `arrived 2h late` | Reached the server well after its own timestamp — either an offline backlog replay or a slow clock. Ambiguous on its own; the Timesheet decides. |

Both use a 120s tolerance, so ordinary network latency stays quiet.

The Scans column shows `effective (+repeats)` — e.g. `3 (+1)` means three real
scans and one that fell inside the de-bounce window.

To switch to alternating in/out pairs instead, the rule lives in one place:
`backend/src/services/attendanceRules.js`.

## Timezone

The device sends naive timestamps. `TZ_OFFSET` in `backend/.env` (default `+05:30`) is applied when converting to `timestamptz`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing in console after saving device settings | Laptop and device on different subnets, or firewall blocking 8081. Open `http://<laptop-ip>:8081` from your phone on the same Wi-Fi. |
| Device connects but no punches | Punches may be batched — check `TransInterval`/`Realtime` in the handshake reply, and confirm the ATTLOG rows exist on the device. |
| `EADDRINUSE` | Something else owns 8081 — change `PORT` in `backend/.env` and on the device. |
| Dashboard shows "disconnected" | Backend isn't running, or Vite's proxy target doesn't match `PORT`. |
