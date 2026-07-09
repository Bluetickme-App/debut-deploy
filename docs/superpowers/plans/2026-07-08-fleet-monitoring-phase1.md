# Fleet Monitoring — Phase 1 (Visibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators (and Claude Code via MCP) one consolidated view of host capacity — RAM, CPU, root disk *and* the `/mnt/dockerdata` volume — plus a per-site table of memory/CPU/disk, with a restart button.

**Architecture:** Extend the existing health-tick sampler ([server/metrics.js](../../../server/metrics.js)) and SSH host-exec ([server/hostexec.js](../../../server/hostexec.js)). Add per-container disk sampling and host-volume capacity to what's already collected, expose it via one new admin route `/api/fleet/overview`, mirror it in the MCP, and render a Fleet dashboard page reusing existing UI components. No new services, no new dependencies.

**Tech Stack:** Node ESM, Express, better-sqlite3, `ssh2` (via `runOnHost`), React + Vite + Tailwind v4, `@modelcontextprotocol/sdk` + `zod`, `node:test`.

## Global Constraints

- ESM everywhere (`import`, not `require`); `"type": "module"`.
- All host access goes through `runOnHost()` in [hostexec.js](../../../server/hostexec.js) (pinned host key; fails closed). Never shell out from the app container directly.
- New DDL must be additive/idempotent and auto-migrate at boot (same pattern as the existing `metrics_samples` / `host_samples` tables in [server/db.js](../../../server/db.js)).
- Pure parsing/bucketing helpers are exported and unit-tested with injected data; DB/SSH helpers are best-effort (wrapped so they never crash the health tick).
- Sampler must stay flat-cost: one SSH round-trip per collector per tick.
- New operator routes are admin-gated: `requireAuth, requireAdmin`.
- Demo mode (`demoMode`) must return synthesized/empty data so the dashboard renders with no live host.
- Reuse `parseBytes`, `mapNamesToUuids`, `resource_ownership`, and the `h()` route wrapper — do not re-implement.

---

### Task 1: Per-container disk parsing + column

**Files:**
- Modify: `server/db.js` (add `disk_bytes` column to `metrics_samples`)
- Modify: `server/metrics.js` (add `parseDiskLine`, `sampleContainerDisk`)
- Test: `server/metrics.test.js`

**Interfaces:**
- Produces: `parseDiskLine(line) -> { name: string, disk_bytes: number } | null` (parses `docker ps -s` size cells)
- Produces: `sampleContainerDisk() -> Promise<Array<{ name, disk_bytes }>>`

- [ ] **Step 1: Write the failing test**

Add to `server/metrics.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_FILE=:memory: node --test --test-name-pattern="parseDiskLine" server/metrics.test.js`
Expected: FAIL — `M.parseDiskLine is not a function`.

- [ ] **Step 3: Implement the parser + sampler in `server/metrics.js`**

Add after `parseStatsLine` (reuse the existing `parseBytes`):

```javascript
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

// One SSH round-trip: total footprint of every container. `docker ps -s` is heavier
// than `docker stats` (it walks layer sizes), so this is called on a slower cadence.
export async function sampleContainerDisk() {
  if (DEMO) return [];
  const out = await runOnHost("docker ps -s --format '{{.Names}}|{{.Size}}'");
  return String(out).trim().split("\n").filter(Boolean).map(parseDiskLine).filter(Boolean);
}
```

- [ ] **Step 4: Add the column in `server/db.js`**

