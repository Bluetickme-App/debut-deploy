# Org & Team Model — Design Spec

**Date:** 2026-07-02
**Status:** Approved (design, amended after review), pending implementation plan
**Subsystem:** A of 3 (Org/Team RBAC · Usage Metering · Billing Engine)

## Context

DebutDeploy is a Render-style control panel proxying Coolify. Today it has a
**flat** tenancy model: a `user` is either `admin` or `customer` and owns
resources directly via `resource_ownership.user_id` (see
`server/ownership.js`). There is no concept of an organization grouping users.

The product goal is a **Master Admin → Client (org) → Client Admin → Team
Users** hierarchy where resources — and, in a later spec, billing/credit —
belong to the **Client org**, not to individuals.

This spec covers **only** the org/team/RBAC foundation. Stripe, the prepaid
credit wallet, and usage metering are separate subsystems (B and C) with their
own specs. This one is a prerequisite for them: billing needs a clean
org → resources line to bill against.

### Decisions locked during brainstorming (+ review amendments)

- **Org-owned model.** A Client is an organization; resources belong to the org.
- **One org per user.** No org-switcher; a user's org is implicit on every request.
- **Per-member capability roles:** `owner` (Client Admin), `manager`, `deployer`, `viewer`.
- **Multiple owners, never zero.** An org may have several owners; every
  demote/remove path must leave at least one owner standing.
- **Invite = copy-paste link now, email seam for later** (no email service exists yet).
  Invite tokens are **hashed at rest** and **expire after 7 days**.
- **New signup → auto-creates its own org UNLESS a valid pending invite is
  present**, in which case the user joins the inviting org instead.
- **Ownership migration = Approach 1:** add `org_id` to `resource_ownership`,
  backfill one org per existing user. `org_id` becomes the sole authorization
  field; `user_id` is retained only as legacy/audit metadata.

## Goals

1. Model organizations, memberships (one per user), and invites.
2. Make resource access **org-scoped** instead of user-scoped, without breaking
   live ownership at app.debutdeploy.com.
3. Enforce four capability tiers on API routes.
4. Give Master Admin a Clients view and Client Admins a Team view.

## Non-goals (explicit — deferred to later specs)

- Stripe / credit wallet / monthly hardware charge (subsystem C).
- Usage metering: GB-hours, compute-hours, bandwidth (subsystem B).
- Email sending (invites are copy-paste links; a `// ponytail:` seam marks the hook).
- Multi-org membership / active-org switching.
- Any billing-related columns on `organizations` (added in spec C).
- Create-flow orphan handling (Coolify-created-but-DB-insert-failed) — a
  pre-existing robustness gap in the current `assign()` path, not introduced by
  this spec; addressed separately.

## Data model

New migration → `user_version` 10 in `server/db.js`.

```sql
CREATE TABLE organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),   -- PK enforces one-org-per-user at the DB level
  org_id  INTEGER NOT NULL REFERENCES organizations(id),
  role    TEXT NOT NULL CHECK(role IN ('owner','manager','deployer','viewer')),
  created_at TEXT NOT NULL
);

CREATE TABLE org_invites (
  id INTEGER PRIMARY KEY,
  org_id     INTEGER NOT NULL REFERENCES organizations(id),
  email      TEXT,                                     -- optional target; soft-matched at accept time
  token_hash TEXT UNIQUE NOT NULL,                     -- SHA-256 of the raw token; raw shown once in the link
  role       TEXT NOT NULL CHECK(role IN ('owner','manager','deployer','viewer')),
  invited_by  INTEGER REFERENCES users(id),
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  expires_at  TEXT NOT NULL,                           -- created_at + 7 days
  created_at  TEXT NOT NULL
);

ALTER TABLE resource_ownership ADD COLUMN org_id INTEGER REFERENCES organizations(id);

CREATE INDEX idx_memberships_org_id        ON memberships(org_id);
CREATE INDEX idx_resource_ownership_org_id ON resource_ownership(org_id);
```

Notes:
- `memberships.user_id` as PRIMARY KEY is the one-org-per-user guarantee.
- Invites **can** carry `role='owner'` (multi-owner model): an owner may invite a
  co-owner or promote a member. The "never zero owners" invariant is enforced in
  app code (see Member management), not by the schema.
- Tokens are hashed (`token_hash`) reusing the existing `hashToken` helper
  (`server/db.js:292`), consistent with how `api_tokens` are stored. The raw
  token appears only once, inside the shareable link.
- `resource_ownership.org_id` stays nullable (SQLite can't add a NOT NULL column
  to a populated table without a default), but the migration backfills every
  existing row, all new inserts set it, and a startup check refuses to run in
  production if any row is null (see Migration validation).
- Indexing is deliberately minimal — this is a single SQLite file fronting one
  Coolify instance. The `assertOwns` hot path is already covered by the existing
  `(type, coolify_uuid)` primary key; the two added indexes cover org-scoped
  list/enumeration. No further indexes until a real query profile demands them.

### Role capabilities

