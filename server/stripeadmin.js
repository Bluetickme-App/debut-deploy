// Read-only Stripe data for the operator's admin dashboard, always for the ACTIVE
// mode (test|live). Every call is best-effort: a failing/permission-denied endpoint
// degrades to null/[] so the dashboard still renders. Never returns secret keys.
import { stripeClient, stripeMode, stripeModeAvailable } from "./billing.js";
import { db } from "./db.js";
import * as hetzner from "./hetzner.js";
import { catalogStatus } from "./stripecatalog.js";

// Cross-link Stripe records to our internal clients (orgs). A Stripe object is
// matched first by its stored customer id (organizations.stripe_customer_id), then
// by the billing email → the org whose member uses that email.
function clientIndex() {
  const byCustomer = new Map();
  for (const o of db.prepare("SELECT id, name, stripe_customer_id FROM organizations").all()) {
    if (o.stripe_customer_id) byCustomer.set(o.stripe_customer_id, { orgId: o.id, orgName: o.name });
  }
  const byEmail = new Map();
  for (const r of db.prepare(
    "SELECT LOWER(u.email) email, m.org_id, org.name org_name " +
    "FROM memberships m JOIN users u ON u.id = m.user_id JOIN organizations org ON org.id = m.org_id"
  ).all()) {
    if (r.email && !byEmail.has(r.email)) byEmail.set(r.email, { orgId: r.org_id, orgName: r.org_name });
  }
  return { byCustomer, byEmail };
}
const linkClient = (idx, { customerId, email } = {}) =>
  (customerId && idx.byCustomer.get(customerId)) ||
  (email && idx.byEmail.get(String(email).toLowerCase())) ||
  null;

// Normalise a subscription's price to a monthly amount (minor units) for MRR.
function subMonthlyAmount(sub) {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price?.unit_amount) return 0;
  const qty = item.quantity || 1;
  const per = { day: 30, week: 4.33, month: 1, year: 1 / 12 }[price.recurring?.interval] ?? 1;
  const count = price.recurring?.interval_count || 1;
  return Math.round((price.unit_amount * qty * per) / count);
}

// Which modes have a key, which is active, and a MASKED hint of the active key
// (prefix + last 4 only — never the full secret).
export function stripeConfig() {
  const mode = stripeMode();
  const key = mode === "live"
    ? (process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY)
    : (process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY);
  return {
    mode,
    configured: !!stripeClient(),
    available: { test: stripeModeAvailable("test"), live: stripeModeAvailable("live") },
    keyHint: key ? `${key.slice(0, 8)}…${key.slice(-4)}` : null,
  };
}

const iso = (unixSeconds) => (unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null);
const money = (amount, currency) => ({ amount, currency: (currency || "").toUpperCase() });

export async function stripeOverview() {
  const cfg = stripeConfig();
  const stripe = stripeClient();
  if (!stripe) return { ...cfg, ok: false };

  const safe = (p) => p.then((r) => r).catch((e) => ({ __error: e.message }));
  const [balance, charges, customers, payouts, subs, account, infra] = await Promise.all([
    safe(stripe.balance.retrieve()),
    safe(stripe.charges.list({ limit: 50 })),                       // 50 so status filters have something to work with
    safe(stripe.customers.list({ limit: 50 })),
    safe(stripe.payouts.list({ limit: 10 })),
    safe(stripe.subscriptions.list({ status: "all", limit: 50, expand: ["data.customer"] })),
    safe(stripe.accounts.retrieve()),
    hetzner.listServersWithCost().catch(() => null),               // live infra cost (EUR) — margin context
  ]);
  const rows = (x) => (x && Array.isArray(x.data) ? x.data : []);
  const idx = clientIndex();

  const subList = rows(subs).map((s) => {
    const email = s.customer && typeof s.customer === "object" ? s.customer.email : null;
    const client = linkClient(idx, { customerId: typeof s.customer === "string" ? s.customer : s.customer?.id, email });
    return {
      id: s.id,
      status: s.status, // active | past_due | canceled | trialing | unpaid | incomplete
      email,
      client,
      monthly: subMonthlyAmount(s),
      currency: (s.items?.data?.[0]?.price?.currency || s.currency || "").toUpperCase(),
      interval: s.items?.data?.[0]?.price?.recurring?.interval || null,
      current_period_end: iso(s.current_period_end),
    };
  });
  // MRR = sum of ACTIVE/trialing subscriptions normalised to monthly, per currency.
  const mrr = {};
  for (const s of subList) {
    if (s.status === "active" || s.status === "trialing") mrr[s.currency] = (mrr[s.currency] || 0) + s.monthly;
  }

  return {
    ...cfg,
    ok: true,
    account: account && !account.__error
      ? {
          id: account.id,
          name: account.business_profile?.name || account.settings?.dashboard?.display_name || account.email || null,
          country: account.country || null,
          charges_enabled: account.charges_enabled ?? null,
          payouts_enabled: account.payouts_enabled ?? null,
        }
      : null,
    balance: balance && !balance.__error
      ? {
          available: (balance.available || []).map((b) => money(b.amount, b.currency)),
          pending: (balance.pending || []).map((b) => money(b.amount, b.currency)),
        }
      : null,
    // Live infra cost (Hetzner) so revenue can be read against spend on the same screen.
    infra: infra ? { monthlyEur: infra.totalMonthly, hourlyEur: infra.totalHourly, servers: (infra.servers || []).length } : null,
    catalog: catalogStatus(), // Stage-2 plan Product/Price state for the active mode

    mrr: Object.entries(mrr).map(([currency, amount]) => ({ amount, currency })),
    charges: rows(charges).map((c) => {
      const email = c.billing_details?.email || c.receipt_email || null;
      return {
        id: c.id,
        amount: c.amount,
        currency: (c.currency || "").toUpperCase(),
        status: c.status,               // succeeded | pending | failed
        paid: c.paid,
        refunded: c.refunded,
        email,
        client: linkClient(idx, { customerId: typeof c.customer === "string" ? c.customer : c.customer?.id, email }),
        description: c.description || null,
        failure: c.failure_message || null,
        created: iso(c.created),
      };
    }),
    customers: rows(customers).map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      client: linkClient(idx, { customerId: c.id, email: c.email }),
      created: iso(c.created),
    })),
    payouts: rows(payouts).map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: (p.currency || "").toUpperCase(),
      status: p.status,
      arrival: iso(p.arrival_date),
    })),
    subscriptions: subList,
    counts: {
      charges: rows(charges).length,
      failed: rows(charges).filter((c) => c.status === "failed").length,
      customers: rows(customers).length,
      payouts: rows(payouts).length,
      subscriptions: subList.length,
      active_subs: subList.filter((s) => s.status === "active" || s.status === "trialing").length,
    },
  };
}
