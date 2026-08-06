# Azure Portal — click-by-click

Everything below is done at **https://portal.azure.com**.

> Azure moves menu items around between releases. If a blade isn't where this says,
> use the **search box at the top of the portal** — searching the setting name
> (e.g. "Web sockets") usually jumps straight to it.

Values used throughout — substitute your own:

| Placeholder | Example |
|---|---|
| App Service name | `essl-adms` |
| Resource group | `essl-rg` |
| Region | Central India (match your Postgres server) |
| Device serial | `NFZ8254202401` |

---

## Part 1 — Create the App Service (backend)

1. Click **+ Create a resource** (top-left).
2. Search **Web App** → click it → **Create**.
3. **Basics** tab:
   - **Subscription** — yours
   - **Resource group** — click **Create new** → `essl-rg` → OK
   - **Name** — `essl-adms` (becomes `essl-adms.azurewebsites.net`, must be globally unique)
   - **Publish** — **Code**
   - **Runtime stack** — **Node 22 LTS**
   - **Operating System** — **Linux**
   - **Region** — same region as your PostgreSQL server
   - **Pricing plan** — click **Create new** / **Change size** → **Basic B1**
     - Do **not** pick Free F1. It has no Always On, so the app unloads when idle and punches are lost.
4. **Deployment** tab — leave Continuous deployment **Disabled**. (This repo has its
   own workflow; letting Azure generate one produces a wrong path for a monorepo.)
5. **Monitoring** tab — Application Insights **No** (optional, saves cost).
6. Click **Review + create** → **Create**. Wait ~1 minute.
7. When done, click **Go to resource**.

---

## Part 2 — Configure the App Service

### 2a. General settings

Left menu → **Settings** → **Configuration** → **General settings** tab.

> In newer portal versions this may be split: **Settings → Configuration** for the
> toggles, **Settings → Environment variables** for app settings.

Set these:

| Field | Value |
|---|---|
| **Web sockets** | **On** |
| **Always On** | **On** |
| **HTTPS Only** | **Off** |
| **Startup Command** | `node src/server.js` |

Click **Save** → **Continue**.

**Why HTTPS Only must be Off:** the K90 Pro has no Server Port field in domain
mode, so it can only reach port 80. With HTTPS Only On, Azure answers port 80
with a 301 redirect the device won't follow — it goes silent with no error on the
device screen.

**Why Web sockets must be On:** it's Off by default and the live dashboard uses a
WebSocket. The punch feed will never connect without it.

### 2b. Environment variables

Left menu → **Settings** → **Environment variables** → **App settings** tab
(older portal: **Configuration** → **Application settings**).

Click **+ Add** for each row:

| Name | Value |
|---|---|
| `DATABASE_URL` | your full Postgres connection string |
| `DB_ENABLED` | `true` |
| `TZ_OFFSET` | `+05:30` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |
| `ALLOWED_SERIALS` | `NFZ8254202401` |
| `CORS_ORIGINS` | (fill in after Part 4) |
| `HALF_DAY_BOUNDARY` | `13:00` |
| `DEBOUNCE_SECONDS` | `120` |
| `MAX_DAY_HOURS` | `12` |
| `MIN_DAY_HOURS` | `1` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` |

Click **Apply** → **Confirm**.

**Do NOT add `PORT`.** Azure injects it. Setting it manually is the single most
common cause of "application error" on App Service Node apps.

`ALLOWED_DEVICE_IPS` is deliberately left out for now — see Part 6.

---

## Part 3 — Allow the App Service to reach PostgreSQL

1. Portal search box → your PostgreSQL server (`nexoradevdb`) → open it.
2. Left menu → **Settings** → **Networking**.
3. Under **Firewall rules**, tick
   **"Allow public access from any Azure service within Azure to this server"**.
4. Click **Save**.

---

## Part 4 — Create the Static Web App (dashboard)

1. **+ Create a resource** → search **Static Web App** → **Create**.
2. **Basics**:
   - **Resource group** — `essl-rg`
   - **Name** — `essl-dashboard`
   - **Plan type** — **Free**
   - **Deployment source** — **Other**
     (choosing GitHub here makes Azure write its own workflow, which conflicts
     with the one in this repo)
3. **Review + create** → **Create** → **Go to resource**.
4. On the **Overview** page, copy the URL — e.g.
   `https://nice-sand-01234.azurestaticapps.net`.
