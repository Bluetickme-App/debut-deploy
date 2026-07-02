// Migration 11: billing columns, credit_ledger, plan_id. Run: node --test server/test_billing_migration.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v10 DB with just the tables migration 11 reads/alters.
const file = path.join(os.tmpdir(), `dd-bill-mig-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE resource_ownership (
      coolify_uuid TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('application','database','service')),
      user_id INTEGER NOT NULL, org_id INTEGER, created_at TEXT NOT NULL,
      PRIMARY KEY (type, coolify_uuid)
    );
  `);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (?,?,?,?)").run(1, "Acme", "acme", now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,created_at) VALUES (?,?,?,?,?)")
    .run("app-1", "application", 1, 1, now);
  d.pragma("user_version = 10");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("organizations gains stripe_customer_id + billing_status default 'ok'", () => {
  const cols = db.prepare("PRAGMA table_info(organizations)").all().map((c) => c.name);
  assert.ok(cols.includes("stripe_customer_id"));
  assert.ok(cols.includes("billing_status"));
  const row = db.prepare("SELECT billing_status FROM organizations WHERE id=1").get();
  assert.equal(row.billing_status, "ok");
});

test("billing_status CHECK allows only ok/arrears", () => {
  assert.throws(() => db.prepare("UPDATE organizations SET billing_status='payment_failed' WHERE id=1").run());
  db.prepare("UPDATE organizations SET billing_status='arrears' WHERE id=1").run();
  db.prepare("UPDATE organizations SET billing_status='ok' WHERE id=1").run();
});

test("credit_ledger exists with UNIQUE idempotency columns", () => {
  db.prepare("INSERT INTO credit_ledger (org_id,amount_pence,type,stripe_session_id,created_at) VALUES (?,?,?,?,?)")
    .run(1, 1000, "topup", "cs_test_1", new Date().toISOString());
  assert.throws(() =>
    db.prepare("INSERT INTO credit_ledger (org_id,amount_pence,type,stripe_session_id,created_at) VALUES (?,?,?,?,?)")
      .run(1, 1000, "topup", "cs_test_1", new Date().toISOString())
  ); // UNIQUE(stripe_session_id) violated
});

test("credit_ledger type CHECK rejects unknown types", () => {
  assert.throws(() =>
    db.prepare("INSERT INTO credit_ledger (org_id,amount_pence,type,created_at) VALUES (?,?,?,?)")
      .run(1, 1, "bogus", new Date().toISOString())
  );
});

test("resource_ownership gains a nullable plan_id (NULL after ALTER)", () => {
  const cols = db.prepare("PRAGMA table_info(resource_ownership)").all().map((c) => c.name);
  assert.ok(cols.includes("plan_id"));
  const row = db.prepare("SELECT plan_id FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  assert.equal(row.plan_id, null);
});
