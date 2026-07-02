import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState } from "../components/ui.jsx";

const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Usage() {
  const [period, setPeriod] = useState(thisMonth());
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSummary(null);
    setError(null);
    api.usage(period).then(setSummary).catch(setError);
  }, [period]);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!summary) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  const lines = summary.lines ?? [];
  const compute = lines.filter((l) => l.type === "compute");
  const disk = lines.filter((l) => l.type === "disk");
  const bandwidth = lines.filter((l) => l.type === "bandwidth");

  return (
    <div className="page">
      <PageHeader title="Usage" subtitle="Metered compute, allocated storage, and bandwidth for this period." />
      <div className="flex items-center gap-2 mb-4">
        <input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <div className="ml-auto text-sm" style={{ color: "var(--text-muted)" }}>
          Period total: <span className="font-semibold" style={{ color: "var(--text)" }}>{gbp(summary.totalPence ?? 0)}</span>
        </div>
      </div>

      {lines.length === 0 && (
        <EmptyState title="No usage yet" description="Assign a plan to a service or database to start metering. Free until assigned." />
      )}

      {lines.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th className="px-4 py-3 font-semibold">Resource</th>
              <th className="px-4 py-3 font-semibold">Plan</th>
              <th className="px-4 py-3 font-semibold">Dimension</th>
              <th className="px-4 py-3 font-semibold">Usage</th>
              <th className="px-4 py-3 font-semibold">Cost</th>
            </tr></thead>
            <tbody>
              {compute.map((l, i) => (
                <tr key={`c${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 mono" style={{ color: "var(--text)" }}>{l.uuid}</td>
                  <td className="px-4 py-3">{l.plan}</td>
                  <td className="px-4 py-3">Compute</td>
                  <td className="px-4 py-3">{l.computeHours} hrs</td>
                  <td className="px-4 py-3">{gbp(l.pence)}</td>
                </tr>
              ))}
              {disk.map((l, i) => (
                <tr key={`d${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 mono" style={{ color: "var(--text)" }}>{l.uuid}</td>
                  <td className="px-4 py-3">{l.plan}</td>
                  <td className="px-4 py-3">Disk (allocated)</td>
                  <td className="px-4 py-3">{l.allocatedGb} GB · {l.hours} hrs</td>
                  <td className="px-4 py-3">{gbp(l.pence)}</td>
                </tr>
              ))}
              {bandwidth.map((l, i) => (
                <tr key={`b${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 mono" style={{ color: "var(--text)" }}>{l.uuid}</td>
                  <td className="px-4 py-3">{l.plan}</td>
                  <td className="px-4 py-3">Bandwidth</td>
                  <td className="px-4 py-3">{l.usedGb} of {l.allowanceGb} GB allowance</td>
                  <td className="px-4 py-3">{gbp(l.pence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