Find the `metrics_samples` table definition. Add a guarded column (matching the file's existing additive-migration style):

```javascript
// additive: per-container disk footprint (sampled on a slower cadence than cpu/mem)
try { db.exec("ALTER TABLE metrics_samples ADD COLUMN disk_bytes INTEGER"); } catch { /* exists */ }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_FILE=:memory: node --test --test-name-pattern="parseDiskLine" server/metrics.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/metrics.js server/db.js server/metrics.test.js
git commit -m "feat(metrics): per-container disk footprint parsing + sampler"
```

---

### Task 2: Host volume capacity (root + /mnt/dockerdata)

**Files:**
- Modify: `server/metrics.js` (`parseHostCapacity`, `sampleHostCapacity`, `insertHostSample`, `hostHistory`)
- Modify: `server/db.js` (`vol_used_bytes`, `vol_total_bytes` columns on `host_samples`)
- Test: `server/metrics.test.js`

**Interfaces:**
- Produces (extended): `parseHostCapacity(out)` now also returns `vol_used_bytes`, `vol_total_bytes` (nullable)

- [ ] **Step 1: Write the failing test**

Add to `server/metrics.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_FILE=:memory: node --test --test-name-pattern="docker volume|volume absent" server/metrics.test.js`
Expected: FAIL — `vol_total_bytes` is `undefined`.

- [ ] **Step 3: Extend the parser and sampler in `server/metrics.js`**

In `parseHostCapacity`, add before the `return`:

```javascript
  const vol_total_bytes = num(/VOL_TOTAL=(\d+)/);
  const vol_used_bytes = num(/VOL_USED=(\d+)/);
```

and add them to the returned object: `return { cpu_pct, mem_used_bytes, mem_total_bytes, disk_used_bytes, disk_total_bytes, vol_used_bytes, vol_total_bytes };`

In `sampleHostCapacity`, append two guarded lines to the remote command (the `2>/dev/null || echo 0` keeps a host without the volume clean — treat 0 as "no volume"):

```javascript
    "echo CORES=$(nproc); echo LOAD1=$(awk '{print $1}' /proc/loadavg); " +
    "echo VOL_TOTAL=$(df -B1 --output=size /mnt/dockerdata 2>/dev/null | tail -1 || echo 0); " +
    "echo VOL_USED=$(df -B1 --output=used /mnt/dockerdata 2>/dev/null | tail -1 || echo 0)"
```

In `parseHostCapacity`, coerce a `0` total to `null` (no volume): after computing `vol_total_bytes`, `const volT = vol_total_bytes || null;` and return `vol_total_bytes: volT, vol_used_bytes: volT ? vol_used_bytes : null`.

- [ ] **Step 4: Persist + surface the columns**

In `server/db.js`, add guarded columns to `host_samples`:

```javascript
try { db.exec("ALTER TABLE host_samples ADD COLUMN vol_used_bytes INTEGER"); } catch { /* exists */ }
try { db.exec("ALTER TABLE host_samples ADD COLUMN vol_total_bytes INTEGER"); } catch { /* exists */ }
```

In `server/metrics.js` `insertHostSample`, extend the INSERT to include the two new columns (bind `sample.vol_used_bytes ?? null`, `sample.vol_total_bytes ?? null`). In `hostHistory`, add to the `cur` SELECT and to the returned `stats` a `volume: { current: pct(cur.vol_used_bytes, cur.vol_total_bytes), bytes: cur.vol_used_bytes, total: cur.vol_total_bytes }` (guard when total is null → omit/`null`).

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_FILE=:memory: node --test --test-name-pattern="host" server/metrics.test.js`
Expected: PASS (existing host tests still green).

- [ ] **Step 6: Commit**

```bash
git add server/metrics.js server/db.js server/metrics.test.js
git commit -m "feat(metrics): sample /mnt/dockerdata volume capacity alongside root disk"
```

---

### Task 3: Wire disk sampling into the tick + store it

**Files:**
- Modify: `server/metrics.js` (`sampleAndStore`, `insertMetricsSamples` or a small disk-merge insert)
- Modify: `server/index.js` (health tick — pass a slower disk cadence)
- Test: `server/metrics.test.js`

**Interfaces:**
- Consumes: `sampleContainerDisk` (Task 1), `mapNamesToUuids` (exists)
- Produces: `sampleAndStore(sampledAt, { withDisk?: boolean }) -> Promise<number>` — when `withDisk`, also writes `disk_bytes` for the current tick's rows.

- [ ] **Step 1: Write the failing test**

Add to `server/metrics.test.js` (uses the in-memory DB, stubs SSH by inserting directly):

```javascript
test("upsertDiskBytes: attaches latest disk_bytes to a uuid's most recent sample", () => {
  const at = new Date().toISOString();
  M.insertMetricsSamples([{ coolify_uuid: "svc1", cpu_pct: 1, mem_bytes: 100, mem_pct: 1,
    net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 1 }], at);
  const n = M.upsertDiskBytes([{ coolify_uuid: "svc1", disk_bytes: 5_000_000 }], at);
  assert.equal(n, 1);
  const hist = M.metricsHistory("svc1", "1h");
  assert.ok(hist.stats.mem.bytes >= 0); // sanity: row exists
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_FILE=:memory: node --test --test-name-pattern="upsertDiskBytes" server/metrics.test.js`
Expected: FAIL — `M.upsertDiskBytes is not a function`.

- [ ] **Step 3: Implement `upsertDiskBytes` and extend `sampleAndStore`**

In `server/metrics.js`:

```javascript
// Write disk_bytes onto this tick's just-inserted rows (matched by uuid + sampledAt).
export function upsertDiskBytes(rows, sampledAt) {
  if (!rows.length) return 0;
  const stmt = db.prepare("UPDATE metrics_samples SET disk_bytes = ? WHERE coolify_uuid = ? AND sampled_at = ?");
  let n = 0;
  const tx = db.transaction((rs) => { for (const r of rs) n += stmt.run(r.disk_bytes, r.coolify_uuid, sampledAt).changes; });
  tx(rows);
  return n;
}
```

Extend `sampleAndStore(sampledAt, { withDisk = false } = {})`: after the existing container + host inserts, add:

```javascript
  if (withDisk) {
    try {
      const owned = db.prepare("SELECT coolify_uuid FROM resource_ownership").all().map((r) => r.coolify_uuid);
      const disk = mapNamesToUuids(await sampleContainerDisk(), owned);
      upsertDiskBytes(disk, sampledAt);
    } catch { /* disk sample best-effort */ }
  }
```

- [ ] **Step 4: Drive the cadence from the health tick**

In `server/index.js` (~line 2603, the metrics-sampling block), replace the single call so disk is sampled ~ every 10th tick:

```javascript
      try {
        const now = new Date().toISOString();
        healthTickN = (healthTickN + 1) % 10;              // module-scope: let healthTickN = 0;
        await sampleAndStore(now, { withDisk: healthTickN === 0 });
      } catch (mErr) {
        console.error("metrics sampling:", mErr.message);
      }
```

Declare `let healthTickN = 0;` near `healthSnapshot` (~line 2560).

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_FILE=:memory: node --test server/metrics.test.js`
Expected: PASS (all metrics tests).

- [ ] **Step 6: Commit**

```bash
git add server/metrics.js server/index.js server/metrics.test.js
git commit -m "feat(metrics): sample container disk every 10th tick and persist"
```

---

### Task 4: `/api/fleet/overview` endpoint

**Files:**
- Modify: `server/metrics.js` (`fleetOverview()`)
- Modify: `server/index.js` (route, near the other metrics routes ~line 505)
- Test: `server/metrics.test.js`; smoke `server/test_fleet_routes.mjs` (new)

**Interfaces:**
- Produces: `fleetOverview() -> { host: { cpu, mem:{used,total,pct}, diskRoot:{used,total,pct}, diskVolume:{used,total,pct}|null }, sites: Array<{ uuid, cpu_pct, mem_bytes, mem_pct, disk_bytes }> }` built from the latest `host_samples` row and each uuid's latest `metrics_samples` row.
- Consumes: `resource_ownership`, latest `host_samples`/`metrics_samples`.

- [ ] **Step 1: Write the failing test**

Add to `server/metrics.test.js`:

```javascript
test("fleetOverview: latest host + per-site rows shaped for the dashboard", () => {
  const at = new Date().toISOString();
  M.insertHostSample({ cpu_pct: 12, mem_used_bytes: 3e9, mem_total_bytes: 8e9,
    disk_used_bytes: 2.4e9, disk_total_bytes: 75e9, vol_used_bytes: 73e9, vol_total_bytes: 196e9 }, at);
  M.insertMetricsSamples([{ coolify_uuid: "svc1", cpu_pct: 5, mem_bytes: 4e8, mem_pct: 5,
    net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 3 }], at);
  M.upsertDiskBytes([{ coolify_uuid: "svc1", disk_bytes: 8.8e9 }], at);
  const o = M.fleetOverview();
  assert.equal(o.host.diskRoot.pct, 3.2);          // 2.4/75
  assert.equal(o.host.diskVolume.pct, 37.2);       // 73/196
  const s = o.sites.find((x) => x.uuid === "svc1");
  assert.equal(s.disk_bytes, 8.8e9);
  assert.equal(s.mem_pct, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_FILE=:memory: node --test --test-name-pattern="fleetOverview" server/metrics.test.js`
Expected: FAIL — `M.fleetOverview is not a function`.

- [ ] **Step 3: Implement `fleetOverview` in `server/metrics.js`**

```javascript
// Latest host capacity + each owned service's most-recent sample, shaped for the
// Fleet dashboard. Reads only the newest row per uuid (cheap; no bucketing).
export function fleetOverview() {
  const pct = (u, t) => (t > 0 ? Math.round((1000 * u) / t) / 10 : 0);
  const host = db.prepare("SELECT * FROM host_samples ORDER BY sampled_at DESC LIMIT 1").get();
  const sites = db.prepare(`
    SELECT m.coolify_uuid AS uuid, m.cpu_pct, m.mem_bytes, m.mem_pct, m.disk_bytes
    FROM metrics_samples m
    JOIN (SELECT coolify_uuid, MAX(sampled_at) AS mx FROM metrics_samples GROUP BY coolify_uuid) l
      ON l.coolify_uuid = m.coolify_uuid AND l.mx = m.sampled_at
  `).all();
  const h = host || {};
  return {
    host: {
      cpu: h.cpu_pct ?? null,
      mem: { used: h.mem_used_bytes ?? null, total: h.mem_total_bytes ?? null, pct: pct(h.mem_used_bytes, h.mem_total_bytes) },
      diskRoot: { used: h.disk_used_bytes ?? null, total: h.disk_total_bytes ?? null, pct: pct(h.disk_used_bytes, h.disk_total_bytes) },
      diskVolume: h.vol_total_bytes ? { used: h.vol_used_bytes, total: h.vol_total_bytes, pct: pct(h.vol_used_bytes, h.vol_total_bytes) } : null,
    },
    sites,
  };
}
```

- [ ] **Step 4: Add the route in `server/index.js`**

After the `/api/metrics/host` route (~line 519), and import `fleetOverview` in the metrics import on line 110:

```javascript
// Fleet overview: host capacity (root + volume) + latest per-site usage. Admin.
app.get(
  "/api/fleet/overview",
  requireAuth,
  requireAdmin,
  h(async () => {
    if (demoMode) return {
      host: { cpu: 12, mem: { used: 3.1e9, total: 8e9, pct: 39 },
        diskRoot: { used: 2.4e9, total: 75e9, pct: 4 }, diskVolume: { used: 73e9, total: 196e9, pct: 37 } },
      sites: [{ uuid: "demo-svc", cpu_pct: 3.2, mem_bytes: 4.8e8, mem_pct: 6, disk_bytes: 8.8e9 }],
    };
    const o = fleetOverview();
    // enrich uuids with names/status from the services list the panel already fetches
    const svcs = await listServicesForUser(req.user).catch(() => []); // reuse existing services fetch
    const byId = Object.fromEntries(svcs.map((s) => [s.uuid, s]));
    o.sites = o.sites.map((s) => ({ ...s, name: byId[s.uuid]?.name || s.uuid, status: byId[s.uuid]?.status, health: byId[s.uuid]?.health }));
    return o;
  })
);
```

> Note for implementer: use whatever the file already calls to list services for the admin (search near `/api/services` handler for the existing helper, e.g. `listServices`/`servicesForUser`); wire that in place of `listServicesForUser`. If none is trivially reusable, return `o` without enrichment and let the client join against its existing services list.

- [ ] **Step 5: Smoke test the route**

Create `server/test_fleet_routes.mjs` mirroring an existing `test_*_routes.mjs` (boot the app with `DEMO_MODE=true`, an admin session, GET `/api/fleet/overview`, assert `host.diskVolume.pct === 37` and `sites.length >= 1`). Run:

Run: `node server/test_fleet_routes.mjs`
Expected: prints PASS / exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/metrics.js server/index.js server/metrics.test.js server/test_fleet_routes.mjs
git commit -m "feat(fleet): GET /api/fleet/overview (host root+volume + per-site usage)"
```

---

### Task 5: MCP tools — host_metrics, fleet_overview, container_disk

**Files:**
- Modify: `mcp/server.js`
- Modify: `docs/api.md` (document the new endpoint)

**Interfaces:**
- Consumes: `/api/fleet/overview`, `/api/metrics/host`, `/api/services/:id/metrics`.

- [ ] **Step 1: Register the tools**

In `mcp/server.js`, after `billing` (line ~183), add:

```javascript
server.registerTool(
  "fleet_overview",
  { description: "Fleet snapshot: host RAM/CPU/root-disk/volume-disk + latest per-site memory/CPU/disk. Admin.", inputSchema: {} },
  tool(() => api("/api/fleet/overview"))
);

server.registerTool(
  "host_metrics",
  { description: "Host capacity history (CPU/RAM/disk %) for the box. Admin.",
    inputSchema: { window: z.enum(["1h", "6h", "24h"]).optional().describe("Lookback window (default 1h)") } },
  tool(({ window }) => api(`/api/metrics/host${window ? `?window=${window}` : ""}`))
);

server.registerTool(
  "container_disk",
  { description: "Live per-container resource stats for one service (incl. current usage).", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/metrics`))
);
```

- [ ] **Step 2: Verify the server lists the new tools**

Run: `DEBUTDEPLOY_TOKEN=x node mcp/server.js` then send an MCP `tools/list` (or start it under the client). Confirm `fleet_overview`, `host_metrics`, `container_disk` appear. (No unit-test harness for the MCP; a load-without-crash + tools/list is the check.)
Expected: server starts; three new tools listed. `Ctrl-C` to exit.

- [ ] **Step 3: Document + commit**

Add the `/api/fleet/overview` row to `docs/api.md` (mirror the `/api/metrics/host` entry).

```bash
git add mcp/server.js docs/api.md
git commit -m "feat(mcp): fleet_overview, host_metrics, container_disk tools"
```

---

### Task 6: Fleet dashboard page

**Files:**
- Modify: `client/src/lib/api.js` (add `fleetOverview`)
- Create: `client/src/pages/Fleet.jsx`
- Modify: `client/src/App.jsx` (route + sidebar nav — mirror the `Servers` page registration)
- Modify: `client/src/pages/Servers.jsx` (export the `Meter` helper for reuse) OR copy the small `Meter` into `Fleet.jsx`

**Interfaces:**
- Consumes: `GET /api/fleet/overview`; existing `control_service` restart via `api` (POST `/api/services/:id/restart`).

- [ ] **Step 1: Add the API method**

In `client/src/lib/api.js`, inside the `export const api = { … }` object, add:

```javascript
  fleetOverview: () => req("/fleet/overview"),
  restartService: (id) => req(`/services/${id}/restart`, { method: "POST" }),
```

> Use whatever the file's internal request helper is named (the module wraps `fetch("/api"+path,…)`; match the existing methods' style — if they call a local `req`/`get`, use that; if they inline `fetch`, inline it the same way).

- [ ] **Step 2: Create the page**

Create `client/src/pages/Fleet.jsx` reusing `ui.jsx` components and the `Meter` pattern from `Servers.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Cpu, MemoryStick, HardDrive, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Card, PageHeader, Spinner, StatusPill } from "../components/ui.jsx";

const gb = (b) => (b == null ? "—" : `${(b / 1e9).toFixed(1)} GB`);
const barColor = (v) => (v > 90 ? "var(--err)" : v > 75 ? "var(--warn)" : "var(--ok)");

function Gauge({ icon: Icon, label, pct, sub }) {
  return (
    <Card>
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1"><Icon className="h-4 w-4" /> {label}</span>
        <span style={{ color: "var(--text)" }}>{pct == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct || 0}%`, background: barColor(pct || 0) }} />
      </div>
      {sub && <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </Card>
  );
}

export default function Fleet() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => api.fleetOverview().then(setData).catch((e) => setErr(e.message || "Failed to load"));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  async function restart(uuid) {
    setBusy(uuid);
    try { await api.restartService(uuid); setTimeout(load, 2000); }
    catch (e) { setErr(e.message || "Restart failed"); }
    finally { setBusy(""); }
  }

  const h = data?.host;
  return (
    <div className="page space-y-6">
      <PageHeader title="Fleet" subtitle="Host capacity and per-site usage" />
      {err && <p className="text-sm" style={{ color: "var(--err)" }}>{err}</p>}
      {!data ? (
        <div className="flex h-40 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}><Spinner /> Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Gauge icon={Cpu} label="CPU" pct={h.cpu} />
            <Gauge icon={MemoryStick} label="RAM" pct={h.mem.pct} sub={`${gb(h.mem.used)} / ${gb(h.mem.total)}`} />
            <Gauge icon={HardDrive} label="Root disk" pct={h.diskRoot.pct} sub={`${gb(h.diskRoot.used)} / ${gb(h.diskRoot.total)}`} />
            {h.diskVolume && <Gauge icon={HardDrive} label="Docker volume" pct={h.diskVolume.pct} sub={`${gb(h.diskVolume.used)} / ${gb(h.diskVolume.total)}`} />}
          </div>

          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs">
                  <th className="p-2">Site</th><th className="p-2">Status</th><th className="p-2">CPU</th>
                  <th className="p-2">Memory</th><th className="p-2">Disk</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...data.sites].sort((a, b) => (b.disk_bytes || 0) - (a.disk_bytes || 0)).map((s) => (
                  <tr key={s.uuid} style={{ borderTop: "1px solid var(--surface-2)" }}>
                    <td className="p-2" style={{ color: "var(--text)" }}>{s.name || s.uuid}</td>
                    <td className="p-2">{s.status ? <StatusPill status={s.health ? `${s.status}:${s.health}` : s.status} /> : "—"}</td>
                    <td className="p-2">{s.cpu_pct != null ? `${s.cpu_pct}%` : "—"}</td>
                    <td className="p-2">{gb(s.mem_bytes)}{s.mem_pct != null ? ` (${s.mem_pct}%)` : ""}</td>
                    <td className="p-2">{gb(s.disk_bytes)}</td>
                    <td className="p-2 text-right">
                      <Button variant="ghost" disabled={busy === s.uuid} onClick={() => restart(s.uuid)}>
                        {busy === s.uuid ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} Restart
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
```

> If `StatusPill` doesn't accept a compound `status:health` string, pass just `s.status` (check the `StatusPill` prop contract in `ui.jsx`). If `Button` has no `variant="ghost"`, drop the prop.

- [ ] **Step 2b: Register route + nav in `client/src/App.jsx`**

Mirror the existing `Servers` page registration exactly: add `import Fleet from "./pages/Fleet.jsx";`, add a sidebar nav entry (label "Fleet", an icon e.g. `Activity`/`Gauge` from lucide) in the same admin section as "Servers", and add the matching route entry. Follow the surrounding code — same guard/admin-visibility as the `Servers`/`Customers` admin pages.

- [ ] **Step 3: Verify in the running app**

Run: `npm run dev` (from repo root; API :8787 + UI :5173). Log in as admin, open the **Fleet** nav item.
Expected: host gauges render (in demo mode the synthesized values: RAM 39%, root 4%, volume 37%), the per-site table lists at least the demo row, and the Restart button issues a POST (network tab shows `/api/services/…/restart`). Live values appear once the server runs against the real host.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: Vite build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Fleet.jsx client/src/App.jsx client/src/lib/api.js client/src/pages/Servers.jsx
git commit -m "feat(fleet): Fleet dashboard page (host gauges + per-site table + restart)"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Fleet dashboard host RAM/disk/CPU incl. volume → Task 2 (volume sampling) + Task 4 (overview) + Task 6 (UI). ✓
- Per-site memory/CPU/**disk** table → Task 1 (disk) + Task 3 (persist) + Task 4/6. ✓
- Restart button in panel → Task 6 (reuses existing `control_service`). ✓
- MCP host metrics + per-container disk → Task 5. ✓
- Reuse existing backend, admin-gated, demo-safe, best-effort sampler → Global Constraints + each task. ✓
- Phase 2 (situations/suggested fixes) and Phase 3 (auto-remediation) are intentionally **out of this plan** — separate plans once Phase 1 lands.

**Placeholder scan:** The two implementer notes (services-list helper name in Task 4; `api.js` request-helper name and `StatusPill`/`Button` prop contracts in Task 6) are deliberate adaptation points to unread local conventions, each with a concrete fallback — not blanks. All code steps contain real code.

**Type consistency:** `disk_bytes` (Tasks 1/3/4/6), `vol_used_bytes`/`vol_total_bytes` (Task 2/4), `fleetOverview()` shape (Task 4) consumed identically by the route, MCP, and UI. `upsertDiskBytes(rows, sampledAt)` signature matches between Task 3 definition and its `sampleAndStore` caller.
