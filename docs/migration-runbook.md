# DebutDeploy — 20-Site Migration Runbook

**Date:** 2026-06-30
**Purpose:** the end-to-end procedure to move ~20 live sites onto DebutDeploy/Coolify safely, using every capability built and every prerequisite. Read top to bottom; don't skip Phase 0.

---

## Phase 0 — Prerequisites (gates; do NOT start migrating until all green)

- [ ] **Capacity.** Current server is a CX22 (2 vCPU / 4 GB) — too small for 20 sites. Provision a **CX42/CX52 or dedicated Hetzner**, or plan multiple servers. Rule of thumb: size for peak RAM of all sites + their databases + 30% headroom.
- [ ] **S3 bucket + keys** for database backups. Add it as an **S3 Storage** in Coolify (Storages → add). Without this, backups are inert.
- [ ] **Platform domain** (e.g. `deploy.yourco.com`) + DNS you control. Needed to host DebutDeploy over HTTPS (OAuth requires it) and ideally a **wildcard `*.apps.yourco.com`** for app subdomains.
- [ ] **Host DebutDeploy publicly** (see Phase 1).
- [ ] **Notifications** configured in Coolify (Settings → Notifications: email/Slack) — deploy/health alerts are Coolify-side.

## Phase 1 — Host DebutDeploy itself (off localhost)

1. Push this repo to a **private GitHub repo** (currently local-only).
2. Deploy DebutDeploy as an app **on Coolify** (dogfood) or Render: build `npm run setup && npm run build`, start `npm start`; serve the client build from Express (single process) — small change if not already.
3. Point `deploy.yourco.com` at it; Coolify issues TLS automatically.
4. **Swap every localhost URL → the domain:** Google OAuth callback, GitHub OAuth callback, **GitHub App Setup URL**, `CLIENT_ORIGIN`, `OAUTH_CALLBACK_BASE`, `ALLOWED_ORIGINS`. Set `NODE_ENV=production`, a strong `SESSION_SECRET`, `DATABASE_FILE` on a persistent disk (or move to Postgres).
5. Log in over HTTPS, confirm GitHub connect + a test deploy work on the hosted instance.

## Phase 2 — Per-site migration (repeat for each of the 20)

For **each** site, follow this checklist. Do the lowest-risk sites first.

### 2a. Inventory the site
- [ ] Git repo + branch; build type (static / Node / Docker); listening **port**.
- [ ] Env vars (export the current `.env`).
- [ ] Database(s)? type + size + connection string.
- [ ] Domain(s) + current DNS + TLS.
- [ ] Persistent files/uploads on disk?

### 2b. Stand it up in DebutDeploy (no traffic yet)
- [ ] **New Service** → pick the repo + branch → **build pack** (Auto/Docker/Static) → set the **port** correctly *(critical: the Traefik port is set at create — wrong port = 502; don't rely on editing it after).*
- [ ] **Env:** paste the site's `.env` via **bulk env**. Team-wide values can live in **Shared Variables** (injected into new services on create).
- [ ] **Database:** create it via **New Database** (Postgres/Redis/MySQL/…), then **import the data** (dump → restore into the new DB), then **Link database** so `DATABASE_URL` is injected.
- [ ] **Resource limits:** set CPU/memory per service (Settings → Resources) so one site can't starve the box.
- [ ] **Health check:** enable with the right path/port.
- [ ] **Persistent disk:** attach one if the site stores files locally.
- [ ] Deploy; watch **build/deploy logs**; confirm the app is **Running** and the temporary `*.sslip.io` URL loads.

### 2c. Domain cutover (the only step that touches live traffic)
- [ ] In the service, set the **custom domain** (e.g. `www.client.com`). It's stored as `https://` so Coolify requests a cert.
- [ ] Add the DNS **A record** → the server IP (the **Verify DNS** button shows the exact record). Lower the record's TTL beforehand for a fast switch.
- [ ] Wait for DNS + Let's Encrypt to issue the cert (HTTP-01 needs ports 80/443 open). Confirm `https://www.client.com` serves the new site.
- [ ] Keep the old host live until verified, then decommission.

### 2d. Verify + safety
- [ ] Site loads over HTTPS; key pages + forms work; DB reads/writes work.
- [ ] A **backup** of the new DB has run (Phase 0 S3) — test a restore once for the first DB site.
- [ ] **Rollback ready:** note the current deployment; one-click rollback is available if a later deploy breaks it.

## Phase 3 — Batching strategy

- **Don't migrate 20 at once.** Batches of ~5, starting with the **simplest static sites** (no DB), then DB-backed sites.
- After each batch: watch box CPU/RAM (capacity check), confirm all sites in the batch are green, then proceed.
- Keep old infra running until each batch is verified for a few days.

## Known limitations to operate around
- **Live metrics (CPU/mem%)** aren't available via Coolify's API in v4.1.2 (needs Coolify **Sentinel**) — monitor via the Coolify dashboard or host metrics for now.
- **Notifications/alerts** are configured in **Coolify**, not DebutDeploy.
- **Shared variables** inject into services **on create**; changing a shared var doesn't retro-update existing services (re-deploy or re-set).
- **Auto-subdomains** (`*.sslip.io`) are http-only; real domains get real TLS. A wildcard for your own subdomains needs a DNS-01 token in Coolify.
- One **shared Coolify host** = shared blast radius; resource limits mitigate but don't fully isolate. Split to multiple servers as load grows.

## Post-migration
- [ ] Confirm scheduled **backups** are running for all DBs.
- [ ] Set up **uptime monitoring** (external) + Coolify alerts.
- [ ] Review resource limits vs actual usage; resize the box if needed.
- [ ] Revoke any temporary API tokens; rotate `SESSION_SECRET` if it was ever exposed.

## Feature → migration-step map (what we built, where it's used)
- Auth + tenant isolation → who can manage what.
- New Service (build-pack, optional commands, link DB, bulk env) → 2b.
- New Database + Link → 2b (data).
- Resource limits, health checks → 2b (stability).
- Persistent disks → 2b (stateful sites).
- Custom domain + DNS verify + auto-TLS → 2c.
- Deploy logs, rollback → 2b/2d (safety).
- Shared variables → 2b (team config).
- Backups → Phase 0 + 2d (data safety).
- API tokens → automation / Claude Code-driven ops.
