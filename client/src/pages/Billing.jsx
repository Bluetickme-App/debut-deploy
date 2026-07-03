import { useEffect, useState } from "react";
import { Server, TrendingUp, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, StatusPill } from "../components/ui.jsx";
import PlanMatrix from "../components/PlanMatrix.jsx";

// Admin billing: what the infra actually costs (Hetzner) + the customer plans
// and the margin on each. Data from /api/billing.
export default function Billing() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.billing().then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed to load billing: {error.message}</p></div>;
  if (!data) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  // Defensive defaults: a malformed /api/billing payload must not blank the page.
  const infra = { servers: [], totalMonthly: 0, totalHourly: 0, ...(data.infra || {}) };
  if (!Array.isArray(infra.servers)) infra.servers = [];
  const computePlans = Array.isArray(data.computePlans) ? data.computePlans : [];
  const dbPlans = Array.isArray(data.dbPlans) ? data.dbPlans : [];
  const eur = (n) => `€${Number(n || 0).toFixed(2)}`;
  const usd = (n) => `$${Number(n || 0)}`;

  return (
    <div className="page">
      <PageHeader title="Billing & Plans" subtitle="What your infrastructure costs, and what you charge for it." />

      {/* Infra spend */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Server size={16} /> <span className="font-semibold text-sm">Infrastructure spend (Hetzner)</span>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold" style={{ color: "var(--text)" }}>{eur(infra.totalMonthly)}<span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>/mo</span></div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{eur(infra.totalHourly)}/hr · {infra.servers.length} server{infra.servers.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm" style={{ minWidth: 520, borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th className="py-2 pr-4 font-semibold">Server</th><th className="py-2 pr-4 font-semibold">Type</th>
              <th className="py-2 pr-4 font-semibold">Region</th><th className="py-2 pr-4 font-semibold">Status</th>
              <th className="py-2 pr-4 font-semibold">€/hr</th><th className="py-2 font-semibold">€/mo</th>
            </tr></thead>
            <tbody>
              {infra.servers.map((s) => (
                <tr key={s.name} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2 pr-4" style={{ color: "var(--text)" }}>{s.name}</td>
                  <td className="py-2 pr-4 mono" style={{ color: "var(--text-muted)" }}>{s.type} · {s.cores}vCPU/{s.memory}GB</td>
                  <td className="py-2 pr-4" style={{ color: "var(--text-muted)" }}>{s.location}</td>
                  <td className="py-2 pr-4"><StatusPill status={(s.status || "").split(":")[0]} /></td>
                  <td className="py-2 pr-4 mono" style={{ color: "var(--text-muted)" }}>{eur(s.hourly)}</td>
                  <td className="py-2 mono" style={{ color: "var(--text)" }}>{eur(s.monthly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Compute plans */}
      <div className="flex items-center gap-2 mb-3" style={{ color: "var(--text)" }}>
        <TrendingUp size={16} /> <span className="font-semibold text-sm">Compute plans</span>
      </div>
      <div className="mb-6">
        <PlanMatrix plans={computePlans} showCost={true} />
      </div>

      {/* DB plans */}
      <div className="flex items-center gap-2 mb-3" style={{ color: "var(--text)" }}>
        <TrendingUp size={16} /> <span className="font-semibold text-sm">Managed Postgres add-ons</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
        {dbPlans.map((p) => (
          <Card key={p.id} className="card-hover">
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{p.name}</div>
            <div className="mt-1 text-2xl font-bold" style={{ color: "var(--text)" }}>{usd(p.priceMo)}<span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>/mo</span></div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{p.ram} RAM · {p.storage} storage</div>
            <div className="mt-3 text-xs" style={{ color: "var(--ok-text)" }}>margin {eur(p.marginMo)}/mo · {p.discountVsRenderPct}% under Render</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
