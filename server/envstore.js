// Encrypted mirror of env values set THROUGH the panel (or a migration), so the
// editor can show values and "reveal secret" works. Coolify's REST API never
// returns env VALUES (encrypted at rest, hidden) nor a reliable is_secret flag —
// so we capture the plaintext + secret flag at write time and merge it back on read.
//
// Coverage is capture-on-write: envs set outside the panel aren't here
// (revealable=false, value blank) until they're next saved through the panel.
import { db } from "./db.js";
import { encryptSecret, decryptSecret } from "./secretbox.js";

// Own table, created OUTSIDE db.js's user_version ladder — keeps this feature
// self-contained (and off the in-progress org migration). CREATE IF NOT EXISTS is
// idempotent. // ponytail: not a ladder migration; fine for an additive table.
db.exec(`CREATE TABLE IF NOT EXISTS env_secrets (
  app_uuid   TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  val_enc    TEXT    NOT NULL,
  is_secret  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_uuid, key)
)`);

const _upsert = db.prepare(`INSERT INTO env_secrets (app_uuid, key, val_enc, is_secret, updated_at)
  VALUES (@a, @k, @v, @s, datetime('now'))
  ON CONFLICT(app_uuid, key) DO UPDATE SET val_enc=@v, is_secret=@s, updated_at=datetime('now')`);
const _get = db.prepare(`SELECT val_enc, is_secret FROM env_secrets WHERE app_uuid=? AND key=?`);
const _all = db.prepare(`SELECT key, val_enc, is_secret FROM env_secrets WHERE app_uuid=?`);
const _del = db.prepare(`DELETE FROM env_secrets WHERE app_uuid=? AND key=?`);

// Capture a value (encrypted) as it's written to Coolify. Null values are skipped.
export function rememberEnv(appUuid, key, value, isSecret) {
  if (value == null) return;
  _upsert.run({ a: String(appUuid), k: String(key), v: encryptSecret(String(value)), s: isSecret ? 1 : 0 });
}

// Decrypt a single stored value (for the on-demand reveal endpoint), or null.
export function revealEnv(appUuid, key) {
  const r = _get.get(String(appUuid), String(key));
  return r ? decryptSecret(r.val_enc) : null;
}

// key → { value, is_secret } for every stored env of an app, for merging over
// Coolify's (value-less) env listing.
export function storedEnvs(appUuid) {
  const m = new Map();
  for (const r of _all.all(String(appUuid))) m.set(r.key, { value: decryptSecret(r.val_enc), is_secret: !!r.is_secret });
  return m;
}

export function forgetEnv(appUuid, key) {
  _del.run(String(appUuid), String(key));
}
