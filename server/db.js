// SQLite layer: a single shared connection plus user/identity queries.
// The connection is a module singleton (imported as `db` by ownership.js and
// audit.js); auth.js imports the user/identity helpers. Schema is created and
// migrated on first import.
//
// DATABASE_FILE overrides the location; use ':memory:' in tests.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

// Lowercase, hyphenate, strip to [a-z0-9-]; used for org slugs.
export function slugify(input) {
  const s = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "org";
}

const MIGRATIONS = [
  // -> user_version 1
  (d) => {
    d.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','customer')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE identities (
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (provider, provider_user_id)
      );
      CREATE TABLE resource_ownership (
        coolify_uuid TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('application','database','service')),
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (type, coolify_uuid)
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_uuid TEXT,
        ip TEXT,
        user_agent TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 2
  (d) => {
    d.exec(`
      CREATE TABLE github_installations (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        installation_id INTEGER NOT NULL,
        account_login TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE customer_projects (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        project_uuid TEXT NOT NULL,
        environment_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 3: one-time OAuth/install state nonces
  (d) => {
    d.exec(`
      CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 4: programmatic API tokens (hashed; for Claude Code / CI)
  (d) => {
    d.exec(`
      CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT,
        token_hash TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
    `);
  },
  // -> user_version 5: multi-installation support (one user, many GitHub App installs)
  (d) => {
    d.exec(`
      CREATE TABLE user_installations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        installation_id INTEGER NOT NULL,
        account_login TEXT,
        account_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, installation_id)
      );
    `);
  },
  // -> user_version 6: per-user outbound webhook notification settings
  (d) => {
    d.exec(`
      CREATE TABLE notification_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        webhook_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 7: which event types a webhook subscribes to (JSON array; null = all)
  (d) => {
    d.exec(`ALTER TABLE notification_settings ADD COLUMN events TEXT`);
  },
  // -> user_version 8: saved (named, encrypted) Render API keys for re-use
  (d) => {
    d.exec(`
      CREATE TABLE render_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        key_ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 9: encrypted key/value app settings (e.g. shared DB cluster URL)
  (d) => {
    d.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 10: organizations, memberships, invites; org-scope ownership
  (d) => {
    d.exec(`
      CREATE TABLE organizations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memberships (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        org_id  INTEGER NOT NULL REFERENCES organizations(id),
        role    TEXT NOT NULL CHECK(role IN ('owner','manager','deployer','viewer')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE org_invites (
        id INTEGER PRIMARY KEY,
        org_id     INTEGER NOT NULL REFERENCES organizations(id),
        email      TEXT,
        token_hash TEXT UNIQUE NOT NULL,
        role       TEXT NOT NULL CHECK(role IN ('owner','manager','deployer','viewer')),
        invited_by  INTEGER REFERENCES users(id),
        accepted_by INTEGER REFERENCES users(id),
        accepted_at TEXT,
        expires_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      ALTER TABLE resource_ownership ADD COLUMN org_id INTEGER REFERENCES organizations(id);
      CREATE INDEX idx_memberships_org_id        ON memberships(org_id);
      CREATE INDEX idx_resource_ownership_org_id ON resource_ownership(org_id);
    `);

    // Backfill: one org per existing user, owner membership, stamp ownership rows.
    const now = new Date().toISOString();
    const users = d.prepare("SELECT id, name, email FROM users").all();
    const insOrg = d.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?,?,?)");
    const insMem = d.prepare("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?,?,?,?)");
    const updOwn = d.prepare("UPDATE resource_ownership SET org_id = ? WHERE user_id = ?");
    const slugTaken = d.prepare("SELECT 1 FROM organizations WHERE slug = ?");
    for (const u of users) {
      const base = slugify(u.name || (u.email || "").split("@")[0] || `user-${u.id}`);
      let slug = base, n = 1;
      while (slugTaken.get(slug)) { n += 1; slug = `${base}-${n}`; } // never -1; -2, -3, …
      const orgId = insOrg.run(u.name || u.email || `User ${u.id}`, slug, now).lastInsertRowid;
      insMem.run(u.id, orgId, "owner", now);
      updOwn.run(orgId, u.id);
    }

    // Validation — throw (rolls back the migration transaction) if backfill is incomplete.
    const noMem = d.prepare("SELECT COUNT(*) c FROM users u LEFT JOIN memberships m ON m.user_id=u.id WHERE m.user_id IS NULL").get().c;
    const nullOrg = d.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NULL").get().c;
    if (noMem || nullOrg) {
      throw new Error(`migration 10 backfill incomplete: ${noMem} users without org, ${nullOrg} ownership rows without org`);
    }
  },
  // -> user_version 11: org billing columns, credit ledger, resource plan_id
  (d) => {
    d.exec(`
      ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;   -- cus_…, nullable until first top-up
      ALTER TABLE organizations ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'ok'
                                 CHECK(billing_status IN ('ok','arrears'));

      -- Append-only wallet ledger. balance = SUM(amount_pence). topup/refund rows
      -- are positive; hardware_charge/usage/adjustment rows may be negative.
      CREATE TABLE credit_ledger (
        id                       INTEGER PRIMARY KEY,
        org_id                   INTEGER NOT NULL REFERENCES organizations(id),
        amount_pence             INTEGER NOT NULL,        -- signed; GBP minor units
        type                     TEXT NOT NULL CHECK(type IN ('topup','hardware_charge','usage','refund','adjustment')),
        stripe_session_id        TEXT UNIQUE,             -- checkout.session.id; idempotency guard
        stripe_payment_intent_id TEXT UNIQUE,             -- pi_…; idempotency guard (unused in prepaid-only MVP; kept for refunds)
        period                   TEXT,                    -- 'YYYY-MM' for hardware_charge/usage; null otherwise
        notes                    TEXT,
        created_at               TEXT NOT NULL
      );
      CREATE INDEX idx_credit_ledger_org ON credit_ledger(org_id, created_at);

      -- Lets the monthly charge be computed without calling Coolify. NULL → £0 until set.
      ALTER TABLE resource_ownership ADD COLUMN plan_id TEXT;
    `);

    // Validation — throw (rolls back the migration transaction) if the ALTERs didn't apply.
    d.prepare("SELECT COUNT(*) FROM credit_ledger").get(); // table exists, 0 rows is fine
    const bad = d.prepare("SELECT COUNT(*) c FROM organizations WHERE billing_status NOT IN ('ok','arrears')").get().c;
    if (bad) throw new Error(`migration 11: ${bad} orgs with invalid billing_status`);
  },
  // -> user_version 12: usage_events (compute metering by uptime; denormalised rate)
  (d) => {
    d.exec(`
      CREATE TABLE usage_events (
        id                   INTEGER PRIMARY KEY,
        org_id               INTEGER NOT NULL REFERENCES organizations(id),
        coolify_uuid         TEXT NOT NULL,
        type                 TEXT NOT NULL CHECK(type IN ('application','database','service')),
        plan_id              TEXT NOT NULL,
        price_pence_per_hour INTEGER NOT NULL,   -- GBP rate frozen at write time (mid-period plan change bills each segment correctly)
        sampled_at           TEXT NOT NULL,
        interval_sec         INTEGER NOT NULL DEFAULT 60
      );
      CREATE INDEX idx_usage_events_org_period ON usage_events(org_id, sampled_at);
    `);
    // No backfill: there is no historical usage. No UNIQUE — the tick's reentrancy
    // guard is the duplicate-suppression, not the schema.
  },
  // -> user_version 13: org billing information (for statements / invoices)
  (d) => {
    d.exec(`
      ALTER TABLE organizations ADD COLUMN billing_email   TEXT;
      ALTER TABLE organizations ADD COLUMN billing_company TEXT;
      ALTER TABLE organizations ADD COLUMN billing_vat     TEXT;
    `);
  },
  // -> user_version 14: billing postal address (multi-line)
  (d) => {
    d.exec(`ALTER TABLE organizations ADD COLUMN billing_address TEXT;`);
  },
  // -> user_version 15: who created each ledger row (null = system/webhook)
  (d) => {
    d.exec(`ALTER TABLE credit_ledger ADD COLUMN created_by INTEGER REFERENCES users(id);`);
  },
  // -> user_version 16: API key scope ('full' = act as owner; 'read' = GET-only)
  (d) => {
    d.exec(`ALTER TABLE api_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';`);
  },
  // -> user_version 17: per-service auto-deploy toggle (push webhook skips when 0).
  // Default 1 keeps the pre-existing "every push deploys" behaviour.
  (d) => {
    d.exec(`ALTER TABLE resource_ownership ADD COLUMN auto_deploy INTEGER NOT NULL DEFAULT 1;`);
  },
  // -> user_version 18: panel-native projects + environments; resource placement + kind
  (d) => {
    d.exec(`
      CREATE TABLE projects (
        id         INTEGER PRIMARY KEY,
        org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(org_id, slug)
      );
      CREATE TABLE environments (
        id         INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, slug)
      );
      ALTER TABLE resource_ownership ADD COLUMN environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL;
      ALTER TABLE resource_ownership ADD COLUMN kind TEXT NOT NULL DEFAULT 'web_service'
        CHECK(kind IN ('web_service','background_worker','cron_job','static_site','postgres','key_value'));
      CREATE INDEX idx_projects_org         ON projects(org_id);
      CREATE INDEX idx_environments_project ON environments(project_id);
      CREATE INDEX idx_resource_env         ON resource_ownership(environment_id);
    `);

    // Generic backfill: per org that owns resources, a Default project + Production env,
    // place all its resources there; databases get kind='postgres' (naive; editable later).
    const now = new Date().toISOString();
    const orgIds = d.prepare("SELECT DISTINCT org_id FROM resource_ownership WHERE org_id IS NOT NULL").all().map((r) => r.org_id);
    const insProj = d.prepare("INSERT INTO projects (org_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)");
    const insEnv  = d.prepare("INSERT INTO environments (project_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)");
    const place   = d.prepare("UPDATE resource_ownership SET environment_id = ? WHERE org_id = ? AND environment_id IS NULL");
    for (const orgId of orgIds) {
      const projId = insProj.run(orgId, "Default", "default", now, now).lastInsertRowid;
      const envId  = insEnv.run(projId, "Production", "production", now, now).lastInsertRowid;
      place.run(envId, orgId);
    }
    d.exec("UPDATE resource_ownership SET kind = 'postgres' WHERE type = 'database'");

    // Validation — throw (rolls back the migration) if anything is left unplaced.
    const unplaced = d.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NOT NULL AND environment_id IS NULL").get().c;
    if (unplaced) throw new Error(`migration 18 backfill incomplete: ${unplaced} owned resources unplaced`);
  },
  // -> user_version 19: per-service notification preference ('default' = use the
  // owner's workspace webhook settings, 'failures' = only failure events, 'off' = mute).
  (d) => {
    d.exec(`ALTER TABLE resource_ownership ADD COLUMN notify_pref TEXT NOT NULL DEFAULT 'default'
      CHECK(notify_pref IN ('default','failures','off'));`);
  },
  // -> user_version 20: correct database rows mis-stored as a non-DB kind by an early
  // claim-on-place (which defaulted kind='web_service'). A database is never a web service.
  (d) => {
    d.exec("UPDATE resource_ownership SET kind = 'postgres' WHERE type = 'database' AND kind NOT IN ('postgres','key_value')");
  },
  // -> user_version 21: time-series metrics samples (CPU/mem/net) for graphs.
  // Sampled every 60s by the health tick; swept to 24h retention. No UNIQUE — the
  // tick's reentrancy guard is the dedupe, mirroring usage_events.
  (d) => {
    d.exec(`
      CREATE TABLE metrics_samples (
        coolify_uuid TEXT NOT NULL,
        sampled_at   TEXT NOT NULL,      -- ISO 8601, same clock as usage_events
        cpu_pct      REAL NOT NULL,      -- 0–100 (× nCPU; docker convention)
        mem_bytes    INTEGER NOT NULL,   -- used bytes
        mem_pct      REAL NOT NULL,      -- 0–100
        net_rx_bytes INTEGER,            -- cumulative from docker stats NetIO (nullable)
        net_tx_bytes INTEGER
      );
      CREATE INDEX idx_metrics_uuid_ts ON metrics_samples(coolify_uuid, sampled_at);
    `);
  },
  // -> user_version 22: org billing country. orgCurrency() already reads this column to pick
  // GBP (UK) vs USD, but it was never migrated in — so every read threw "no such column" and
  // 500'd the admin billing view (stuck spinner) + startSubscriptionCheckout. Nullable;
  // NULL keeps the default-GBP behaviour.
  (d) => {
    d.exec(`ALTER TABLE organizations ADD COLUMN billing_country TEXT;`);
  },
  // -> user_version 23: one-click DNS (Domain Connect) setup status per (org, domain, kind)
  (d) => {
    d.exec(`
      CREATE TABLE domain_dns_setup (
        id INTEGER PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('mail','hosting')),
        provider TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','manual','applied','verified','failed')),
        applied_at TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(org_id, domain, kind)
      );
    `);
  },
  // -> user_version 24: extra per-service metrics (disk I/O, PIDs) + host capacity samples
  (d) => {
    d.exec(`
      ALTER TABLE metrics_samples ADD COLUMN block_read_bytes INTEGER;
      ALTER TABLE metrics_samples ADD COLUMN block_write_bytes INTEGER;
      ALTER TABLE metrics_samples ADD COLUMN pids INTEGER;
      CREATE TABLE host_samples (
        sampled_at      TEXT NOT NULL,
        cpu_pct         REAL,              -- 1-min loadavg / cores * 100
        mem_used_bytes  INTEGER,
        mem_total_bytes INTEGER,
        disk_used_bytes INTEGER,
        disk_total_bytes INTEGER
      );
      CREATE INDEX idx_host_samples_ts ON host_samples(sampled_at);
    `);
  },
  // -> user_version 25: email-hosting ownership + billing (domain → org, mailbox → org).
  // Mailboxes tracked here so the monthly charge (sync) counts them without a live
  // mailcow call; mailcow stays the source of truth for the mailboxes themselves.
  (d) => {
    d.exec(`
      CREATE TABLE mail_domains (
        domain     TEXT PRIMARY KEY,
        org_id     INTEGER REFERENCES organizations(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE mail_mailboxes (
        address    TEXT PRIMARY KEY,
        domain     TEXT NOT NULL,
        org_id     INTEGER REFERENCES organizations(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_mail_mailboxes_org ON mail_mailboxes(org_id);
    `);
  },
];

function resolveDbFile() {
  const configured = process.env.DATABASE_FILE;
  if (configured) return configured;
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(serverDir, "data", "debut.db");
}

function openDb() {
  const file = resolveDbFile();
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("foreign_keys = ON");
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 5000");
  migrate(d);
  return d;
}

function migrate(d) {
  const version = d.pragma("user_version", { simple: true });
  for (let i = version; i < MIGRATIONS.length; i++) {
    const run = d.transaction(() => {
      MIGRATIONS[i](d);
      d.pragma(`user_version = ${i + 1}`);
    });
    run();
  }
}

export const db = openDb();

// --- user + identity queries -------------------------------------------------

export function createUser({ email, name = null, avatar_url = null, role = "customer" }) {
  const info = db
    .prepare("INSERT INTO users (email, name, avatar_url, role, created_at) VALUES (?,?,?,?,?)")
    .run(email, name, avatar_url, role, new Date().toISOString());
  return getUserById(info.lastInsertRowid);
}

// --- saved Render API keys (encrypted at rest; scoped to the owning user) -----
export function createRenderCredential({ userId, name, keyCiphertext }) {
  const info = db
    .prepare("INSERT INTO render_credentials (user_id, name, key_ciphertext, created_at) VALUES (?,?,?,?)")
    .run(userId, name, keyCiphertext, new Date().toISOString());
  return { id: info.lastInsertRowid, name };
}
// List NEVER returns the ciphertext — only id/name/created_at.
export function listRenderCredentials(userId) {
  return db.prepare("SELECT id, name, created_at FROM render_credentials WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}
// Scoped to userId → no cross-tenant read of another user's key.
export function getRenderCredential(userId, id) {
  return db.prepare("SELECT * FROM render_credentials WHERE user_id = ? AND id = ?").get(userId, id);
}
export function deleteRenderCredential(userId, id) {
  return db.prepare("DELETE FROM render_credentials WHERE user_id = ? AND id = ?").run(userId, id).changes;
}

// --- key/value app settings (store encrypted values like the shared cluster URL) --
export function getSetting(key) {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? null;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value, new Date().toISOString());
  return value;
}

// ── One-click DNS (Domain Connect) setup status ────────────────────────────────
export function upsertDnsSetup({ orgId, domain, kind, provider = null, status }) {
  const org = orgId ?? "";
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO domain_dns_setup (org_id, domain, kind, provider, status, applied_at, created_at)
    VALUES (@org, @domain, @kind, @provider, @status, @applied, @now)
    ON CONFLICT(org_id, domain, kind) DO UPDATE SET
      provider = excluded.provider,
      status = excluded.status,
      applied_at = CASE WHEN excluded.status = 'applied' AND domain_dns_setup.applied_at IS NULL
                        THEN excluded.applied_at
                        ELSE domain_dns_setup.applied_at END
  `).run({ org, domain, kind, provider, status, now, applied: status === "applied" ? now : null });
}

export function getDnsSetup(orgId, domain, kind) {
  return db.prepare(
    "SELECT * FROM domain_dns_setup WHERE org_id = ? AND domain = ? AND kind = ?"
  ).get(orgId ?? "", domain, kind);
}

export function setDnsSetupStatus({ orgId, domain, kind, status, verified = false }) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE domain_dns_setup
       SET status = @status,
           applied_at = CASE WHEN @status = 'applied' AND applied_at IS NULL THEN @now ELSE applied_at END,
           verified_at = CASE WHEN @verified = 1 THEN @now ELSE verified_at END
     WHERE org_id = @org AND domain = @domain AND kind = @kind
  `).run({ org: orgId ?? "", domain, kind, status, verified: verified ? 1 : 0, now });
}

// Idempotent: returns the existing user for this email, or creates one.
export function seedUser(fields) {
  return getUserByEmail(fields.email) || createUser(fields);
}

export const getUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
export const getUserByEmail = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email);
export const listUsers = () => db.prepare("SELECT * FROM users ORDER BY id").all();

export const getIdentity = (provider, providerUserId) =>
  db.prepare("SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?").get(provider, providerUserId);

export const getUserByIdentity = (provider, providerUserId) =>
  db
    .prepare(
      "SELECT users.* FROM users JOIN identities ON identities.user_id = users.id " +
        "WHERE identities.provider = ? AND identities.provider_user_id = ?"
    )
    .get(provider, providerUserId);

export function upsertIdentity({ provider, provider_user_id, user_id }) {
  db.prepare(
    "INSERT INTO identities (provider, provider_user_id, user_id, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id"
  ).run(provider, provider_user_id, user_id, new Date().toISOString());
}

// --- github installation + customer project helpers -------------------------

export function setInstallation({ userId, installationId, accountLogin = null }) {
  db.prepare(
    "INSERT INTO github_installations (user_id, installation_id, account_login, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET installation_id = excluded.installation_id, account_login = excluded.account_login, created_at = excluded.created_at"
  ).run(userId, installationId, accountLogin, new Date().toISOString());
}

export const getInstallation = (userId) =>
  db.prepare("SELECT * FROM github_installations WHERE user_id = ?").get(userId);

export const deleteInstallation = (userId) =>
  db.prepare("DELETE FROM github_installations WHERE user_id = ?").run(userId);

export function setCustomerProject({ userId, projectUuid, environmentName }) {
  db.prepare(
    "INSERT INTO customer_projects (user_id, project_uuid, environment_name, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET project_uuid = excluded.project_uuid, environment_name = excluded.environment_name, created_at = excluded.created_at"
  ).run(userId, projectUuid, environmentName, new Date().toISOString());
}

export const getCustomerProject = (userId) =>
  db.prepare("SELECT * FROM customer_projects WHERE user_id = ?").get(userId);

// reverse identity lookup: a user's linked account for a provider (used to
// verify a GitHub App installation belongs to the signed-in user).
export const getIdentityByUser = (userId, provider) =>
  db.prepare("SELECT * FROM identities WHERE user_id = ? AND provider = ?").get(userId, provider);

// --- one-time OAuth/install state nonces ------------------------------------

export function createOauthState({ state, userId }) {
  db.prepare("INSERT INTO oauth_states (state, user_id, created_at) VALUES (?,?,?)").run(
    state,
    userId,
    new Date().toISOString()
  );
}

// Single-use: returns the row (or undefined) and deletes it.
export function consumeOauthState(state) {
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
  if (row) db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return row;
}

// --- programmatic API tokens (hashed at rest) -------------------------------

const hashToken = (raw) => createHash("sha256").update(raw).digest("hex");

// Returns { id, token } — the raw token is shown ONCE and never stored.
// scope: 'full' (act as owner) or 'read' (GET-only); anything else coerces to 'full'.
export function createApiToken(userId, name, scope = "full") {
  const token = "dd_" + randomBytes(24).toString("hex");
  const info = db
    .prepare("INSERT INTO api_tokens (user_id, name, token_hash, scope, created_at) VALUES (?,?,?,?,?)")
    .run(userId, name || null, hashToken(token), scope === "read" ? "read" : "full", new Date().toISOString());
  return { id: info.lastInsertRowid, token };
}

// Resolve a raw bearer token to its user (stamps last_used_at). Returns the user
// with the token's scope attached as `tokenScope`, or undefined if unknown.
export function getUserByApiToken(rawToken) {
  if (!rawToken) return undefined;
  const row = db.prepare("SELECT * FROM api_tokens WHERE token_hash = ?").get(hashToken(rawToken));
  if (!row) return undefined;
  db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  const user = getUserById(row.user_id);
  return user && { ...user, tokenScope: row.scope || "full" };
}

export const listApiTokens = (userId) =>
  db.prepare("SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC").all(userId);

export const deleteApiToken = (userId, id) =>
  db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId);

// --- multi-installation helpers (user_installations table) -------------------

export function addUserInstallation({ userId, installationId, accountLogin = null, accountId = null }) {
  db.prepare(
    "INSERT INTO user_installations (user_id, installation_id, account_login, account_id, created_at) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(user_id, installation_id) DO UPDATE SET account_login = excluded.account_login, account_id = excluded.account_id"
  ).run(userId, installationId, accountLogin, accountId, new Date().toISOString());
}

export const listUserInstallations = (userId) =>
  db.prepare("SELECT * FROM user_installations WHERE user_id = ? ORDER BY id").all(userId);

export const findUserInstallationByAccount = (userId, accountId) =>
  db.prepare("SELECT * FROM user_installations WHERE user_id = ? AND account_id = ?").get(userId, accountId);

export const findUserInstallationByLogin = (userId, accountLogin) =>
  db.prepare("SELECT * FROM user_installations WHERE user_id = ? AND account_login = ? COLLATE NOCASE").get(userId, accountLogin);

// --- organizations, memberships, invites ------------------------------------

const nowIso = () => new Date().toISOString();

function uniqueSlug(base) {
  const taken = db.prepare("SELECT 1 FROM organizations WHERE slug = ?");
  let slug = base, n = 1;
  while (taken.get(slug)) { n += 1; slug = `${base}-${n}`; }
  return slug;
}

// Idempotent: returns the user's org_id, creating org + owner membership +
// backfilling their ownership rows on first call. Mirrors migration 10's backfill
// for the runtime (new-signup) path. ponytail: two backfill sites (migration is
// one-shot, this is runtime) — kept separate because `db` isn't assigned yet during migration.
export function ensureUserOrg(userId) {
  const existing = getMembership(userId);
  if (existing) return existing.org_id;
  const user = getUserById(userId);
  const base = slugify(user?.name || (user?.email || "").split("@")[0] || `user-${userId}`);
  const slug = uniqueSlug(base);
  const orgId = db
    .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?,?,?)")
    .run(user?.name || user?.email || `User ${userId}`, slug, nowIso()).lastInsertRowid;
  addMembership(userId, orgId, "owner");
  db.prepare("UPDATE resource_ownership SET org_id = ? WHERE user_id = ? AND org_id IS NULL").run(orgId, userId);
  return orgId;
}

export const getMembership = (userId) =>
  db.prepare("SELECT user_id, org_id, role FROM memberships WHERE user_id = ?").get(userId);

export function addMembership(userId, orgId, role) {
  db.prepare("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?,?,?,?)")
    .run(userId, orgId, role, nowIso());
}

export const listOrgMembers = (orgId) =>
  db.prepare(
    "SELECT u.id, u.email, u.name, u.avatar_url, m.role, m.created_at " +
      "FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at"
  ).all(orgId);

export const countOrgOwners = (orgId) =>
  db.prepare("SELECT COUNT(*) c FROM memberships WHERE org_id = ? AND role = 'owner'").get(orgId).c;

export const setMemberRole = (userId, role) =>
  db.prepare("UPDATE memberships SET role = ? WHERE user_id = ?").run(role, userId).changes;

export const removeMembership = (userId) =>
  db.prepare("DELETE FROM memberships WHERE user_id = ?").run(userId).changes;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Returns the RAW token once; only its hash is stored.
export function createInvite({ orgId, email = null, role, invitedBy }) {
  const token = "in_" + randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const id = db
    .prepare(
      "INSERT INTO org_invites (org_id, email, token_hash, role, invited_by, expires_at, created_at) " +
        "VALUES (?,?,?,?,?,?,?)"
    )
    .run(orgId, email, hashToken(token), role, invitedBy, expires, nowIso()).lastInsertRowid;
  return { id, token };
}

export const getValidInvite = (rawToken) => {
  if (!rawToken) return undefined;
  return db
    .prepare(
      "SELECT * FROM org_invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?"
    )
    .get(hashToken(rawToken), nowIso());
};

export const markInviteAccepted = (inviteId, userId) =>
  db.prepare("UPDATE org_invites SET accepted_by = ?, accepted_at = ? WHERE id = ?")
    .run(userId, nowIso(), inviteId);

export const listPendingInvites = (orgId) =>
  db.prepare(
    "SELECT id, email, role, created_at, expires_at FROM org_invites " +
      "WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC"
  ).all(orgId, nowIso());

export const deleteInvite = (orgId, id) =>
  db.prepare("DELETE FROM org_invites WHERE id = ? AND org_id = ?").run(id, orgId).changes;

export const listOrgsWithCounts = () =>
  db.prepare(`
    SELECT o.id, o.name, o.slug, o.created_at, o.billing_status,
      (SELECT COALESCE(SUM(amount_pence),0) FROM credit_ledger cl WHERE cl.org_id = o.id) AS balance_pence,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id AND m.role = 'owner') AS owners,
      (SELECT COUNT(*) FROM resource_ownership r WHERE r.org_id = o.id AND r.type = 'application') AS applications,
      (SELECT COUNT(*) FROM resource_ownership r WHERE r.org_id = o.id AND r.type = 'database') AS databases
    FROM organizations o ORDER BY o.created_at DESC
  `).all();

export const getOrgDetail = (orgId) => {
  const org = db.prepare("SELECT id, name, slug, created_at FROM organizations WHERE id = ?").get(orgId);
  if (!org) return undefined;
  return {
    org,
    members: listOrgMembers(orgId),
    ownedApplications: db.prepare("SELECT coolify_uuid FROM resource_ownership WHERE org_id = ? AND type = 'application'").all(orgId).map((r) => r.coolify_uuid),
    ownedDatabases: db.prepare("SELECT coolify_uuid FROM resource_ownership WHERE org_id = ? AND type = 'database'").all(orgId).map((r) => r.coolify_uuid),
  };
};

// Every resource an org owns, with its assigned plan (null = free tier).
export const listOrgResources = (orgId) =>
  db.prepare("SELECT type, coolify_uuid, plan_id, created_at FROM resource_ownership WHERE org_id = ? ORDER BY type, created_at").all(orgId);

// Org billing information (for statements / invoices). All fields nullable.
export const getOrgBillingInfo = (orgId) =>
  db.prepare("SELECT billing_email, billing_company, billing_vat, billing_address FROM organizations WHERE id = ?").get(orgId);

export const setOrgBillingInfo = (orgId, { email = null, company = null, vat = null, address = null }) =>
  db.prepare("UPDATE organizations SET billing_email = ?, billing_company = ?, billing_vat = ?, billing_address = ? WHERE id = ?")
    .run(email, company, vat, address, orgId).changes;

// --- projects & environments (panel-native grouping) ------------------------

const notFound = (m = "Not found") => Object.assign(new Error(m), { status: 404 });

function uniqueEnvSlug(projectId, base) {
  const taken = db.prepare("SELECT 1 FROM environments WHERE project_id = ? AND slug = ?");
  let slug = base, n = 1;
  while (taken.get(projectId, slug)) { n += 1; slug = `${base}-${n}`; }
  return slug;
}

export function createProject(orgId, name) {
  // orgId is NOT NULL in the schema; guard so an admin (org context = null) gets a clean
  // 400 instead of a raw NOT NULL constraint 500. Admins must act within an org context.
  if (!orgId) throw Object.assign(new Error("An organization context is required"), { status: 400 });
  const slug = slugify(name);
  // Enforce the UNIQUE(org_id, slug) exactly (no silent suffixing on create — callers
  // want a clear "already exists" error). uniqueProjectSlug is used only for backfill/default.
  const exists = db.prepare("SELECT 1 FROM projects WHERE org_id = ? AND slug = ?").get(orgId, slug);
  if (exists) throw Object.assign(new Error("A project with that name already exists"), { status: 409 });
  const now = nowIso();
  const id = db.prepare("INSERT INTO projects (org_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(orgId, name, slug, now, now).lastInsertRowid;
  return { id, name, slug };
}

export const listProjects = (orgId) =>
  db.prepare("SELECT id, name, slug, created_at FROM projects WHERE org_id = ? ORDER BY created_at").all(orgId);

export const getProject = (orgId, id) =>
  db.prepare("SELECT id, name, slug, created_at FROM projects WHERE org_id = ? AND id = ?").get(orgId, id);

export function renameProject(orgId, id, name) {
  const newSlug = slugify(name);
  // Pre-check: reject if another project in the same org already has this slug
  const collision = db.prepare("SELECT 1 FROM projects WHERE org_id = ? AND slug = ? AND id != ?")
    .get(orgId, newSlug, id);
  if (collision) throw Object.assign(new Error("A project with that name already exists"), { status: 409 });
  return db.prepare("UPDATE projects SET name = ?, slug = ?, updated_at = ? WHERE org_id = ? AND id = ?")
    .run(name, newSlug, nowIso(), orgId, id).changes;
}

export const deleteProject = (orgId, id) =>
  db.prepare("DELETE FROM projects WHERE org_id = ? AND id = ?").run(orgId, id).changes;

// Master-admin only: move a whole project + its resources to another user's org.
// Panel-native metadata move — nothing on Coolify changes, so no redeploy/downtime.
// Repoints authz+billing (org_id) AND creator (user_id) for every resource placed in
// the project's environments; environments follow via their project_id FK. Returns the
// count of resources moved and the (possibly suffixed) slug used in the destination org.
export function transferProject(projectId, targetUserId) {
  const proj = db.prepare("SELECT id, org_id, name, slug FROM projects WHERE id = ?").get(projectId);
  if (!proj) throw notFound();
  if (!getUserById(targetUserId)) throw Object.assign(new Error("Target user not found"), { status: 404 });
  const targetOrg = ensureUserOrg(targetUserId); // resolves or creates the target user's org
  if (targetOrg === proj.org_id) return { moved: 0, project: proj.id, slug: proj.slug, org_id: targetOrg };
  // Collision-safe slug in the destination org (UNIQUE(org_id, slug)).
  let slug = proj.slug;
  for (let n = 2; db.prepare("SELECT 1 FROM projects WHERE org_id = ? AND slug = ?").get(targetOrg, slug); n++) {
    slug = `${proj.slug}-${n}`;
  }
  const now = nowIso();
  const run = db.transaction(() => {
    const moved = db.prepare(`UPDATE resource_ownership SET org_id = ?, user_id = ?
      WHERE environment_id IN (SELECT id FROM environments WHERE project_id = ?)`)
      .run(targetOrg, targetUserId, projectId).changes;
    db.prepare("UPDATE projects SET org_id = ?, slug = ?, updated_at = ? WHERE id = ?")
      .run(targetOrg, slug, now, projectId);
    return moved;
  });
  return { moved: run(), project: projectId, slug, org_id: targetOrg };
}

// Validates the project belongs to the org before creating the env under it.
export function createEnvironment(orgId, projectId, name) {
  const proj = db.prepare("SELECT id FROM projects WHERE org_id = ? AND id = ?").get(orgId, projectId);
  if (!proj) throw notFound();
  const slug = uniqueEnvSlug(projectId, slugify(name));
  const now = nowIso();
  const id = db.prepare("INSERT INTO environments (project_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(projectId, name, slug, now, now).lastInsertRowid;
  return { id, name, slug };
}

// NOTE: not org-scoped by design — callers MUST gate with getProject(orgId, projectId) first (buildProjectDetail does). Never call with an untrusted projectId.
export const listEnvironments = (projectId) =>
  db.prepare("SELECT id, name, slug FROM environments WHERE project_id = ? ORDER BY (slug='production') DESC, name").all(projectId);

export const renameEnvironment = (orgId, envId, name) =>
  db.prepare(`UPDATE environments SET name = ?, slug = ?, updated_at = ?
              WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)`)
    .run(name, slugify(name), nowIso(), envId, orgId).changes;

export const deleteEnvironment = (orgId, envId) =>
  db.prepare(`DELETE FROM environments WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)`)
    .run(envId, orgId).changes;

// Env → project → org, in one row. Used by the placement service's target check.
export const getEnvironmentWithOrg = (envId) =>
  db.prepare(`SELECT e.id, e.project_id, p.org_id
              FROM environments e JOIN projects p ON p.id = e.project_id WHERE e.id = ?`).get(envId);

// Idempotent Default project + Production env for an org (first-login / empty state).
export function ensureDefaultProjectEnv(orgId) {
  let proj = db.prepare("SELECT id FROM projects WHERE org_id = ? AND slug = 'default'").get(orgId);
  if (!proj) {
    const now = nowIso();
    const id = db.prepare("INSERT INTO projects (org_id, name, slug, created_at, updated_at) VALUES (?, 'Default', 'default', ?, ?)")
      .run(orgId, now, now).lastInsertRowid;
    proj = { id };
  }
  let env = db.prepare("SELECT id FROM environments WHERE project_id = ? AND slug = 'production'").get(proj.id);
  if (!env) {
    const now = nowIso();
    const id = db.prepare("INSERT INTO environments (project_id, name, slug, created_at, updated_at) VALUES (?, 'Production', 'production', ?, ?)")
      .run(proj.id, now, now).lastInsertRowid;
    env = { id };
  }
  return { projectId: proj.id, environmentId: env.id };
}

// --- email hosting: domain/mailbox ownership + billing counts ------------------
export const setMailDomainOrg = (domain, orgId) =>
  db.prepare("INSERT INTO mail_domains (domain, org_id, created_at) VALUES (?,?,?) " +
    "ON CONFLICT(domain) DO UPDATE SET org_id = excluded.org_id").run(domain, orgId ?? null, nowIso());

export const getMailDomainOrg = (domain) =>
  db.prepare("SELECT org_id FROM mail_domains WHERE domain = ?").get(domain)?.org_id ?? null;

export const listMailDomainOrgs = () =>
  db.prepare("SELECT domain, org_id FROM mail_domains").all();

// Domain removed → drop it and its mailbox rows (mailcow cascades the real mailboxes).
export const deleteMailDomainRow = (domain) => {
  db.prepare("DELETE FROM mail_mailboxes WHERE domain = ?").run(domain);
  db.prepare("DELETE FROM mail_domains WHERE domain = ?").run(domain);
};

export const addMailboxRow = (address, domain, orgId) =>
  db.prepare("INSERT INTO mail_mailboxes (address, domain, org_id, created_at) VALUES (?,?,?,?) " +
    "ON CONFLICT(address) DO UPDATE SET domain = excluded.domain, org_id = excluded.org_id")
    .run(address, domain, orgId ?? null, nowIso());

export const deleteMailboxRow = (address) =>
  db.prepare("DELETE FROM mail_mailboxes WHERE address = ?").run(address);

export const orgMailboxCount = (orgId) =>
  db.prepare("SELECT COUNT(*) c FROM mail_mailboxes WHERE org_id = ?").get(orgId).c;
