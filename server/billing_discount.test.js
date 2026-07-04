// Run: node --test server/billing_discount.test.js
// computeMonthlyCharge must honour the per-org comp/discount override.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
const { db, createUser, getUserByEmail, ensureUserOrg, createProject, createEnvironment } = await import("./db.js");
const { placeResourceInEnvironment } = await import("./placement.js");
const { computeMonthlyCharge } = await import("./billing.js");
const { setComp } = await import("./comp.js");

// An org owning one 'pro' app ($15/mo). Returns the org id.
function orgWithProApp(email) {
  createUser({ email, name: email.split("@")[0], role: "admin" });
  const u = getUserByEmail(email);
  const org = ensureUserOrg(u.id);
  const proj = createProject(org, "P");
  const env = createEnvironment(org, proj.id, "Production");
  placeResourceInEnvironment({ user: u, type: "application", resourceUuid: `app-${org}`, environmentId: env.id });
  db.prepare("UPDATE resource_ownership SET plan_id = 'pro' WHERE coolify_uuid = ?").run(`app-${org}`);
  return org;
}

test("full price when the org has no override", () => {
  const org = orgWithProApp("full@x.com");
  const full = computeMonthlyCharge(org);
  assert.ok(full > 0, "a priced resource charges something");
});

test("a 25% discount scales the monthly charge down", () => {
  const org = orgWithProApp("disc@x.com");
  const full = computeMonthlyCharge(org);
  setComp(org, { discountPct: 25 });
  const discounted = computeMonthlyCharge(org);
  // Rounded once at the pence boundary, so allow ±1 pence of rounding slack.
  assert.ok(Math.abs(discounted - Math.round(full * 0.75)) <= 1, `expected ~${Math.round(full * 0.75)}, got ${discounted}`);
});

test("a comped org is charged nothing", () => {
  const org = orgWithProApp("comp@x.com");
  setComp(org, { comp: true });
  assert.equal(computeMonthlyCharge(org), 0);
});
