# Platform Plan: Multi-account GitHub · Hetzner Provisioning · Render Importer

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Three subsystems so an operator can migrate any Render site, from any GitHub account, onto shared or freshly-provisioned infrastructure — seamlessly.

**Architecture:** New focused server modules per concern (parallel-safe), one integration agent for `index.js` routes, UI split by page. External APIs (GitHub user-OAuth, Hetzner Cloud, Render) each get a client module with `isDemo()` fixture branches + unit tests; live behavior is verified later with real keys.

**Tech stack:** Node 22 ESM, Express, better-sqlite3, React+Vite. Tests: `node:test` + `:memory:`. External: GitHub App user-to-server OAuth, Hetzner Cloud API (`https://api.hetzner.cloud/v1`), Render API (`https://api.render.com/v1`), `pg_dump`/`pg_restore`.

## Global Constraints
- ESM only; follow existing patterns (`coolify.js` `cf()` + `isDemo()`; `index.js` `h()`/`requireAuth`/`requireAdmin`/`mutateGuard`/`assertOwns`; audit on writes).
- New external clients read keys from env (`HETZNER_API_TOKEN`, `RENDER_API_KEY`, GitHub App creds already present) and **branch on `isDemo()`** returning fixtures so unit tests run without keys.
- Tests: `node:test`, `DATABASE_FILE=':memory:'` + dynamic import. Each module ships a test.
- **Verify live calls against the real APIs before claiming done** where a key exists; otherwise mark `// VERIFY LIVE` and unit-test the demo path.
- Secrets (env var values, DB creds, API keys) never logged; stored hashed/encrypted where persisted.
- You are IMPLEMENTING (write code+tests), not reviewing.

---

## Subsystem A — Multi-account GitHub

