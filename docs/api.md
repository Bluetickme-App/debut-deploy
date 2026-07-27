# DebutDeploy API Reference

DebutDeploy is a Render-style control panel that proxies Coolify. This document covers
the REST API so a developer — or Claude Code / CI with an API token — can drive it
programmatically: create services, trigger and monitor deploys, read logs, set env vars,
manage databases, and more.

Every route below is grounded in `server/index.js` (all routes are defined inline there).

## Base URL

```
https://app.debutdepoly.com
```

Local dev: `http://localhost:8787` (the Vite UI on `:5173`/`:5180` proxies `/api` to it).

All responses are JSON. On error you get `{ "error": "..." }` with a 4xx/5xx status.
5xx bodies are always the generic `"Internal error"` (upstream detail is logged server-side,
never forwarded).

---

## Authentication

Most `/api/*` routes require auth. Two mechanisms are accepted:

1. **Session cookie** — set by the browser login flow (GitHub OAuth). Used by the UI.
2. **Bearer API token** — for programmatic access (Claude Code / CI). Send:
   ```
   Authorization: Bearer <token>
   ```
   If there's no session user but a valid Bearer token is present, the request is
   authenticated as that token's owner.

### Minting a token

The easiest way is the web UI: **Account settings → API keys → Create key**. Pick
**Full access** or **Read-only**, then copy the token (shown once).

Tokens are also created, listed, and deleted under `/api/tokens`. **Creating a token requires a
session** (you must be logged into the web UI) — you can't bootstrap a token with a token
alone in a fresh context via the mutate guard's origin check, so mint it from the browser /
an authenticated session, then use it programmatically.

`POST /api/tokens` returns the raw token **once** — only its hash is stored, so copy it
immediately.

```bash
# From an authenticated browser session (cookie + same-origin), create a token:
curl -X POST https://app.debutdepoly.com/api/tokens \
  -H "Content-Type: application/json" \
  --cookie "…session cookie…" \
  -d '{"name":"ci-deploy","scope":"full"}'
# → { "id": 3, "name": "ci-deploy", "scope": "full", "token": "…copy me, shown once…" }
```

### Key scope: full vs read-only

Each key carries a **scope**:

- **`full`** (default) — can do anything the key's owner can do; ordinary
  ownership + role (RBAC) checks still apply.
- **`read`** — may only make **GET/HEAD** requests. Any write (POST/PUT/PATCH/DELETE)
  returns `403 {"error":"read-only API key"}`, enforced before the route runs.

This single check covers every Bearer caller — curl, CI, and the MCP server (below) —
so a read-only key is a safe way to grant dashboards or agents look-but-don't-touch access.

Thereafter, use the token on any `/api/*` route:

```bash
curl https://app.debutdepoly.com/api/me \
  -H "Authorization: Bearer $DD_TOKEN"
```

Notes:
- **Failed-auth throttle**: after **10 failed Bearer attempts from one IP within 60s**,
  further attempts return `429 {"error":"Too many attempts"}` until the window resets.
  Tokens are 192-bit random; this is defense-in-depth against guessing.
- **CSRF / mutate guard**: cookie-authed mutations (POST/PUT/PATCH/DELETE) must be
  `application/json` and carry a same-origin `Origin`/`Referer`, or they get `403`.
  **Bearer-token requests skip this check** (no cookie = no CSRF), so token-driven
  automation just works.
- **Ownership**: non-admin callers only see and act on resources they own. Accessing a
  resource you don't own returns `403`/`404`. Admin callers bypass ownership filtering.
- **Admin-only** routes additionally require `role === "admin"` and return `403` otherwise.

---

## Endpoint reference

Legend: **Admin** = requires admin role. All non-public routes require auth (cookie or Bearer).
`:id` is a Coolify UUID unless noted.

### Health / identity

| Method | Path | Purpose | Admin |
|---|---|---|---|
| GET | `/api/health` | Liveness + mode (`demo`/`live`). No auth. | — |
| GET | `/api/me` | Current user `{ id, email, name, avatar_url, role }`. | — |

```bash
curl https://app.debutdepoly.com/api/health
curl https://app.debutdepoly.com/api/me -H "Authorization: Bearer $DD_TOKEN"
```

