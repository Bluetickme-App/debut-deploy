// Billing: ledger + idempotency + charge math. Run: node --test server/test_billing.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const db = await import("./db.js");
const { planPriceUsd } = await import("./plans.js");
const billing = await import("./billing.js");
const { assign, release } = await import("./ownership.js");
const { usageSummary } = await import("./metering.js");

// Seed user for resource_ownership FK (user_id NOT NULL REFERENCES users(id))
db.createUser({ email: "seed@test.com", role: "customer" }); // gets id=1

test("planPriceUsd looks up compute + db catalogs; unknown → 0", () => {
  assert.equal(planPriceUsd("pro"), 15);
  assert.equal(planPriceUsd("db-pro"), 45);
  assert.equal(planPriceUsd("nope"), 0);
  assert.equal(planPriceUsd(null), 0);
});

test("usdToPence uses the configurable rate (default 0.79) and rounds", () => {
  // default rate 0.79: 15 USD → round(15*0.79*100) = round(1185) = 1185
  assert.equal(billing.usdToPence(15), 1185);
  db.setSetting("usd_gbp_rate", "0.80");
  assert.equal(billing.usdToPence(15), 1200); // round(15*0.80*100)
  db.setSetting("usd_gbp_rate", "0.79"); // restore for later tests
  assert.equal(billing.usdToPence(0), 0);
});

test("balance = SUM(amount_pence), integer pence, may go negative (arrears)", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Bal Co", "bal-co", now).lastInsertRowid;
  assert.equal(billing.walletBalance(org), 0); // empty ledger → £0
  billing.creditWallet({ orgId: org, amountPence: 1000, type: "topup", stripeSessionId: "cs_bal_1" }); // +£10
  billing.creditWallet({ orgId: org, amountPence: -300, type: "hardware_charge", period: "2026-07" }); // −£3
  assert.equal(billing.walletBalance(org), 700); // £7
  billing.creditWallet({ orgId: org, amountPence: -1000, type: "hardware_charge", period: "2026-08" }); // −£10
  assert.equal(billing.walletBalance(org), -300); // arrears, still integer
});

test("CRITICAL: crediting the same stripe_session_id twice inserts ONE row", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Idem Co", "idem-co", now).lastInsertRowid;
  const r1 = billing.creditWallet({ orgId: org, amountPence: 2500, type: "topup", stripeSessionId: "cs_dup" });
  const r2 = billing.creditWallet({ orgId: org, amountPence: 2500, type: "topup", stripeSessionId: "cs_dup" });
  assert.equal(r1.inserted, true);
  assert.equal(r2.inserted, false); // silent no-op on replay
  assert.equal(billing.walletBalance(org), 2500); // credited once, not twice
  const rows = db.db.prepare("SELECT COUNT(*) c FROM credit_ledger WHERE stripe_session_id='cs_dup'").get();
  assert.equal(rows.c, 1);
});

test("CRITICAL charge math: pro + db-pro, NULL plan contributes 0", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Charge Co", "charge-co", now).lastInsertRowid;
  const ins = db.db.prepare(
    "INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,plan_id,created_at) VALUES (?,?,?,?,?,?)"
  );
  ins.run("a-pro", "application", 1, org, "pro", now);      // $15
  ins.run("d-pro", "database", 1, org, "db-pro", now);      // $45
  ins.run("a-free", "application", 1, org, null, now);      // $0 (unassigned)
  // (15+45) USD * 0.79 * 100 = round(4740) = 4740 pence
  assert.equal(billing.computeMonthlyCharge(org), 4740);
});

test("CRITICAL: chargeMonthlyHardware is idempotent per (org, period)", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Month Co", "month-co", now).lastInsertRowid;
  db.db.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,plan_id,created_at) VALUES (?,?,?,?,?,?)")
    .run("m-pro", "application", 1, org, "pro", now); // round(15*0.79*100)=1185
  billing.creditWallet({ orgId: org, amountPence: 5000, type: "topup", stripeSessionId: "cs_month" });
  billing.chargeMonthlyHardware(org, "2026-07");
  billing.chargeMonthlyHardware(org, "2026-07"); // second call: no-op
  const rows = db.db.prepare(
    "SELECT COUNT(*) c FROM credit_ledger WHERE org_id=? AND type='hardware_charge' AND period='2026-07'"
  ).get(org);
  assert.equal(rows.c, 1); // exactly one charge for the period
  assert.equal(billing.walletBalance(org), 5000 - 1185);
});

test("charge drives negative balance → billing_status='arrears', no Stripe", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Arrears Co", "arrears-co", now).lastInsertRowid;
  db.db.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,plan_id,created_at) VALUES (?,?,?,?,?,?)")
    .run("ar-pro", "application", 1, org, "pro", now);
  // empty wallet → charge of 1185 pushes to −1185
  billing.chargeMonthlyHardware(org, "2026-07");
  assert.equal(billing.walletBalance(org), -1185);
  const st = db.db.prepare("SELECT billing_status FROM organizations WHERE id=?").get(org);
  assert.equal(st.billing_status, "arrears");
});

test("zero charge (no priced resources) inserts nothing", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Zero Co", "zero-co", now).lastInsertRowid;
  const res = billing.chargeMonthlyHardware(org, "2026-07");
  assert.equal(res.charged, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) c FROM credit_ledger WHERE org_id=?").get(org).c, 0);
});