Capability ladder (each tier includes the ones above it):

| Role      | `read` | `deploy` (restart/env) | `manage` (create/delete) | `owner` (invites/roles/billing) |
|-----------|:------:|:----------------------:|:------------------------:|:-------------------------------:|
| `viewer`  | ✅     | —                      | —                        | —                               |
| `deployer`| ✅     | ✅                     | —                        | —                               |
| `manager` | ✅     | ✅                     | ✅                       | —                               |
| `owner`   | ✅     | ✅                     | ✅                       | ✅                              |

**Master Admin** = existing `users.role='admin'`. Cross-org; **explicitly
short-circuits** `attachOrgContext`, `requireCapability`, and `assertOwns`
(`if (req.user.role === 'admin') return next()/return true`). Unchanged by this
spec otherwise. A Master Admin also gets a personal org in the backfill so they
can own resources like anyone else.

**Master Admin resource behaviour:** on normal dashboard routes a Master Admin
acts inside their **own personal org** (resources they create are owned by it).
Acting inside a *client's* org is done only through the `/api/admin/orgs/:id/…`
routes. (Selected-org-aware admin mutation endpoints are a later addition; this
spec's admin routes are read-only.)

## Migration / backfill

Runs inside the same `user_version` 10 migration, as one transaction:

1. For each existing `users` row: insert an `organizations` row.
   `slug = slugify(user.name || email-local-part || 'user-' + id)`, deduped
   deterministically — the bare slug first, then `-2`, `-3`, … only on collision
   (never `-1`).
2. Insert a `memberships` row for that user with `role = 'owner'`.
3. `UPDATE resource_ownership SET org_id = <new org id> WHERE user_id = <user id>`.

### Migration validation
After backfill, still inside the transaction, assert and **throw (rolling back)**
if either is non-zero:
- users with no membership: `SELECT COUNT(*) FROM users u LEFT JOIN memberships m ON m.user_id=u.id WHERE m.user_id IS NULL`
- ownership rows with null org: `SELECT COUNT(*) FROM resource_ownership WHERE org_id IS NULL`

Additionally, on every boot (not just migration), if any `resource_ownership`
row has a null `org_id`, refuse to start in production (log critical). Cheap
insurance against a partial migration against live data.

## Onboarding & invites

### Invite-aware signup (critical path)
An invited *new* user hits `/accept-invite?token=…` before they have an account,
so signup must not blindly auto-create a personal org. Flow:

1. `/accept-invite?token=…` stores the token in `req.session` (same mechanism as
   `setReturnTo` in `server/auth.js:268`) and, if unauthenticated, sends the user
   into OAuth.
2. Both OAuth strategies call `createUser` (around `server/auth.js:164` / `:203`).
   The shared post-login helper checks for a **valid pending invite token** in the
   session:
   - **Valid pending invite** → join the inviting org with the invite's role;
     do **not** create a personal org.
   - **No pending invite** → create a personal org and add an `owner` membership.
3. Existing users are unaffected (they already have a membership).

Rule: *New signup without a pending valid invite creates its own org; with one, it
joins the invited org instead.*

### Creating an invite
`owner`-only endpoint accepts `{ email?, role }`, generates a random raw token,
stores its SHA-256 `token_hash` with `expires_at = now + 7 days`, and returns the
shareable URL `<clientOrigin>/accept-invite?token=<raw token>` **once**. The
Client Admin copy-pastes it. A `// ponytail:` comment marks where an email send
slots in later.

### Accepting an invite
`POST /api/org/invites/accept` with `{ token }`, authenticated session required.
An invite is **valid** iff: `accepted_at IS NULL` AND `expires_at > now` AND the
`token_hash` matches. Then:
- Invalid / expired / already accepted → clear error.
- Signed-in user **already has an org** → blocked (one-org rule) with a message
  explaining they must use an account with no org.
- `invite.email` set and does not match the signed-in verified email → soft
  reject (guards against link forwarding).
- Otherwise → insert membership with `invite.role`, stamp `accepted_by` /
  `accepted_at`.

## Role enforcement

- **Attach org context:** after `requireAuth`, `attachOrgContext` resolves the
  user's `memberships` row and attaches `req.org = { id, role }`. Master Admin
  short-circuits (org-agnostic).
- **Org-scope ownership** (`server/ownership.js`): `ownedUuids` and `assertOwns`
  filter by `org_id` (from `req.org.id`) instead of `user_id`; Master Admin
  bypass stays. **`org_id` is the sole authorization field** after migration —
  `user_id` is legacy/audit metadata and must not drive access control. Cross-org
  access returns **404** (non-disclosure — same as today's not-owned case).
  *Future migration:* drop/rename `resource_ownership.user_id` once all routes
  are org-scoped.
- **Capability gate:** `requireCapability(level)` where
  `level ∈ {'read','deploy','manage','owner'}`, using the ladder above. Applied to
  existing routes in `server/index.js`:
  - create/delete resource routes → `manage`
  - deploy/restart/env-edit routes → `deploy`
  - read routes → `read` (any member)
  - invite / member-management routes → `owner`

### Isolation invariant (must hold on every Coolify-backed route)
> Authorise → fetch → filter. No Coolify resource UUID may be returned to a
> non-admin user unless a `resource_ownership` row exists for that UUID with the
> caller's `org_id`. List routes fetch from Coolify then filter to org-owned
> UUIDs; action routes call `assertOwns` before touching Coolify; create routes
> pass `requireCapability('manage')` then insert ownership with `org_id`.

This invariant is covered by route-level tests (below).

## API surface (new)

- `GET  /api/org` — current user's org + role.
- `GET  /api/org/members` — members + roles (`owner`/`manager` may read; `owner` mutates).
- `POST /api/org/invites` — create invite, returns link once (owner only).
- `GET  /api/org/invites` — pending invites (owner only).
- `DELETE /api/org/invites/:id` — revoke via hard delete (owner only).
- `POST /api/org/invites/accept` — accept `{ token }` (any signed-in user).
- `PATCH /api/org/members/:userId` — change a member's role (owner only; cannot
  demote the last owner).
- `DELETE /api/org/members/:userId` — remove a member (owner only; cannot remove
  the last owner).
- `GET  /api/admin/orgs` — Master Admin: all orgs with counts.
- `GET  /api/admin/orgs/:id` — Master Admin: one org's members + resources.

`/api/customers` (Master Admin) is superseded by `/api/admin/orgs`.

### Member management rules
- **Never zero owners:** `PATCH` demoting an owner and `DELETE` removing an owner
  both fail if that user is the org's *last* owner (`SELECT COUNT(*) … role='owner'`
  must stay ≥ 1).