### Services (applications)

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/services` | List services you own. | — | — |
| GET | `/api/services/:id` | Get one service. | — | — |
| POST | `/api/services/:id/deploy` | Trigger a deploy. | — | — |
| POST | `/api/services/:id/start` | Start the service. | — | — |
| POST | `/api/services/:id/stop` | Stop the service. | — | — |
| POST | `/api/services/:id/restart` | Restart the service. | — | — |
| DELETE | `/api/services/:id` | Delete the service. | — | — |
| GET | `/api/services/:id/deployments` | List deployments (status per deploy). | — | — |
| GET | `/api/services/:id/logs` | Recent runtime log lines. | — | — |
| GET | `/api/services/:id/deployments/:depId/logs` | Build/deploy logs for one deployment. | — | — |
| POST | `/api/services/:id/rollback` | Roll back to a commit. | `commit` (required) | — |
| GET | `/api/services/:id/events` | Activity events for this service. | — | — |
| PATCH | `/api/services/:id/limits` | Set CPU/memory limits. | resource limit fields (passed through to Coolify) | — |
| PATCH | `/api/services/:id/healthcheck` | Configure health check. | healthcheck fields (passed through) | — |

The `start|stop|restart` actions share one route (`/:action(start|stop|restart)`).

```bash
# Deploy
curl -X POST https://app.debutdepoly.com/api/services/$UUID/deploy \
  -H "Authorization: Bearer $DD_TOKEN"

# Rollback
curl -X POST https://app.debutdepoly.com/api/services/$UUID/rollback \
  -H "Authorization: Bearer $DD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"commit":"a1b2c3d"}'

# Deployment build logs
curl https://app.debutdepoly.com/api/services/$UUID/deployments/$DEP_UUID/logs \
  -H "Authorization: Bearer $DD_TOKEN"
```

### Environment variables

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/services/:id/envs` | List env vars. | — | — |
| POST | `/api/services/:id/envs` | Create/update an env var (upsert). | `key`, `value`, `is_secret` | — |
| DELETE | `/api/services/:id/envs/:envId` | Delete an env var. | — | — |

```bash
curl -X POST https://app.debutdepoly.com/api/services/$UUID/envs \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"DATABASE_URL","value":"postgres://…","is_secret":true}'
```

### Domains

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| POST | `/api/services/:id/domain` | Set the service's domain (FQDN). | `fqdn` | — |
| GET | `/api/services/:id/domain/verify?fqdn=…` | Verify DNS/domain for the FQDN. | — | — |

```bash
curl -X POST https://app.debutdepoly.com/api/services/$UUID/domain \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{"fqdn":"myapp.example.com"}'
```

### Instance size / plan changes

Resizing costs money and only takes effect when Docker recreates the container, so it is
a preview-then-apply pair rather than a bare field write.

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| POST | `/api/services/:id/plan-change/preview` | Price a proposed change: spec before/after, monthly price before/after, pro-rata amount for the rest of the cycle, cycle end date, whether a redeploy is needed, warnings. Writes nothing. | `planId` (or `null` + `cpus`/`memory`) | — |
| POST | `/api/services/:id/plan-change` | Apply it: container limits → billed plan → billing settlement → redeploy. Returns a per-step outcome. | same | — |
| PATCH | `/api/services/:id/resources` | **Low-level.** Writes `limits_cpus`/`limits_memory` into Coolify only — no pricing, no billing, no redeploy. The caller owns the deploy. | `cpus`, `memory`, `memorySwap` | — |

Billing settlement depends on how the org pays: a Stripe subscription has its items
reconciled (`proration_behavior: create_prorations` → the difference lands on the next
invoice); a wallet-billed org is debited/credited the pro-rata difference on the ledger
immediately. Moving to an unpriced custom size records the limits but refuses the
redeploy (`redeploy.skipped: "plan_required"`) — there is no free tier.

```bash
curl -X POST https://app.debutdepoly.com/api/services/$UUID/plan-change \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{"planId":"pro"}'
```

### Volumes (persistent disks)

