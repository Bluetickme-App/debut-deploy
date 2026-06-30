// Run: node --test server/test_notifications.mjs
process.env.DATABASE_FILE = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { db, seedUser } = await import("./db.js");
const { getNotificationSettings, setNotificationSettings, notify } = await import("./notifications.js");

// (a) set then get round-trips correctly
test("setNotificationSettings persists and getNotificationSettings returns it", () => {
  const user = seedUser({ email: "hooks@x.com", role: "customer" });
  const saved = setNotificationSettings({ userId: user.id, webhookUrl: "https://hooks.example.com/x", enabled: 1 });
  assert.equal(saved.webhook_url, "https://hooks.example.com/x");
  assert.equal(saved.enabled, 1);
  const fetched = getNotificationSettings(user.id);
  assert.equal(fetched.webhook_url, "https://hooks.example.com/x");
  assert.equal(fetched.enabled, 1);
});

// (b) invalid URL with enabled:1 throws with status 400
test("setNotificationSettings rejects non-URL when enabled", () => {
  const user = seedUser({ email: "bad-url@x.com", role: "customer" });
  assert.throws(
    () => setNotificationSettings({ userId: user.id, webhookUrl: "not-a-url", enabled: 1 }),
    (e) => e.status === 400
  );
});

// (c) notify() with fake httpClient returns {sent:true} and body contains event.type
test("notify() calls httpClient with event.type in body", async () => {
  const user = seedUser({ email: "fire@x.com", role: "customer" });
  setNotificationSettings({ userId: user.id, webhookUrl: "https://hooks.example.com/fire", enabled: 1 });

  let captured;
  const fakeClient = async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200 }; };
  const publicLookup = async () => [{ address: "93.184.216.34" }]; // avoid real DNS in tests

  const result = await notify({ userId: user.id, event: { type: "deploy", resource_uuid: "abc-123" } }, { httpClient: fakeClient, lookup: publicLookup });
  assert.deepEqual(result, { sent: true });
  assert.equal(captured.body.event.type, "deploy");
  assert.equal(captured.body.event.resource_uuid, "abc-123");
});

// (d) notify() when disabled returns {sent:false}
test("notify() returns {sent:false} when disabled", async () => {
  const user = seedUser({ email: "disabled@x.com", role: "customer" });
  setNotificationSettings({ userId: user.id, webhookUrl: "https://hooks.example.com/d", enabled: 0 });

  const result = await notify({ userId: user.id, event: { type: "deploy-failed" } }, { httpClient: () => { throw new Error("should not call"); } });
  assert.deepEqual(result, { sent: false, reason: "disabled" });
});

// (e) notify() when httpClient throws returns {sent:false} and does NOT rethrow
test("notify() swallows httpClient errors", async () => {
  const user = seedUser({ email: "throw@x.com", role: "customer" });
  setNotificationSettings({ userId: user.id, webhookUrl: "https://hooks.example.com/t", enabled: 1 });

  const result = await notify(
    { userId: user.id, event: { type: "service-down" } },
    { httpClient: async () => { throw new Error("network dead"); }, lookup: async () => [{ address: "93.184.216.34" }] }
  );
  assert.deepEqual(result, { sent: false, reason: "error" });
});

// (f) SSRF: set-time rejects a private/metadata IP literal with 400
test("setNotificationSettings rejects private-IP webhook (SSRF)", () => {
  const user = seedUser({ email: "ssrf-set@x.com", role: "customer" });
  for (const bad of ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1:9000/hook", "http://localhost/x", "http://10.0.0.5/x"]) {
    assert.throws(() => setNotificationSettings({ userId: user.id, webhookUrl: bad, enabled: 1 }), (e) => e.status === 400, bad);
  }
});

// (g) SSRF: send-time blocks a hostname that resolves to a private address; httpClient NOT called
test("notify() blocks webhook host resolving to a private IP (SSRF)", async () => {
  const user = seedUser({ email: "ssrf-send@x.com", role: "customer" });
  setNotificationSettings({ userId: user.id, webhookUrl: "http://internal.attacker.example/hook", enabled: 1 });
  let called = false;
  const result = await notify(
    { userId: user.id, event: { type: "deploy" } },
    { httpClient: async () => { called = true; return { status: 200 }; }, lookup: async () => [{ address: "169.254.169.254" }] }
  );
  assert.deepEqual(result, { sent: false, reason: "blocked" });
  assert.equal(called, false, "must not POST to a private target");
});
