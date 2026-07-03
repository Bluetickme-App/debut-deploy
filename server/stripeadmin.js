// Read-only Stripe data for the operator's admin dashboard, always for the ACTIVE
// mode (test|live). Every call is best-effort: a failing/permission-denied endpoint
// degrades to null/[] so the dashboard still renders. Never returns secret keys.
import { stripeClient, stripeMode, stripeModeAvailable } from "./billing.js";

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
  const [balance, charges, customers, payouts, account] = await Promise.all([
    safe(stripe.balance.retrieve()),
    safe(stripe.charges.list({ limit: 25 })),
    safe(stripe.customers.list({ limit: 25 })),
    safe(stripe.payouts.list({ limit: 10 })),
    safe(stripe.accounts.retrieve()),
  ]);
  const rows = (x) => (x && Array.isArray(x.data) ? x.data : []);

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
    charges: rows(charges).map((c) => ({
      id: c.id,
      amount: c.amount,
      currency: (c.currency || "").toUpperCase(),
      status: c.status,
      paid: c.paid,
      refunded: c.refunded,
      email: c.billing_details?.email || c.receipt_email || null,
      description: c.description || null,
      created: iso(c.created),
    })),
    customers: rows(customers).map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      created: iso(c.created),
    })),
    payouts: rows(payouts).map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: (p.currency || "").toUpperCase(),
      status: p.status,
      arrival: iso(p.arrival_date),
    })),
    counts: {
      charges: rows(charges).length,
      customers: rows(customers).length,
      payouts: rows(payouts).length,
    },
  };
}
