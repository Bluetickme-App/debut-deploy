import { useEffect, useState } from "react";
import { Field, Select } from "./ui.jsx";
import { api } from "../lib/api.js";

// Priced plan chooser for the create forms. kind = "compute" (services) | "db"
// (databases). Fetches /api/plans, shows a dropdown with the price in each label,
// and a live spec/price line under it. value/onChange carry the plan id, which the
// create routes already accept as plan_id.
const specOf = (p) => (p.vcpu ? `${p.vcpu} · ${p.ram} · ${p.disk}` : `${p.ram} RAM · ${p.storage} storage`);

export default function PlanPicker({ kind = "compute", value, onChange, label = "Plan" }) {
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    let off = false;
    api.plans()
      .then((d) => { if (!off) setPlans((kind === "db" ? d?.db : d?.compute) || []); })
      .catch(() => { if (!off) setPlans([]); });
    return () => { off = true; };
  }, [kind]);

  if (!plans || plans.length === 0) return null; // no catalog → no picker (free tier)
  const sel = plans.find((p) => p.id === value) || null;

  return (
    <Field label={label}>
      <Select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Free tier (shared, no plan)</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>{p.name} — ${p.priceMo}/mo · {specOf(p)}</option>
        ))}
      </Select>
      {sel ? (
        <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>${sel.priceMo}/mo</span> · {specOf(sel)}
          {sel.renderMo ? ` — ${Math.round((1 - sel.priceMo / sel.renderMo) * 100)}% under Render` : ""}
        </p>
      ) : (
        <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Pick a plan to set resources and price. Free tier shares the host with no monthly charge.
        </p>
      )}
    </Field>
  );
}
