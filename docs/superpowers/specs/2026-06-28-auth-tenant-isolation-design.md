# DebutDeploy — Auth + Tenant Isolation Foundation

**Date:** 2026-06-28
**Status:** Approved (design, rev 2 — incorporates security review)
**Scope:** Accounts, Google + GitHub login, and app-layer tenant isolation on a single shared Coolify backend.

## Context

DebutDeploy is today a personal control panel: a React+Vite UI → Express proxy → Coolify `/api/v1`. A single team-scoped Coolify token lives in `server/.env`, and `coolify.js` returns every resource in that team to anyone who can reach the proxy.

The product direction is to **sell self-serve access to end users on one shared Coolify instance** ("you host one shared Coolify"). That makes isolation the central problem: customer A must never see or act on customer B's resources.

### Key constraint (researched)

Coolify's API is **team-scoped per token**; Coolify *projects* are organizational folders, **not** a security boundary, and the API returns all resources in the token's team. Real isolation in Coolify means separate teams with separate tokens, and Coolify explicitly does not yet support teams safely sharing a server. ([authorization docs](https://coolify.io/docs/api-reference/authorization), [teams-sharing-server discussion](https://github.com/coollabsio/coolify/discussions/1820))

**Therefore isolation is enforced in the Express proxy**, via an ownership table in our own datastore that maps each Coolify resource UUID to a customer. Every route filters reads and authorizes actions against it.

### Isolation scope (important framing)

This design provides **control-plane isolation**: customers can only see and operate on the Coolify resources our ownership table permits. It is **not** hard runtime/container isolation — a shared Coolify server still shares the kernel, networks, and volumes. Runtime isolation is a later concern (separate teams/servers, quotas) and is out of scope here.

## Out of scope (future specs)

- Self-serve create/deploy flows (connect a repo, create an app on Coolify, auto-assign ownership)
- GitHub repo linking for deploys
- Resource quotas / guardrails on the shared box
- Hard runtime/container isolation
- Billing (Stripe, plans, metering)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth stack | Self-hosted Passport (`passport-google-oauth20`, `passport-github2`) + `express-session` | Free, no vendor, on-brand with a cost-cutting/self-host product; well-trodden |
| Session store | `connect-sqlite3` | Matches the datastore; survives restarts |
| Datastore | `better-sqlite3` (file at `server/data/debut.db`) | Zero infra, synchronous/simple. **Ceiling:** single instance only — migrate to Postgres when running >1 server process |
| Isolation point | Express proxy ownership table | Coolify cannot isolate within one team token (see Context) |
| Ownership key | `(type, coolify_uuid)` | Do not rely on UUID global-uniqueness for a security check; the route already knows the type |
| Non-owned access response | `404`, not `403` | Prevents customers enumerating which resources exist |
| Demo mode | `DEMO_MODE=true` **and** `NODE_ENV !== 'production'` only | A misconfigured prod must never silently become an open admin panel |
| CSRF defense | `sameSite=lax` + Origin/Referer allowlist on mutations + JSON-only | Same-origin JSON SPA; `lax` already blocks cross-site fetch writes. **Upgrade path:** token-based CSRF if sameSite is relaxed or cross-site clients are added |
| Audit trail | `audit_events` table from day one | Hosting control panel; backfilling an audit log later is painful |

## Architecture

A thin persistence + auth layer is added to the existing Express server. The Vite dev proxy model is unchanged. OAuth callbacks land on the Express server (`OAUTH_CALLBACK_BASE`), which sets a session cookie; the SPA reads auth state from `/api/me`.

```
Browser ──/auth/{google,github}──▶ Express (Passport) ──▶ provider ──▶ /callback
   │                                     │
   │◀──── session cookie ────────────────┘
   │
   └──/api/*──▶ requireAuth ──▶ ownership/admin guard ──▶ coolify.js ──▶ Coolify
```

**Complete mediation (non-negotiable):** there is **no generic `/api/proxy/*` passthrough** to Coolify. Every exposed Coolify operation is an explicit Express route carrying `requireAuth` plus ownership-or-admin middleware. This prevents a future "quick shortcut" route from bypassing tenant checks.

## Components

### `server/db.js`
better-sqlite3 connection. On boot it sets pragmas and runs migrations:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Schema is versioned via `PRAGMA user_version` (or a `migrations` table) — not bare `CREATE TABLE IF NOT EXISTS`, because the schema will evolve. Tables:

- `users(id INTEGER PK, email TEXT UNIQUE, name TEXT, avatar_url TEXT, role TEXT CHECK(role IN ('admin','customer')) DEFAULT 'customer', created_at TEXT)`
- `identities(provider TEXT, provider_user_id TEXT, user_id INTEGER REFERENCES users(id), PRIMARY KEY(provider, provider_user_id))` — lets one person link both Google and GitHub to the same user
- `resource_ownership(coolify_uuid TEXT, type TEXT CHECK(type IN ('application','database','service')), user_id INTEGER REFERENCES users(id), created_at TEXT, PRIMARY KEY(type, coolify_uuid))`
- `audit_events(id INTEGER PK, user_id INTEGER, action TEXT NOT NULL, resource_type TEXT, resource_uuid TEXT, ip TEXT, user_agent TEXT, metadata_json TEXT, created_at TEXT NOT NULL)`
- sessions table — managed by `connect-sqlite3`

### `server/auth.js`
Passport Google + GitHub strategies, `serializeUser`/`deserializeUser`, and routes:

- `GET /auth/google`, `GET /auth/google/callback`
- `GET /auth/github`, `GET /auth/github/callback`
- `POST /auth/logout`
- `GET /api/me` → `{ id, email, name, avatar_url, role }` or `401`

**Identity resolution on callback:**
1. Find by `(provider, provider_user_id)` → log in.
2. Else resolve the provider's **verified** email (for GitHub, request `user:email` scope and pick the primary verified email). If no verified email is available, **reject login** with a clear error.
3. Find a user by that verified email and link a new identity row; else create a user.
4. Role is `admin` if the email is in `ADMIN_EMAILS`, otherwise `customer`.
5. **Regenerate the session** before attaching the authenticated user (anti session-fixation), then redirect to the SPA.

Accounts are never linked by an unverified or missing email.

### `server/ownership.js`
- `ownedUuids(userId, type)` → array of UUIDs the user owns
- `assertOwns(userId, type, uuid)` → throws a `404`-shaped error if not owned (admins bypass)
- `assign(uuid, type, userId)` → insert/replace ownership

### `server/audit.js`
- `record(req, action, { resourceType, resourceUuid, metadata })` → inserts an `audit_events` row (captures `user_id`, `ip`, `user_agent`).

Logged events (minimum): login, logout, failed ownership assertion, deploy/start/stop/restart, env changes, admin assignment/reassignment, admin-only access attempts.

### `server/index.js` (middleware wiring)
- `requireAuth` on all `/api/*` except `/api/health`.
- `requireAdmin` for admin-only routes.
- A mutation guard (Origin/Referer allowlist + JSON content-type) on all state-changing methods.
- **Lists** (`/api/services`, `/api/databases`): call coolify, then filter to `ownedUuids(user, type)` unless `role === 'admin'`.
- **Item/action routes** (`/services/:id`, `/deploy`, `/start|stop|restart`, `/deployments`, `/logs`, `/envs*`): `assertOwns(user, type, uuid)` runs **before any Coolify call**; non-owned → `404` with **zero** upstream requests.
- `GET /api/servers`: admin-only → non-admins get `403` (a known infra endpoint, not a per-tenant resource, so `403` is acceptable here).
- `POST /api/admin/assign` (admin-only): body `{ uuid, type, userId }`, validated (existing user, valid type, UUID present) → `ownership.assign` + audit.

### `server/coolify.js`
Unchanged in responsibility (demo/live branching). Filtering happens in the route layer using the UUID sets, so `coolify.js` stays focused. Secret env values are already masked here (`is_secret ? "••••••"`); raw secret values remain **admin-only**.

### Demo mode
Demo auto-login engages **only** when `DEMO_MODE=true` and `NODE_ENV !== 'production'`. In that case the server seeds a demo admin user and auto-logs-in every request as that admin, preserving the "clone and click around with fixtures" experience.

**In production:** missing `SESSION_SECRET`, or missing OAuth credentials while not in demo, causes **startup failure** (fail fast). A misconfigured prod must never become an unauthenticated admin panel.

### Config additions (`server/.env` / `.env.example`)
`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_CALLBACK_BASE` (e.g. `http://localhost:8787`), `ADMIN_EMAILS` (comma-separated), `DATABASE_FILE` (default `./data/debut.db`), `ALLOWED_ORIGINS` (comma-separated, for the mutation guard).

### Client
- `/login` page: "Continue with Google" / "Continue with GitHub" buttons linking to `/auth/{google,github}` (lucide icons already available).
- An auth context that fetches `/api/me`; a route guard that redirects to `/login` on `401`.
- Logout button (`POST /auth/logout`).
- Hide the Servers nav item for non-admin users.

## Error handling

- Unauthenticated `/api/*` → `401` → SPA redirects to `/login`.
- Authenticated but non-owned resource → `404` (no existence leak), with no Coolify call made.
- Admin-only endpoint accessed by customer → `403`.
- Failed mutation guard (bad/missing Origin) → `403`.
- Existing Express error handler is reused; ownership/auth errors carry a `status`.

## Security notes

- Session cookie: `httpOnly`, `sameSite=lax`, `secure` in production.
- `SESSION_SECRET` required in production (fail fast if missing and not demo).
- OAuth identities linked only by **verified** email; login rejected if no verified email.
- Session regenerated on successful login (anti-fixation).
- Mutations defended by `sameSite=lax` + Origin/Referer allowlist + JSON-only (token-based CSRF is the upgrade path).
- `404` over `403` on tenant resources to prevent enumeration; ownership checked before any upstream call.
- Raw secret env values are admin-only; customer reads are masked.
- Audit trail captured from day one.

## Testing

`server/test_isolation.mjs` (`node:test`) with a **mocked Coolify client** so we can assert call counts. Seed two customers with disjoint ownership plus an admin, and assert:

| Test | Expected |
|------|----------|
| unauthenticated `/api/services` | `401` |
| customer `/api/servers` | `403` |
| customer `/api/services` list | excludes other users' resources |
| customer direct access to another user's service | `404` |
| customer direct access to another user's logs | `404` |
| customer direct access to another user's deployments | `404` |
| customer direct access to another user's envs | `404` |
| non-owned action | mocked Coolify call count = `0` |
| admin lists | `200`, full list (sees all) |
| admin assign with invalid user | `400`/`404` |
| admin assign with invalid UUID/type | `400` |
| production without `SESSION_SECRET` | startup failure |
| production, missing OAuth, `DEMO_MODE=false` | startup failure |

The most important assertion is not merely "returns 404" but **"returns 404 and never calls Coolify."**

## Implementation sequence

1. `server/db.js` — schema, WAL/FK pragmas, versioned migrations.
2. `server/auth.js` — Passport, session store, verified-email linking, session regeneration, `/api/me`.
3. Middleware — `requireAuth`, `requireAdmin`, mutation guard, `assertOwns(user, type, uuid)`.
4. Convert every Coolify route to an explicit guarded route (no generic proxy).
5. `resource_ownership` + `audit_events` wired into reads/actions.
6. `POST /api/admin/assign` with UUID/type/user validation.
7. Client auth context, `/login`, logout, route guard, hide Servers for non-admins.
8. `test_isolation.mjs` before any future self-serve work.

## Open questions / follow-ups

- Ownership population before self-serve exists: admin uses `POST /api/admin/assign` manually. Acceptable for the foundation.
- Postgres migration path when scaling past one instance (ceiling noted above).
- Token-based CSRF if sameSite is ever relaxed or cross-site clients are added.
