// Fleet overview HTTP route test. Run: node server/test_fleet_routes.mjs
// Tests the full middleware chain: auth → requireAdmin → demo branch → JSON response.
// Sets env BEFORE any imports so index.js picks them up at module load.
process.env.DEMO_MODE = "true";
process.env.NODE_ENV = "test";
process.env.DATABASE_FILE = ":memory:";
process.env.PORT = "8799";

import assert from "node:assert/strict";

// Boot the Express app (listen binds to :8799; timers are suppressed by NODE_ENV=test)
await import("./index.js");

// Wait for the listener to be ready — poll /api/health up to 2s
const BASE = "http://localhost:8799";
for (let i = 0; i < 20; i++) {
  try { await fetch(`${BASE}/api/health`); break; }
  catch { await new Promise(r => setTimeout(r, 100)); }
}

// --- HTTP route test ---
const res = await fetch(`${BASE}/api/fleet/overview`);
assert.ok(res.ok, `Expected 200, got ${res.status}`);

const body = await res.json();
assert.equal(body.host.diskVolume.pct, 37, "diskVolume.pct === 37");
assert.ok(Array.isArray(body.sites) && body.sites.length >= 1, "sites.length >= 1");

console.log("PASS — HTTP /api/fleet/overview: status 200, auth+admin gate passed, demo payload correct");
process.exit(0);
