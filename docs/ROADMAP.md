# DebutDeploy Roadmap — Render parity

**Goal:** a sellable, Render-style control panel over Coolify (on Hetzner). This is the honest gap between what exists today and what "feels like Render," in build order.

Legend: ✅ done · 🔶 partial · ⬜ not started · ⚠️ risk/decision

---

## ✅ Done (this far)

- Auth: Google + GitHub OAuth login, sessions, verified-email linking.
- Multi-tenant isolation: per-user ownership table; lists filtered; non-owned → 404; admin bypass. Security-reviewed.
- Roles: admin (sees all) vs customer (sees owned); role-based nav.
- Live Coolify connection (Hetzner), demo mode for local.
- Service control: list, deploy/redeploy, start/stop/restart, logs, env (read/upsert/delete), audit log.
- Self-serve deploy MVP: GitHub App, per-installation repo listing, "New Service" wizard, create private-repo app → per-customer Coolify project → ownership auto-assign → auto-deploy webhook.

---

## Phase 1 — Make the core deploy loop feel real
*The single most important phase: prove and polish "deploy an app and manage it."*

- ⬜ Verify one real end-to-end deploy (build + run on Hetzner, shows in list).
- 🔶 Service detail page parity: status, URL, last deploy, commit, build/deploy logs (live stream).
- ⬜ Deploy history + **rollback** (Coolify keeps deployments).
- ⬜ **Custom domains + automatic TLS** (Coolify/Traefik issues Let's Encrypt). Render's killer convenience.
- ⬜ App **delete/teardown** (remove app + its ownership row).
- ⬜ Input validation + friendly errors on the create flow (currently minimal).
- ⚠️ Fix GitHub post-install redirect for the hosted case (works via direct record locally; needs a clean hosted run — see Phase 3).

## Phase 2 — Databases (Render's "New → Redis/Postgres")
*Coolify supports these via API; we build the flow.*

- ⬜ "New Database" wizard: Postgres / Redis / MySQL / MongoDB (Coolify `POST /databases/*`).
- ⬜ Per-customer ownership + project placement (mirror the app flow).
- ⬜ Show connection string (internal URL) — masked for customers, like env secrets.
- ⬜ Start/stop/delete, backups (Coolify supports scheduled backups).

## Phase 3 — Make it an online product (not a local tool)
*You asked about this. Until done, it's localhost-only.*

- ⬜ Deploy DebutDeploy itself (dogfood on Coolify, or Render) → public domain.
- ⬜ Serve built client from Express (single process) — already designed.
- ⬜ Swap every `localhost` URL → domain: GitHub App Setup URL + OAuth callbacks, Google/GitHub login callbacks, `CLIENT_ORIGIN`, `OAUTH_CALLBACK_BASE`, `ALLOWED_ORIGINS`.
- ⬜ HTTPS + secure cookies in prod (`NODE_ENV=production`, fail-fast already coded).
- ⬜ Postgres for DebutDeploy's own DB (SQLite → Postgres) once >1 instance or for durability.

## Phase 4 — More resource types & config (Render parity)
- ⬜ Static sites, background workers, cron jobs (Coolify build-pack/service types).
- ⬜ Persistent disks/volumes.
- ⬜ Env groups / shared variables (Coolify has shared variables).
- ⬜ Secret files.

## Phase 5 — Scaling & observability
- ⬜ Instance size selection; health checks; zero-downtime deploys (Coolify supports).
- ⬜ Metrics (CPU/mem/disk) per service — Render-style graphs (Coolify `/resources`).
- ⬜ Activity/events feed; basic alerts/notifications.

## Phase 6 — Teams & access
- ⬜ Teams/orgs, invite members, RBAC beyond admin/customer.
- ⬜ Audit-log viewer UI (data already captured).
- ⬜ Org-account GitHub installs (currently personal-only; needs user-to-server OAuth to verify org membership — security item).

## Phase 7 — Selling it (required before real customers)
- ⚠️ **Quotas / resource guardrails** on the shared Hetzner box — without these, one customer can starve the box. Non-negotiable before paid multi-tenant.
- ⬜ Billing: Stripe, plans, usage metering.
- ⬜ Onboarding, account settings, 2FA/SSO.
- ⚠️ Runtime isolation reality: shared Coolify = shared kernel/network. True hard isolation = per-customer teams/servers (bigger infra spend). Decide acceptable level per price point.

---

## Suggested order
1. **Phase 1** (prove + polish the deploy loop) — highest value, smallest.
2. **Phase 3** (host it online) — unlocks the real GitHub flow and makes it demoable/sellable.
3. **Phase 2** (databases) — big perceived-parity win.
4. Then 4–7 as the business demands, with **Phase 7 quotas** gating any paid launch.

Each phase = its own brainstorm → spec → plan → build (we have the workflow for it).

---

## Requested infrastructure backlog (the "all of Render" asks)

Captured verbatim from the brief. These are **infra projects**, not UI batches — each needs its own design + (often) the Hetzner API + cost/decisions. Feasibility noted.

| Ask | Feasibility | Notes |
|-----|-------------|-------|
| ✅ Bulk env, link-database (`DATABASE_URL`), auto build-pack, deploy logs, GitHub reconnect | **Done** | shipped |
| Instance sizing (2GB / CPU tiers) | 🔶 two layers | Per-app CPU/mem **limits** = Coolify supports (easy). True "instance type" = the Hetzner **VM size** = provisioning (below). |
| Multiple servers + **provision new servers** | ⬜ big | Needs Hetzner Cloud API (create server, costs money) + Coolify "add server". Real project. |
| SSH key mgmt + connect servers via SSH | 🔶 medium | Coolify adds servers over SSH (the "SSH Authentication" screen you saw). We'd manage keys + call Coolify's server-add. |
| **Web SSH terminal** per server (Render-style) | ⬜ hard | Coolify has a terminal; embedding a live shell in our UI = websockets/PTY proxy. Non-trivial + security-sensitive. |
| Persistent disks / SSD (block storage) | 🔶 medium | Coolify volumes; Hetzner Volumes via API for true block storage. |
| Private networking + region (Frankfurt) internal links; Postgres external+internal URL | 🔶 medium | Same-server services already share an internal network in Coolify; cross-server/region private networking is more. Expose internal vs external DB URLs. |
| Backups (DB + app, scheduled) | 🔶 medium | Coolify supports scheduled backups to S3 — build the config UI. |
| **Programmatic API for Claude Code** (monitor logs, change env, deploy) | 🔶 achievable, security-sensitive | Add API personal-access-tokens + Bearer auth on `/api/*` so an agent can drive deploys/logs/env without a browser session. Own careful pass. |

**Sequencing:** the cheap wins (per-app limits, backups config, internal/external DB URLs, the API tokens) before the heavy provisioning stack (Hetzner API → multi-server → disks → web terminal). Provisioning is the gate to "instance sizing" and "new servers" feeling like Render.