Disks are billed per GB per month (`disk-gb`, $0.125/GB/mo ≈ £0.10), so `sizeGb` is
required — it is the quantity charged. Adding or removing one redeploys the service.

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/services/:id/volumes` | List volumes, each with its billed `sizeGb` (`null` = attached outside the panel, unmetered). | — | — |
| POST | `/api/services/:id/volumes/preview` | Price a disk before creating it: monthly rate, pro-rata amount, cycle end, org storage total after. Writes nothing. | `sizeGb`, `action` (`add`\|`remove`) | — |
| POST | `/api/services/:id/volumes` | Attach a disk: mount → bill → redeploy. | `mountPath`, `sizeGb` | — |
| DELETE | `/api/services/:id/volumes/:vid` | Detach a disk (destroys its data) and stop billing those GB. | — | — |

### Apps (create a service from a connected GitHub repo)

| Method | Path | Purpose | Admin |
|---|---|---|---|
| POST | `/api/apps` | Create + instantly deploy a service from a repo in the caller's GitHub App installation. | — |

Body fields (from the handler):

| Field | Required | Notes |
|---|---|---|
| `repo` | yes | `owner/name`; must be accessible to your GitHub installation. |
| `branch` | yes | Must exist in the repo. |
| `name` | yes | Service name. |
| `port` | yes | Exposed port (string or number; empty rejected). |
| `envs` | no | Array of `{ key, value, is_secret }` set after create. |
| `buildPack` | no | Defaults to `nixpacks`. |
| `installCommand` | no | Passed through when set. |
| `buildCommand` | no | Passed through when set. |
| `startCommand` | no | Passed through when set. |

Returns `{ uuid }`. If you haven't connected a GitHub installation, returns
`409 { "needsConnect": true }`. Team shared vars are applied first, then per-app `envs`
(per-app wins on key collisions).

```bash
curl -X POST https://app.debutdepoly.com/api/apps \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "repo":"myorg/myapp",
    "branch":"main",
    "name":"myapp",
    "port":3000,
    "buildPack":"nixpacks",
    "startCommand":"node server.js",
    "envs":[{"key":"NODE_ENV","value":"production","is_secret":false}]
  }'
```

### Deploy-key service creation (deploy ANY repo, no GitHub App) — Admin

Two-step flow to deploy a repo you can't reach through the shared GitHub App, using a
read-only deploy key.

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| POST | `/api/git/prepare-key` | Generate a keypair, register the private half in Coolify. Returns `{ keyUuid, publicKey }` — add `publicKey` as a deploy key on the repo. | — | yes |
| POST | `/api/git/create-service` | Create the app from the repo with that key, set domain, deploy, assign ownership. | see below | yes |

`create-service` body: `keyUuid` (req), `repo` (req), `name` (req), `branch`, `buildPack`,
`installCommand`, `buildCommand`, `startCommand`, `port`, `domain`. Returns
`{ appUuid, deployment }`.

### Databases

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/databases` | List databases you own. | — | — |
| POST | `/api/databases` | Create a database (auto-creates your project if needed). | `type`, `name` (both required) | — |
| POST | `/api/databases/:id/start` | Start a database. | — | — |
| POST | `/api/databases/:id/stop` | Stop a database. | — | — |
| DELETE | `/api/databases/:id` | Delete a database. | — | — |
| GET | `/api/databases/:id/backups` | Get backup config. | — | — |
| POST | `/api/databases/:id/backups` | Set backup schedule. | `frequency` (+ schedule fields) | — |
| POST | `/api/databases/:id/backups/run` | Trigger a backup now. | — | — |

```bash
curl -X POST https://app.debutdepoly.com/api/databases \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"postgresql","name":"myapp-db"}'
```

### Servers & Hetzner provisioning — Admin

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/servers` | List Coolify servers. | — | yes |
| GET | `/api/servers/:id/usage` | Resource usage for a server. | — | yes |
| GET | `/api/hetzner/server-types` | Available Hetzner server types. | — | yes |
| GET | `/api/hetzner/locations` | Available Hetzner locations. | — | yes |
| POST | `/api/servers/provision` | Provision a new Hetzner server. | `name`, `serverType`, `location` | yes |
| GET | `/api/servers/:id/provision-status` | Poll provisioning status (reads Hetzner directly). | — | yes |

### GitHub

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/github/installations` | List the user's GitHub App installations. | — | — |
| GET | `/api/github/repos` | List repos across all installations (`409 needsConnect` if none). | — | — |
| GET | `/api/github/repos/:owner/:repo/branches` | List branches for a repo. | — | — |
| DELETE | `/api/github/connection` | Disconnect GitHub (lets user connect a different account). | — | — |

Browser-only (not JSON API — these are redirects in the OAuth/install flow):
`GET /github/connect`, `GET /github/setup`, `POST /github/webhook` (GitHub push webhook,
HMAC-verified, auto-deploys matching services).

