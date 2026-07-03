// Migration 10 backfill: run with `node --test server/test_orgs_migration.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v9 DB with just the tables migration 10 reads/alters.
const file = path.join(os.tmpdir(), `dd-mig-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
      avatar_url TEXT, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL
    );
    CREATE TABLE resource_ownership (
      coolify_uuid TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('application','database','service')),
      user_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (type, coolify_uuid)
    );
  `);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)").run(1, "a@x.com", "Acme Ltd", "customer", now);
  d.prepare("INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)").run(2, "b@x.com", null, "admin", now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,created_at) VALUES (?,?,?,?)").run("app-1", "application", 1, now);
  // Migration 16 ALTERs api_tokens (from migration 4); this fixture jumps to v9.
  d.exec(`CREATE TABLE api_tokens (id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL);`);
  d.pragma("user_version = 9");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("every user gets exactly one owner membership", () => {
  const rows = db.prepare("SELECT user_id, role FROM memberships ORDER BY user_id").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.role === "owner"));
});

test("resource_ownership rows are backfilled with the owner's org_id", () => {
  const own = db.prepare("SELECT org_id FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  const mem = db.prepare("SELECT org_id FROM memberships WHERE user_id=1").get();
  assert.equal(own.org_id, mem.org_id);
});

test("org slug derives from name, falls back sanely", () => {
  const o1 = db.prepare("SELECT slug FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=1").get();
  const o2 = db.prepare("SELECT slug FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=2").get();
  assert.equal(o1.slug, "acme-ltd");
  assert.equal(o2.slug, "b"); // no name → email local-part
});

test("no ownership row left without an org", () => {
  assert.equal(db.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NULL").get().c, 0);
});