test("getOrCreateStripeCustomer creates once, then reuses cus_ from the row", async () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Cust Co", "cust-co", now).lastInsertRowid;
  const u = db.createUser({ email: "owner@cust.co", name: "Owner", role: "customer" });
  db.db.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (?,?,?,?)")
    .run(u.id, org, "owner", now);

  let createCalls = 0;
  billing.setStripeForTests({
    customers: { create: async () => { createCalls += 1; return { id: "cus_stub_1" }; } },
  });
  const c1 = await billing.getOrCreateStripeCustomer(org);
  const c2 = await billing.getOrCreateStripeCustomer(org);
  assert.equal(c1, "cus_stub_1");
  assert.equal(c2, "cus_stub_1");
  assert.equal(createCalls, 1); // second call reuses the stored id
});

test("webhook credits a paid topup session once, idempotently", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Hook Co", "hook-co", now).lastInsertRowid;
  const event = {
    type: "checkout.session.completed",
    data: { object: { id: "cs_hook_1", mode: "payment", payment_status: "paid",
      amount_total: 5000,
      metadata: { org_id: String(org), amount_pence: "9999" } } }, // metadata intentionally differs to prove amount_total wins
  };
  const r1 = billing.handleWebhookEvent(event);
  const r2 = billing.handleWebhookEvent(event); // replay
  assert.equal(r1.credited, true);
  assert.equal(r2.credited, false); // idempotent: INSERT OR IGNORE no-op
  assert.equal(billing.walletBalance(org), 5000); // amount_total, not metadata.amount_pence
});

test("CRITICAL: release() stops billing — charge and disk lines gone after delete", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Release Co", "release-co", now).lastInsertRowid;
  const u = db.createUser({ email: "rel@release.co", role: "customer" });
  db.db.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (?,?,?,?)").run(u.id, org, "owner", now);

  assign("del-app", "application", u.id);
  db.db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?").run("pro", "application", "del-app");

  assert.ok(billing.computeMonthlyCharge(org) > 0, "charge > 0 before delete");
  const before = usageSummary(org, "2026-07");
  assert.ok(before.lines.some((l) => l.uuid === "del-app"), "disk line present before delete");

  const deleted = release("application", "del-app");
  assert.equal(deleted, 1, "release deleted 1 row");

  assert.equal(billing.computeMonthlyCharge(org), 0, "charge = 0 after delete");
  const after = usageSummary(org, "2026-07");
  assert.ok(!after.lines.some((l) => l.uuid === "del-app"), "no disk line after delete");
});

test("webhook ignores unpaid / non-payment sessions", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Ign Co", "ign-co", now).lastInsertRowid;
  billing.handleWebhookEvent({ type: "checkout.session.completed",
    data: { object: { id: "cs_unpaid", mode: "payment", payment_status: "unpaid",
      metadata: { org_id: String(org), amount_pence: "999" } } } });
  billing.handleWebhookEvent({ type: "payment_intent.created", data: { object: {} } });
  assert.equal(billing.walletBalance(org), 0);
});

test("admin billing view: listOrgsWithCounts exposes balance_pence + billing_status", () => {
  const u = db.createUser({ email: "adminview@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  billing.creditWallet({ orgId, amountPence: 5000, type: "topup", stripeSessionId: "cs_adminview" });
  billing.creditWallet({ orgId, amountPence: -1200, type: "adjustment", notes: "manual debit" });
  const row = db.listOrgsWithCounts().find((o) => o.id === orgId);
  assert.equal(row.balance_pence, 3800);          // 5000 - 1200
  assert.equal(row.billing_status, "ok");         // default from migration 11
});

test("admin credit adjustment: negative drives arrears balance, positive comps credit", () => {
  const u = db.createUser({ email: "adjust@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  billing.creditWallet({ orgId, amountPence: -900, type: "adjustment", notes: "correction" });
  assert.equal(billing.walletBalance(orgId), -900);   // debit → arrears territory
  billing.creditWallet({ orgId, amountPence: 2000, type: "adjustment", notes: "comp" });
  assert.equal(billing.walletBalance(orgId), 1100);   // comped back to positive
});

test("migration 13: org billing info columns exist + round-trip", () => {
  const u = db.createUser({ email: "bizinfo@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  assert.deepEqual(db.getOrgBillingInfo(orgId), { billing_email: null, billing_company: null, billing_vat: null, billing_address: null });
  db.setOrgBillingInfo(orgId, { email: "ap@acme.com", company: "Acme Ltd", vat: "GB123", address: "1 High St\nLondon" });
  assert.deepEqual(db.getOrgBillingInfo(orgId), { billing_email: "ap@acme.com", billing_company: "Acme Ltd", billing_vat: "GB123", billing_address: "1 High St\nLondon" });
});

test("listOrgResources returns each resource with its plan_id (null = free)", () => {
  const u = db.createUser({ email: "res@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  assign("app-res-1", "application", u.id);
  db.db.prepare("UPDATE resource_ownership SET plan_id='pro' WHERE coolify_uuid='app-res-1'").run();
  assign("app-res-2", "application", u.id); // no plan → free
  const rows = db.listOrgResources(orgId).filter((r) => r.coolify_uuid.startsWith("app-res"));
  assert.equal(rows.find((r) => r.coolify_uuid === "app-res-1").plan_id, "pro");
  assert.equal(rows.find((r) => r.coolify_uuid === "app-res-2").plan_id, null);
});
