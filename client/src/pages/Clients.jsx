import { useEffect, useState, Fragment } from "react";
import { Users, Layers, Database, Wallet, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState, timeAgo } from "../components/ui.jsx";

const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;

function OrgUsageCell({ id }) {
  const [pence, setPence] = useState(null);
  useEffect(() => { api.adminOrgUsage(id).then((s) => setPence(s.totalPence)).catch(() => setPence(0)); }, [id]);
  return <span style={{ color: "var(--text-muted)" }}>{pence == null ? "…" : gbp(pence)}</span>;
}

// Operator billing panel for one client: balance, recent ledger, manual credit/debit.
function BillingPanel({ org, onChange }) {
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => api.adminOrgWallet(org.id).then(setWallet).catch((e) => setErr(e));
  useEffect(() => { load(); }, [org.id]); // wrap so the effect returns undefined, not a Promise

  const adjust = async (sign) => {
    const pounds = Number(amount);
    if (!Number.isFinite(pounds) || pounds <= 0) { setErr(new Error("Enter a positive amount")); return; }
    setBusy(true); setErr(null);
    try {
      await api.adminAdjustCredit(org.id, { amount_pence: sign * Math.round(pounds * 100), notes: notes || null });
      setAmount(""); setNotes("");
      await load();
      onChange?.(); // refresh the parent list balance
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  if (err && !wallet) return <div style={{ padding: 16, color: "var(--err)" }}>Failed to load wallet: {err.message}</div>;
  if (!wallet) return <div style={{ padding: 16, color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading wallet…</div>;

  const ledger = Array.isArray(wallet.recent_ledger) ? wallet.recent_ledger : [];

  return (
    <div style={{ padding: 16, background: "var(--surface-2)", display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
      <div>
        <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Recent ledger</div>
        {ledger.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No transactions yet.</div>}
        {ledger.length > 0 && (
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-1.5" style={{ color: "var(--text-muted)" }}>{l.created_at ? timeAgo(l.created_at) : "—"}</td>
                  <td className="py-1.5"><span className="pill pill-neutral">{l.type}</span></td>
                  <td className="py-1.5 mono" style={{ color: l.amount_pence < 0 ? "var(--err)" : "var(--ok-text)", textAlign: "right" }}>{l.amount_pence < 0 ? "−" : "+"}{gbp(Math.abs(l.amount_pence))}</td>
                  <td className="py-1.5" style={{ color: "var(--text-muted)", paddingLeft: 8 }}>{l.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Adjust credit (manual)</div>
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ color: "var(--text-muted)" }}>£</span>
          <input className="input" style={{ width: 100 }} type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="reason (e.g. comp, refund)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex gap-2 mt-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => adjust(+1)}>Credit</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => adjust(-1)}>Debit</button>
        </div>
        {err && <div className="text-xs mt-2" style={{ color: "var(--err)" }}>{err.message}</div>}
        <div className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Balance updates immediately; writes an audited <span className="mono">adjustment</span> ledger entry.</div>
      </div>
    </div>
  );
}

export default function Clients() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = () => api.adminOrgs().then(setOrgs).catch(setError);
  useEffect(load, []);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!orgs) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Clients" subtitle="Every client organization — resources, usage, and credit." />
      {orgs.length === 0 && <EmptyState title="No clients yet" description="Orgs appear here as users sign up." />}
      {orgs.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th className="px-4 py-3 font-semibold" style={{ width: 28 }}></th>
              <th className="px-4 py-3 font-semibold">Organization</th>
              <th className="px-4 py-3 font-semibold">Members</th>
              <th className="px-4 py-3 font-semibold">Services</th>
              <th className="px-4 py-3 font-semibold">Databases</th>
              <th className="px-4 py-3 font-semibold">Balance</th>
              <th className="px-4 py-3 font-semibold">Usage (mo)</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr></thead>
            <tbody>
              {orgs.map((o) => {
                const open = openId === o.id;
                const arrears = o.billing_status === "arrears" || o.balance_pence < 0;
                return (
                  <Fragment key={o.id}>
                    <tr style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setOpenId(open ? null : o.id)}>
                      <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text)" }}>{o.name}<div className="mono" style={{ color: "var(--text-muted)", fontSize: 12 }}>{o.slug}</div></td>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Users size={14} style={{ color: "var(--text-muted)" }} /> {o.members} ({o.owners} owner{o.owners !== 1 ? "s" : ""})</span></td>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Layers size={14} style={{ color: "var(--text-muted)" }} /> {o.applications}</span></td>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Database size={14} style={{ color: "var(--text-muted)" }} /> {o.databases}</span></td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 mono" style={{ color: arrears ? "var(--err)" : "var(--text)" }}>
                          <Wallet size={14} style={{ color: arrears ? "var(--err)" : "var(--text-muted)" }} /> {gbp(o.balance_pence ?? 0)}
                        </span>
                        {arrears && <span className="pill" style={{ marginLeft: 6, background: "var(--err)", color: "#fff" }}>arrears</span>}
                      </td>
                      <td className="px-4 py-3"><OrgUsageCell id={o.id} /></td>
                      <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{o.created_at ? timeAgo(o.created_at) : "—"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
                          <BillingPanel org={o} onChange={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
