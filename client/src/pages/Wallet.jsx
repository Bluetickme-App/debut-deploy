import { useEffect, useState } from "react";
import { Wallet as WalletIcon, CreditCard, ExternalLink, AlertTriangle } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.jsx";
import { PageHeader, Card, Spinner, timeAgo } from "../components/ui.jsx";

const PRESETS = [1000, 2500, 5000, 10000]; // pence: £10 / £25 / £50 / £100
const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;

export default function Wallet() {
  const { user } = useAuth();
  const isOwner = user?.orgRole === "owner";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [amount, setAmount] = useState(2500); // pence
  const [busy, setBusy] = useState(false);

  const load = () => api.wallet().then(setData).catch(setError);
  useEffect(load, []);

  const topup = async (pence) => {
    setBusy(true);
    try { const { url } = await api.topup(pence); window.location.href = url; }
    catch (e) { setError(e); setBusy(false); }
  };
  const openPortal = async () => {
    setBusy(true);
    try { const { url } = await api.billingPortal(); window.location.href = url; }
    catch (e) { setError(e); setBusy(false); }
  };

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!data) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Wallet" subtitle="Your prepaid credit wallet." />

      {data.billing_status === "arrears" && (
        <Card className="mb-6" style={{ borderColor: "var(--err)" }}>
          <div className="flex items-center gap-2" style={{ color: "var(--err)" }}>
            <AlertTriangle size={16} />
            <span className="text-sm">Your balance is negative. Top up to clear arrears — no service is suspended.</span>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex items-center gap-2 mb-1" style={{ color: "var(--text-muted)" }}>
          <WalletIcon size={16} /><span className="text-sm">Wallet balance</span>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, color: data.balance_pence < 0 ? "var(--err)" : "var(--text)" }}>
          {gbp(data.balance_pence)}
        </div>

        {isOwner && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2 items-center">
              {PRESETS.map((p) => (
                <button key={p} className={`btn ${amount === p ? "btn-primary" : ""}`} onClick={() => setAmount(p)}>{gbp(p)}</button>
              ))}
              <input className="input" type="number" min="1" step="1" style={{ width: 120 }}
                value={amount / 100} onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))} />
              <button className="btn btn-primary" disabled={busy || amount < 100} onClick={() => topup(amount)}>
                <CreditCard size={14} /> Top up
              </button>
              <button className="btn" disabled={busy} onClick={openPortal}><ExternalLink size={14} /> Manage in Stripe</button>
            </div>
          </div>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Notes</th>
          </tr></thead>
          <tbody>
            {data.recent_ledger.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{timeAgo(r.created_at)}</td>
                <td className="px-4 py-3" style={{ color: "var(--text)" }}>{r.type}</td>
                <td className="px-4 py-3" style={{ color: r.amount_pence < 0 ? "var(--err)" : "var(--ok, var(--text))" }}>
                  {r.amount_pence < 0 ? "−" : "+"}{gbp(Math.abs(r.amount_pence))}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{r.notes || (r.period ? r.period : "—")}</td>
              </tr>
            ))}
            {data.recent_ledger.length === 0 && (
              <tr><td className="px-4 py-6" colSpan={4} style={{ color: "var(--text-muted)" }}>No transactions yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
