process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { db } = await import("./db.js");
import { evaluateSituations, REGISTRY } from "./situations.js";

test("situations + remediation_log tables exist with expected columns", () => {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepEqual(cols("situations").sort(), ["auto_applied_at","detail","id","opened_at","resolved_at","severity","status","suggested_remediation","target","type"].sort());
  assert.ok(cols("remediation_log").includes("situation_id"));
  assert.ok(cols("remediation_log").includes("actor"));
});

test("evaluateSituations: volume crit → host.disk crit with prune suggestion", () => {
  const out = evaluateSituations({ host: { diskRoot: { pct: 40 }, diskVolume: { pct: 95 }, mem: { pct: 50 } }, sites: [], deploys: [] });
  const s = out.find((x) => x.type === "host.disk" && x.severity === "crit");
  assert.ok(s, "expected a crit host.disk situation");
  assert.equal(s.severity, "crit");
  assert.equal(s.suggested_remediation, "prune-docker");
  assert.match(s.detail, /volume/i);
});

test("evaluateSituations: zombie deploy → deploy.zombie crit", () => {
  const out = evaluateSituations({ host: { diskRoot: { pct: 5 }, diskVolume: null, mem: { pct: 10 } }, sites: [], deploys: [{ uuid: "d1", application_name: "X", status: "in_progress", ageSec: 5000 }] });
  assert.equal(out.find((x) => x.type === "deploy.zombie").severity, "crit");
});

test("evaluateSituations: all healthy → no situations", () => {
  assert.equal(
    evaluateSituations({ host: { diskRoot: { pct: 5 }, diskVolume: { pct: 5 }, mem: { pct: 10 } }, sites: [{ uuid: "a", name: "svc", status: "running", health: "healthy" }], deploys: [] }).length,
    0
  );
});

test("evaluateSituations: unhealthy site → service.unhealthy warn + restart suggestion", () => {
  const out = evaluateSituations({ host: { diskRoot: { pct: 5 }, diskVolume: null, mem: { pct: 10 } }, sites: [{ uuid: "s1", name: "app", status: "running", health: "unhealthy" }], deploys: [] });
  const s = out.find((x) => x.type === "service.unhealthy");
  assert.ok(s);
  assert.equal(s.severity, "warn");
  assert.equal(s.suggested_remediation, "restart-service");
});

test("evaluateSituations: queue pileup → deploy.pileup warn, no remediation", () => {
  const deploys = [1, 2, 3].map((i) => ({ uuid: `d${i}`, application_name: "X", status: "queued", ageSec: 10 }));
  const out = evaluateSituations({ host: { diskRoot: { pct: 5 }, diskVolume: null, mem: { pct: 10 } }, sites: [], deploys });
  const s = out.find((x) => x.type === "deploy.pileup");
  assert.ok(s);
  assert.equal(s.severity, "warn");
  assert.equal(s.suggested_remediation, null);
});

test("evaluateSituations: root disk warn (no volume)", () => {
  const out = evaluateSituations({ host: { diskRoot: { pct: 88 }, diskVolume: null, mem: { pct: 10 } }, sites: [], deploys: [] });
  const s = out.find((x) => x.type === "host.disk");
  assert.ok(s);
  assert.equal(s.severity, "warn");
  assert.match(s.detail, /root/i);
});

test("REGISTRY: every command is a fixed string, none auto in phase 2", () => {
  for (const r of Object.values(REGISTRY)) {
    assert.equal(typeof r.command, "string");
    assert.notEqual(r.auto, true);
  }
});

test("evaluateSituations: diskRoot.pct === 92 is exactly DISK_CRIT → host.disk crit", () => {
  const out = evaluateSituations({ host: { diskRoot: { pct: 92 }, diskVolume: null, mem: { pct: 10 } }, sites: [], deploys: [] });
  const s = out.find((x) => x.type === "host.disk");
  assert.ok(s, "expected a host.disk situation at pct=92");
  assert.equal(s.severity, "crit");
});

test("evaluateSituations: status 'stopped' + health 'healthy' → service.unhealthy warn", () => {
  const out = evaluateSituations({ host: { diskRoot: { pct: 5 }, diskVolume: null, mem: { pct: 10 } }, sites: [{ uuid: "s2", name: "svc", status: "stopped", health: "healthy" }], deploys: [] });
  const s = out.find((x) => x.type === "service.unhealthy");
  assert.ok(s, "expected service.unhealthy for stopped container");
  assert.equal(s.severity, "warn");
  assert.equal(s.suggested_remediation, "restart-service");
});

// ── collectSituationInputs ────────────────────────────────────────────────────

const { collectSituationInputs } = await import("./situations.js");

const FAKE_HOST = { diskRoot: { pct: 40 }, diskVolume: null, mem: { pct: 50 } };
const FAKE_SITE = { uuid: "csi-test-uuid", status: "running", health: "healthy" };

