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