### Tokens

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/tokens` | List your API tokens (metadata only, incl. `scope`). | — | — |
| POST | `/api/tokens` | Create a token; returns raw `token` **once**. | `name` (optional, ≤60 chars), `scope` (`full`\|`read`, default `full`) | — |
| DELETE | `/api/tokens/:id` | Revoke a token. | — | — |

### Events & notifications

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/events?limit=N` | Activity feed (your events + system events on your apps; admins see all). | — | — |
| GET | `/api/services/:id/events` | Events for one service. | — | — |
| GET | `/api/notifications` | Get your notification settings. | — | — |
| PUT | `/api/notifications` | Update notification settings. | `webhookUrl`, `enabled` | — |

### Metrics & fleet — Admin

| Method | Path | Purpose | Query | Admin |
|---|---|---|---|---|
| GET | `/api/fleet/overview` | Fleet snapshot: host RAM/CPU/root-disk/volume-disk + latest per-site memory/CPU/disk. | — | yes |
| GET | `/api/metrics/host` | Host capacity history (CPU/RAM/disk %) for the box. | `?window=1h\|6h\|24h` (default `1h`) | yes |
| GET | `/api/services/:id/metrics` | Live per-container resource stats for one service (incl. current usage). | — | — |

```bash
curl https://app.debutdepoly.com/api/fleet/overview \
  -H "Authorization: Bearer $DD_TOKEN"

curl "https://app.debutdepoly.com/api/metrics/host?window=6h" \
  -H "Authorization: Bearer $DD_TOKEN"

curl https://app.debutdepoly.com/api/services/$UUID/metrics \
  -H "Authorization: Bearer $DD_TOKEN"
```

### Situations & remediation — Admin

Active fleet alerts (disk pressure, unhealthy services, zombie deploys) with suggested remediations.

| Method | Path | Purpose | Query/Body | Admin |
|---|---|---|---|---|
| GET | `/api/situations` | List open situations (alerts). Pass `?all=1` to include resolved. | `?all=1` (optional) | yes |
| POST | `/api/situations/:id/remediate` | Execute the suggested remediation for situation `:id`. Returns `{ ok, result }`. | — | yes |

Remediation commands are fixed registry strings — no situation data is ever interpolated into a shell command.

```bash
# List open alerts
curl https://app.debutdepoly.com/api/situations \
  -H "Authorization: Bearer $DD_TOKEN"

# Run remediation for situation id 7
curl -X POST https://app.debutdepoly.com/api/situations/7/remediate \
  -H "Authorization: Bearer $DD_TOKEN"
```

MCP tools: `list_situations` (optional `all: true`), `run_remediation` (`id: number`).

**Configuration — `AUTO_REMEDIATE` (server env var)**

Default: **off** (unset or any value other than `"true"`). In the default mode situations are detect-and-suggest only: the panel surfaces them with a suggested fix and a human clicks "Apply fix".

Set `AUTO_REMEDIATE=true` in `server/.env` (requires server restart) to enable bounded autonomous remediation for **high-confidence situations only**:

| Remediation | Trigger | Notes |
|---|---|---|
| `prune-docker` | disk usage critical (≥ 90 %) | Runs `docker system prune -f` to reclaim dangling layers/volumes. |
| `clear-deploy-queue` | zombie deploy stuck in queue | Cancels queued deployments blocking the pipeline. |

`restart-service` is **never** auto-applied — customer apps are only restarted by a human.

Guardrails:

- Each situation auto-remediates **at most once** (`auto_applied_at` is set on first run and blocks re-entry).
- A per-remediation **cooldown** (6 h lookback in `remediation_log`) prevents thrash if the root cause persists.
- Every auto-action is written to `remediation_log` with `actor='auto'` and triggers the owner notification path — the same audit trail as a human-initiated fix.

