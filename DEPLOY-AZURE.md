# Deploying to Azure

Target architecture:

```
K90 Pro (office)
    │  http://essl-adms.azurewebsites.net:80/iclock/cdata.aspx
    ▼
Azure App Service (Linux, Node 22)  ──▶  Azure PostgreSQL (already provisioned)
    │
    │  wss://essl-adms.azurewebsites.net/ws
    ▼
Azure Static Web Apps (React dashboard)
```

---

## 0. Before you start

| Item | Where to get it |
|---|---|
| Your office's **public IP** | Google "what is my ip" **from the office network**, not from home |
| Device **serial number** | `NFZ8254202401` — shown on the Devices tab |
| **DATABASE_URL** | The Azure Postgres connection string you already use locally |

If your office internet has a **dynamic** public IP, the IP allowlist will break whenever it changes. Either ask your ISP for a static IP, or drop `ALLOWED_DEVICE_IPS` and rely on the serial allowlist alone.

---

## 1. Create the App Service

**Portal:** Create a resource → Web App

| Field | Value |
|---|---|
| Name | `essl-adms` (must be globally unique) |
| Publish | Code |
| Runtime stack | **Node 22 LTS** |
| Operating System | **Linux** |
| Region | Same region as your Postgres server |
| Pricing plan | **B1 Basic** — see the warning below |

**CLI:**

```bash
az group create --name essl-rg --location centralindia

az appservice plan create \
  --name essl-plan --resource-group essl-rg \
  --sku B1 --is-linux

az webapp create \
  --name essl-adms --resource-group essl-rg \
  --plan essl-plan --runtime "NODE:22-lts"
```

> **Don't use the Free (F1) tier.** Free App Services have no *Always On* — the app is unloaded after ~20 minutes idle and only wakes on an incoming HTTP request. Your device would silently lose punches during the cold-start window, and the WebSocket dashboard would keep dropping. B1 is the cheapest tier with Always On.

---

## 2. Configure the App Service

### Settings → Configuration → General settings

| Setting | Value | Why |
|---|---|---|
| **Web sockets** | **On** | Off by default. Without it the live dashboard won't work. |
| **Always On** | **On** | Keeps the process alive so punches are never missed. |
| **Startup Command** | `node src/server.js` | |
| **HTTPS Only** | **Off** — required | The K90 Pro has no Server Port field in domain mode, so it can only use port 80. With HTTPS Only on, Azure answers port 80 with a 301 the device won't follow, and it goes silent with no on-screen error. |

### Settings → Environment variables → App settings

```
DATABASE_URL         = postgresql://techconznexoradb:...@nexoradevdb.postgres.database.azure.com:5432/kprnest_db?sslmode=require
DB_ENABLED           = true
TZ_OFFSET            = +05:30
NODE_ENV             = production
TRUST_PROXY          = true
ALLOWED_SERIALS      = NFZ8254202401
ALLOWED_DEVICE_IPS   = <your office public IP>
CORS_ORIGINS         = https://<your-swa-name>.azurestaticapps.net
SCM_DO_BUILD_DURING_DEPLOYMENT = false
```

**Do not set `PORT`.** App Service injects it; `config.js` reads `process.env.PORT` automatically. Hard-coding 8081 will make the app unreachable.

`TRUST_PROXY=true` is essential — behind Azure's load balancer every request appears to come from an internal IP unless Express reads `X-Forwarded-For`. Without it, your IP allowlist will reject your own device.

### Postgres firewall

Azure Database for PostgreSQL → Networking → tick **"Allow public access from any Azure service within Azure"**, or add the App Service's outbound IPs explicitly.

---

## 3. Deploy the backend

### Option A — GitHub Actions (recommended)

1. Push this repo to GitHub.
2. App Service → Deployment Center → Manage publish profile → **Download**.
3. GitHub repo → Settings → Secrets and variables → Actions → New secret:
   - `AZURE_WEBAPP_PUBLISH_PROFILE` = the entire contents of that file.
4. Edit `AZURE_WEBAPP_NAME` in `.github/workflows/deploy-backend.yml` if you didn't name it `essl-adms`.
5. Push to `main`. The workflow builds and deploys.

### Option B — one-off ZIP deploy

```bash
cd backend
npm ci --omit=dev
zip -r ../backend.zip . -x ".env"
az webapp deploy --resource-group essl-rg --name essl-adms \
  --src-path ../backend.zip --type zip
```

### Verify

```
https://essl-adms.azurewebsites.net/api/health
```

Expect `"database": "connected"`. Then check the log stream (App Service → Log stream) for:

