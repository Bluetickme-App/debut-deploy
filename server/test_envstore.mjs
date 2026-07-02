// Env-secret mirror: capture-on-write, encrypted-at-rest, reveal-on-demand.
process.env.DATABASE_FILE = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long";

import { test } from "node:test";
import assert from "node:assert/strict";

const { rememberEnv, revealEnv, storedEnvs, forgetEnv } = await import("./envstore.js");
const { db } = await import("./db.js");

test("round-trips a captured value", () => {
  rememberEnv("app1", "API_KEY", "s3cr3t", true);
  assert.equal(revealEnv("app1", "API_KEY"), "s3cr3t");
});

test("value is encrypted at rest — plaintext never hits the row", () => {
  rememberEnv("app1", "TOKEN", "plaintext-xyz-marker", true);
  const row = db.prepare("SELECT val_enc FROM env_secrets WHERE app_uuid=? AND key=?").get("app1", "TOKEN");
  assert.ok(row && !row.val_enc.includes("plaintext-xyz-marker"), "stored value must be ciphertext, not raw");
});

test("storedEnvs maps key → {value,is_secret}; upsert overwrites in place", () => {
  rememberEnv("app2", "PORT", "3000", false);
  rememberEnv("app2", "PORT", "10000", false); // overwrite same key
  const m = storedEnvs("app2");
  assert.equal(m.get("PORT").value, "10000");
  assert.equal(m.get("PORT").is_secret, false);
  assert.equal(m.size, 1, "overwrite must not create a duplicate row");
});

test("unknown key reveals null; forget removes", () => {
  assert.equal(revealEnv("app3", "NOPE"), null);
  rememberEnv("app3", "X", "1", true);
  forgetEnv("app3", "X");
  assert.equal(revealEnv("app3", "X"), null);
});

test("null value is not stored", () => {
  rememberEnv("app4", "N", null, false);
  assert.equal(revealEnv("app4", "N"), null);
});
