// Variable Groups — named, reusable sets of env vars that can be attached to
// services. Coolify has no shared/grouped-variable API (see sharedvars.js), so
// the group is panel-native: we hold the canonical copy here and PUSH the keys
// into each attached application's own env (coolify.upsertEnv), removing them
// again on detach. That means an attached group behaves exactly like per-service
// env — including surviving a Coolify-side deploy — with the panel as the editor.
//
// Values are encrypted at rest (same box as envstore) so secrets never sit in
// plaintext in the SQLite file.
//
// ponytail: pushes are per-key HTTP calls to Coolify; a very large group attached
// to many services is O(vars × services) requests. Fine at fleet scale, revisit
// if groups grow past a few dozen keys.

import { db } from "./db.js";
import { encryptSecret, decryptSecret } from "./secretbox.js";
import * as coolify from "./coolify.js";
import { forgetEnv } from "./envstore.js";

// Own tables, created outside db.js's user_version ladder — same pattern as
// envstore.js/sharedvars.js, keeps the feature self-contained. Idempotent.
db.exec(`
  CREATE TABLE IF NOT EXISTS var_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    scope      TEXT    NOT NULL DEFAULT 'Global',
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    UNIQUE(org_id, name)
  );
  CREATE TABLE IF NOT EXISTS var_group_vars (
    group_id   INTEGER NOT NULL,
    key        TEXT    NOT NULL,
    val_enc    TEXT    NOT NULL,
    is_secret  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (group_id, key)
  );
  CREATE TABLE IF NOT EXISTS var_group_links (
    group_id     INTEGER NOT NULL,
    service_uuid TEXT    NOT NULL,
    created_at   TEXT    NOT NULL,
    PRIMARY KEY (group_id, service_uuid)
  );
  CREATE INDEX IF NOT EXISTS idx_var_group_links_service ON var_group_links(service_uuid);
`);

const nowIso = () => new Date().toISOString();
const err = (message, status) => Object.assign(new Error(message), { status });

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertKey(key) {
  const k = String(key || "").trim();
  if (!KEY_RE.test(k)) throw err("Invalid variable name — use letters, digits and _ (not starting with a digit)", 400);
  return k;
}

// --- reads -------------------------------------------------------------------

// A group row scoped to the caller's org, or a 404. Every mutation funnels
// through this, so no cross-org id can be touched.
export function getGroup(orgId, id) {
  const row = db.prepare("SELECT * FROM var_groups WHERE id = ? AND org_id = ?").get(Number(id), orgId);
  if (!row) throw err("Variable group not found", 404);
  return row;
}

// Decrypt is best-effort: a value written under an older SESSION_SECRET can't be
// read back (secretbox derives its key from it), so surface a blank rather than
// 500 the whole page.
function readVars(groupId, reveal) {
  return db
    .prepare("SELECT key, val_enc, is_secret FROM var_group_vars WHERE group_id = ? ORDER BY key")
    .all(groupId)
    .map((r) => {
      let value = "";
      if (!r.is_secret || reveal) {
        try { value = decryptSecret(r.val_enc); } catch { value = ""; }
      }
      return { key: r.key, value, is_secret: !!r.is_secret };
    });
}

const linkedUuids = (groupId) =>
  db.prepare("SELECT service_uuid FROM var_group_links WHERE group_id = ?").all(groupId).map((r) => r.service_uuid);

export function listGroups(orgId, { reveal = false } = {}) {
  return db
    .prepare("SELECT * FROM var_groups WHERE org_id = ? ORDER BY name")
    .all(orgId)
    .map((g) => ({
      id: g.id,
      name: g.name,
      scope: g.scope,
      created_at: g.created_at,
      updated_at: g.updated_at,
      vars: readVars(g.id, reveal),
      services: linkedUuids(g.id),
    }));
}

// Plaintext of every var in a group — internal only (drives the pushes below).
function plainVars(groupId) {
  return db
    .prepare("SELECT key, val_enc, is_secret FROM var_group_vars WHERE group_id = ? ORDER BY key")
    .all(groupId)
    .map((r) => {
      try { return { key: r.key, value: decryptSecret(r.val_enc), is_secret: !!r.is_secret }; }
      catch { return null; }
    })
    .filter(Boolean);
}

// --- Coolify sync ------------------------------------------------------------

