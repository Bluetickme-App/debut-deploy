// Migration 12 (usage_events). Run: node --test server/test_metering_migration.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v11 DB with just what migration 12's FK needs (organizations).
const file = path.join(os.tmpdir(), `dd-mig12-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.pragma("foreign_keys = ON");
  d.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
    );
  `);
  d.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?,?,?)")
    .run("Acme", "acme", new Date().toISOString());
  d.pragma("user_version = 11");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("migration ran usage_events (user_version >= 12)", () => {
  // >= 12 not == 12: later migrations (13+) also apply on a fresh migrate from v11.
  assert.ok(db.pragma("user_version", { simple: true }) >= 12);
});

test("usage_events table exists with the expected columns", () => {
  const cols = db.prepare("PRAGMA table_info(usage_events)").all().map((c) => c.name);
  for (const name of [
    "id", "org_id", "coolify_uuid", "type", "plan_id",
    "price_pence_per_hour", "sampled_at", "interval_sec",
  ]) {
    assert.ok(cols.includes(name), `missing column ${name}`);
  }
});

test("the org/period index exists", () => {
  const idx = db.prepare("PRAGMA index_list(usage_events)").all().map((i) => i.name);
  assert.ok(idx.includes("idx_usage_events_org_period"));
});

test("a usage_events row round-trips", () => {
  db.prepare(
    "INSERT INTO usage_events (org_id, coolify_uuid, type, plan_id, price_pence_per_hour, sampled_at, interval_sec) " +
      "VALUES (?,?,?,?,?,?,?)"
  ).run(1, "app-1", "application", "pro", 2, new Date().toISOString(), 60);
  const row = db.prepare("SELECT price_pence_per_hour, interval_sec FROM usage_events WHERE coolify_uuid='app-1'").get();
  assert.equal(row.price_pence_per_hour, 2);
  assert.equal(row.interval_sec, 60);
});
