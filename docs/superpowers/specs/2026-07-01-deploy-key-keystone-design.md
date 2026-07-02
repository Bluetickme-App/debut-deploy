# Keystone: route all app creation through the deploy-key path

**Date:** 2026-07-01
**Status:** approved (design)

## Problem

Coolify v4.1.2 has no `/api/v1/sources` endpoint (404). `coolify.createPrivateGithubApp`
(Coolify GitHub-App-source integration) therefore never works on this instance. Three
code paths depend on it and are all broken identically:

- `POST /api/apps` — New Service (UI) + programmatic API create.
- `server/migrate.js` — Render importer (`resolve-github` via `coolify-github.js`).
- (implicitly) any API-driven "set up a new instance" for Claude Code.

The only proven create path is `deploykey.js createDeployKeyApp`
(`/applications/private-deploy-key`), used live for debut-deploy and quicktrade.

## Approach (approved)

Route **all** creates through `createDeployKeyApp`, authenticated by a **single,
one-time account SSH key**: the operator adds Coolify's public key to their GitHub
**account** (not per-repo). Coolify then clones any repo on that account with no
per-repo deploy-key step — which is also what makes bulk/project migration (next
phase) practical.

## Changes

1. **`deploykey.js`**
   - `ensureAccountKey()` → get-or-create one Coolify security key named
     `debutdeploy-account`; returns `{ uuid, publicKey }`.
   - `toSshUrl(repo)` (pure): `https://github.com/O/R` | `O/R` | `git@…` →
     `git@github.com:O/R.git`. Exported for reuse + unit test.

2. **`POST /api/apps`** ([index.js](../../../server/index.js))
   - Replace the `createPrivateGithubApp` block with:
     `ensureAccountKey` → `createDeployKeyApp({ keyUuid, repo: toSshUrl(repo), branch, name, buildPack, port, install/build/start })`.
   - Order: create (no instant deploy) → shared vars + env → `deployService(uuid)`.
   - Keep the installation repo/branch access check + ownership + audit unchanged.

3. **`server/migrate.js`**
   - Replace `resolve-github` (drop `ensureCoolifySourceForInstallation`) with
     `resolve-key` (`ensureAccountKey`).
   - `create-app` → `createDeployKeyApp({ keyUuid, repo: toSshUrl(service.repo), … })`.
   - Keep `migrate-db` (still a 501 stub — real DB migration is the next phase),
     `push-env`, `deploy`, `assign-ownership`.
   - `coolify-github.js` becomes unused (leave file; remove import).

4. **UI** ([ImportRender.jsx](../../../client/src/pages/ImportRender.jsx))
   - One-time dismissible banner with the account public key + copy button:
     "Add this key to your GitHub account (Settings → SSH keys) to enable
     deploys/migration." Fetched from a new admin route `GET /api/git/account-key`.

## Testing

- Unit: `toSshUrl` for all three input forms + idempotence on an SSH url.
- Unit: rewired `migrate.js` step sequence with mocked `d.*` deps — asserts
  `resolve-key` + `create-app` call `createDeployKeyApp` with the SSH url, and the
  step list no longer contains `resolve-github`.
- Live: migrate one real Render service end-to-end (service + env + deploy).

## Out of scope (later phases)

- Real Postgres migration (provision Coolify PG + `pg_dump|restore`) — folded into
  multi-instance project migration (C).
- Pricing/spec matrix (A). API reference doc (`docs/api.md`, D).