// Push one key into one application. Returns null on success, an error string
// otherwise — callers aggregate rather than abort, so one dead service doesn't
// block the group edit from landing everywhere else.
async function pushKey(serviceUuid, v) {
  try {
    await coolify.upsertEnv(serviceUuid, { key: v.key, value: v.value, is_secret: v.is_secret });
    return null;
  } catch (e) {
    return `${serviceUuid}: ${e.message}`;
  }
}

async function pushVars(serviceUuid, vars) {
  const failures = [];
  for (const v of vars) {
    const f = await pushKey(serviceUuid, v);
    if (f) failures.push(f);
  }
  return failures;
}

// Remove the given keys from one application. Coolify deletes by env uuid, so we
// resolve the uuids from its env listing first.
async function removeKeys(serviceUuid, keys) {
  if (!keys.length) return [];
  const failures = [];
  let envs = [];
  try { envs = await coolify.listEnvs(serviceUuid); }
  catch (e) { return [`${serviceUuid}: ${e.message}`]; }
  for (const key of keys) {
    const hit = (envs || []).find((e) => e.key === key);
    if (!hit?.uuid) continue; // already gone (or set outside the panel)
    try {
      await coolify.deleteEnv(serviceUuid, hit.uuid);
      forgetEnv(serviceUuid, key);
    } catch (e) {
      failures.push(`${serviceUuid}: ${e.message}`);
    }
  }
  return failures;
}

// Re-push the whole group to every attached service. Called after any var edit so
// attached services never drift from the group.
async function syncGroup(groupId) {
  const vars = plainVars(groupId);
  const failures = [];
  for (const uuid of linkedUuids(groupId)) failures.push(...(await pushVars(uuid, vars)));
  return failures;
}

// --- group CRUD --------------------------------------------------------------

