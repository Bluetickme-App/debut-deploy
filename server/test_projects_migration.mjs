// Migration 18. Run: node --test server/test_projects_migration.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v17 DB with the tables migration 18 reads/alters, then seed an org + resources.
const file = path.join(os.tmpdir(), `dd-mig18-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memberships (user_id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE resource_ownership (
      coolify_uuid TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('application','database','service')),
      user_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      org_id INTEGER, plan_id TEXT, auto_deploy INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (type, coolify_uuid)
    );
  `);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (1,'Acme','acme',?)").run(now);
  d.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (1,1,'owner',?)").run(now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,created_at,org_id) VALUES ('app-1','application',1,?,1)").run(now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,created_at,org_id) VALUES ('db-1','database',1,?,1)").run(now);
  d.pragma("user_version = 17");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("creates a Default project + Production environment for the org", () => {
  const proj = db.prepare("SELECT * FROM projects WHERE org_id = 1").get();
  assert.equal(proj.name, "Default");
  assert.equal(proj.slug, "default");
  const env = db.prepare("SELECT * FROM environments WHERE project_id = ?").get(proj.id);
  assert.equal(env.name, "Production");
  assert.equal(env.slug, "production");
});

test("places every owned resource into Production and never leaves one unplaced", () => {
  const unplaced = db.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NOT NULL AND environment_id IS NULL").get().c;
  assert.equal(unplaced, 0);
});

test("naive kind: application → web_service, database → postgres", () => {
  const app = db.prepare("SELECT kind FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  const dbr = db.prepare("SELECT kind FROM resource_ownership WHERE coolify_uuid='db-1'").get();
  assert.equal(app.kind, "web_service");
  assert.equal(dbr.kind, "postgres");
});

test("kind CHECK rejects an invalid value", () => {
  assert.throws(() => db.prepare("UPDATE resource_ownership SET kind='bogus' WHERE coolify_uuid='app-1'").run());
});

test("deleting a project cascades environments and unplaces (not deletes) its resources", () => {
  const proj = db.prepare("SELECT id FROM projects WHERE org_id=1").get();
  db.prepare("DELETE FROM projects WHERE id = ?").run(proj.id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM environments WHERE project_id=?").get(proj.id).c, 0);
  const still = db.prepare("SELECT environment_id FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  assert.equal(still.environment_id, null);            // SET NULL, resource row survives
  assert.ok(db.prepare("SELECT 1 FROM resource_ownership WHERE coolify_uuid='app-1'").get());
});
