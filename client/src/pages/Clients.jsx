import { useEffect, useState, Fragment } from "react";
import { Users, Layers, Database, Wallet, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState, timeAgo } from "../components/ui.jsx";

const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

const PAY_STATUS = {
  succeeded: { label: "succeeded", ok: true },
  processing: { label: "processing", ok: null },
  requires_payment_method: { label: "failed / no method", ok: false },
  requires_action: { label: "needs auth (3DS)", ok: null },
  requires_confirmation: { label: "unconfirmed", ok: null },
  canceled: { label: "canceled", ok: false },
};

function Section({ title, right, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

// Operator billing detail for one client (Render-style, prepaid model).
function BillingPanel({ org, onChange }) {
  const [wallet, setWallet] = useState(null);
  const [payments, setPayments] = useState(null);
  const [resources, setResources] = useState(null);
  const [usage, setUsage] = useState(null);
  const [info, setInfo] = useState(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => {
    api.adminOrgWallet(org.id).then(setWallet).catch((e) => setErr(e));
    api.adminOrgPayments(org.id).then(setPayments).catch(() => setPayments({ payments: [], configured: false }));
    api.adminOrgResources(org.id).then(setResources).catch(() => setResources({ resources: [], monthly_total_pence: 0 }));
    api.adminOrgUsage(org.id).then(setUsage).catch(() => setUsage({ lines: [], totalPence: 0 }));
    api.adminOrgBillingInfo(org.id).then(setInfo).catch(() => setInfo({}));
  };
  useEffect(() => { load(); }, [org.id]);

  const adjust = async (sign) => {
    const pounds = Number(amount);
    if (!Number.isFinite(pounds) || pounds <= 0) { setErr(new Error("Enter a positive amount")); return; }
    setBusy(true); setErr(null);
    try {
      await api.adminAdjustCredit(org.id, { amount_pence: sign * Math.round(pounds * 100), notes: notes || null });
      setAmount(""); setNotes("");
      await api.adminOrgWallet(org.id).then(setWallet);
      onChange?.();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const saveInfo = async () => {
    setSavingInfo(true);
    try { setInfo(await api.adminSaveBillingInfo(org.id, info)); }
    catch (e) { setErr(e); } finally { setSavingInfo(false); }
  };

  if (err && !wallet) return <div style={{ padding: 16, color: "var(--err)" }}>Failed to load: {err.message}</div>;
  if (!wallet) return <div style={{ padding: 16, color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  const ledger = Array.isArray(wallet.recent_ledger) ? wallet.recent_ledger : [];
  const resList = resources?.resources || [];
  const usageLines = usage?.lines || [];

  // Accrued (metered usage month-to-date) + linear projection to month end.
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const accrued = usage?.totalPence ?? 0;
  const projected = dayOfMonth > 0 ? Math.round((accrued / dayOfMonth) * daysInMonth) : accrued;

  const cell = { padding: "6px 8px 6px 0", color: "var(--text-muted)" };

  return (
    <div style={{ padding: 16, background: "var(--surface-2)", display: "grid", gap: 18 }}>
      {/* Summary line */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>Balance <span className="mono" style={{ color: wallet.balance_pence < 0 ? "var(--err)" : "var(--text)" }}>{gbp(wallet.balance_pence)}</span></span>
        <span>{org.members} member{org.members !== 1 ? "s" : ""} · {org.owners} owner{org.owners !== 1 ? "s" : ""}</span>
        <span>{org.applications} service{org.applications !== 1 ? "s" : ""} · {org.databases} DB{org.databases !== 1 ? "s" : ""}</span>
        {payments?.customer && <span>Stripe <span className="mono">{payments.customer}</span></span>}
      </div>

      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr 1fr" }}>
        {/* Plan — per-resource plans + monthly £ */}
        <Section title="Plan" right={<span className="text-xs mono" style={{ color: "var(--text)" }}>{gbp(resources?.monthly_total_pence)}/mo</span>}>
          {resList.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No resources.</div>}
          {resList.length > 0 && (
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {resList.map((r) => (
                  <tr key={`${r.type}-${r.uuid}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}><span className="pill pill-neutral">{r.type === "application" ? "service" : r.type}</span></td>
                    <td style={{ ...cell, color: "var(--text)" }} className="mono">{r.uuid.slice(0, 12)}</td>
                    <td style={cell}>{r.plan_id || <span style={{ color: "var(--text-muted)" }}>free</span>}</td>
                    <td className="mono" style={{ ...cell, color: "var(--text)", textAlign: "right", paddingRight: 0 }}>{gbp(r.monthly_pence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Included Usage — metered breakdown */}
        <Section title="Usage this month" right={<span className="text-xs mono" style={{ color: "var(--text)" }}>{gbp(accrued)}</span>}>
          {!usage && <div className="text-xs" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> …</div>}
          {usage && usageLines.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No metered usage yet.</div>}
          {usageLines.length > 0 && (
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {usageLines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}><span className="pill pill-neutral">{l.type}</span></td>
                    <td style={{ ...cell, color: "var(--text-muted)" }}>
                      {l.type === "compute" && `${(l.computeHours ?? 0).toFixed(1)} hr`}
                      {l.type === "disk" && `${l.allocatedGb ?? 0} GB × ${(l.hours ?? 0).toFixed(0)} hr`}
                      {l.type === "bandwidth" && `${l.usedGb ?? 0} / ${l.allowanceGb ?? 0} GB`}
                    </td>
                    <td className="mono" style={{ ...cell, color: "var(--text)", textAlign: "right", paddingRight: 0 }}>{gbp(l.pence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* Unbilled / accrued charges */}
      <Section title="Unbilled charges (month to date)">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>Metered usage so far: <span className="mono" style={{ color: "var(--text)" }}>{gbp(accrued)}</span></span>
          <span>Projected month-end: <span className="mono" style={{ color: "var(--text)" }}>{gbp(projected)}</span></span>
          <span>Monthly plan cost: <span className="mono" style={{ color: "var(--text)" }}>{gbp(resources?.monthly_total_pence)}</span></span>
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Prepaid: the monthly plan cost is charged from credit; metered usage is shown for transparency (drawdown not yet wired).</div>
      </Section>

      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr 1fr" }}>
        {/* Credit ledger */}
        <Section title="Credit ledger">
          {ledger.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No credit transactions yet.</div>}
          {ledger.length > 0 && (
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}>{l.created_at ? timeAgo(l.created_at) : "—"}</td>
                    <td style={cell}><span className="pill pill-neutral">{l.type}</span></td>
                    <td className="mono" style={{ ...cell, color: l.amount_pence < 0 ? "var(--err)" : "var(--ok-text)", textAlign: "right", paddingRight: 0 }}>{l.amount_pence < 0 ? "−" : "+"}{gbp(Math.abs(l.amount_pence))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Manual adjust */}
        <Section title="Adjust credit (manual)">
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ color: "var(--text-muted)" }}>£</span>
            <input className="input" style={{ width: 90 }} type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="reason (comp, refund)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => adjust(+1)}>Credit</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => adjust(-1)}>Debit</button>
          </div>
          {err && <div className="text-xs mt-2" style={{ color: "var(--err)" }}>{err.message}</div>}
        </Section>
      </div>

      {/* Stripe payment attempts — succeeded AND failed/abandoned */}
      <Section title="Stripe payment attempts">
        {!payments && <div className="text-xs" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> …</div>}
        {payments && payments.payments.length === 0 && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {payments.configured === false ? "Stripe is not configured on the server." : payments.customer ? "No payment attempts yet." : "No Stripe customer yet — this client hasn't started a top-up."}
          </div>
        )}
        {payments && payments.payments.length > 0 && (
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {payments.payments.map((p) => {
                const st = PAY_STATUS[p.status] || { label: p.status, ok: null };
                const col = st.ok === true ? "var(--ok-text)" : st.ok === false ? "var(--err)" : "var(--text-muted)";
                return (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}>{p.created ? timeAgo(p.created) : "—"}</td>
                    <td className="mono" style={{ ...cell, color: "var(--text)" }}>{gbp(p.amount_pence)}</td>
                    <td style={cell}><span className="pill" style={{ color: col, borderColor: col }}>{st.label}</span></td>
                    <td style={{ ...cell, color: "var(--err)" }}>{p.error || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* Billing information */}
      <Section title="Billing information" right={<button className="btn" disabled={savingInfo} onClick={saveInfo}>{savingInfo ? "Saving…" : "Save"}</button>}>
        <div className="flex flex-wrap gap-2">
          <input className="input" style={{ minWidth: 200 }} placeholder="billing email" value={info?.billing_email || ""} onChange={(e) => setInfo({ ...info, billing_email: e.target.value })} />
          <input className="input" style={{ minWidth: 160 }} placeholder="company name" value={info?.billing_company || ""} onChange={(e) => setInfo({ ...info, billing_company: e.target.value })} />
          <input className="input" style={{ minWidth: 120 }} placeholder="VAT number" value={info?.billing_vat || ""} onChange={(e) => setInfo({ ...info, billing_vat: e.target.value })} />
        </div>
      </Section>
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

function OrgUsageCell({ id }) {
  const [pence, setPence] = useState(null);
  useEffect(() => { api.adminOrgUsage(id).then((s) => setPence(s.totalPence)).catch(() => setPence(0)); }, [id]);
  return <span style={{ color: "var(--text-muted)" }}>{pence == null ? "…" : gbp(pence)}</span>;
}