export async function createGroup(orgId, { name, scope = "Global", vars = [] }) {
  const clean = String(name || "").trim();
  if (!clean) throw err("Group name is required", 400);
  if (db.prepare("SELECT 1 FROM var_groups WHERE org_id = ? AND name = ?").get(orgId, clean)) {
    throw err("A variable group with that name already exists", 409);
  }
  const now = nowIso();
  const id = db
    .prepare("INSERT INTO var_groups (org_id, name, scope, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(orgId, clean, String(scope || "Global"), now, now).lastInsertRowid;
  const ins = db.prepare(
    "INSERT INTO var_group_vars (group_id, key, val_enc, is_secret, updated_at) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(group_id, key) DO UPDATE SET val_enc = excluded.val_enc, is_secret = excluded.is_secret, updated_at = excluded.updated_at"
  );
  for (const v of vars || []) {
    if (!String(v?.key || "").trim()) continue;
    ins.run(id, assertKey(v.key), encryptSecret(v.value ?? ""), v.is_secret ? 1 : 0, now);
  }
  return { id, name: clean, scope };
}

export async function updateGroup(orgId, id, { name, scope }) {
  const g = getGroup(orgId, id);
  const nextName = name === undefined ? g.name : String(name).trim();
  if (!nextName) throw err("Group name is required", 400);
  if (nextName !== g.name && db.prepare("SELECT 1 FROM var_groups WHERE org_id = ? AND name = ?").get(orgId, nextName)) {
    throw err("A variable group with that name already exists", 409);
  }
  db.prepare("UPDATE var_groups SET name = ?, scope = ?, updated_at = ? WHERE id = ?")
    .run(nextName, scope === undefined ? g.scope : String(scope), nowIso(), g.id);
  return { id: g.id, name: nextName };
}

// Deleting a group also strips its keys from every service it was attached to —
// otherwise the vars would live on invisibly with no way left to manage them.
export async function deleteGroup(orgId, id) {
  const g = getGroup(orgId, id);
  const keys = plainVars(g.id).map((v) => v.key);
  const failures = [];
  for (const uuid of linkedUuids(g.id)) failures.push(...(await removeKeys(uuid, keys)));
  db.transaction(() => {
    db.prepare("DELETE FROM var_group_links WHERE group_id = ?").run(g.id);
    db.prepare("DELETE FROM var_group_vars WHERE group_id = ?").run(g.id);
    db.prepare("DELETE FROM var_groups WHERE id = ?").run(g.id);
  })();
  return { ok: true, failures };
}

// --- variable CRUD -----------------------------------------------------------

// Upsert one or many vars, then re-sync attached services.
export async function setVars(orgId, id, input) {
  const g = getGroup(orgId, id);
  const list = (Array.isArray(input) ? input : [input]).filter((v) => String(v?.key || "").trim());
  if (!list.length) throw err("No variables supplied", 400);
  const now = nowIso();
  const ins = db.prepare(
    "INSERT INTO var_group_vars (group_id, key, val_enc, is_secret, updated_at) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(group_id, key) DO UPDATE SET val_enc = excluded.val_enc, is_secret = excluded.is_secret, updated_at = excluded.updated_at"
  );
  const rows = list.map((v) => [assertKey(v.key), encryptSecret(v.value ?? ""), v.is_secret ? 1 : 0]);
  db.transaction(() => { for (const [k, enc, s] of rows) ins.run(g.id, k, enc, s, now); })();
  db.prepare("UPDATE var_groups SET updated_at = ? WHERE id = ?").run(now, g.id);
  return { ok: true, count: rows.length, failures: await syncGroup(g.id) };
}

// Rename a key in place: drop the old key from attached services, write the new one.
export async function renameVar(orgId, id, oldKey, newKey) {
  const g = getGroup(orgId, id);
  const from = assertKey(oldKey);
  const to = assertKey(newKey);
  if (from === to) return { ok: true, failures: [] };
  const row = db.prepare("SELECT * FROM var_group_vars WHERE group_id = ? AND key = ?").get(g.id, from);
  if (!row) throw err("Variable not found", 404);
  if (db.prepare("SELECT 1 FROM var_group_vars WHERE group_id = ? AND key = ?").get(g.id, to)) {
    throw err(`${to} already exists in this group`, 409);
  }
  const failures = [];
  for (const uuid of linkedUuids(g.id)) failures.push(...(await removeKeys(uuid, [from])));
  db.prepare("UPDATE var_group_vars SET key = ?, updated_at = ? WHERE group_id = ? AND key = ?")
    .run(to, nowIso(), g.id, from);
  failures.push(...(await syncGroup(g.id)));
  return { ok: true, failures };
}

export async function deleteVar(orgId, id, key) {
  const g = getGroup(orgId, id);
  const k = String(key || "").trim();
  const info = db.prepare("DELETE FROM var_group_vars WHERE group_id = ? AND key = ?").run(g.id, k);
  if (info.changes === 0) throw err("Variable not found", 404);
  db.prepare("UPDATE var_groups SET updated_at = ? WHERE id = ?").run(nowIso(), g.id);
  const failures = [];
  for (const uuid of linkedUuids(g.id)) failures.push(...(await removeKeys(uuid, [k])));
  return { ok: true, failures };
}

// --- attach / detach ---------------------------------------------------------

// Push first, link second: a failed attach leaves no phantom membership.
export async function attachService(orgId, id, serviceUuid) {
  const g = getGroup(orgId, id);
  const uuid = String(serviceUuid || "").trim();
  if (!uuid) throw err("Service uuid is required", 400);
  const failures = await pushVars(uuid, plainVars(g.id));
  db.prepare("INSERT OR IGNORE INTO var_group_links (group_id, service_uuid, created_at) VALUES (?,?,?)")
    .run(g.id, uuid, nowIso());
  return { ok: true, failures };
}

export async function detachService(orgId, id, serviceUuid) {
  const g = getGroup(orgId, id);
  const uuid = String(serviceUuid || "").trim();
  const keys = plainVars(g.id).map((v) => v.key);
  const failures = await removeKeys(uuid, keys);
  db.prepare("DELETE FROM var_group_links WHERE group_id = ? AND service_uuid = ?").run(g.id, uuid);
  return { ok: true, failures };
}

// Which groups feed a given service — lets the service's own env editor show
// where an inherited key came from.
export function groupsForService(orgId, serviceUuid) {
  return db
    .prepare(
      "SELECT g.id, g.name FROM var_group_links l JOIN var_groups g ON g.id = l.group_id " +
        "WHERE l.service_uuid = ? AND g.org_id = ? ORDER BY g.name"
    )
    .all(String(serviceUuid), orgId);
}

// A service deleted from the panel shouldn't leave dangling links.
export function forgetService(serviceUuid) {
  db.prepare("DELETE FROM var_group_links WHERE service_uuid = ?").run(String(serviceUuid));
}