```
[ OK  ] Device guard active — serials: NFZ8254202401 · IPs: <your ip>
[ OK  ] PostgreSQL connected
```

If you instead see `NO DEVICE GUARD CONFIGURED`, your app settings didn't apply — restart the app.

---

## 4. Run the database migration against Azure

The tables already exist if you migrated from your laptop against the same database — you're done. Otherwise, from your laptop with the same `DATABASE_URL` in `backend/.env`:

```
npm run migrate
```

---

## 5. Deploy the dashboard to Static Web Apps

1. Create a resource → **Static Web App**
   - Plan type: **Free**
   - Deployment: **Other** (we use our own workflow)
2. Copy the **deployment token** (Overview → Manage deployment token).
3. Add two GitHub secrets:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN` = that token
   - `VITE_API_BASE` = `https://essl-adms.azurewebsites.net`
4. Push to `main` — `deploy-frontend.yml` builds and uploads.
5. Set `CORS_ORIGINS` on the App Service to the SWA URL it gives you, then restart the App Service.

`VITE_API_BASE` is baked into the JavaScript bundle at build time. If you change it you must rebuild, not just restart.

The dashboard connects over `wss://` while the device pushes over plain `http://` — both work against the same App Service simultaneously.

---

## 6. Point the K90 Pro at Azure

**Menu → Comm → Cloud Server Setting**

| Setting | Value |
|---|---|
| Server Mode | ADMS |
| **Enable Domain Name** | **ON** |
| Server Address | `essl-adms.azurewebsites.net` (no `http://`, no trailing slash) |
| Server Port | **80** — if the field isn't shown, the device already defaults to 80 |
| **Enable Proxy Server** | **OFF** |

If the proxy is left ON with IP `0.0.0.0`, the device routes everything to a
non-existent address and silently fails. Turn it off unless your office genuinely
requires an HTTP proxy for outbound internet — in which case enter the real
proxy IP and port.

Confirm the port after it connects: the Host header in the Raw Requests tab
should read `essl-adms.azurewebsites.net` with **no** `:port` suffix.

Save, then watch the App Service log stream. Within ~30 seconds you should see the handshake and `getrequest` polls.

### Trying HTTPS instead

Once HTTP works, you can try port **443**. Your firmware (Ver 8.0.4.3-20230515) advertises TLS support, but eSSL TLS stacks are unreliable in practice — if the device goes silent on 443, revert to 80. Only turn **HTTPS Only** back on in App Service if 443 proves stable, otherwise you'll break the device with a 301 redirect it won't follow.

---

## 7. Verify end to end

1. `https://essl-adms.azurewebsites.net/api/health` → `"connected"`
2. Open your Static Web App URL → status pill shows **connected**
3. Punch a finger → row appears within a second or two
4. App Service log stream shows the `✅ PUNCH` block
5. `https://essl-adms.azurewebsites.net/api/punches?limit=5` returns the record

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Device silent, nothing in log stream | Office firewall blocks outbound 80, or "Enable Domain Name" is still OFF. |
| `REJECTED request from unlisted IP x.x.x.x` | That's your real office IP — add it to `ALLOWED_DEVICE_IPS`. If it keeps changing, your ISP gives you a dynamic IP. |
| Everything rejected right after deploy | `TRUST_PROXY` isn't `true`, so Express sees Azure's internal IP. |
| Dashboard stuck on "connecting" | Web sockets not enabled in General settings, or `VITE_API_BASE` wrong/missing at build time. |
| Dashboard loads but API calls fail | `CORS_ORIGINS` doesn't exactly match the SWA origin (scheme + host, no trailing slash). |
| Punches stop overnight | Always On is off, or you're on the Free tier. |
| App won't start | You set `PORT` manually. Remove it. |

---

## Honest limitations

**ADMS has no authentication.** The serial allowlist and IP restriction raise the bar but neither is cryptographic — a serial number is guessable and source IPs can be spoofed on some networks. Anyone who learns your device serial *and* can send from your office IP range can inject fabricated attendance.

If this data drives payroll, the stronger options are:

- Put **Azure Front Door** or **Application Gateway with WAF** in front and restrict by geography plus rate limits.
- Give the device a **site-to-site VPN** or **Azure VPN Gateway** tunnel so the endpoint is never publicly routable — the only genuinely solid answer.
- Treat the device feed as *untrusted input* and reconcile against a second source before paying anyone.

**No replay protection.** The device resends batches until acknowledged; the database de-duplicates on `(device_sn, pin, punch_time, status)`, so an attacker replaying a captured batch changes nothing. But a *new* fabricated record with a fresh timestamp would be accepted.
