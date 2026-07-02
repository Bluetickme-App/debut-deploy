import { useEffect, useState } from "react";
import { Users, Layers, Database } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState, timeAgo } from "../components/ui.jsx";

function OrgUsageCell({ id }) {
  const [pence, setPence] = useState(null);
  useEffect(() => { api.adminOrgUsage(id).then((s) => setPence(s.totalPence)).catch(() => setPence(0)); }, [id]);
  return <span style={{ color: "var(--text-muted)" }}>{pence == null ? "…" : `£${(pence / 100).toFixed(2)}`}</span>;
}

export default function Clients() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.adminOrgs().then(setOrgs).catch(setError); }, []);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!orgs) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Clients" subtitle="Every client organization and what it runs." />
      {orgs.length === 0 && <EmptyState title="No clients yet" description="Orgs appear here as users sign up." />}
      {orgs.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th className="px-4 py-3 font-semibold">Organization</th>
              <th className="px-4 py-3 font-semibold">Members</th>
              <th className="px-4 py-3 font-semibold">Services</th>
              <th className="px-4 py-3 font-semibold">Databases</th>
              <th className="px-4 py-3 font-semibold">Created</th>
              <th className="px-4 py-3 font-semibold">Usage (mo)</th>
            </tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3" style={{ color: "var(--text)" }}>{o.name}<div className="mono" style={{ color: "var(--text-muted)", fontSize: 12 }}>{o.slug}</div></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Users size={14} style={{ color: "var(--text-muted)" }} /> {o.members} ({o.owners} owner{o.owners !== 1 ? "s" : ""})</span></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Layers size={14} style={{ color: "var(--text-muted)" }} /> {o.applications}</span></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Database size={14} style={{ color: "var(--text-muted)" }} /> {o.databases}</span></td>
                  <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{o.created_at ? timeAgo(o.created_at) : "—"}</td>
                  <td className="px-4 py-3"><OrgUsageCell id={o.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
