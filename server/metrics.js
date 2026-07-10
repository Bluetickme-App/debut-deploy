// Time-series metrics: sample `docker stats` over SSH, persist, and query back
// windowed for the Metrics-tab graphs. Coolify has no metrics API, so we
// accumulate our own history. Pure parsing/bucketing helpers are exported for
// tests; DB-touching helpers import the shared `db` (same pattern as metering.js).
import { db } from "./db.js";
import { runOnHost } from "./hostexec.js";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

// "67.38MiB" / "7.57GiB" / "1.2kB" / "3.4MB" / "512B" → bytes. Binary (1024) when
// the unit carries an 'i' (MiB/GiB/KiB), SI (1000) otherwise. null on garbage.
export function parseBytes(s) {
  const m = String(s ?? "").trim().match(/^([\d.]+)\s*([a-zA-Z]*)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = m[2].toLowerCase();
  const base = u.includes("i") ? 1024 : 1000;
  const exp = { b: 0, k: 1, m: 2, g: 3, t: 4, p: 5 }[u[0]] ?? 0;
  return Math.round(n * base ** exp);
}

const stripPct = (s) => parseFloat(String(s ?? "").replace("%", "").trim());

// One `docker stats --format 'Name|CPUPerc|MemUsage|MemPerc|NetIO'` line → sample.
// Returns null (dropped) if the line is malformed or has no usable CPU value.
export function parseStatsLine(line) {
  const p = String(line ?? "").split("|");
  if (p.length < 4) return null;
  const [name, cpu, memUsage, memPerc, netIO, blockIO, pidsStr] = p;
  const cpu_pct = stripPct(cpu);
  if (!name?.trim() || !Number.isFinite(cpu_pct)) return null;
  const mem_bytes = parseBytes(String(memUsage).split("/")[0]) ?? 0;
  const mem_pct = stripPct(memPerc);
  const pair = (s) => { const [a, b] = String(s ?? "").split("/"); return [parseBytes(a), parseBytes(b)]; };
  const [net_rx_bytes, net_tx_bytes] = netIO ? pair(netIO) : [null, null];
  const [block_read_bytes, block_write_bytes] = blockIO ? pair(blockIO) : [null, null];
  const pids = Number.parseInt(pidsStr, 10);
  return {
    name: name.trim(),
    cpu_pct,
    mem_bytes,
    mem_pct: Number.isFinite(mem_pct) ? mem_pct : 0,
    net_rx_bytes,
    net_tx_bytes,
    block_read_bytes,
    block_write_bytes,
    pids: Number.isFinite(pids) ? pids : null,
  };
}

// One `docker ps -s --format '{{.Names}}|{{.Size}}'` line → per-container disk footprint.
// The Size cell is "<writable> (virtual <total-incl-image>)"; we keep the total (virtual).
// Falls back to the writable figure if "(virtual …)" is absent. null on malformed/no-name.
export function parseDiskLine(line) {
  const p = String(line ?? "").split("|");
  if (p.length < 2) return null;
  const name = p[0]?.trim();
  if (!name) return null;
  const size = p[1] ?? "";
  const virt = size.match(/virtual\s+([\d.]+\s*[a-zA-Z]+)/i);
  const bytes = parseBytes((virt ? virt[1] : size.split("(")[0]).trim());
  if (bytes == null) return null;
  return { name, disk_bytes: bytes };
}

// Parse SAMPLE_HOSTS env var: comma-separated "host|hostKeySha256[|name]" entries.
// Returns [{ host, hostKeySha256, name }]. name defaults to host. Pure.
export function parseSampleHosts(raw) {
  if (!raw) return [];
  // "primary" is reserved for the default host; drop it and any duplicate name so
  // fleetOverview's per-label join can't return two rows under one card.
  const seen = new Set(["primary"]);
  return raw.split(",").flatMap((entry) => {
    const [host, sha, name] = entry.trim().split("|");
    if (!host || !sha) return [];
    // must be a non-empty hex string
    if (!/^[0-9a-f]+$/i.test(sha.trim())) return [];
    const label = name?.trim() || host.trim();
    if (seen.has(label)) return [];
    seen.add(label);
    return [{ host: host.trim(), hostKeySha256: sha.trim(), name: label }];
  });
}

// Primary host (empty SSH opts = default env vars, labeled "primary") + extras from SAMPLE_HOSTS.
function sampleTargets() {
  return [{ name: "primary" }].concat(parseSampleHosts(process.env.SAMPLE_HOSTS));
}

// One SSH round-trip: total footprint of every container. `docker ps -s` is heavier
// than `docker stats` (it walks layer sizes), so this is called on a slower cadence.
export async function sampleContainerDisk() {
  if (DEMO) return [];
  const cmd = "docker ps -s --format '{{.Names}}|{{.Size}}'";
  const results = await Promise.all(sampleTargets().map(async (opts) => {
    try {
      const out = await runOnHost(cmd, opts);
      return String(out).trim().split("\n").filter(Boolean).map(parseDiskLine).filter(Boolean);
    } catch (e) {
      console.error(`[metrics] sampleContainerDisk skipped host ${opts.host || "primary"}: ${e.message}`);
      return [];
    }
  }));
  return results.flat();
}

// Attach the owning service uuid to each stats row by "uuid is a substring of the
// container name" (Coolify names embed the uuid; the live endpoint filters the same
// way). Rows matching no owned resource are dropped. Pure — ownedUuids is injected.
export function mapNamesToUuids(rows, ownedUuids) {
  const out = [];
  for (const r of rows) {
    const uuid = ownedUuids.find((u) => u && r.name.includes(u));
    if (uuid) out.push({ ...r, coolify_uuid: uuid });
  }
  return out;
}

// One SSH round-trip per host: `docker stats` over ALL running containers (no name
// filter), so cost is flat regardless of fleet size. DEMO returns nothing (the tick
// is off in demo anyway; the history endpoint synthesises demo data instead).
export async function sampleAllContainers() {
  if (DEMO) return [];
  const cmd = "docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'";
  const results = await Promise.all(sampleTargets().map(async (opts) => {
    try {
      const out = await runOnHost(cmd, opts);
      return String(out).trim().split("\n").filter(Boolean).map(parseStatsLine).filter(Boolean);
    } catch (e) {
      console.error(`[metrics] sampleAllContainers skipped host ${opts.host || "primary"}: ${e.message}`);
      return [];
    }
  }));
  return results.flat();
}

export function insertMetricsSamples(rows, sampledAt) {
  if (!rows.length) return 0;
  const stmt = db.prepare(
    "INSERT INTO metrics_samples (coolify_uuid, sampled_at, cpu_pct, mem_bytes, mem_pct, net_rx_bytes, net_tx_bytes, block_read_bytes, block_write_bytes, pids) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  const tx = db.transaction((rs) => {
    for (const r of rs) stmt.run(r.coolify_uuid, sampledAt, r.cpu_pct, r.mem_bytes, r.mem_pct, r.net_rx_bytes, r.net_tx_bytes, r.block_read_bytes, r.block_write_bytes, r.pids);
  });
  tx(rows);
  return rows.length;
}

