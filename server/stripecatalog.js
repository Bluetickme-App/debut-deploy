// Stripe catalog (Stage 2): idempotently ensure a Product + a GBP Price and a USD
// Price per plan, in the ACTIVE Stripe mode. Creating products/prices charges nobody.
// Price ids are stored in app_settings keyed by MODE (test/live have separate objects,
// so switching modes never reuses the wrong environment's ids). A Price's amount is
// immutable, so if a plan price or the FX rate changes we mint a new Price and archive
// the old one; the stored value is "<priceId>:<amountMinor>" to detect drift.
import { stripeClient, stripeMode } from "./billing.js";
import { getSetting, setSetting } from "./db.js";
import { computePlans, dbPlans } from "./plans.js";
import { planAmountMinor } from "./subscriptions.js";

const allPlans = () => [...computePlans(), ...dbPlans()].map((p) => ({ id: p.id, name: p.name }));
const prodKey = (mode, plan) => `stripe_product_${mode}_${plan}`;
const priceKey = (mode, plan, cur) => `stripe_price_${mode}_${plan}_${cur}`;
const parseStored = (raw) => {
  const [priceId, amt] = String(raw || "").split(":");
  return priceId ? { priceId, amount: Number(amt) } : null;
};

// Read-only: what's configured for the active mode + whether each price matches the
// current target amount (no Stripe call — reads stored ids).
export function catalogStatus() {
  const mode = stripeMode();
  return {
    mode,
    plans: allPlans().map((p) => {
      const g = parseStored(getSetting(priceKey(mode, p.id, "gbp")));
      const u = parseStored(getSetting(priceKey(mode, p.id, "usd")));
      const wantG = planAmountMinor(p.id, "gbp");
      const wantU = planAmountMinor(p.id, "usd");
      return {
        plan: p.id,
        name: p.name,
        gbp: { current: wantG, priceId: g?.priceId || null, upToDate: !!g && g.amount === wantG },
        usd: { current: wantU, priceId: u?.priceId || null, upToDate: !!u && u.amount === wantU },
      };
    }),
    configured: allPlans().every((p) =>
      parseStored(getSetting(priceKey(mode, p.id, "gbp"))) && parseStored(getSetting(priceKey(mode, p.id, "usd")))),
  };
}

// Idempotent sync: ensure a Product + a GBP/USD monthly Price per plan for the active mode.
export async function ensureCatalog() {
  const stripe = stripeClient();
  if (!stripe) throw Object.assign(new Error("Stripe is not configured for this mode"), { status: 400 });
  const mode = stripeMode();
  const results = [];
  for (const p of allPlans()) {
    let productId = getSetting(prodKey(mode, p.id));
    if (!productId) {
      const prod = await stripe.products.create({ name: `DebutDeploy — ${p.name}`, metadata: { plan_id: p.id, mode } });
      productId = prod.id;
      setSetting(prodKey(mode, p.id), productId);
    }
    for (const currency of ["gbp", "usd"]) {
      const amount = planAmountMinor(p.id, currency);
      const existing = parseStored(getSetting(priceKey(mode, p.id, currency)));
      if (existing && existing.amount === amount) {
        results.push({ plan: p.id, currency, priceId: existing.priceId, amount, action: "reused" });
        continue;
      }
      const price = await stripe.prices.create({
        product: productId,
        currency,
        unit_amount: amount,
        recurring: { interval: "month" },
        nickname: `${p.name} ${currency.toUpperCase()}`,
        metadata: { plan_id: p.id, mode },
      });
      setSetting(priceKey(mode, p.id, currency), `${price.id}:${amount}`);
      if (existing?.priceId) await stripe.prices.update(existing.priceId, { active: false }).catch(() => {});
      results.push({ plan: p.id, currency, priceId: price.id, amount, action: existing ? "replaced" : "created" });
    }
  }
  return { mode, count: results.length, results };
}
