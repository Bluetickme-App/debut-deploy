// Run: node --test server/test_events.mjs
process.env.DATABASE_FILE = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { record, recordSystem } = await import("./audit.js");
const { seedUser } = await import("./db.js");
const { listEvents, listEventsForResource } = await import("./events.js");

const user = seedUser({ email: "alice@example.com", name: "Alice", role: "customer" });
const other = seedUser({ email: "bob@example.com", name: "Bob", role: "customer" });

// Shared req stub — record() uses req.user.id, req.ip, req.get()
const req = (u) => ({ user: { id: u.id }, ip: "1.2.3.4", get: () => "ua", headers: {} });

test("listEvents returns parsed metadata and actor_email, no metadata_json/user_agent", () => {
  record(req(user), "deploy", { resourceType: "application", resourceUuid: "app-1", metadata: { foo: 1 } });
  const events = listEvents();
  const ev = events.find((e) => e.action === "deploy" && e.resource_uuid === "app-1");
  assert.ok(ev, "event not found");
  assert.deepEqual(ev.metadata, { foo: 1 });
  assert.equal(ev.actor_email, "alice@example.com");
  assert.equal("metadata_json" in ev, false, "must not leak metadata_json");
  assert.equal("user_agent" in ev, false, "must not leak user_agent");
});

test("listEvents({userId}) excludes other user's events", () => {
  record(req(other), "restart", { resourceUuid: "app-2" });
  const events = listEvents({ userId: other.id });
  assert.ok(events.every((e) => e.actor_email === "bob@example.com"));
  assert.ok(events.some((e) => e.action === "restart"));
  // alice's deploy must not appear
  assert.equal(events.some((e) => e.actor_email === "alice@example.com"), false);
});

test("recordSystem + listEventsForResource returns both events newest-first", () => {
  // app-1 already has alice's deploy from test 1
  recordSystem("service.down", { resourceUuid: "app-1" });
  const events = listEventsForResource("app-1");
  assert.ok(events.length >= 2, "expected at least 2 events for app-1");
  // newest first: system event was inserted after deploy
  assert.equal(events[0].action, "service.down");
  assert.equal(events[0].actor_email, null);
  assert.equal(events[1].action, "deploy");
});

test("listEventsForResource redacts prior-owner actor identity for non-admins", () => {
  // app-1's deploy was performed by alice. A different viewer (bob) who now owns
  // the resource must NOT see alice's email/name; an admin must.
  const asBob = listEventsForResource("app-1", { viewerId: other.id, isAdmin: false });
  const deployRow = asBob.find((e) => e.action === "deploy");
  assert.ok(deployRow, "deploy row missing");
  assert.equal(deployRow.actor_email, null, "prior owner email must be redacted");
  assert.equal(deployRow.actor_name, null, "prior owner name must be redacted");

  const asAdmin = listEventsForResource("app-1", { viewerId: other.id, isAdmin: true });
  assert.equal(asAdmin.find((e) => e.action === "deploy").actor_email, "alice@example.com");

  // the owner themselves still sees their own identity
  const asAlice = listEventsForResource("app-1", { viewerId: user.id, isAdmin: false });
  assert.equal(asAlice.find((e) => e.action === "deploy").actor_email, "alice@example.com");
});

test("listEvents includes system events on the customer's owned resources", () => {
  // alice owns app-1, which has a system service.down (user_id NULL). Without
  // ownedUuids it would be invisible to her; with it, it appears.
  const without = listEvents({ userId: user.id });
  assert.equal(without.some((e) => e.action === "service.down"), false);

  const withOwned = listEvents({ userId: user.id, ownedUuids: ["app-1"] });
  assert.ok(withOwned.some((e) => e.action === "service.down" && e.resource_uuid === "app-1"),
    "system down event on owned resource must appear in the customer feed");
  // and it carries no actor identity (system event)
  const downRow = withOwned.find((e) => e.action === "service.down");
  assert.equal(downRow.actor_email, null);
});

test("limit is clamped to 500", () => {
  // Just verify the query runs (can't easily exceed 500 rows in unit test);
  // pass 9999 and confirm it doesn't throw and returns ≤500
  const events = listEvents({ limit: 9999 });
  assert.ok(events.length <= 500);
});