5. Click **Manage deployment token** (top toolbar) → copy the token.

### Now go back and set CORS

App Service → **Settings** → **Environment variables** → edit `CORS_ORIGINS` →
paste the Static Web App URL exactly (scheme + host, **no trailing slash**) →
**Apply** → **Restart** the App Service.

---

## Part 5 — Deploy the code

This part is GitHub, not the portal.

1. Push this repo to GitHub.
2. App Service → left menu → **Deployment** → **Deployment Center** →
   toolbar **Manage publish profile** → **Download publish profile**.
3. GitHub repo → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**, three times:

   | Secret name | Value |
   |---|---|
   | `AZURE_WEBAPP_PUBLISH_PROFILE` | entire contents of the downloaded file |
   | `AZURE_STATIC_WEB_APPS_API_TOKEN` | the deployment token from Part 4 |
   | `VITE_API_BASE` | `https://essl-adms.azurewebsites.net` |

4. If you named the App Service something other than `essl-adms`, edit
   `AZURE_WEBAPP_NAME` at the top of `.github/workflows/deploy-backend.yml`.
5. Push to `main`. Watch the **Actions** tab until both workflows go green.

### Check it worked

Open `https://essl-adms.azurewebsites.net/api/health` — expect
`"database": "connected"`.

Open `https://essl-adms.azurewebsites.net/api/setup` — it should now say
`"mode": "hosted"` and print the exact device settings.

---

## Part 6 — Point the device at Azure

On the K90 Pro: **Menu → Comm → Cloud Server Setting**

```
Server Mode         : ADMS
Enable Domain Name  : ON
Server Address      : essl-adms.azurewebsites.net
Enable Proxy Server : OFF
```

No `http://`, no trailing slash. If a Server Port field appears, set it to **80**.

Save, then in the portal open App Service → **Monitoring** → **Log stream**.

Within ~30 seconds you should see:

```
[DEVICE] GET /iclock/cdata.aspx?SN=NFZ8254202401&options=all&pushver=2.4.1
[ OK  ] Handshake with device NFZ8254202401 — realtime push enabled
```

### Now lock down the IP (optional)

In the same log stream, find the device's real public IP:

```
[RAW  ] from 203.0.113.45  SN=NFZ8254202401
```

App Service → **Environment variables** → **+ Add** →
`ALLOWED_DEVICE_IPS` = `203.0.113.45` → **Apply** → **Restart**.

Doing it in this order means you can never lock yourself out by guessing wrong.
Skip this entirely if your office IP is dynamic.

---

## Part 7 — Verify end to end

1. Log stream shows `[ OK ] Device guard active — serials: NFZ8254202401`
2. Punch a finger → `✅ PUNCH` appears in the log stream
3. Open the Static Web App URL → status pills read **Connected · Device: online · DB: Connected**
4. The punch appears in the Live Feed within a second or two
5. Raw Requests tab → Host reads `essl-adms.azurewebsites.net` with **no** `:port`
   — that confirms the device is using port 80

---

## If something doesn't work

| Symptom | Where to look |
|---|---|
| Nothing in Log stream after saving device settings | HTTPS Only still On; or office firewall blocks outbound 80; or proxy left On with `0.0.0.0` |
| `REJECTED request from unlisted IP x.x.x.x` | That IP **is** your office — paste it into `ALLOWED_DEVICE_IPS` |
| Everything rejected right after deploy | `TRUST_PROXY` isn't `true`, so Express sees Azure's internal IP |
| App won't start / "Application Error" | You set `PORT` manually — delete it. Then check **Log stream** for the Node error |
| Dashboard stuck on "connecting" | Web sockets Off, or `VITE_API_BASE` wrong at build time (rebuild, don't just restart) |
| Dashboard loads, API calls fail | `CORS_ORIGINS` doesn't exactly match the SWA origin |
| Punches stop overnight | Always On is Off, or you're on the Free tier |
| `relation "..." does not exist` | Migration never ran — run `npm run migrate` from your laptop against the same `DATABASE_URL` |
