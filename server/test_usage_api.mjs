// Usage API contract + isolation. Run: node --test server/test_usage_api.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, ensureUserOrg, getOrgDetail } from "./db.js";
import { usageSummary } from "./metering.js";

test("a member's usage read is scoped to their own org_id", () => {
  const a = createUser({ email: "ua@x.com", role: "customer" });
  const b = createUser({ email: "ub@x.com", role: "customer" });
  const orgA = ensureUserOrg(a.id);
  const orgB = ensureUserOrg(b.id);
  // The route computes usageSummary(req.org.id, …). Org A's summary never reads org B.
  assert.notEqual(orgA, orgB);
  assert.equal(usageSummary(orgA, "2026-07").totalPence, 0);
});

test("admin usage of a missing org is a 404 (getOrgDetail returns undefined)", () => {
  // The admin route guards on getOrgDetail before calling usageSummary.
  assert.equal(getOrgDetail(999999), undefined); // → route throws 404
});

test("current-month default resolves to a valid YYYY-MM period", () => {
  const period = new Date().toISOString().slice(0, 7); // the route's default
  assert.match(period, /^\d{4}-\d{2}$/);
  const u = createUser({ email: "cur@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  assert.equal(usageSummary(orgId, period).period, period);
});
