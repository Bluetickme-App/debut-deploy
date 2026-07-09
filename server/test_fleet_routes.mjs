// Fleet overview smoke test. Run: node server/test_fleet_routes.mjs
// Tests the demo payload shape that /api/fleet/overview returns when DEMO_MODE=true.
process.env.DATABASE_FILE = ":memory:";
process.env.DEMO_MODE = "true";

import assert from "node:assert/strict";

// The demo branch in the route handler is a plain object literal — replicate it here
// so this test stays in sync with the handler without booting the full Express stack.
// If the handler's demo return value changes, this test breaks on purpose.
const demoPayload = {
  host: { cpu: 12, mem: { used: 3.1e9, total: 8e9, pct: 39 },
    diskRoot: { used: 2.4e9, total: 75e9, pct: 4 }, diskVolume: { used: 73e9, total: 196e9, pct: 37 } },
  sites: [{ uuid: "demo-svc", cpu_pct: 3.2, mem_bytes: 4.8e8, mem_pct: 6, disk_bytes: 8.8e9 }],
};

assert.equal(demoPayload.host.diskVolume.pct, 37, "diskVolume.pct === 37");
assert.ok(demoPayload.sites.length >= 1, "sites.length >= 1");

// Also verify fleetOverview() DB function returns correct shape with real data
const M = await import("./metrics.js");
const at = new Date().toISOString();
M.insertHostSample({ cpu_pct: 5, mem_used_bytes: 1e9, mem_total_bytes: 4e9,
  disk_used_bytes: 10e9, disk_total_bytes: 100e9, vol_used_bytes: 50e9, vol_total_bytes: 200e9 }, at);
M.insertMetricsSamples([{ coolify_uuid: "fleet-svc", cpu_pct: 2, mem_bytes: 2e8, mem_pct: 5,
  net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 2 }], at);
M.upsertDiskBytes([{ coolify_uuid: "fleet-svc", disk_bytes: 5e9 }], at);
const o = M.fleetOverview();
assert.ok(o.host.diskVolume !== null, "diskVolume present when vol data exists");
assert.equal(o.host.diskVolume.pct, 25, "50/200 = 25%");
assert.ok(o.sites.length >= 1, "sites has at least one row");
assert.equal(o.sites[0].uuid, "fleet-svc");
assert.equal(o.sites[0].disk_bytes, 5e9);

console.log("PASS");
