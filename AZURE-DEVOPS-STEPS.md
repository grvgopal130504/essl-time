# Deploying from Azure DevOps — click-by-click

Your code lives in Azure Repos, so deployment uses **Azure Pipelines**, not GitHub
Actions. The two files `azure-pipelines-backend.yml` and
`azure-pipelines-frontend.yml` at the repo root do the work.

> The `.github/workflows/` folder is for GitHub Actions and is unused here.
> Safe to delete.

Create the Azure resources first — see **AZURE-PORTAL-STEPS.md** Parts 1–4.
Come back here in place of Part 5.

---

## Step 0 — Check you have a parallel job

Free Azure DevOps organisations start with **no** Microsoft-hosted parallel jobs,
and pipelines just queue forever with *"no hosted parallelism has been purchased
or granted."*

Check: **Organization settings** (bottom-left) → **Pipelines** → **Parallel jobs**.

If Microsoft-hosted shows **0**, request the free grant:
https://aka.ms/azpipelines-parallelism-request — approval typically takes 2–3
business days. Do this first; everything else waits on it.

---

## Step 1 — Create the service connection

This lets pipelines deploy into your Azure subscription.

1. Azure DevOps → your project → **Project settings** (bottom-left).
2. **Pipelines** → **Service connections** → **New service connection**.
3. Choose **Azure Resource Manager** → **Next**.
4. Authentication: **Workload Identity federation (automatic)** → **Next**.
5. Scope level **Subscription**:
   - **Subscription** — the one holding `essl-rg`
   - **Resource group** — `essl-rg`
6. **Service connection name** — `azure-essl` (remember this exactly)
7. Tick **Grant access permission to all pipelines** → **Save**.

---

## Step 2 — Create the backend pipeline

1. Left menu → **Pipelines** → **New pipeline**.
2. Where is your code? → **Azure Repos Git**.
3. Select your repository.
4. Configure your pipeline → **Existing Azure Pipelines YAML file**.
5. Branch **main**, Path **/azure-pipelines-backend.yml** → **Continue**.
6. Don't run it yet — click the **▾** next to *Run* → **Save**.

### Add its variables

1. On the pipeline page click **Edit** → **Variables** (top right) → **+ New variable**.

   | Name | Value | Secret? |
   |---|---|---|
   | `azureServiceConnection` | `azure-essl` | No |
   | `webAppName` | `essl-adms` | No |

2. **Save**.

### Rename it (optional but helps)

**Pipelines** → **⋯** next to the pipeline → **Rename/move** → `essl-backend`.

---

## Step 3 — Create the frontend pipeline

Same flow, with **/azure-pipelines-frontend.yml**.

Variables:

| Name | Value | Secret? |
|---|---|---|
| `swaDeploymentToken` | the Static Web App deployment token | **Yes — tick Keep this value secret** |
| `viteApiBase` | `https://essl-adms.azurewebsites.net` | No |

Get the token from the portal: your Static Web App → **Overview** →
**Manage deployment token** → copy.

Rename to `essl-frontend`.

---

## Step 4 — Run them

**Pipelines** → select `essl-backend` → **Run pipeline** → **Run**.

First run also asks you to **permit** the pipeline to use the service connection —
click **View** → **Permit**.

Then run `essl-frontend`.

### Check

- `https://essl-adms.azurewebsites.net/api/health` → `"database": "connected"`
- `https://essl-adms.azurewebsites.net/api/setup` → `"mode": "hosted"`
- Your Static Web App URL loads the dashboard

After that, both pipelines run automatically on every push to `main` — the
backend one only when something under `backend/` changes, and vice versa.

---

## Step 5 — Set CORS, then restart

App Service → **Settings** → **Environment variables** → `CORS_ORIGINS` =
your Static Web App URL (scheme + host, no trailing slash) → **Apply** →
**Restart**.

---

## Notes on how these pipelines work

**Backend** — installs with `--omit=dev`, zips the *contents* of `backend/` (not
the folder), and deploys with `AzureWebApp@1`. The zip must have `src/server.js`
at its root or App Service won't find the entry point.

**Frontend** — builds locally with `VITE_API_BASE` injected, then uploads
`frontend/dist` with `skip_app_build: true`. Letting the Static Web Apps task run
its own Oryx build is the usual way this breaks, because the env var doesn't
reliably reach it.

There's a guard step that greps the built bundle for your API URL and **fails the
build** if it's missing. Without it, a forgotten variable produces a dashboard
that deploys perfectly and then can't talk to anything — which looks like a
backend fault and wastes an afternoon.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Pipeline queues forever | No parallel jobs — see Step 0 |
| `The pipeline is not valid. Job build: step ... input azureSubscription references invalid service connection` | `azureServiceConnection` variable doesn't match the connection name exactly |
| First run halts on "waiting for permission" | Click **View** → **Permit** on the service connection prompt |
| Deploy succeeds, site returns "Application Error" | Check **Log stream**. Usually a manually-set `PORT`, or Startup Command missing |
| `VITE_API_BASE was not baked into the bundle` | The `viteApiBase` variable is unset or misspelled |
| Frontend deploys but shows "connecting" forever | Web sockets Off on the App Service, or `CORS_ORIGINS` mismatch |
