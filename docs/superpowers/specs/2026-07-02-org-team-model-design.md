# Org & Team Model — Design Spec

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
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

### Decisions locked during brainstorming

- **Org-owned model.** A Client is an organization; resources belong to the org.
- **One org per user.** No org-switcher; a user's org is implicit on every request.
- **Per-member capability roles:** `owner` (Client Admin), `manager`, `deployer`, `viewer`.
- **Invite = copy-paste link now, email seam for later** (no email service exists yet).
- **New signup with no invite → auto-creates its own org**, user becomes `owner`.
- **Ownership migration = Approach 1:** add `org_id` to `resource_ownership`, backfill one org per existing user.

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
  org_id  INTEGER NOT NULL REFERENCES organizations(id),
  email   TEXT,                                        -- optional target; soft-matched at accept time
  token   TEXT UNIQUE NOT NULL,                        -- random; forms the shareable accept link
  role    TEXT NOT NULL CHECK(role IN ('manager','deployer','viewer')),
  invited_by  INTEGER REFERENCES users(id),
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  created_at  TEXT NOT NULL
);

ALTER TABLE resource_ownership ADD COLUMN org_id INTEGER REFERENCES organizations(id);
```

Notes:
- `memberships.user_id` as PRIMARY KEY is the one-org-per-user guarantee.
- `org_invites.role` cannot be `owner` — an org has exactly one owner (its creator);
  ownership transfer is out of scope for this spec.
- `resource_ownership.org_id` stays nullable (SQLite can't add a NOT NULL column
  to a populated table without a default), but the migration backfills every
  existing row and all new inserts set it.

### Role capabilities

| Role      | Read | Deploy/restart/env | Create/delete | Invites & billing |
|-----------|------|--------------------|---------------|-------------------|
| `viewer`  | ✅   | —                  | —             | —                 |
| `deployer`| ✅   | ✅                 | —             | —                 |
| `manager` | ✅   | ✅                 | ✅            | —                 |
| `owner`   | ✅   | ✅                 | ✅            | ✅                |

**Master Admin** = existing `users.role='admin'`. Cross-org, bypasses org
scoping, unchanged by this spec. (A Master Admin also gets a personal org in the
backfill so they can own resources like anyone else.)

## Migration / backfill

Runs inside the same `user_version` 10 migration, as one transaction:

1. For each existing `users` row: insert an `organizations` row
   (`name = user.name || user.email`; `slug` = slugified name, deduped with a
   numeric suffix on collision).
2. Insert a `memberships` row for that user with `role = 'owner'`.
3. `UPDATE resource_ownership SET org_id = <new org id> WHERE user_id = <user id>`.

Result: every live owner keeps exactly their current resources, now expressed as
org ownership. No resource changes hands.

## Onboarding & invites

### New signup (no invite)
In `server/auth.js`, both the Google and GitHub strategies call `createUser`
(around `server/auth.js:164` / `:203`). Factor the post-create step into a shared
helper that, when a freshly created user has no membership, creates an org named
after them and adds an `owner` membership. Existing users are unaffected.

### Creating an invite
`owner`-only endpoint accepts `{ email?, role }`, mints a random `token`, inserts
an `org_invites` row, and returns the shareable URL
`<clientOrigin>/accept-invite?token=<token>`. The Client Admin copy-pastes it.
A `// ponytail:` comment marks where an email send would later be triggered.

### Accepting an invite
`/accept-invite?token=…` requires an authenticated session:
- Token invalid / already accepted → clear error.
- Signed-in user **already has an org** → blocked (one-org rule) with a message
  explaining they must use an account with no org.
- `invite.email` set and does not match the signed-in verified email → soft
  reject (guards against link forwarding).
- Otherwise → insert membership with `invite.role`, stamp `accepted_by` /
  `accepted_at`.

## Role enforcement

- **Attach org context:** after `requireAuth`, a helper resolves the user's
  `memberships` row and attaches `req.org = { id, role }`. Master Admin without a
  membership still works (org-agnostic).
- **Org-scope ownership** (`server/ownership.js`): `ownedUuids` and `assertOwns`
  filter by `org_id` (from `req.org.id`) instead of `user_id`. Master Admin
  bypass stays. Cross-org access returns 404 (same as today's not-owned case).
- **Capability gate:** a new `requireCapability(level)` middleware where
  `level ∈ {'read','deploy','manage'}`. Applied to existing routes in
  `server/index.js`:
  - create/delete resource routes → `manage`
  - deploy/restart/env-edit routes → `deploy`
  - read routes → `read` (any member)
  - invite/member-management routes → `owner` only

## API surface (new)

- `GET  /api/org` — current user's org + role.
- `GET  /api/org/members` — members + roles (owner/manager can read; owner can mutate).
- `POST /api/org/invites` — create invite, returns link (owner only).
- `GET  /api/org/invites` — pending invites (owner only).
- `DELETE /api/org/invites/:id` — revoke (owner only).
- `POST /api/org/invites/accept` — accept `{ token }` (any signed-in user).
- `PATCH /api/org/members/:userId` — change a member's role (owner only).
- `DELETE /api/org/members/:userId` — remove a member (owner only).
- `GET  /api/admin/orgs` — Master Admin: all orgs with counts.
- `GET  /api/admin/orgs/:id` — Master Admin: one org's members + resources.

`/api/customers` (Master Admin) is superseded by `/api/admin/orgs`.

## UI

- **Master Admin — Clients** (`client/src/pages/Customers.jsx` evolves, likely
  renamed `Clients.jsx`): table of all orgs (name, owner, member count, service &
  DB counts). Row → detail: members + resources (+ billing later).
- **Client Admin — Team** (new `client/src/pages/Team.jsx`): member list with
  roles, "Invite" (generates + shows copy link), change role, remove member.
- **Nav** (`client/src/…` layout): "Clients" shown to Master Admin; "Team" shown
  only to org `owner`s. Team Users see resources per capability but not the Team
  page.

## Testing

`server/test_orgs.mjs`, in-memory DB, matching the `server/test_isolation.mjs`
pattern. Assertions:
- New user signup auto-creates an org with an `owner` membership.
- One-org-per-user is enforced (second membership insert fails).
- Invite create → accept joins the org with the invited role.
- Accept is blocked when the accepting user already belongs to an org.
- `assertOwns` allows same-org access and denies cross-org (404).
- Capability gating: `viewer` cannot delete, `deployer` cannot create,
  `manager` can create/delete, `owner` can invite.
- Migration backfill: an existing user with owned resources ends up with one
  org and all `resource_ownership.org_id` populated.

## Build sequence (for the implementation plan)

1. Migration 10 + backfill + `db.js` org/membership/invite query helpers.
2. `test_orgs.mjs` for the data layer (TDD).
3. Auth hook: auto-create org on new signup.
4. Org-scope `ownership.js` + `requireCapability` middleware.
5. Wire capability levels onto existing routes in `index.js`.
6. New org/invite/admin API endpoints.
7. Client: Team page, Clients (Master Admin) page, nav gating.
8. Full `test_orgs.mjs` pass + `test_isolation.mjs` still green.
