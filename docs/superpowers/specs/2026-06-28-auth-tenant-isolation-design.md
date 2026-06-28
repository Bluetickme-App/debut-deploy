# DebutDeploy — Auth + Tenant Isolation Foundation

**Date:** 2026-06-28
**Status:** Approved (design)
**Scope:** Accounts, Google + GitHub login, and app-layer tenant isolation on a single shared Coolify backend.

## Context

DebutDeploy is today a personal control panel: a React+Vite UI → Express proxy → Coolify `/api/v1`. A single team-scoped Coolify token lives in `server/.env`, and `coolify.js` returns every resource in that team to anyone who can reach the proxy.

The product direction is to **sell self-serve access to end users on one shared Coolify instance** ("you host one shared Coolify"). That makes isolation the central problem: customer A must never see or act on customer B's resources.

### Key constraint (researched)

Coolify's API is **team-scoped per token**; Coolify *projects* are organizational folders, **not** a security boundary, and the API returns all resources in the token's team. Real isolation in Coolify means separate teams with separate tokens, and Coolify explicitly does not yet support teams safely sharing a server. ([authorization docs](https://coolify.io/docs/api-reference/authorization), [teams-sharing-server discussion](https://github.com/coollabsio/coolify/discussions/1820))

**Therefore isolation is enforced in the Express proxy**, via an ownership table in our own datastore that maps each Coolify resource UUID to a customer. Every route filters reads and authorizes actions against it.

## Out of scope (future specs)

- Self-serve create/deploy flows (connect a repo, create an app on Coolify, auto-assign ownership)
- GitHub repo linking for deploys
- Resource quotas / guardrails on the shared box
- Billing (Stripe, plans, metering)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth stack | Self-hosted Passport (`passport-google-oauth20`, `passport-github2`) + `express-session` | Free, no vendor, on-brand with a cost-cutting/self-host product; well-trodden |
| Session store | `connect-sqlite3` | Matches the datastore; survives restarts |
| Datastore | `better-sqlite3` (file at `server/data/debut.db`) | Zero infra, synchronous/simple. **Ceiling:** single instance only — migrate to Postgres when running >1 server process |
| Isolation point | Express proxy ownership table | Coolify cannot isolate within one team token (see Context) |
| Non-owned access response | `404`, not `403` | Prevents customers enumerating which resources exist |

## Architecture

A thin persistence + auth layer is added to the existing Express server. The Vite dev proxy model is unchanged. OAuth callbacks land on the Express server (`OAUTH_CALLBACK_BASE`), which sets a session cookie; the SPA reads auth state from `/api/me`.

```
Browser ──/auth/{google,github}──▶ Express (Passport) ──▶ provider ──▶ /callback
   │                                     │
   │◀──── session cookie ────────────────┘
   │
   └──/api/*──▶ requireAuth ──▶ ownership filter ──▶ coolify.js ──▶ Coolify
```

## Components

### `server/db.js`
better-sqlite3 connection; schema created/migrated on boot. Tables:

- `users(id INTEGER PK, email TEXT UNIQUE, name TEXT, avatar_url TEXT, role TEXT CHECK(role IN ('admin','customer')) DEFAULT 'customer', created_at TEXT)`
- `identities(provider TEXT, provider_user_id TEXT, user_id INTEGER REFERENCES users(id), PRIMARY KEY(provider, provider_user_id))` — lets one person link both Google and GitHub to the same user
- `resource_ownership(coolify_uuid TEXT, type TEXT CHECK(type IN ('application','database','service')), user_id INTEGER REFERENCES users(id), created_at TEXT, PRIMARY KEY(coolify_uuid))`
- sessions table — managed by `connect-sqlite3`

### `server/auth.js`
Passport Google + GitHub strategies, `serializeUser`/`deserializeUser`, and routes:

- `GET /auth/google`, `GET /auth/google/callback`
- `GET /auth/github`, `GET /auth/github/callback`
- `POST /auth/logout`
- `GET /api/me` → `{ id, email, name, avatar_url, role }` or `401`

**Identity resolution on callback:** find by `(provider, provider_user_id)`; else find user by verified email and link a new identity row; else create a user. Role is `admin` if the email is in `ADMIN_EMAILS`, otherwise `customer`. Then establish the session and redirect to the SPA.

### `server/ownership.js`
- `ownedUuids(userId, type)` → array of UUIDs the user owns
- `assertOwns(userId, uuid)` → throws a `404`-shaped error if not owned (admins bypass)
- `assign(uuid, type, userId)` → insert/replace ownership

### `server/index.js` (middleware wiring)
- `requireAuth` on all `/api/*` except `/api/health`.
- **Lists** (`/api/services`, `/api/databases`): call coolify, then filter to `ownedUuids(user, type)` unless `role === 'admin'`.
- **Item/action routes** (`/services/:id`, `/deploy`, `/start|stop|restart`, `/deployments`, `/logs`, `/envs*`): `assertOwns` before calling coolify; non-owned → `404`.
- `GET /api/servers`: admin-only → non-admins get `403` (it is a known-existing infra endpoint, not a per-tenant resource, so `403` is acceptable here).
- `POST /api/admin/assign` (admin-only): body `{ uuid, type, userId }` → `ownership.assign`.

### `server/coolify.js`
Unchanged in responsibility (demo/live branching). Filtering happens in the route layer using the UUID sets, so `coolify.js` stays focused.

### Demo mode
If OAuth credentials are absent, the server seeds a demo admin user and auto-logs-in every request as that admin, so the existing "clone and click around with fixtures" experience keeps working token-free. Guarded so it only engages when OAuth is unconfigured.

### Config additions (`server/.env` / `.env.example`)
`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_CALLBACK_BASE` (e.g. `http://localhost:8787`), `ADMIN_EMAILS` (comma-separated), `DATABASE_FILE` (default `./data/debut.db`).

### Client
- `/login` page: "Continue with Google" / "Continue with GitHub" buttons linking to `/auth/{google,github}` (lucide icons already available).
- An auth context that fetches `/api/me`; a route guard that redirects to `/login` on `401`.
- Logout button (`POST /auth/logout`).
- Hide the Servers nav item for non-admin users.

## Error handling

- Unauthenticated `/api/*` → `401` → SPA redirects to `/login`.
- Authenticated but non-owned resource → `404` (no existence leak).
- Admin-only endpoint accessed by customer → `403`.
- Existing Express error handler is reused; ownership/auth errors carry a `status`.

## Security notes

- Session cookie: `httpOnly`, `sameSite=lax`, `secure` in production.
- `SESSION_SECRET` required in production (fail fast if missing and not demo).
- OAuth `state` handled by Passport; callback URLs pinned via `OAUTH_CALLBACK_BASE`.
- `404` over `403` on tenant resources to prevent enumeration.

## Testing

One must-have security check: `server/test_isolation.mjs` (`node:test`) seeds two customers with disjoint ownership and asserts:
- user A's `/api/services` list excludes user B's resources,
- direct access to user B's resource returns `404`,
- an admin sees both.

## Open questions / follow-ups

- How ownership gets populated before self-serve exists: admin uses `POST /api/admin/assign` manually. Acceptable for the foundation.
- Postgres migration path when scaling past one instance (ceiling noted above).
