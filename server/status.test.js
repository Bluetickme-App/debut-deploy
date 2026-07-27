// Public status page. Run: node --test server/status.test.js
// The disclosure rules are the point of this suite: the page is unauthenticated, so a
// regression here publishes our stack or a customer's service name to the internet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatusHtml, buildHistory, uptimePct, worst, COMPONENT_FOR_TYPE, INCIDENT_TITLE } from "./status.js";

const COMPONENTS = ["Dashboard & API", "Builds & Deployments", "Hosting Infrastructure", "Platform Data"];
const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

const page = (situations = [], overall = "operational") => {
  const { history, incidents } = buildHistory(situations, { nowMs: NOW, componentNames: COMPONENTS });
  return renderStatusHtml({
    overall,
    components: COMPONENTS.map((name) => ({ name, status: "operational", note: "x", history: history[name], uptime: uptimePct(history[name]) })),
    incidents,
    checkedAt: NOW,
  });
};

test("CRITICAL: the page never names the stack we run on", () => {
  const html = page([{ type: "host.disk", severity: "crit", opened_at: new Date(NOW - 86400000).toISOString(), resolved_at: null }]);
  for (const leak of ["coolify", "hetzner", "docker", "traefik", "nixpacks", "sqlite", "mailcow", "stripe", "sslip"]) {
    assert.ok(!html.toLowerCase().includes(leak), `status page leaked "${leak}"`);
  }
});

test("CRITICAL: the page never publishes counts of servers or customers", () => {
  const html = page();
  assert.ok(!/\d+\s*\/\s*\d+\s*reachable/i.test(html), "leaked an n/m server count");
  assert.ok(!/\b\d+\s+(servers?|hosts?|containers?|customers?)\b/i.test(html), "leaked an estate size");
});

test("CRITICAL: a customer's service name can never reach the page", () => {
  // A real situation row carries the customer's service name in target/detail.
  const situations = [{
    type: "deploy.zombie", severity: "crit",
    target: "DebutWebConsultantsWebsite",
    detail: "DebutWebConsultantsWebsite deploy stalled — no progress for 3500s",
    opened_at: new Date(NOW - 2 * 86400000).toISOString(),
    resolved_at: new Date(NOW - 2 * 86400000 + 3600000).toISOString(),
  }];
  const { incidents } = buildHistory(situations, { nowMs: NOW, componentNames: COMPONENTS });
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].title, "Delays in the deployment pipeline");
  // The derived incident carries no target/detail at all...
  assert.equal(incidents[0].target, undefined);
  assert.equal(incidents[0].detail, undefined);
  // ...and the rendered page doesn't contain the name either.
  assert.ok(!page(situations).includes("DebutWebConsultantsWebsite"));
});

test("an unmapped situation type is dropped, not rendered raw", () => {
  const { incidents, history } = buildHistory(
    [{ type: "some.new.internal.alert", severity: "crit", opened_at: new Date(NOW).toISOString(), resolved_at: null }],
    { nowMs: NOW, componentNames: COMPONENTS }
  );
  assert.deepEqual(incidents, []);
  assert.ok(history["Hosting Infrastructure"].every((d) => d.status === "operational"));
});

test("every mapped type has both a component and a public title", () => {
  for (const type of Object.keys(COMPONENT_FOR_TYPE)) {
    assert.ok(INCIDENT_TITLE[type], `${type} has a component but no public incident title`);
  }
});

test("history marks the days a situation spanned, and only those", () => {
  const opened = new Date(NOW - 3 * 86400000).toISOString();
  const resolved = new Date(NOW - 2 * 86400000).toISOString();
  const { history } = buildHistory(
    [{ type: "host.disk", severity: "crit", opened_at: opened, resolved_at: resolved }],
    { nowMs: NOW, componentNames: COMPONENTS }
  );
  const days = history["Hosting Infrastructure"];
  assert.equal(days.length, 90);
  assert.equal(days.filter((d) => d.status === "outage").length, 2, "the two spanned days");
  assert.equal(days[days.length - 1].status, "operational", "today is unaffected");
  // A different component is untouched by a hosting incident.
  assert.ok(history["Builds & Deployments"].every((d) => d.status === "operational"));
});

test("warn severity degrades rather than outages", () => {
  const { history, incidents } = buildHistory(
    [{ type: "deploy.pileup", severity: "warn", opened_at: new Date(NOW).toISOString(), resolved_at: null }],
    { nowMs: NOW, componentNames: COMPONENTS }
  );
  assert.equal(history["Builds & Deployments"].at(-1).status, "degraded");
  assert.equal(incidents[0].severity, "degraded");
});

test("uptimePct: outage costs a full day, degraded a half", () => {
  assert.equal(uptimePct([{ status: "operational" }, { status: "operational" }]), 100);
  assert.equal(uptimePct([{ status: "operational" }, { status: "outage" }]), 50);
  assert.equal(uptimePct([{ status: "operational" }, { status: "degraded" }]), 75);
  assert.equal(uptimePct([]), null, "no rated days → no claim of uptime");
});

test("worst() ranks outage above degraded above operational", () => {
  assert.equal(worst("operational", "degraded"), "degraded");
  assert.equal(worst("degraded", "outage"), "outage");
  assert.equal(worst("outage", "operational"), "outage");
});

test("renders an empty-state instead of an empty incident list", () => {
  assert.match(page(), /No incidents reported in the last 90 days/);
});

test("HTML-escapes anything interpolated (defence in depth)", () => {
  const html = renderStatusHtml({
    overall: "operational",
    components: [{ name: '<script>alert(1)</script>', status: "operational", note: "x", history: [], uptime: null }],
    incidents: [],
    checkedAt: NOW,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
