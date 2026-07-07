# Revealable Database Credentials — Design

**Status:** approved for planning · **Date:** 2026-07-07

**Goal:** Let the owner of a database (or an admin) reveal its full connection
details — username, password, host, port, database name, and ready-to-copy
connection URLs — from the database's page in the panel. Must work for **every**
database, including ones that already exist.

**Architecture:** On-demand fetch. Coolify's REST API masks an existing database's
password (verified — see [coolify.js](../../../server/coolify.js) "No password in
the API response"), and the panel does not persist it at provision time. The
password's source of truth is the **running container's plaintext env**
(`POSTGRES_PASSWORD` etc., which the container needs at boot). So on reveal, the
server runs `docker inspect` on the host over the existing SSH-to-host channel
(`runOnHost`, [hostexec.js](../../../server/hostexec.js)) and parses the container's
env, image, and port bindings into a credential object. No storage, always current,
uniform across Postgres/Redis/MySQL/MariaDB/Mongo.

**Tech stack:** Node/Express (ESM), better-sqlite3 (audit), React+Vite. Reuses the
existing `ssh2`-based `runOnHost`. No new dependency.

## Decisions (from brainstorming)

1. **Reveal shows full connection details + copyable connection URLs** (internal +
   external), not just the password.
2. **Authz: admin OR the resource owner** — the existing `assertOwns(req.user,
   "database", id)` guard (owner passes, admin bypasses).
3. **On-demand via `docker inspect`** — covers existing + future DBs uniformly; no
   password persisted in the panel.
4. Every reveal is **audit-logged** (`db.credentials.reveal`).

## Global Constraints

- ESM everywhere (`import`, not `require`).
- Never persist the DB password in the panel (SQLite/logs). It is fetched
  on-demand and returned to the authenticated owner over HTTPS only.
- Never log the password (audit records the DB uuid + actor, never the secret).
- Secrets are read from the container the panel already manages; the reveal route
  must be owner-or-admin gated exactly like the other `/api/databases/:id/*` routes.
- `runOnHost` targets the primary host — v1 covers DBs there; a DB whose container
  isn't found on that host returns a clear "not found on the managed host" error.

## Components

### C1. `server/dbcreds.js` (new)
- `parseInspect(inspectJson, { uuid, publicHost }) → creds` — **pure**. Takes the
  parsed output of `docker inspect <container>` (a one-element array) and returns:
  ```
  {
    engine,            // "postgres" | "redis" | "mysql" | "mariadb" | "mongo"
    username, password, database,
    internalHost,      // = uuid (Coolify internal DNS = container name)
    internalPort,      // engine default (5432/6379/3306/27017)
    externalHost,      // publicHost, only when a port is published, else null
    externalPort,      // published host port, or null
    internalUrl,       // e.g. postgresql://user:pass@<uuid>:5432/db (user/pass URL-encoded)
    externalUrl,       // same with publicHost:externalPort, or null
  }
  ```
  Engine is inferred from `Config.Image`; creds from `Config.Env`
  (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`; `REDIS_PASSWORD` with user
  `default`; `MYSQL_*`/`MARIADB_*`; `MONGO_INITDB_*`). External mapping is read from
  `HostConfig.PortBindings` / `NetworkSettings.Ports` for the engine's port;
  `username`/`password` are `encodeURIComponent`-escaped inside the URLs.
- `getDatabaseCredentials(uuid) → Promise<creds>` — sanitises `uuid` to `[a-z0-9]`,
  runs one host command:
  ```
  CID=$(docker ps -q --filter name=<uuid> | head -1); [ -n "$CID" ] && docker inspect "$CID" || echo '[]'
  ```
  via `runOnHost`, `JSON.parse`s it; empty array → throw `404` "database container
  not found on the managed host (is it running?)". `publicHost` =
  `process.env.MIGRATION_SSH_HOST`. Returns `parseInspect(...)`. In DEMO mode returns
  placeholder creds.

### C2. Route — `GET /api/databases/:id/credentials`
- `requireAuth` + `assertOwns(req.user, "database", req.params.id)`.
- Calls `getDatabaseCredentials(req.params.id)`.
- `record(req, "db.credentials.reveal", { resourceType: "database", resourceUuid: id })`
  — metadata carries NO secret.
- Returns the creds object. Read-only (no `mutateGuard`; it's a GET).

### C3. UI — database detail page
- A "Connection details" card with a **Reveal** button (collapsed by default; the
  password is never fetched until clicked).
- On click → `api.dbCredentials(id)` → render username / host / port / database as
  plain fields, the **password behind a show/hide toggle**, and copy buttons for the
  **internal** and **external** connection URLs.
- When `externalUrl` is null, show the internal URL plus a note: "This database has
  no public port — enable one in settings to connect from outside the platform."
- `api.js`: add `dbCredentials: (id) => req(`/databases/${id}/credentials`)`.

## Data flow

1. Owner/admin opens the database page, clicks **Reveal**.
2. `GET /api/databases/:id/credentials` → authz → `getDatabaseCredentials` →
   `runOnHost("… docker inspect …")` → `parseInspect`.
3. Audit event recorded; creds returned over HTTPS.
4. UI shows fields + connection strings with copy; password toggled hidden/shown.

## Error handling

| Case | Behavior |
|---|---|
| SSH host not configured (`MIGRATION_SSH_*`) | `runOnHost` rejects 501 → surfaced as "credential reveal not available (host SSH not configured)" |
| Container not found / not running on host | 404 "database container not found on the managed host (is it running?)" |
| Host key pin mismatch / SSH failure | 502 from `runOnHost`, shown as a concise reveal-failed message |
| Not owner / not admin | `assertOwns` → 403 |
| Engine env vars absent (unknown image) | return what's parseable; `password` null with a note; never throw a 5xx |

## Testing

- **Unit (pure, fixture-based):** `parseInspect` against captured `docker inspect`
  JSON for (a) a Postgres container **with** a published external port → asserts
  username/password/database, internal + external URLs, URL-encoding of a password
  containing `@`/`/`; (b) a Redis container **without** a public port → asserts
  `externalUrl` is null and the internal `redis://default:pass@uuid:6379` URL.
- **Path:** unknown/empty inspect (`[]`) → `getDatabaseCredentials` throws 404 (mock
  `runOnHost`).
- Route-level authz (owner-or-admin) is the same guard already covered elsewhere; no
  new HTTP harness introduced (consistent with the repo's server tests).

## Out of scope (v1)

- Databases on **dedicated/other servers** (reveal SSHes to the primary host only; a
  multi-server version would SSH to the resource's own server).
- **Rotating** a password from the UI (this is read/reveal only).
- Persisting/caching credentials in the panel (deliberately on-demand).
- Showing creds in the database **list** view (reveal is per-database, on its page).
