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

### Volumes

| Method | Path | Purpose | Body | Admin |
|---|---|---|---|---|
| GET | `/api/services/:id/volumes` | List volumes. | — | — |
| POST | `/api/services/:id/volumes` | Add a persistent volume. | `mountPath` (+ Coolify volume fields) | — |
| DELETE | `/api/services/:id/volumes/:vid` | Delete a volume. | — | — |

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