### Billing, shared vars, customers, admin — Admin

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/billing` | Infra cost (Hetzner) + compute/db pricing plans. | — | yes |
| GET | `/api/customers` | Users with owned-resource counts. | — | yes |
| GET | `/api/admin/users` | List all users. | — | yes |
| POST | `/api/admin/assign` | Assign a resource's ownership to a user. | `uuid`, `type` (`application`/`database`/`service`), `userId` | yes |
| GET | `/api/shared-vars` | List team shared env vars. | — | yes |
| POST | `/api/shared-vars` | Upsert a shared var. | `key`, `value`, `is_secret` | yes |
| DELETE | `/api/shared-vars/:id` | Delete a shared var. | — | yes |

### Variable groups

Org-scoped, reusable env sets. Values are stored encrypted panel-side; attaching a
group writes its keys into the target application's own Coolify env (and detaching
removes them again), so attached services pick changes up on their next deploy.
Writes require the `deploy` capability; attach/detach also requires ownership of the
target service. Responses from mutating calls carry a `failures[]` array listing any
service Coolify rejected the push for.

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/var-groups` | List groups with their vars + attached service uuids. `?reveal=1` includes secret values. | — | — |
| POST | `/api/var-groups` | Create a group. | `name`, `scope?`, `vars?[]` | — |
| PATCH | `/api/var-groups/:id` | Rename / re-scope a group. | `name?`, `scope?` | — |
| DELETE | `/api/var-groups/:id` | Delete a group and strip its keys from attached services. | — | — |
| POST | `/api/var-groups/:id/vars` | Upsert one var or many (the .env paste path). | `vars: [{key, value, is_secret}]` | — |
| PATCH | `/api/var-groups/:id/vars/:key` | Rename a key in place. | `key` | — |
| DELETE | `/api/var-groups/:id/vars/:key` | Delete a var (and remove it from attached services). | — | — |
| POST | `/api/var-groups/:id/services` | Attach the group to a service. | `uuid` | — |
| DELETE | `/api/var-groups/:id/services/:uuid` | Detach the group from a service. | — | — |

### Email hosting

Mailboxes live on the Stalwart mail server, not Coolify. A domain is owned by an org
(which is what its mailboxes are billed to), and `assertMailDomainOrg` gates every
per-domain call — you can only touch domains your org owns (admin bypasses). Creating
a domain does **not** publish DNS; mail flows only once the returned MX/SPF/DKIM/DMARC
records exist at the registrar, which `…/verify` checks live and caches for the panel.

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/mail/status` | Whether mail is configured, plus hostname + webmail URL. | — | — |
| GET | `/api/mail/domains` | Domains with mailboxes, required DNS records, owning org, last verify result. | — | — |
| POST | `/api/mail/domains` | Add a mail domain; returns the DNS records it needs. | `domain`, `orgId?` (admin) | — |
| DELETE | `/api/mail/domains/:domain` | Remove a domain **and every mailbox on it**. | — | — |
| GET | `/api/mail/domains/:domain/verify` | Check live DNS against expected records (pass/fail each). | — | — |
| POST | `/api/mail/mailboxes` | Create a mailbox on an owned domain. Omit `password` for a generated temp one (returned once). | `address`, `password?` (8+), `quotaMb?` | — |
| POST | `/api/mail/mailboxes/:address/password` | Reset the password. Omit `password` for a generated temp one. | `password?` (8+) | — |
| DELETE | `/api/mail/mailboxes/:address` | Delete a mailbox and its stored mail. | — | — |
| POST | `/api/mail/mailboxes/:address/recovery` | Set the user's recovery email (enables self-service reset). | `recoveryEmail` | — |
| DELETE | `/api/mail/mailboxes/:address/recovery` | Remove the recovery email. | — | — |
| PATCH | `/api/mail/domains/:domain` | Assign the domain to an org (who pays); cascades to its mailbox rows. | `orgId` (null to unassign) | yes |
| POST | `/api/mail/reconcile` | Import domains/mailboxes created directly on the mail server into billing. Idempotent. | — | yes |

#### Self-service password reset (public)

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/mail/forgot` | Public page: request a reset link. | — |
| GET | `/mail/reset?token=…` | Public page: set a new password. | — |
| POST | `/api/mail/forgot` | Mint + email a reset link to the recovery address. | `address` |
| POST | `/api/mail/reset` | Spend the token and set the password. | `token`, `password` (8+) |

`POST /api/mail/forgot` returns an **identical response** whether or not the mailbox exists,
has a recovery address, or the email actually sent — otherwise it becomes an oracle for
enumerating hosted mailboxes. It is throttled to 5 requests per IP per 15 minutes.
Tokens are 32 random bytes, **stored only as a SHA-256 hash**, single-use, and expire after
1 hour; requesting a new link invalidates any earlier unused one.

Outbound mail needs `MAIL_SMTP_USER` + `MAIL_SMTP_PASS` (a real mailbox on the mail server;
`MAIL_SMTP_HOST`/`MAIL_SMTP_PORT` default to `MAIL_HOSTNAME`:587 with STARTTLS required).
Without them the reset request still answers generically and logs the failure.

MCP tools: `mail_status`, `list_mail_domains`, `create_mail_domain`, `delete_mail_domain`,
`verify_mail_dns`, `create_mailbox`, `reset_mailbox_password`, `set_mailbox_recovery`,
`delete_mailbox`, `assign_mail_domain`, `reconcile_mail_billing`.