- Removing a member **removes access only** — it does not delete or transfer the
  org's resources (they remain org-owned). Hard-delete of the membership row is
  acceptable; access history lives in `audit_events`.
- A removed user can rejoin only via a fresh invite.

## UI

- **Master Admin — Clients** (`client/src/pages/Customers.jsx` evolves, likely
  renamed `Clients.jsx`): table of all orgs (name, owner(s), member count, service
  & DB counts). Row → detail: members + resources (+ billing later).
- **Client Admin — Team** (new `client/src/pages/Team.jsx`): member list with
  roles. **Visible to `owner` and `manager`; only `owner` sees the invite /
  change-role / remove controls** (aligns the page with the read/mutate API
  split).
- **Nav** (`client/src/…` layout): "Clients" shown to Master Admin; "Team" shown
  to `owner` and `manager`. `viewer`/`deployer` see resources per capability but
  not the Team page.

## Testing

Two layers, both matching existing patterns (`server/test_isolation.mjs`,
in-memory DB).

**`server/test_orgs.mjs` — data layer:**
- New user signup auto-creates an org with an `owner` membership.
- Signup **with a pending valid invite** joins the inviting org and does **not**
  create a personal org.
- One-org-per-user is enforced (second membership insert fails).
- Invite create → accept joins the org with the invited role; expired/already-
  accepted invites are rejected; token is matched by hash.
- Accept is blocked when the accepting user already belongs to an org.
- Migration backfill: existing user with owned resources → one org, all
  `resource_ownership.org_id` populated; validation assertions pass.

**Route-level RBAC (extend the isolation tests):**
- `viewer`: can list; cannot create/delete/restart/edit-env.
- `deployer`: can restart/deploy/edit-env; cannot create/delete.
- `manager`: can create/delete; cannot invite/manage members.
- `owner`: can invite and manage members.
- `admin` (Master Admin): reaches cross-org `/api/admin/orgs` endpoints.
- **Cross-org UUID action returns 404, not 403** (non-disclosure).
- Last-owner guard: demoting/removing the only owner fails.

## Build sequence (for the implementation plan)

1. **Migration 10** — organizations, memberships, invites (hashed token +
   expiry), `resource_ownership.org_id`, the two indexes, backfill, and the
   in-transaction validation assertions.
2. **Data helpers** in `db.js` — create org, create membership, get membership,
   create/accept/expire invite (hash + validity), list members, role-mutation
   guards (last-owner check). Plus the boot-time null-`org_id` check.
3. **`test_orgs.mjs`** for the data layer (TDD).
4. **Invite-aware auth onboarding** — session token stash, suppress auto-org when
   a valid pending invite exists, else create org + `owner` membership.
5. **RBAC middleware** — `attachOrgContext`, `requireCapability(level)` with the
   four-level ladder, explicit Master Admin bypass everywhere.
6. **Org-scope `ownership.js`** — `ownedUuids`/`assertOwns` by `org_id`,
   cross-org 404.
7. **Wire capability levels** onto existing routes in `index.js`; verify the
   isolation invariant holds per route.
8. **New org/invite/admin API endpoints.**
9. **Client** — Team page, Clients (Master Admin) page, nav + control gating.
10. **Tests green** — `test_orgs.mjs` (data + route-level RBAC) and existing
    `test_isolation.mjs` both pass.
