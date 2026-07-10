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

test("fleetOverview: latest host + per-site rows shaped for the dashboard", () => {
  // ponytail: fixed far-future timestamp so this test's rows always win MAX/ORDER BY DESC
  const at = "2099-01-01T00:00:00.000Z";
  M.insertHostSample({ cpu_pct: 12, mem_used_bytes: 3e9, mem_total_bytes: 8e9,
    disk_used_bytes: 2.4e9, disk_total_bytes: 75e9, vol_used_bytes: 73e9, vol_total_bytes: 196e9 }, at);
  M.insertMetricsSamples([{ coolify_uuid: "fleet-ov-svc", cpu_pct: 5, mem_bytes: 4e8, mem_pct: 5,
    net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 3 }], at);
  M.upsertDiskBytes([{ coolify_uuid: "fleet-ov-svc", disk_bytes: 8.8e9 }], at);
  const o = M.fleetOverview();
  assert.equal(o.host.diskRoot.pct, 3.2);          // 2.4/75
  assert.equal(o.host.diskVolume.pct, 37.2);       // 73/196
  const s = o.sites.find((x) => x.uuid === "fleet-ov-svc");
  assert.equal(s.disk_bytes, 8.8e9);
  assert.equal(s.mem_pct, 5);
});

test("parseSampleHosts: empty/undefined → []", () => {
  assert.deepEqual(M.parseSampleHosts(""), []);
  assert.deepEqual(M.parseSampleHosts(undefined), []);
});

test("parseSampleHosts: one valid pair → [{host, hostKeySha256}]", () => {
  const r = M.parseSampleHosts("157.90.244.221|f6e8aef9bd99c75436341fe33dac83511e92068f975b99bdbe78acb45b0e1236");
  assert.equal(r.length, 1);
  assert.equal(r[0].host, "157.90.244.221");
  assert.equal(r[0].hostKeySha256, "f6e8aef9bd99c75436341fe33dac83511e92068f975b99bdbe78acb45b0e1236");
});

test("parseSampleHosts: malformed entries (no pipe, non-hex sha) are skipped", () => {
  assert.deepEqual(M.parseSampleHosts("nopipe"), []);
  assert.deepEqual(M.parseSampleHosts("host|not-a-hex!"), []);
  assert.deepEqual(M.parseSampleHosts(",,,"), []);
});

test("parseSampleHosts: two valid pairs → length 2", () => {
  const r = M.parseSampleHosts(
    "157.90.244.221|f6e8aef9bd99c75436341fe33dac83511e92068f975b99bdbe78acb45b0e1236," +
    "10.0.0.5|abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"
  );
  assert.equal(r.length, 2);
  assert.equal(r[1].host, "10.0.0.5");
});

test("parseSampleHosts: 3-field entry → name set; 2-field → name defaults to host", () => {
  const sha = "f6e8aef9bd99c75436341fe33dac83511e92068f975b99bdbe78acb45b0e1236";
  const r3 = M.parseSampleHosts(`157.90.1.1|${sha}|mailbox`);
  assert.equal(r3.length, 1);
  assert.equal(r3[0].name, "mailbox");
  assert.equal(r3[0].host, "157.90.1.1");
  const r2 = M.parseSampleHosts(`157.90.1.2|${sha}`);
  assert.equal(r2.length, 1);
  assert.equal(r2[0].name, "157.90.1.2"); // defaults to host
});

test("parseSampleHosts: reserved 'primary' and duplicate names are dropped", () => {
  const sha = "f6e8aef9bd99c75436341fe33dac83511e92068f975b99bdbe78acb45b0e1236";
  // "primary" is reserved for the default host
  assert.equal(M.parseSampleHosts(`157.90.1.1|${sha}|primary`).length, 0);
  // second entry reusing "mailbox" is dropped; first wins
  const r = M.parseSampleHosts(`157.90.1.1|${sha}|mailbox,157.90.1.2|${sha}|mailbox`);
  assert.equal(r.length, 1);
  assert.equal(r[0].host, "157.90.1.1");
});

test("fleetOverview: hosts[] contains one entry per host label; host key = primary", () => {
  // ponytail: far-future timestamp with unique prefix to avoid collision with other tests.
  // Both hosts share ONE timestamp — production writes every host with the same sampledAt,
  // so this exercises the per-label join's tie behavior (one card per label, no cross-match).
  const at = "2099-06-01T00:00:00.000Z";
  const sample = (cpu, mem, disk) => ({
    cpu_pct: cpu, mem_used_bytes: mem, mem_total_bytes: 8e9,
    disk_used_bytes: disk, disk_total_bytes: 100e9, vol_used_bytes: null, vol_total_bytes: null,
  });
  M.insertHostSample(sample(10, 2e9, 20e9), at, "primary");
  M.insertHostSample(sample(50, 4e9, 40e9), at, "mailbox");

  const o = M.fleetOverview();
  assert.ok(Array.isArray(o.hosts), "hosts is array");
  const hp = o.hosts.filter((x) => x.name === "primary");
  const hm = o.hosts.filter((x) => x.name === "mailbox");
  assert.equal(hp.length, 1, "exactly one primary card");
  assert.equal(hm.length, 1, "exactly one mailbox card");
  assert.equal(hp[0].cpu, 10);
  assert.equal(hm[0].cpu, 50);
  assert.equal(hm[0].mem.pct, Math.round((4e9 / 8e9) * 1000) / 10); // 50.0
  // backward-compat: o.host still returns the primary
  assert.equal(o.host.cpu, 10);
});

test("fleetOverview: disk_bytes reads latest NON-NULL when newest row is null (disk sampled every 10th tick)", () => {
  const svc = "fleet-disknull-svc";
  // earlier row carries disk; the newer row (a non-disk tick) has disk_bytes NULL
  M.insertMetricsSamples([{ coolify_uuid: svc, cpu_pct: 1, mem_bytes: 100, mem_pct: 1,
    net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 1 }], "2099-02-01T00:00:00.000Z");
  M.upsertDiskBytes([{ coolify_uuid: svc, disk_bytes: 5_000_000 }], "2099-02-01T00:00:00.000Z");
  M.insertMetricsSamples([{ coolify_uuid: svc, cpu_pct: 2, mem_bytes: 200, mem_pct: 2,
    net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 1 }], "2099-02-01T00:01:00.000Z");
  const s = M.fleetOverview().sites.find((x) => x.uuid === svc);
  assert.equal(s.mem_bytes, 200);        // shape reads the newest row (mem/cpu)
  assert.equal(s.disk_bytes, 5_000_000); // but disk comes from the earlier non-null row, not the null newest
});
