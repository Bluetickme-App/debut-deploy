// Pricing plans derived from docs/pricing-research.md — customer-facing prices
// (USD/mo) with the Hetzner cost basis so the Billing page can show margin.
// ponytail: static catalog; move to DB when plans become editable/per-customer.

export const COMPUTE_PLANS = [
  { id: "hobby",    name: "Hobby",    ram: "512 MB", ramGb: 0.5, vcpu: "0.5 shared",  vcpuCount: 0.5, disk: "20 GB",  shared: true,  priceMo: 5,  costMo: 0.74, renderMo: 7,   note: "Personal projects" },
  { id: "starter",  name: "Starter",  ram: "1 GB",   ramGb: 1,   vcpu: "0.5 shared",  vcpuCount: 0.5, disk: "40 GB",  shared: true,  priceMo: 9,  costMo: 1.48, renderMo: 7,   note: "Small apps" },
  { id: "pro",      name: "Pro",      ram: "2 GB",   ramGb: 2,   vcpu: "1 shared",    vcpuCount: 1,   disk: "80 GB",  shared: true,  priceMo: 15, costMo: 2.97, renderMo: 25,  note: "Production apps", popular: true },
  { id: "proplus",  name: "Pro Plus", ram: "4 GB",   ramGb: 4,   vcpu: "2 dedicated", vcpuCount: 2,   disk: "160 GB", shared: false, priceMo: 45, costMo: 5.93, renderMo: 85,  note: "Busy production" },
  { id: "scale",    name: "Scale",    ram: "8 GB",   ramGb: 8,   vcpu: "4 dedicated", vcpuCount: 4,   disk: "240 GB", shared: false, priceMo: 85, costMo: 9.17, renderMo: 175, note: "High traffic" },
];

export const DB_PLANS = [
  { id: "db-hobby",   name: "DB Hobby",   ram: "256 MB", storage: "2 GB",   priceMo: 5,  costMo: 0.5,  renderMo: 6 },
  { id: "db-starter", name: "DB Starter", ram: "1 GB",   storage: "10 GB",  priceMo: 12, costMo: 2,    renderMo: 19 },
  { id: "db-pro",     name: "DB Pro",     ram: "4 GB",   storage: "50 GB",  priceMo: 45, costMo: 9,    renderMo: 75 },
  { id: "db-scale",   name: "DB Scale",   ram: "8 GB",   storage: "100 GB", priceMo: 90, costMo: 15,   renderMo: 100 },
];

// Email hosting — priced natively in GBP (billed/shown in £, NOT converted from USD
// like compute/db). One per-mailbox plan for now. costPence ≈ Stalwart licence + SES +
// storage/backup (see the email-hosting spec COGS ~£0.35–0.55/mailbox/mo).
export const MAIL_PLANS = [
  { id: "mail-standard", name: "Business Email", pricePence: 299, costPence: 55, storageGb: 10, note: "Per mailbox · webmail + IMAP/SMTP" },
];

// GBP-native margin fields (pence → £), mirroring withMargin's shape for the matrix.
export const mailPlans = () => MAIL_PLANS.map((p) => ({
  ...p,
  priceGbp: +(p.pricePence / 100).toFixed(2),
  costGbp: +(p.costPence / 100).toFixed(2),
  marginGbp: +((p.pricePence - p.costPence) / 100).toFixed(2),
  marginPct: Math.round(((p.pricePence - p.costPence) / p.costPence) * 100),
}));

// Attach derived margin fields.
const withMargin = (p) => ({
  ...p,
  marginMo: +(p.priceMo - p.costMo).toFixed(2),
  marginPct: Math.round(((p.priceMo - p.costMo) / p.costMo) * 100),
  discountVsRenderPct: p.renderMo ? Math.round((1 - p.priceMo / p.renderMo) * 100) : null,
});

export const computePlans = () => COMPUTE_PLANS.map(withMargin);
export const dbPlans = () => DB_PLANS.map(withMargin);

// USD/mo customer price for a plan id, across both catalogs. Unknown/null → 0
// (a resource with no plan contributes £0 to the monthly charge — free until assigned).
export function planPriceUsd(planId) {
  if (!planId) return 0;
  const p = [...COMPUTE_PLANS, ...DB_PLANS].find((x) => x.id === planId);
  return p ? p.priceMo : 0;
}

// Docker memory string for a plan's RAM — mirrors the client (ServiceDetail): <1G → "512M".
const ramToDocker = (gb) => (gb < 1 ? `${Math.round(gb * 1024)}M` : `${gb}G`);

// Detect the compute plan a service is on from its live Docker limits (cpus like "1"/"0.5",
// memory like "2G"/"512M"). Returns a plan id, or null when limits are unset/unlimited ("0")
// or don't match a tier — callers must NOT guess a plan for an unlimited service.
export function detectComputePlan(cpus, memory) {
  if (cpus == null || memory == null || String(cpus) === "0" || String(memory) === "0") return null;
  const p = COMPUTE_PLANS.find((x) => String(x.vcpuCount) === String(cpus) && ramToDocker(x.ramGb) === String(memory));
  return p ? p.id : null;
}