// Parse `free -b` + `df -B1 /` + `nproc` + loadavg into one host-capacity sample.
// cpu_pct ≈ 1-min loadavg / cores * 100 (a coarse but honest utilisation proxy).
export function parseHostCapacity(out) {
  const s = String(out ?? "");
  const num = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
  const mem_total_bytes = num(/MEM_TOTAL=(\d+)/);
  const mem_used_bytes = num(/MEM_USED=(\d+)/);
  const disk_total_bytes = num(/DISK_TOTAL=(\d+)/);
  const disk_used_bytes = num(/DISK_USED=(\d+)/);
  const cores = num(/CORES=(\d+)/) || 1;
  const load1 = num(/LOAD1=([\d.]+)/);
  const cpu_pct = load1 != null ? Math.round((load1 / cores) * 1000) / 10 : null;
  const vol_total_bytes = num(/VOL_TOTAL=(\d+)/);
  const vol_used_bytes = num(/VOL_USED=(\d+)/);
  const volT = vol_total_bytes || null;
  return { cpu_pct, mem_used_bytes, mem_total_bytes, disk_used_bytes, disk_total_bytes, vol_total_bytes: volT, vol_used_bytes: volT ? vol_used_bytes : null };
}

export async function sampleHostCapacity(opts = {}) {
  if (DEMO) return null;
  const out = await runOnHost(
    "echo MEM_TOTAL=$(free -b | awk '/^Mem:/{print $2}'); echo MEM_USED=$(free -b | awk '/^Mem:/{print $3}'); " +
    "echo DISK_TOTAL=$(df -B1 --output=size / | tail -1); echo DISK_USED=$(df -B1 --output=used / | tail -1); " +
    "echo CORES=$(nproc); echo LOAD1=$(awk '{print $1}' /proc/loadavg); " +
    "echo VOL_TOTAL=$(df -B1 --output=size /mnt/dockerdata 2>/dev/null | tail -1 || echo 0); " +
    "echo VOL_USED=$(df -B1 --output=used /mnt/dockerdata 2>/dev/null | tail -1 || echo 0)",
    opts
  );
  return parseHostCapacity(out);
}