test("collectSituationInputs: populates host+sites from injected fleetOverview; deploys=[] (no SSH)", async () => {
  const result = await collectSituationInputs({
    fleetOverview: () => Promise.resolve({ host: FAKE_HOST, sites: [FAKE_SITE] }),
  });
  assert.deepEqual(result.host, FAKE_HOST);
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].uuid, FAKE_SITE.uuid);
  assert.ok(Array.isArray(result.deploys), "deploys must be an array");
  // runOnHost unavailable in test → best-effort path → []
  assert.equal(result.deploys.length, 0);
});

test("collectSituationInputs: does not throw when fleetOverview rejects", async () => {
  const result = await collectSituationInputs({
    fleetOverview: () => Promise.reject(new Error("network down")),
  });
  assert.ok(Array.isArray(result.sites));
  assert.ok(Array.isArray(result.deploys));
});

// ── reconcileSituations + listSituations ─────────────────────────────────────
// Unique type/target so these tests are isolated from all other rows in the shared :memory: db.

const { reconcileSituations, listSituations } = await import("./situations.js");

const RECON_ITEM = { type: "test.recon", target: "recon-A", severity: "warn", detail: "disk at 90%", suggested_remediation: "prune-docker" };
const NOW1 = "2026-01-01T00:00:00.000Z";
const NOW2 = "2026-01-02T00:00:00.000Z";
const NOW3 = "2026-01-03T00:00:00.000Z";

test("reconcile [A] → opened:[A], row in db", () => {
  const r = reconcileSituations([RECON_ITEM], NOW1);
  assert.equal(r.opened.length, 1);
  assert.equal(r.resolved.length, 0);
  assert.equal(r.opened[0].type, "test.recon");
  assert.equal(r.opened[0].target, "recon-A");
});

test("reconcile same [A] again → idempotent, opened:[] resolved:[]", () => {
  const r = reconcileSituations([RECON_ITEM], NOW2);
  assert.equal(r.opened.length, 0);
  assert.equal(r.resolved.length, 0);
});

test("reconcile [] → resolved:[A]", () => {
  const r = reconcileSituations([], NOW3);
  const mine = r.resolved.filter((x) => x.type === "test.recon" && x.target === "recon-A");
  assert.equal(mine.length, 1);
});

test("listSituations() returns only open rows (none for test.recon after resolve)", () => {
  const open = listSituations().filter((x) => x.type === "test.recon" && x.target === "recon-A");
  assert.equal(open.length, 0);
});

test("listSituations({includeResolved:true}) includes the resolved test.recon row", () => {
  const all = listSituations({ includeResolved: true }).filter((x) => x.type === "test.recon" && x.target === "recon-A");
  assert.equal(all.length, 1);
  assert.equal(all[0].status, "resolved");
});

// ── applyRemediation ──────────────────────────────────────────────────────────

const { applyRemediation } = await import("./situations.js");

test("applyRemediation: restart-service calls control(target, 'restart') and writes remediation_log", async () => {
  // Insert a unique open situation with restart-service remediation
  const r = reconcileSituations([{ type: "test.apply", target: "uuid-apply-001", severity: "warn", detail: "unhealthy", suggested_remediation: "restart-service" }], "2026-01-10T00:00:00.000Z");
  const situationId = r.opened[0].id;

  let called = null;
  const result = await applyRemediation(situationId, "tester", {
    control: async (uuid, action) => { called = { uuid, action }; return { ok: true }; },
  });

  assert.ok(result.ok, "applyRemediation should return ok:true");
  assert.deepEqual(called, { uuid: "uuid-apply-001", action: "restart" }, "control called with situation.target + 'restart'");

  const logRow = db.prepare("SELECT * FROM remediation_log WHERE situation_id = ? AND actor = 'tester'").get(situationId);
  assert.ok(logRow, "remediation_log row must exist");
  assert.equal(logRow.actor, "tester");
  assert.equal(logRow.ok, 1);
  assert.equal(logRow.action, "restart-service");
});

test("applyRemediation: null suggested_remediation → ok:false, no control call, no log row", async () => {
  const r = reconcileSituations([{ type: "test.apply", target: "uuid-apply-002", severity: "warn", detail: "mem pressure", suggested_remediation: null }], "2026-01-11T00:00:00.000Z");
  const situationId = r.opened[0].id;

  let controlCalled = false;
  const result = await applyRemediation(situationId, "tester2", {
    control: async () => { controlCalled = true; },
  });

  assert.equal(result.ok, false, "should return ok:false");
  assert.equal(controlCalled, false, "control must NOT be called");
  const logRow = db.prepare("SELECT * FROM remediation_log WHERE situation_id = ?").get(situationId);
  assert.equal(logRow, undefined, "no remediation_log row must be written");
});
