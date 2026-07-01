// Pricing plans derived from docs/pricing-research.md — customer-facing prices
// (USD/mo) with the Hetzner cost basis so the Billing page can show margin.
// ponytail: static catalog; move to DB when plans become editable/per-customer.

export const COMPUTE_PLANS = [
  { id: "hobby",    name: "Hobby",    ram: "512 MB", vcpu: "0.5 shared",    priceMo: 5,  costMo: 0.74, renderMo: 7,   note: "Personal projects" },
  { id: "starter",  name: "Starter",  ram: "1 GB",   vcpu: "0.5 shared",    priceMo: 9,  costMo: 1.48, renderMo: 7,   note: "Small apps" },
  { id: "pro",      name: "Pro",      ram: "2 GB",   vcpu: "1 shared",      priceMo: 15, costMo: 2.97, renderMo: 25,  note: "Production apps", popular: true },
  { id: "proplus",  name: "Pro Plus", ram: "4 GB",   vcpu: "2 dedicated",   priceMo: 45, costMo: 5.93, renderMo: 85,  note: "Busy production" },
  { id: "scale",    name: "Scale",    ram: "8 GB",   vcpu: "4 dedicated",   priceMo: 85, costMo: 9.17, renderMo: 175, note: "High traffic" },
];

export const DB_PLANS = [
  { id: "db-hobby",   name: "DB Hobby",   ram: "256 MB", storage: "2 GB",   priceMo: 5,  costMo: 0.5,  renderMo: 6 },
  { id: "db-starter", name: "DB Starter", ram: "1 GB",   storage: "10 GB",  priceMo: 12, costMo: 2,    renderMo: 19 },
  { id: "db-pro",     name: "DB Pro",     ram: "4 GB",   storage: "50 GB",  priceMo: 45, costMo: 9,    renderMo: 75 },
  { id: "db-scale",   name: "DB Scale",   ram: "8 GB",   storage: "100 GB", priceMo: 90, costMo: 15,   renderMo: 100 },
];

// Attach derived margin fields.
const withMargin = (p) => ({
  ...p,
  marginMo: +(p.priceMo - p.costMo).toFixed(2),
  marginPct: Math.round(((p.priceMo - p.costMo) / p.costMo) * 100),
  discountVsRenderPct: p.renderMo ? Math.round((1 - p.priceMo / p.renderMo) * 100) : null,
});

export const computePlans = () => COMPUTE_PLANS.map(withMargin);
export const dbPlans = () => DB_PLANS.map(withMargin);
