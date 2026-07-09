// Run: DATABASE_FILE=:memory: node --test server/metrics.test.js
// Covers the pure parsing/bucketing helpers plus insert → windowed history →
// retention against an in-memory DB.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:"; // must be set before db.js opens the singleton
const M = await import("./metrics.js");

test("parseBytes: binary vs SI units", () => {
  assert.equal(M.parseBytes("512B"), 512);
  assert.equal(M.parseBytes("1.2kB"), 1200);          // SI
  assert.equal(M.parseBytes("3.4MB"), 3_400_000);      // SI
  assert.equal(M.parseBytes("1KiB"), 1024);            // binary
  assert.equal(M.parseBytes("67.38MiB"), Math.round(67.38 * 1024 ** 2));
  assert.equal(M.parseBytes("7.57GiB"), Math.round(7.57 * 1024 ** 3));
  assert.equal(M.parseBytes("garbage"), null);
});

test("parseStatsLine: full line (incl block I/O + PIDs) and malformed drop", () => {
  const s = M.parseStatsLine("app-uuid123-x|0.87%|67.38MiB / 7.57GiB|4.20%|1.2kB / 3.4MB|5MB / 2MB|17");
  assert.equal(s.name, "app-uuid123-x");
  assert.equal(s.cpu_pct, 0.87);
  assert.equal(s.mem_pct, 4.2);
  assert.equal(s.mem_bytes, Math.round(67.38 * 1024 ** 2));
  assert.equal(s.net_rx_bytes, 1200);
  assert.equal(s.net_tx_bytes, 3_400_000);
  assert.equal(s.block_read_bytes, 5_000_000);
  assert.equal(s.block_write_bytes, 2_000_000);
  assert.equal(s.pids, 17);
  assert.equal(M.parseStatsLine("only|two"), null);          // too few fields
  assert.equal(M.parseStatsLine("|x|y|z"), null);            // no name / bad cpu
});

test("parseHostCapacity: free/df/loadavg output → percentages", () => {
  const out = "MEM_TOTAL=8000000000\nMEM_USED=3000000000\nDISK_TOTAL=80000000000\nDISK_USED=40000000000\nCORES=4\nLOAD1=2.0";
  const h = M.parseHostCapacity(out);
  assert.equal(h.mem_total_bytes, 8_000_000_000);
  assert.equal(h.mem_used_bytes, 3_000_000_000);
  assert.equal(h.disk_used_bytes, 40_000_000_000);
  assert.equal(h.cpu_pct, 50);   // load 2.0 / 4 cores * 100
});

test("mapNamesToUuids: substring match, unowned dropped", () => {
  const rows = [
    { name: "svc-aaa111-web-1", cpu_pct: 1, mem_bytes: 0, mem_pct: 0, net_rx_bytes: null, net_tx_bytes: null },
    { name: "unowned-zzz-1", cpu_pct: 1, mem_bytes: 0, mem_pct: 0, net_rx_bytes: null, net_tx_bytes: null },
  ];
  const out = M.mapNamesToUuids(rows, ["aaa111", "bbb222"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].coolify_uuid, "aaa111");
});

test("windowCfg: known windows and default", () => {
  assert.deepEqual(M.windowCfg("6h"), { sec: 21600, bucket: 180 });
  assert.deepEqual(M.windowCfg("bogus"), M.windowCfg("1h")); // unknown → 1h
});

test("metricsHistory: empty → stats null", () => {
  const h = M.metricsHistory("nope", "1h");
  assert.equal(h.stats, null);
  assert.deepEqual(h.series, { cpu: [], mem: [], net: [], throughput: [], diskio: [], pids: [] });
});

test("metricsHistory: buckets, peak, current, net cumulative, retention", () => {
  const now = Date.parse("2026-07-04T12:00:00.000Z");
  const mk = (cpu, rx) => [{ coolify_uuid: "svc1", cpu_pct: cpu, mem_bytes: 1000, mem_pct: 40, net_rx_bytes: rx, net_tx_bytes: 50 }];
  M.insertMetricsSamples(mk(30, 100), new Date(now - 240_000).toISOString());
  M.insertMetricsSamples(mk(20, 200), new Date(now - 120_000).toISOString());
  M.insertMetricsSamples(mk(5, 300), new Date(now).toISOString());

  const h = M.metricsHistory("svc1", "1h", now + 1000);
  assert.equal(h.series.cpu.length, 3);       // three distinct 60s buckets
  assert.equal(h.stats.cpu.peak, 30);         // MAX over window
  assert.equal(h.stats.cpu.current, 5);       // latest sample
  assert.equal(h.stats.net.current, 350);     // 300 rx + 50 tx, cumulative
  assert.equal(h.stats.net.peak, 350);

  const deleted = M.sweepMetrics(new Date(now - 180_000).toISOString());
  assert.equal(deleted, 1);                    // only the oldest (t-240s) row
  assert.equal(M.metricsHistory("svc1", "1h", now + 1000).stats.cpu.peak, 20);
});

test("demoHistory: shaped like real payload", () => {
  const h = M.demoHistory("6h");
  assert.ok(h.series.cpu.length > 1);
  assert.ok(h.stats.cpu.peak >= h.stats.cpu.avg);
  assert.equal(typeof h.stats.net.current, "number");
});

test("parseHostCapacity: includes docker volume when present", () => {
  const out = "MEM_TOTAL=8000000000\nMEM_USED=3000000000\nDISK_TOTAL=80000000000\nDISK_USED=40000000000\n" +
              "CORES=4\nLOAD1=2.0\nVOL_TOTAL=200000000000\nVOL_USED=73000000000";
  const h = M.parseHostCapacity(out);
  assert.equal(h.vol_total_bytes, 200_000_000_000);
  assert.equal(h.vol_used_bytes, 73_000_000_000);
});

test("parseHostCapacity: volume absent → null volume fields", () => {
  const out = "MEM_TOTAL=8000000000\nMEM_USED=3000000000\nDISK_TOTAL=80000000000\nDISK_USED=40000000000\nCORES=4\nLOAD1=1.0";
  const h = M.parseHostCapacity(out);
  assert.equal(h.vol_total_bytes, null);
  assert.equal(h.vol_used_bytes, null);
});

test("parseDiskLine: 'SizeRW (virtual SizeRootFs)' → total footprint bytes", () => {
  // docker ps -s Size cell: "<writable> (virtual <total>)"
  const s = M.parseDiskLine("app-uuid123-x|12.3MB (virtual 1.2GB)");
  assert.equal(s.name, "app-uuid123-x");
  assert.equal(s.disk_bytes, 1_200_000_000); // uses the virtual (total incl image) figure
  const noVirt = M.parseDiskLine("x-y|5MB");   // some engines omit "(virtual ...)"
  assert.equal(noVirt.disk_bytes, 5_000_000);
  assert.equal(M.parseDiskLine("bad line no pipe"), null);
  assert.equal(M.parseDiskLine("|12MB"), null); // no name
});

test("upsertDiskBytes: attaches latest disk_bytes to a uuid's most recent sample", () => {
  const at = new Date().toISOString();
  M.insertMetricsSamples([{ coolify_uuid: "svc1", cpu_pct: 1, mem_bytes: 100, mem_pct: 1,
    net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 1 }], at);
  const n = M.upsertDiskBytes([{ coolify_uuid: "svc1", disk_bytes: 5_000_000 }], at);
  assert.equal(n, 1);
  const hist = M.metricsHistory("svc1", "1h");
  assert.ok(hist.stats.mem.bytes >= 0); // sanity: row exists
});
