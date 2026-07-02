import { Card } from "./ui.jsx";

// Render-style compute plan cards. Presentational only — parent supplies the
// (margin-enriched) plans. showCost overlays base cost + margin (admin view).
export default function PlanMatrix({ plans, showCost = false }) {
  const usd = (n) => `$${Number(n)}`;
  const eur = (n) => `€${Number(n).toFixed(2)}`;

  const shared = plans.filter((p) => p.shared);
  const dedicated = plans.filter((p) => !p.shared);

  return (
    <div className="flex flex-col gap-5">
      {shared.length > 0 && <Group label="Shared CPU" plans={shared} showCost={showCost} usd={usd} eur={eur} />}
      {dedicated.length > 0 && <Group label="Dedicated CPU" plans={dedicated} showCost={showCost} usd={usd} eur={eur} />}
    </div>
  );
}

function Group({ label, plans, showCost, usd, eur }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
        {plans.map((p) => (
          <Card key={p.id} className="card-hover">
            {p.popular && <span className="pill pill-accent" style={{ marginBottom: 8 }}>Most popular</span>}
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{p.name}</div>
            <div className="mt-1 text-2xl font-bold" style={{ color: "var(--text)" }}>
              {usd(p.priceMo)}<span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>/mo</span>
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{p.vcpuCount} vCPU · {p.ram} · {p.disk}</div>
            {showCost && (
              <div className="mt-3 flex flex-col gap-1 text-xs">
                <span style={{ color: "var(--text-muted)" }}>cost {eur(p.costMo)}/mo</span>
                <span style={{ color: "var(--ok-text)" }}>margin {eur(p.marginMo)}/mo ({p.marginPct}%)</span>
                {p.discountVsRenderPct != null && <span style={{ color: "var(--text-muted)" }}>{p.discountVsRenderPct}% under Render (${p.renderMo})</span>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
