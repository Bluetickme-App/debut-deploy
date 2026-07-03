# Client Account API (Render-parity) — Design

**Date:** 2026-07-03
**Status:** Approved for planning

## Summary

Let clients self-serve the Render "account API" experience: create/revoke API
keys, invite teammates, and drive their services (provision, deploy, logs,
settings) over REST — and reuse the same keys with the MCP server.

**~80% already exists.** This spec closes four specific gaps. It adds no new
architecture; it extends the existing token → Bearer-auth → org/RBAC layer.

### What already exists (do not rebuild)

- **Team / add users** — [server/index.js](../../../server/index.js) `/api/org/*`
  (invites, members, role changes, removal), owner-gated, org-scoped; full UI in
  [client/src/pages/Team.jsx](../../../client/src/pages/Team.jsx). Untouched by this work.
- **API tokens** — `/api/tokens` GET/POST/DELETE; hashed `dd_…` Bearer tokens
  (`createApiToken`/`getUserByApiToken`/`listApiTokens`/`deleteApiToken` in
  [server/db.js](../../../server/db.js)). No client UI yet.
- **Bearer middleware** — resolves a token to its user, sets `req.viaApiToken`,
  skips CSRF; every REST route then runs under that user's org + RBAC
  ([server/index.js](../../../server/index.js) ~L119).
- **REST surface** — services list/get/deploy/start/stop/restart, logs,
  build-logs, deployments/rollback, env, databases, domains, metrics, server
  provisioning, events.
- **MCP server** — [mcp/server.js](../../../mcp/server.js) is a Bearer client of
  the REST API reading `DEBUTDEPLOY_TOKEN`. A `dd_…` key already works as a
  `DEBUTDEPLOY_TOKEN` with no changes.

## Gaps this spec closes

1. **Token scoping** — every token today inherits its owner's **full** powers.
   Add a Render-style **read-only vs full** option.
2. **Client-facing UI** — no "API Keys" section anywhere; add one to the account
   page ([client/src/pages/Settings.jsx](../../../client/src/pages/Settings.jsx)).
3. **MCP hookup (discoverability)** — surface that a key plugs straight into the
   MCP server; ship a copy-paste config. No MCP server code change.
4. **Public API docs** — `docs/api.md` is framed for Claude Code; add a
   client-facing `docs/client-api.md`.

## Design

### 1. Token scoping (backend — the only real logic change)

- **Schema:** add `scope TEXT NOT NULL DEFAULT 'full'` to `api_tokens` in a new
  `user_version` migration in [server/db.js](../../../server/db.js). Values:
  `'read'` | `'full'`. Default `'full'` keeps existing tokens working unchanged.
- **DB helpers:**
  - `createApiToken(userId, name, scope = 'full')` persists `scope`.
  - `getUserByApiToken(raw)` returns the scope alongside the user (e.g.
    `{ ...user, tokenScope }`, or a shape the caller can read). Keep
    `last_used_at` stamping.
  - `listApiTokens(userId)` includes `scope`.
- **Enforcement — one guard** in the Bearer block
  ([server/index.js](../../../server/index.js) ~L119): after a token resolves,
  stash its scope on `req` (e.g. `req.tokenScope`). If
  `req.tokenScope === 'read'` and the request method is **not** GET or HEAD →
  respond `403 { error: "read-only API key" }`. Full tokens are unaffected;
  RBAC still applies to them via the user's org role.
  - This single guard enforces read-only for **every Bearer-authenticated
    caller** — curl, CI, and MCP alike. (The web app uses cookie sessions, not
    tokens, so it is unaffected.)
- **Routes:** `POST /api/tokens` accepts `{ name, scope }`; validate
  `scope ∈ {'read','full'}`, default `'full'`. Return `scope` in the create
  response and in `GET /api/tokens`.

### 2. Client-facing UI (frontend)

- New **"API Keys"** card in
  [client/src/pages/Settings.jsx](../../../client/src/pages/Settings.jsx) (the
  account page every client already reaches).
  - **List:** name, scope pill (`read` / `full`), created, last used; revoke
    button per row.
  - **Create:** name input + Full / Read-only radio → calls create → shows the
    raw token **once** in a reveal box with a Copy button and a "you won't see
    this again" note.
  - **api.js:** add `createToken({ name, scope })` and `deleteToken(id)` to
    [client/src/lib/api.js](../../../client/src/lib/api.js) (a `tokens()` getter
    may already exist; reuse it, else add).
- **Team UI** already complete — not touched.

### 3. MCP hookup (no MCP server code change)

- In the API Keys card, after a key is revealed, a collapsible **"Use with
  Claude (MCP)"** block shows, pre-filled with the instance URL and the
  just-minted token:
  - the `claude mcp add debutdeploy -e DEBUTDEPLOY_TOKEN=… -- node <path>/mcp/server.js` command, and
  - the equivalent JSON config snippet.
- **[mcp/README.md](../../../mcp/README.md):** update "Configure" to say keys are
  minted from **Settings → API Keys**, and note a **read-only** key restricts
  MCP to read tools (write tools return `403`).
- Read-only enforcement flows through the same middleware guard from §1 — a
  read-only key succeeds on `list_services`/`service_logs`/etc. and fails on
  `deploy_service`/`create_service`/`control_service`.

### 4. Public API docs

- New **`docs/client-api.md`**: auth (`Authorization: Bearer dd_…`), key
  management (mint/revoke, read vs full), and one curl example per resource group
  (services, deploys/rollback, logs, env, databases, domains). A short "Use from
  Claude (MCP)" section. Content is **derived from the real route list**, not
  invented. Linked from the Settings API Keys card.

### Capabilities (§4 of the original ask)

The REST surface already covers Render's core actions. The doc **maps each area
to its existing endpoint**; nothing new is built speculatively. If a specific
endpoint turns out missing, add just that one — flag during spec review or as it
surfaces.

## Testing

- **Server** (extend [server/test_apitokens.mjs](../../../server/test_apitokens.mjs)):
  - `scope` persists on create and is returned by list.
  - read-only token → `403` on a POST route; `200` on a GET route.
  - full token → unaffected (existing behaviour).
  - invalid `scope` value → rejected / coerced to a valid default.
- **Client:** `npm run build` green; manual create → reveal → copy → revoke, and
  the MCP snippet renders with the token substituted.

## Deliberately skipped (YAGNI)

- Service-scoped keys, per-key rate limits, key expiry/rotation reminders,
  org-visible key listing (keys stay **personal**, matching Render), new MCP
  tools. Add when actually needed.

## Data-model / migration note

`api_tokens` gains one nullable-with-default column; the migration is additive
and backfills existing rows to `'full'`. No destructive change.