export function insertHostSample(sample, sampledAt, host = null) {
  if (!sample) return 0;
  db.prepare(
    "INSERT INTO host_samples (sampled_at, cpu_pct, mem_used_bytes, mem_total_bytes, disk_used_bytes, disk_total_bytes, vol_used_bytes, vol_total_bytes, host) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(sampledAt, sample.cpu_pct, sample.mem_used_bytes, sample.mem_total_bytes, sample.disk_used_bytes, sample.disk_total_bytes, sample.vol_used_bytes ?? null, sample.vol_total_bytes ?? null, host);
  return 1;
}

// Write disk_bytes onto this tick's just-inserted rows (matched by uuid + sampledAt).
export function upsertDiskBytes(rows, sampledAt) {
  if (!rows.length) return 0;
  const stmt = db.prepare("UPDATE metrics_samples SET disk_bytes = ? WHERE coolify_uuid = ? AND sampled_at = ?");
  let n = 0;
  const tx = db.transaction((rs) => { for (const r of rs) n += stmt.run(r.disk_bytes, r.coolify_uuid, sampledAt).changes; });
  tx(rows);
  return n;
}

// Orchestrates one sampling pass. Called best-effort from the health tick.
export async function sampleAndStore(sampledAt, { withDisk = false } = {}) {
  const owned = db.prepare("SELECT coolify_uuid FROM resource_ownership").all().map((r) => r.coolify_uuid);
  const rows = mapNamesToUuids(await sampleAllContainers(), owned);
  const n = insertMetricsSamples(rows, sampledAt);
  // Sample capacity for each host (primary + extras from SAMPLE_HOSTS), best-effort per host.
  for (const { name, ...sshOpts } of sampleTargets()) {
    try { insertHostSample(await sampleHostCapacity(sshOpts), sampledAt, name); }
    catch (e) { console.error(`[metrics] host capacity skipped (${name}): ${e.message}`); }
  }
  if (withDisk) {
    try {
      const owned = db.prepare("SELECT coolify_uuid FROM resource_ownership").all().map((r) => r.coolify_uuid);
      const disk = mapNamesToUuids(await sampleContainerDisk(), owned);
      upsertDiskBytes(disk, sampledAt);
    } catch { /* disk sample best-effort */ }
  }
  return n;
}

// Latest host capacity + each service's most-recent sample, shaped for the Fleet dashboard.
// Reads only the newest row per uuid (cheap; no bucketing). Pure DB read, no side effects.
export function fleetOverview() {
  const pct = (u, t) => (t > 0 ? Math.round((1000 * u) / t) / 10 : 0);
  // Latest row per host label. NULL host treated as 'primary' (pre-migration rows).
  const hostRows = db.prepare(`
    SELECT h.*
    FROM host_samples h
    JOIN (SELECT COALESCE(host,'primary') AS label, MAX(sampled_at) AS mx
          FROM host_samples GROUP BY COALESCE(host,'primary')) l
      ON COALESCE(h.host,'primary') = l.label AND h.sampled_at = l.mx
    ORDER BY CASE WHEN COALESCE(h.host,'primary') = 'primary' THEN 0 ELSE 1 END, h.host
  `).all();
  const shapeHost = (h, label) => ({
    name: label,
    cpu: h.cpu_pct ?? null,
    mem: { used: h.mem_used_bytes ?? null, total: h.mem_total_bytes ?? null, pct: pct(h.mem_used_bytes, h.mem_total_bytes) },
    diskRoot: { used: h.disk_used_bytes ?? null, total: h.disk_total_bytes ?? null, pct: pct(h.disk_used_bytes, h.disk_total_bytes) },
    diskVolume: h.vol_total_bytes ? { used: h.vol_used_bytes, total: h.vol_total_bytes, pct: pct(h.vol_used_bytes, h.vol_total_bytes) } : null,
  });
  const hosts = hostRows.map((h) => shapeHost(h, h.host ?? "primary"));
  const primaryRaw = hostRows.find((h) => (h.host ?? "primary") === "primary") || {};
  const sites = db.prepare(`
    SELECT m.coolify_uuid AS uuid, m.cpu_pct, m.mem_bytes, m.mem_pct,
      (SELECT d.disk_bytes FROM metrics_samples d
        WHERE d.coolify_uuid = m.coolify_uuid AND d.disk_bytes IS NOT NULL
        ORDER BY d.sampled_at DESC LIMIT 1) AS disk_bytes
    FROM metrics_samples m
    JOIN (SELECT coolify_uuid, MAX(sampled_at) AS mx FROM metrics_samples GROUP BY coolify_uuid) l
      ON l.coolify_uuid = m.coolify_uuid AND l.mx = m.sampled_at
  `).all();
  const h = primaryRaw;
  return {
    // ponytail: backward-compat key; current UI reads this; hosts[] is the new multi-host surface
    host: {
      cpu: h.cpu_pct ?? null,
      mem: { used: h.mem_used_bytes ?? null, total: h.mem_total_bytes ?? null, pct: pct(h.mem_used_bytes, h.mem_total_bytes) },
      diskRoot: { used: h.disk_used_bytes ?? null, total: h.disk_total_bytes ?? null, pct: pct(h.disk_used_bytes, h.disk_total_bytes) },
      diskVolume: h.vol_total_bytes ? { used: h.vol_used_bytes, total: h.vol_total_bytes, pct: pct(h.vol_used_bytes, h.vol_total_bytes) } : null,
    },
    hosts,
    sites,
  };
}

// Retention: drop samples older than the cutoff (health-tick sweep passes now-24h).
export function sweepMetrics(cutoffIso) {
  const a = db.prepare("DELETE FROM metrics_samples WHERE sampled_at < ?").run(cutoffIso).changes;
  const b = db.prepare("DELETE FROM host_samples WHERE sampled_at < ?").run(cutoffIso).changes;
  return a + b;
}

// window → { sec: lookback, bucket: SQL bucket width } — 60/120/144 points.
const WINDOWS = {
  "1h": { sec: 3600, bucket: 60 },
  "6h": { sec: 21600, bucket: 180 },
  "24h": { sec: 86400, bucket: 600 },
};
export const windowCfg = (w) => WINDOWS[w] || WINDOWS["1h"];
const windowKey = (w) => (WINDOWS[w] ? w : "1h");
const round = (n, d) => (n == null ? 0 : Math.round(n * 10 ** d) / 10 ** d);
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// Windowed, SQL-bucketed history for one service. { window, series, stats }.
// Empty history (no rows in window) → stats: null so the client shows "accumulating…".
export function metricsHistory(uuid, window, nowMs = Date.now()) {
  const cfg = windowCfg(window);
  const from = new Date(nowMs - cfg.sec * 1000).toISOString();
  const buckets = db.prepare(`
    SELECT MIN(sampled_at) AS t,
           AVG(cpu_pct) AS cpu, MAX(cpu_pct) AS cpu_peak,
           AVG(mem_pct) AS mem, AVG(mem_bytes) AS mem_bytes,
           AVG(COALESCE(net_rx_bytes,0) + COALESCE(net_tx_bytes,0)) AS net,
           AVG(COALESCE(block_read_bytes,0)) AS bread, AVG(COALESCE(block_write_bytes,0)) AS bwrite,
           AVG(pids) AS pids
    FROM metrics_samples
    WHERE coolify_uuid = ? AND sampled_at >= ?
    GROUP BY CAST(strftime('%s', sampled_at) / ? AS INT)
    ORDER BY t
  `).all(uuid, from, cfg.bucket);

  if (!buckets.length) return { window: windowKey(window), series: { cpu: [], mem: [], net: [], throughput: [], diskio: [], pids: [] }, stats: null };

  // Net throughput (bytes/sec): delta of the cumulative counter between buckets, clamped
  // (the counter resets to 0 on container restart → drop the negative spike).
  const throughput = buckets.map((b, i) => {
    if (i === 0) return { t: b.t, v: 0 };
    const d = b.net - buckets[i - 1].net;
    return { t: b.t, v: d > 0 ? Math.round(d / cfg.bucket) : 0 };
  });

  const series = {
    cpu: buckets.map((b) => ({ t: b.t, v: round(b.cpu, 2), peak: round(b.cpu_peak, 2) })),
    mem: buckets.map((b) => ({ t: b.t, v: round(b.mem, 2), bytes: Math.round(b.mem_bytes) })),
    net: buckets.map((b) => ({ t: b.t, v: Math.round(b.net) })),
    throughput,
    diskio: buckets.map((b) => ({ t: b.t, v: Math.round((b.bread || 0) + (b.bwrite || 0)) })),
    pids: buckets.map((b) => ({ t: b.t, v: Math.round(b.pids || 0) })),
  };
  const agg = db.prepare(`
    SELECT MAX(cpu_pct) AS cpu_peak, AVG(cpu_pct) AS cpu_avg,
           MAX(mem_pct) AS mem_peak, AVG(mem_pct) AS mem_avg,
           MAX(COALESCE(net_rx_bytes,0)+COALESCE(net_tx_bytes,0)) AS net_peak,
           AVG(COALESCE(net_rx_bytes,0)+COALESCE(net_tx_bytes,0)) AS net_avg,
           MAX(pids) AS pids_peak, AVG(pids) AS pids_avg,
           MAX(COALESCE(block_read_bytes,0)+COALESCE(block_write_bytes,0)) AS io_peak
    FROM metrics_samples WHERE coolify_uuid = ? AND sampled_at >= ?
  `).get(uuid, from);
  const cur = db.prepare(`
    SELECT cpu_pct, mem_pct, mem_bytes, COALESCE(net_rx_bytes,0)+COALESCE(net_tx_bytes,0) AS net, pids
    FROM metrics_samples WHERE coolify_uuid = ? ORDER BY sampled_at DESC LIMIT 1
  `).get(uuid) || { cpu_pct: 0, mem_pct: 0, mem_bytes: 0, net: 0, pids: 0 };

  // Uptime %: fraction of expected buckets (since the first sample) carrying data —
  // sampled every tick, so a running service has a sample per bucket. Counting from
  // first-seen avoids penalising a freshly-created service.
  const tpVals = throughput.map((p) => p.v);
  const spanBuckets = Math.max(1, Math.round((nowMs - Date.parse(buckets[0].t)) / (cfg.bucket * 1000)));
  const uptimePct = Math.min(100, round((buckets.length / spanBuckets) * 100, 1));

  const stats = {
    cpu: { current: round(cur.cpu_pct, 2), peak: round(agg.cpu_peak, 2), avg: round(agg.cpu_avg, 2) },
    mem: { current: round(cur.mem_pct, 2), peak: round(agg.mem_peak, 2), avg: round(agg.mem_avg, 2), bytes: Math.round(cur.mem_bytes) },
    net: { current: Math.round(cur.net), peak: Math.round(agg.net_peak), avg: Math.round(agg.net_avg) },
    throughput: { current: tpVals.at(-1) || 0, peak: Math.max(0, ...tpVals), avg: Math.round(avg(tpVals)) },
    diskio: { peak: Math.round(agg.io_peak || 0) },
    pids: { current: Math.round(cur.pids || 0), peak: Math.round(agg.pids_peak || 0), avg: round(agg.pids_avg, 1) },
    uptimePct,
  };
  return { window: windowKey(window), series, stats };
}

// Host capacity history (the box the services run on) — CPU/RAM/disk %, bucketed.
export function hostHistory(window, nowMs = Date.now()) {
  const cfg = windowCfg(window);
  const from = new Date(nowMs - cfg.sec * 1000).toISOString();
  const buckets = db.prepare(`
    SELECT MIN(sampled_at) AS t, AVG(cpu_pct) AS cpu,
           AVG(CASE WHEN mem_total_bytes>0 THEN 100.0*mem_used_bytes/mem_total_bytes END) AS mem,
           AVG(CASE WHEN disk_total_bytes>0 THEN 100.0*disk_used_bytes/disk_total_bytes END) AS disk
    FROM host_samples WHERE sampled_at >= ?
    GROUP BY CAST(strftime('%s', sampled_at) / ? AS INT) ORDER BY t
  `).all(from, cfg.bucket);
  if (!buckets.length) return { window: windowKey(window), series: { cpu: [], mem: [], disk: [] }, stats: null };
  const cur = db.prepare("SELECT cpu_pct, mem_used_bytes, mem_total_bytes, disk_used_bytes, disk_total_bytes, vol_used_bytes, vol_total_bytes FROM host_samples ORDER BY sampled_at DESC LIMIT 1").get() || {};
  const pct = (u, t) => (t > 0 ? round((100 * u) / t, 1) : 0);
  return {
    window: windowKey(window),
    series: {
      cpu: buckets.map((b) => ({ t: b.t, v: round(b.cpu, 1) })),
      mem: buckets.map((b) => ({ t: b.t, v: round(b.mem, 1) })),
      disk: buckets.map((b) => ({ t: b.t, v: round(b.disk, 1) })),
    },
    stats: {
      cpu: { current: round(cur.cpu_pct, 1) },
      mem: { current: pct(cur.mem_used_bytes, cur.mem_total_bytes), bytes: cur.mem_used_bytes, total: cur.mem_total_bytes },
      disk: { current: pct(cur.disk_used_bytes, cur.disk_total_bytes), bytes: cur.disk_used_bytes, total: cur.disk_total_bytes },
      volume: cur.vol_total_bytes ? { current: pct(cur.vol_used_bytes, cur.vol_total_bytes), bytes: cur.vol_used_bytes, total: cur.vol_total_bytes } : null,
    },
  };
}

// Synthetic series for DEMO mode (no sampler runs in demo). Shaped like the real
// payload so the graphs render identically. ponytail: sine+noise, good enough to demo.
export function demoHistory(window, nowMs = Date.now()) {
  const cfg = windowCfg(window);
  const n = Math.min(Math.floor(cfg.sec / cfg.bucket), 200);
  const cpu = [], mem = [], net = [], throughput = [], diskio = [], pids = [];
  let rx = 0;
  for (let i = 0; i < n; i++) {
    const t = new Date(nowMs - (n - 1 - i) * cfg.bucket * 1000).toISOString();
    const c = 2 + 8 * Math.abs(Math.sin(i / 7)) + Math.random() * 2;
    const m = 40 + 10 * Math.sin(i / 11) + Math.random() * 3;
    rx += 50000 + Math.random() * 200000;
    cpu.push({ t, v: round(c, 2), peak: round(c + Math.random() * 3, 2) });
    mem.push({ t, v: round(m, 2), bytes: Math.round((m / 100) * 8 * 1024 ** 3) });
    net.push({ t, v: Math.round(rx) });
    throughput.push({ t, v: Math.round(40000 + Math.random() * 120000) });
    diskio.push({ t, v: Math.round(20000 + Math.random() * 80000) });
    pids.push({ t, v: Math.round(12 + Math.random() * 6) });
  }
  const cpuVals = cpu.map((p) => p.v), memVals = mem.map((p) => p.v), tpVals = throughput.map((p) => p.v);
  return {
    window: windowKey(window),
    series: { cpu, mem, net, throughput, diskio, pids },
    stats: {
      cpu: { current: cpu.at(-1).v, peak: round(Math.max(...cpuVals), 2), avg: round(avg(cpuVals), 2) },
      mem: { current: mem.at(-1).v, peak: round(Math.max(...memVals), 2), avg: round(avg(memVals), 2), bytes: mem.at(-1).bytes },
      net: { current: net.at(-1).v, peak: net.at(-1).v, avg: Math.round(net.at(-1).v / 2) },
      throughput: { current: tpVals.at(-1), peak: Math.max(...tpVals), avg: Math.round(avg(tpVals)) },
      diskio: { peak: Math.round(Math.max(...diskio.map((p) => p.v))) },
      pids: { current: pids.at(-1).v, peak: Math.max(...pids.map((p) => p.v)), avg: round(avg(pids.map((p) => p.v)), 1) },
      uptimePct: round(97 + Math.random() * 3, 1),
    },
  };
}
