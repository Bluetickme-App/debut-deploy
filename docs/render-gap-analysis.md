# Render vs DebutDeploy — Gap Analysis (for migrating ~20 production sites)

**Date:** 2026-06-29
**Context:** DebutDeploy is a thin control plane over **Coolify v4.1.2 + Traefik + Let's Encrypt** on a Hetzner box. This compares it to Render.com with one lens: *what's needed to confidently move ~20 live sites without losing data or uptime.* Status reflects the **actual code**, not the roadmap's claims.

Legend: ✅ have · 🔶 partial · ⬜ missing · **Coolify?** = can Coolify's API do it (so it's "just" a DebutDeploy surface) · **20-site need** = blocker / important / nice

## Verdict up front

**Counts:** ~15 ✅ · ~6 🔶 · ~18 ⬜.

The deploy *mechanics* work (proven: real private repo cloned, built, served with auto-TLS-capable domain). But **DebutDeploy is not yet safe for 20 production sites.** Five hard blockers below. The biggest are **database backups/restore, capacity + quotas on a shared box, rollback/zero-downtime, real-domain TLS at scale, and hosting DebutDeploy itself off localhost.**

## Cross-reference table

| Render feature | DebutDeploy | Coolify? | 20-site need | Notes |
|---|---|---|---|---|
| Git deploy (web service) | ✅ | yes | — | private repo via GitHub App, auto-deploy on push |
| Auto build detect (Nixpacks/Docker) | ✅ | yes | — | build-pack select + optional commands |
| Static sites | 🔶 | yes | important | works via `static` build pack, not a first-class type |
| Background workers | ⬜ | yes | important | not modeled |
| Cron jobs | ⬜ | yes | important | Coolify has scheduled tasks |
| Private services | ⬜ | yes | nice | |
| Managed Postgres | ✅ create | yes | — | create/start/stop/delete |
| Redis / Key Value, MySQL, Mongo | ✅ create | yes | — | |
| **DB backups + restore** | ⬜ | yes (S3) | **BLOCKER** | Render has PITR on all paid DBs ([docs](https://render.com/docs/postgresql-backups)); we have **none** |
| Env vars | ✅ | yes | — | single + bulk `.env` paste; secrets masked |
| Env groups (shared) | ⬜ | partial | important | Coolify has shared variables |
| Secret files | ⬜ | ? | nice | |
| Custom domains | ✅ | yes | blocker¹ | set + DNS-verify; needs real-domain testing at scale |
| Automatic TLS | ✅ | yes | blocker¹ | Traefik + Let's Encrypt, auto-renew (custom domains) |
| Auto subdomain | 🔶 | yes | important | sslip.io **http only** (no wildcard TLS) |
| Wildcard domain/TLS | ⬜ | yes (DNS-01) | important | needs a DNS-provider API token |
| Zero-downtime deploys | 🔶 | yes | **BLOCKER** | Coolify supports rolling; **not verified/surfaced** |
| Health checks | 🔶 | yes | blocker | Coolify has them; no config surface |
| Rollback / deploy history | 🔶 | yes | **BLOCKER** | history now lists; **no one-click rollback** |
| Build logs / app logs | ✅ | yes | — | per-deployment build logs + app logs |
| Live log streaming / tail | ⬜ | partial | important | currently a static fetch, not a stream |
| Log retention / drains | ⬜ | ? | important | |
| Metrics (CPU/mem graphs) | ⬜ | yes | important | Coolify `/resources` exists |
| Notifications / alerts | ⬜ | yes | **BLOCKER** | deploy-failed / service-down — running 20 sites blind is unsafe |
| Autoscaling | ⬜ | no¹ | nice | Hetzner VMs don't autoscale like Render |
| Instance types / sizing | ⬜ | partial | blocker | per-app CPU/mem **limits** (Coolify) vs VM tiers (Hetzner) |
| Persistent disks | ⬜ | yes | important | Coolify volumes; needed for stateful sites |
| Preview environments (per-PR) | ⬜ | partial | nice | Render auto-clones env per PR |
| Deploy hooks (URL trigger) | 🔶 | yes | nice | `POST /deploy` exists; no shareable hook URL |
| One-off jobs / shell | ⬜ | yes | important | |
| SSH into instance / web terminal | ⬜ | partial | important | Coolify has a terminal; embedding is non-trivial |
| IaC (render.yaml / Blueprints) | ⬜ | partial | nice | great for repeatable 20-site setup, not required |
| API (programmatic) | ✅ | — | — | Bearer tokens (for Claude Code/CI) |
| Teams / RBAC / SSO | 🔶 | partial | important | only admin/customer roles today |
| Private networking | 🔶 | yes | important | same-server Coolify net exists; not surfaced |
| CDN / DDoS | ⬜ | via CF | nice | front with Cloudflare |
| Maintenance mode | ⬜ | ? | nice | |
| **Quotas / resource guardrails** | ⬜ | partial | **BLOCKER** | one bad site can OOM the shared box → all 20 down |
| Multi-server / provisioning | ⬜ | partial | blocker² | 20 sites won't fit one CX22 |
| **Host DebutDeploy itself (public)** | ⬜ | yes | **BLOCKER** | it's localhost-only; can't run 20 prod sites from a laptop |

¹ autoscaling/TLS-at-scale caveats explained below. ² capacity, see below.

## Migration robustness — the part that matters for 20 live sites

### Do-NOT-migrate-until (hard blockers)
1. **Database backups + tested restore.** Migrating real data with zero backup/PITR is the single biggest risk. Render gives PITR free on paid DBs. We must wire Coolify's **scheduled S3 backups** and *actually test a restore* before any site with a database moves. (Static-only sites are lower risk.)
2. **Capacity + quotas (shared-box blast radius).** The current server is a **CX22 (2 vCPU / 4 GB)** — 20 real sites (Node apps + DBs) will not fit, and with **no per-app resource limits** one runaway site OOMs the box and takes down *all* of them. Required: a much bigger box (or several), **plus per-app CPU/mem limits**.
3. **Zero-downtime deploys + one-click rollback.** Production can't tolerate a failed deploy dropping a site with no fast revert. Verify Coolify rolling deploys and add a **rollback** action (history already lists deployments).
4. **Real domains with TLS, at scale.** 20 customer domains each need a DNS A-record → box + a Let's Encrypt cert. The `setDomain`/verify flow exists and TLS is automatic, but it must be **tested on real domains**, and the **port-label/502 pitfall we hit** (Coolify writes the Traefik port at create, not on edit) must be handled by setting build-pack + port correctly at creation.
5. **Host DebutDeploy on a public HTTPS URL.** It's localhost-only; you can't operate 20 production sites from a laptop, and OAuth login requires a real https domain. (Roadmap Phase 3.)

### Fix soon after (operationally important)
- **Notifications/alerts** (deploy failed, service down) — don't run 20 sites blind.
- **Live log streaming + retention** and **per-service metrics**.
- **Health-check config** surfaced per service.
- **Persistent disks** for any stateful site; **env groups** for shared config across the 20.
- **First-class service types** (static / worker / cron) instead of build-pack workarounds.
- Solidify the **GitHub installation_id binding** (we patched Coolify's side by hand) so connect populates Coolify automatically.

### Capacity sizing note
Rule of thumb: 20 mixed sites + databases ≈ well beyond 4 GB. Plan for a **CX42/CX52 or dedicated Hetzner** (or split across servers, which needs the multi-server work). Decide before migrating, not after the box falls over.

## Prioritized "missing functionality to add"
1. DB **backups/restore** (Coolify S3) — blocker.
2. **Resource limits per app** + right-size/segment the server(s) — blocker.
3. **Rollback** action + verify zero-downtime — blocker.
4. **Host DebutDeploy** publicly (Phase 3) — blocker.
5. **Alerts/notifications** + live logs + metrics — high.
6. Persistent disks, env groups, health-check config — high.
7. First-class static/worker/cron types — medium.
8. Wildcard TLS (DNS-01), preview envs, IaC, SSH/terminal — later.

## Sources
- [Render Postgres backups/PITR](https://render.com/docs/postgresql-backups) · [PITR changelog](https://render.com/changelog/added-point-in-time-recovery-to-all-paid-database-instances)
- [Persistent Disks](https://render.com/docs/disks) · [Scaling/autoscaling](https://render.com/docs/scaling) · [Instance types](https://render.com/docs/compute-plans)
- [Preview Environments](https://render.com/docs/preview-environments) · [Blueprints/IaC](https://render.com/docs/infrastructure-as-code) · [Blueprint spec](https://render.com/docs/blueprint-spec)