### Task A1: multi-installation storage (`server/db.js`)
**Files:** modify `server/db.js`; `server/test_userinstalls.mjs`.
- Migration (next user_version): `CREATE TABLE user_installations (id INTEGER PK, user_id INT REFERENCES users(id), installation_id INT NOT NULL, account_login TEXT, account_id TEXT, created_at TEXT, UNIQUE(user_id, installation_id))`.
- Helpers: `addUserInstallation({userId, installationId, accountLogin, accountId})` (upsert), `listUserInstallations(userId)`, `findUserInstallationByAccount(userId, accountId)`. Keep existing `getInstallation`/`setInstallation` for back-compat (treat as the user's primary/first).
- [ ] Test: add two installations for a user → list returns both; find-by-account works.

### Task A2: GitHub user-OAuth + installation discovery (`server/github-app.js`)
**Files:** modify `server/github-app.js`; `server/test_github_userauth.mjs`.
- Add `exchangeUserCode(code)` → POST `https://github.com/login/oauth/access_token` (App client_id/secret) → user access token. (VERIFY LIVE.)
- Add `listUserInstallations(userToken)` → GET `https://api.github.com/user/installations` → `[{id, account:{login,id,type}}]`.
- Make these injectable (httpClient) so the test mocks them.
- [ ] Test: mocked → `listUserInstallations` maps results; `exchangeUserCode` parses the token.

### Task A3: connect flow + repo aggregation (`server/index.js` integration — folded into the integrator)
- `/github/connect` → GitHub App install+authorize URL (request user auth). Callback exchanges code → user token → `listUserInstallations` → `addUserInstallation` for each.
- `ensureInstallation` → `ensureInstallations`: aggregate repos across ALL the user's installations; `GET /api/github/repos` returns `[{full_name, account_login, installation_id, private, default_branch}]`.
- Deploy/create resolves the correct `installation_id` for the chosen repo (from its account).

### Task A4: Coolify per-account source mapping (`server/coolify-github.js`)
**Files:** create `server/coolify-github.js`; `server/test_coolify_github.mjs`.
- Coolify stores one installation_id per GitHub-App source. To deploy a repo from account X, the create call needs a Coolify github source whose installation matches X.
- `ensureCoolifySourceForInstallation(installationId)` → look up/create a Coolify github source bound to that installation; return its `github_app_uuid`. MVP fallback (documented): if only one Coolify source exists, set its installation_id to the target before deploy (note the single-source race ceiling).
- `createPrivateGithubApp` call sites use the resolved `github_app_uuid`.
- [ ] Test: demo returns a stub uuid; validation of inputs.

---

## Subsystem B — Hetzner provisioning

### Task B1: Hetzner client (`server/hetzner.js`)
**Files:** create `server/hetzner.js`; `server/test_hetzner.mjs`.
- `isDemo()`/key-missing → fixtures. Live → `https://api.hetzner.cloud/v1` Bearer `HETZNER_API_TOKEN`.
- `listServerTypes()`, `listLocations()`, `createServer({name, serverType, location, image, sshKeys})` → `{id, ip, status}`, `getServer(id)`, `deleteServer(id)`. (VERIFY LIVE — creating a server costs money.)
- [ ] Test: demo createServer returns id+ip; rejects missing name/type.

### Task B2: provision → Coolify server registration (`server/provision.js`)
**Files:** create `server/provision.js`; `server/test_provision.mjs`.
- `provisionServer({name, serverType, location})`: createServer (B1) → poll until running → install Coolify agent OR add it to the control Coolify as a server via SSH (Coolify add-server API + our SSH key) → return `{ serverUuid, ip }`. (VERIFY LIVE; SSH + Coolify add-server.)
- Idempotent + status reporting. Long-running → returns a job/status the UI polls.
- [ ] Test: demo path returns a fake serverUuid; sequencing logic unit-tested with mocked B1/coolify.

### Task B3: Servers admin UI (`client/src/pages/Servers.jsx`)
**Files:** create `client/src/pages/Servers.jsx`; route+nav in `App.jsx` (admin).
- List servers (Coolify `listServers` + usage), "Provision new server" form (name, type from `listServerTypes`, location), status polling.

---

## Subsystem C — Render importer

### Task C1: Render API client (`server/render.js`)
**Files:** create `server/render.js`; `server/test_render.mjs`.
- Key from `RENDER_API_KEY` (or passed per-request, encrypted-in-transit only). `isDemo`/no key → fixtures.
- `listServices()` → `[{id, name, repo, branch, buildCommand, startCommand, type, env}]`; `getService(id)`; `getEnvVars(id)` → `[{key,value}]`; `getDatastore(id)` / `getConnectionInfo` → Postgres external connection string. (VERIFY LIVE against `https://api.render.com/v1`.)
- [ ] Test: demo listServices returns fixtures; getEnvVars maps key/value.

### Task C2: migration orchestrator (`server/migrate.js`)
**Files:** create `server/migrate.js`; `server/test_migrate.mjs`.
- `importFromRender({ renderServiceId, target: {mode:'shared'|'dedicated', serverType?} , userId })`:
  1. read Render service + env (C1).
  2. resolve target server: shared (COOLIFY_SERVER_UUID) or provision (B2).
  3. resolve GitHub installation for the repo's account (A4); create the Coolify app (repo, build, start, port).
  4. if Render datastore: create Coolify Postgres → `pg_dump` from Render conn → `pg_restore` into Coolify DB (stream; never store the dump long-term) → set `DATABASE_URL`.
  5. push env vars; deploy; assign ownership; return a structured report (steps + statuses).
- Each step emits progress (return a step log array; live-stream optional).
- [ ] Test: with mocked C1/coolify/B2, a full import returns a report with each step ok; failure in one step stops + reports (no partial ownership).

### Task C3: Import wizard UI (`client/src/pages/ImportRender.jsx`)
**Files:** create `client/src/pages/ImportRender.jsx`; route+nav in `App.jsx`.
- Paste Render API key → list services → pick one → choose infra (shared / dedicated+size) → "Migrate" → show step-by-step progress (read config → DB dump/restore → deploy → done) + the resulting URL.

---

## Task D: Route integration (`server/index.js`)
**Files:** modify `server/index.js` (the ONLY agent to touch it).
- A: `/github/connect` + callback (user-OAuth, multi-install), `GET /api/github/repos` aggregated, `GET /api/github/installations`.
- B: `requireAdmin` `GET /api/hetzner/server-types|locations`, `POST /api/servers/provision`, `GET /api/servers/:id/provision-status`.
- C: `POST /api/import/render/services` (list, body: apiKey), `POST /api/import/render` (run import: serviceId, target). All `requireAuth`; admin where infra-level; `mutateGuard`; audit.
- [ ] `node --check`, `node --test server/*.mjs` all pass.

## Task E: verify
- `node --test server/*.mjs`, `node --check server/index.js`, `npm --prefix client run build`.

## Parallelization map
- **Wave 1 (parallel new files + db):** A1(db), A2(github-app), A4(coolify-github), B1(hetzner), B2(provision), C1(render), C2(migrate). A2 edits github-app.js (one agent); rest are new files.
- **Wave 2 (sequential):** Task D — index.js routes.
- **Wave 3 (parallel pages):** B3 Servers, C3 ImportRender, + App.jsx wiring (one agent owns App.jsx).
- **Wave 4:** verify.

## Live-dependency checklist (operator)
- `HETZNER_API_TOKEN` (Hetzner Cloud → API tokens) — provisioning + costs money.
- `RENDER_API_KEY` (Render → Account Settings → API Keys) — importer reads services/env/DB.
- GitHub App **user authorization** enabled + installed on each account to migrate.
- `pg_dump`/`pg_restore` available on the host running the importer (or in a container).
- Coolify: per-account GitHub source OR accept the single-source switch limitation (A4).

## Honest caveats (not re-argued, just recorded)
- This ships code + demo paths + unit tests; **live functionality is unverified until the keys above exist** and each external call is tested against the real API (expect Coolify/Hetzner/Render field-name fixes, as seen all session).
- Hetzner provisioning creates real, billed servers.
- Multi-account is only as clean as Coolify's source model allows (A4 ceiling).
- Full-auto DB migration assumes Postgres reachable externally + reasonable size; huge DBs / custom extensions need manual handling.
