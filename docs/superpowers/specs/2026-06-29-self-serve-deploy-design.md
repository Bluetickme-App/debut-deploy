# DebutDeploy — Self-Serve Deploy (Render-clone) MVP

**Date:** 2026-06-29
**Status:** Approved (design)
**Scope:** Let a signed-in customer connect their GitHub, pick a private repo + branch, and deploy it to the shared Coolify — mirroring Render's "New Web Service" flow — with per-customer Coolify projects, ownership auto-assignment, and auto-deploy on push.

## Context

DebutDeploy already has: Google/GitHub login, an ownership table (`resource_ownership`), audit log, and a dashboard that lists/deploys/starts/stops/logs/env-edits **existing** Coolify apps the user owns. It is wired to a live Coolify (`http://167.233.206.184:8000`). What's missing is **creating** apps from the panel. This spec adds that.

The model: clone Render's deploy UX onto Coolify's `private-github-app` create endpoint.

## Decisions

| Decision | Choice |
|---|---|
| Deploy source | Private Git repo via a **GitHub App** |
| Auto-deploy on push | **Yes, in MVP** (free: Coolify wires the webhook when deploying via the GitHub App) |
| App placement | **One Coolify project per customer** (created on first deploy) |
| GitHub App count | **One platform GitHub App**, shared: Coolify uses it to create/deploy/webhook; DebutDeploy uses its App ID + private key to list each customer's repos via installation tokens |
| Per-customer repo isolation | Each customer installs the app on their GitHub; we store `user_id → installation_id` and list repos with **that installation's** token |
| JWT signing | Node built-in `node:crypto` (RS256) — no new dependency |

## Phase 0 — prerequisite (ops, not in the code plan)

A GitHub App registered on GitHub and configured in Coolify, producing:
- `github_app_uuid` (Coolify-side source id) — passed to the create call
- GitHub App **App ID** + **private key (PEM)** + **slug** + webhook/callback config

DebutDeploy `.env` additions: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `COOLIFY_GITHUB_APP_UUID`, `COOLIFY_SERVER_UUID` (the localhost server), `COOLIFY_DESTINATION_UUID` (optional; else resolved).

## Out of scope (Phase 2)

Quotas / resource limits on the shared box, instance sizing, app delete/teardown UI, build-config polish, GitLab/Bitbucket, public-repo path.

## Data model (DebutDeploy DB, new migration)

- `github_installations(user_id INTEGER PRIMARY KEY REFERENCES users(id), installation_id INTEGER NOT NULL, account_login TEXT, created_at TEXT NOT NULL)`
- `customer_projects(user_id INTEGER PRIMARY KEY REFERENCES users(id), project_uuid TEXT NOT NULL, environment_name TEXT NOT NULL, created_at TEXT NOT NULL)`

Query helpers in `db.js`: `setInstallation`, `getInstallation(userId)`, `setCustomerProject`, `getCustomerProject(userId)`.

## Components

### `server/github-app.js` (new)
Holds GitHub App creds; no DB.
- `installationToken(installationId)` → mints a JWT (RS256, `node:crypto`, App ID, 9-min exp) → `POST /app/installations/{id}/access_tokens` → returns short-lived token.
- `listRepos(installationId)` → `GET /installation/repositories` with the installation token → `[{ full_name, private, default_branch }]`.
- `listBranches(installationId, owner, repo)` → `GET /repos/{owner}/{repo}/branches` → `[name]`.
- `installUrl(state)` → `https://github.com/apps/<slug>/installations/new?state=<state>`.
- All return shapes documented; network errors throw `{status}`-tagged errors.

### `server/coolify.js` (additions; demo + live branches each)
- `getDefaultDestination(serverUuid)` → resolves the server's default docker destination uuid (live: `GET /servers/{uuid}` or `/destinations`; demo: fixture).
- `createProject(name)` → `POST /projects` → `{ uuid }` (demo: fake uuid).
- `createPrivateGithubApp({ githubAppUuid, projectUuid, environmentName, serverUuid, destinationUuid, gitRepository, gitBranch, portsExposes, name, buildPack, instantDeploy })` → `POST /applications/private-github-app` → `{ uuid }`.

### `server/index.js` (routes; all `requireAuth`, mutations `mutateGuard`)
- `GET /github/connect` → redirect to `githubApp.installUrl(signedState(userId))`.
- `GET /github/setup` → GitHub callback with `installation_id` + `state`; verify state → `setInstallation(userId, installationId, accountLogin)` → redirect to client `/new`.
- `GET /api/github/repos` → `getInstallation` else `409 {needsConnect:true}`; return `listRepos`.
- `GET /api/github/repos/:owner/:repo/branches` → `listBranches`.
- `POST /api/apps` → body `{ repo, branch, name, port, envs?[] }`:
  1. `getCustomerProject(userId)` or create one (`createProject("deploy-<userId>")` + default env "production") and persist.
  2. resolve `destinationUuid` (env or `getDefaultDestination`).
  3. `createPrivateGithubApp(...)` with `instantDeploy:true`.
  4. `assign(appUuid, "application", userId)` + audit `app.create`.
  5. for each env: `upsertEnv(appUuid, env)`.
  6. return `{ uuid }`.

`signedState` = HMAC of `userId` with `SESSION_SECRET` to prevent install-callback forgery.

### Client (`client/src/`)
- "Connect GitHub" button (shown when `/api/github/repos` returns `needsConnect`) → links to `/github/connect`.
- `/new` wizard page: repo dropdown (from `/api/github/repos`) → branch dropdown → name + port + env-var rows → "Create" → `POST /api/apps` → on success route to the new service's detail page.

## Error handling
- Not connected → `409 {needsConnect:true}` → UI shows Connect button.
- GitHub API failure → surfaced with status.
- Coolify create failure → surfaced; no ownership row written (assign only after success).
- State mismatch on `/github/setup` → `403`.

## Testing (node:test, mocked)
- `test_github_app.mjs`: installation A's token lists only A's repos (mock GitHub fetch keyed by installation token); JWT is RS256 with correct claims.
- `test_create_app.mjs`: `POST /api/apps` creates project once (second deploy reuses it), assigns ownership only after a successful Coolify create, and a failed create writes **no** ownership row (mocked coolify, asserts call/ownership state).

## Phasing within this spec
1. DB migration + query helpers.
2. `github-app.js` (+ unit test).
3. `coolify.js` additions.
4. Routes integration (`/github/*`, `/api/github/*`, `/api/apps`).
5. Client wizard.
6. Create-flow test.
Modules 1–3 are independent (distinct files) and can be built in parallel; 4 integrates them; 5–6 follow.