**On passwords:** there is no reveal endpoint and there cannot be one — mailcow stores only a
hash, so an existing password is unrecoverable by anyone, including an admin. A reset is the
sole recovery path. The reset returns the new plaintext in its **response body only**: it is
never persisted, and the audit log records *that* a reset happened (`mail.mailbox.password_reset`,
with `address` and whether it was generated) but never the value. Generated passwords are four
4-character groups from an alphabet with `0/O/1/l/I` removed (~82 bits), readable aloud.

### Render importer

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| POST | `/api/import/render/services` | List a Render account's services (key travels in body, never logged). | `apiKey` | — |
| POST | `/api/import/render` | Import a Render service into DebutDeploy. | `renderServiceId`, `target`, `apiKey` | conditional* |

\* Importing onto **shared** infra (`target.mode === "shared"`) is allowed for any user.
Importing onto dedicated/provisioned infra requires admin (`403` otherwise).

---

## Use from Claude (MCP)

The [`mcp/`](../mcp) directory ships a Model Context Protocol server that exposes
these endpoints as tools, so Claude Code / Claude Desktop can operate the platform.
It authenticates with the **same API key** — just set it as `DEBUTDEPLOY_TOKEN`:

```bash
claude mcp add debutdeploy \
  -e DEBUTDEPLOY_URL=https://app.debutdepoly.com \
  -e DEBUTDEPLOY_TOKEN=$DD_TOKEN \
  -- node /path/to/debut-deploy/mcp/server.js
```

A **read-only** key restricts the MCP server to read tools (`list_services`,
`service_logs`, …); write tools (`deploy_service`, `create_service`, `control_service`)
return `403`. The Account settings → API keys page shows this exact command with your
token pre-filled after you create a key.

---

## Recipes

Set once:

```bash
export DD=https://app.debutdepoly.com
export DD_TOKEN=…   # from POST /api/tokens (created via an authenticated browser session)
```

### (a) Create & deploy a service

```bash
# 1. Confirm the repo is reachable via your GitHub installation.
curl -s "$DD/api/github/repos" -H "Authorization: Bearer $DD_TOKEN" | jq '.[].full_name'

# 2. Create + instant-deploy. Returns { "uuid": "…" }.
UUID=$(curl -s -X POST "$DD/api/apps" \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{"repo":"myorg/myapp","branch":"main","name":"myapp","port":3000}' \
  | jq -r .uuid)
echo "created $UUID"

# 3. (optional) Add env vars.
curl -s -X POST "$DD/api/services/$UUID/envs" \
  -H "Authorization: Bearer $DD_TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"NODE_ENV","value":"production","is_secret":false}'
```

`POST /api/apps` deploys instantly, so there's a deployment already in flight — monitor it
with recipe (b). To redeploy later: `POST /api/services/$UUID/deploy`.

### (b) Monitor a deploy

Poll deployments until the newest one reaches a terminal state, then dump its build logs.
Coolify statuses are compound (`running:healthy`); deployment status values include
`queued`, `in_progress`, `finished`, `failed`, `cancelled`.

```bash
# Kick a deploy (skip if you just created via /api/apps).
curl -s -X POST "$DD/api/services/$UUID/deploy" -H "Authorization: Bearer $DD_TOKEN"

# Poll the latest deployment.
while true; do
  DEP=$(curl -s "$DD/api/services/$UUID/deployments" -H "Authorization: Bearer $DD_TOKEN" | jq '.[0]')
  STATUS=$(echo "$DEP" | jq -r '.status')
  echo "status: $STATUS"
  case "$STATUS" in
    finished|failed|cancelled) break ;;
  esac
  sleep 5
done

# Build/deploy logs for that deployment.
DEP_UUID=$(echo "$DEP" | jq -r '.uuid')
curl -s "$DD/api/services/$UUID/deployments/$DEP_UUID/logs" -H "Authorization: Bearer $DD_TOKEN"

# Runtime logs once it's up.
curl -s "$DD/api/services/$UUID/logs" -H "Authorization: Bearer $DD_TOKEN"
```

> Field names for deployment objects (`.status`, `.uuid`) come from Coolify's normalised
> shape. If your account returns different keys, inspect one object first:
> `curl -s "$DD/api/services/$UUID/deployments" -H "Authorization: Bearer $DD_TOKEN" | jq '.[0]'`.
