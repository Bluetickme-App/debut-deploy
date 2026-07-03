import { useEffect, useState } from "react";
import { Search, FileText, Plus, Minus, Info } from "lucide-react";
import { api } from "../lib/api.js";
import { Spinner, timeAgo } from "../components/ui.jsx";

const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

const PAY_STATUS = {
  succeeded: { label: "succeeded", ok: true },
  processing: { label: "processing", ok: null },
  requires_payment_method: { label: "failed · no method", ok: false },
  requires_action: { label: "needs auth (3DS)", ok: null },
  requires_confirmation: { label: "unconfirmed", ok: null },
  canceled: { label: "canceled", ok: false },
};
const LEDGER_DESC = { topup: "Top-up", hardware_charge: "Plan charge", adjustment: "Manual adjustment", refund: "Refund", usage: "Metered usage" };
const AVATARS = ["#2563eb", "#0d9488", "#8b5cf6", "#d9822b", "#db2777", "#0891b2", "#65a30d"];

const s = {
  search: { width: 220, padding: "8px 12px 8px 33px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" },
  btnSecondary: { display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 15px", borderRadius: 9, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  btnDanger: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 15px", borderRadius: 9, border: "1px solid var(--err)", background: "var(--err)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  btnPrimarySm: { padding: "7px 15px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  btnGhostSm: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "none" },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" },
  blockTitle: { fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-muted)" },
  statLabel: { fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 },
  statVal: { fontSize: 19, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 },
  input: { width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  amountInput: { width: "100%", padding: "9px 12px 9px 24px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontFamily: "var(--mono, monospace)", outline: "none", boxSizing: "border-box" },
};

function csvDownload(orgs) {
  const head = ["name", "slug", "balance_gbp", "members", "owners", "services", "databases", "status"];
  const rows = orgs.map((o) => [o.name, o.slug, ((o.balance_pence || 0) / 100).toFixed(2), o.members, o.owners, o.applications, o.databases, o.billing_status || "ok"]);
  const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "clients.csv"; a.click();
  URL.revokeObjectURL(url);
}

function AccountCard({ org, color, expanded, onToggle, onChange }) {
  const [spend, setSpend] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [payments, setPayments] = useState(null);
  const [resources, setResources] = useState(null);
  const [info, setInfo] = useState(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => { api.adminOrgUsage(org.id).then((u) => setSpend(u.totalPence)).catch(() => setSpend(0)); }, [org.id]);
  useEffect(() => {
    if (!expanded || wallet) return;
    api.adminOrgWallet(org.id).then(setWallet).catch(() => setWallet({ balance_pence: org.balance_pence, recent_ledger: [] }));
    api.adminOrgPayments(org.id).then(setPayments).catch(() => setPayments({ payments: [], configured: false }));
    api.adminOrgResources(org.id).then(setResources).catch(() => setResources({ monthly_total_pence: 0 }));
    api.adminOrgBillingInfo(org.id).then(setInfo).catch(() => setInfo({}));
  }, [expanded]); // eslint-disable-line

  const pastDue = org.billing_status === "arrears" || org.balance_pence < 0;
  const balancePos = (org.balance_pence || 0) > 0;

  const adjust = async (sign) => {
    const pounds = Number(amount);
    if (!Number.isFinite(pounds) || pounds <= 0) return;
    setBusy(true);
    try {
      await api.adminAdjustCredit(org.id, { amount_pence: sign * Math.round(pounds * 100), notes: notes || null });
      setAmount(""); setNotes("");
      setWallet(await api.adminOrgWallet(org.id));
      onChange?.();
    } finally { setBusy(false); }
  };
  const saveInfo = async () => { setSavingInfo(true); try { setInfo(await api.adminSaveBillingInfo(org.id, info)); } finally { setSavingInfo(false); } };

  // Accrued + projection
  const now = new Date();
  const dom = now.getUTCDate();
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const accrued = spend ?? 0;
  const projected = dom > 0 ? Math.round((accrued / dom) * dim) : accrued;
  const planTotal = resources?.monthly_total_pence ?? 0;

  return (
    <div style={{ border: pastDue ? "1px solid var(--err)" : "1px solid var(--border)", borderRadius: 13, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
      {/* Collapsed header */}
      <div role="button" onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 18px", cursor: "pointer" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform .15s", transform: expanded ? "rotate(90deg)" : "none", flexShrink: 0 }}><path d="m9 18 6-6-6-6" /></svg>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{(org.name || "?")[0].toUpperCase()}</span>
        <div style={{ minWidth: 0, maxWidth: 260 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org.name}</span>
            {pastDue && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: "var(--err-soft)", color: "var(--err-text)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--err)" }} />Past due</span>}
          </div>
          <span style={{ display: "block", fontFamily: "var(--mono, monospace)", fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org.slug}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0, marginLeft: "auto" }}>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 70 }}>
            <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: pastDue ? "var(--err-text)" : balancePos ? "var(--ok-text)" : "var(--text)" }}>{gbp(org.balance_pence)}</span>
            <span style={{ fontSize: 9.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>Credit</span>
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 74 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{spend == null ? "…" : gbp(spend)}</span>
            <span style={{ fontSize: 9.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>MTD spend</span>
          </span>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", minWidth: 58, textAlign: "right", whiteSpace: "nowrap" }}>{org.created_at ? timeAgo(org.created_at) : "—"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "20px 22px 22px", background: "var(--surface-2)" }}>
          {/* Summary line */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 18px", marginBottom: 18, fontSize: 12.5, color: "var(--text-muted)" }}>
            <span>Balance <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{gbp(org.balance_pence)}</strong></span>
            <span style={{ width: 1, height: 12, background: "var(--border-strong)" }} />
            <span>{org.members} member{org.members !== 1 ? "s" : ""} · {org.owners} owner{org.owners !== 1 ? "s" : ""}</span>
            <span style={{ width: 1, height: 12, background: "var(--border-strong)" }} />
            <span>{org.applications} services · {org.databases} databases</span>
            {payments?.customer && <><span style={{ width: 1, height: 12, background: "var(--border-strong)" }} /><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Stripe <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 11.5, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", padding: "1px 7px", borderRadius: 6 }}>{payments.customer}</span></span></>}
          </div>

          {/* Plan + Usage */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}><div style={s.blockTitle}>Plan</div><span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{gbp(planTotal)}<span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>/mo</span></span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: planTotal > 0 ? "var(--accent-soft)" : "var(--neutral-soft)", color: planTotal > 0 ? "var(--accent-text)" : "var(--neutral-text)" }}>{planTotal > 0 ? "Active" : "Free"}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{org.applications + org.databases === 0 ? "No resources" : `${org.applications} services · ${org.databases} databases`}</span>
              </div>
            </div>
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}><div style={s.blockTitle}>Usage this month</div><span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{spend == null ? "…" : gbp(spend)}</span></div>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{accrued > 0 ? "Compute, bandwidth & storage." : "No metered usage yet."}</p>
            </div>
          </div>

          {/* Unbilled */}
          <div style={{ ...s.card, marginBottom: 14 }}>
            <div style={{ ...s.blockTitle, marginBottom: 14 }}>Unbilled charges <span style={{ fontWeight: 500, color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>· month to date</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={s.statLabel}>Metered usage so far</span><span style={s.statVal}>{gbp(accrued)}</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={s.statLabel}>Projected month-end</span><span style={s.statVal}>{gbp(projected)}</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={s.statLabel}>Monthly plan cost</span><span style={s.statVal}>{gbp(planTotal)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 9, background: "var(--accent-soft)", fontSize: 12, color: "var(--accent-text)", lineHeight: 1.5 }}><Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>Prepaid: the monthly plan cost is charged from credit; metered usage is shown for transparency (drawdown not yet wired).</span></div>
          </div>

          {/* Ledger + Adjust */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14, alignItems: "start" }}>
            <div style={s.card}>
              <div style={{ ...s.blockTitle, marginBottom: 12 }}>Credit ledger</div>
              {!wallet && <Spinner />}
              {wallet && (wallet.recent_ledger || []).length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>No credit transactions yet.</p>}
              {wallet && (wallet.recent_ledger || []).map((l) => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{l.notes || LEDGER_DESC[l.type] || l.type}</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{l.created_at ? timeAgo(l.created_at) : ""} · {l.type}</div></div>
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", fontFamily: "var(--mono, monospace)", color: l.amount_pence < 0 ? "var(--text)" : "var(--ok-text)" }}>{l.amount_pence < 0 ? "−" : "+"}{gbp(Math.abs(l.amount_pence))}</span>
                </div>
              ))}
            </div>
            <div style={s.card}>
              <div style={{ ...s.blockTitle, marginBottom: 12 }}>Adjust credit <span style={{ fontWeight: 500, color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>· manual</span></div>
              <div style={{ display: "flex", gap: 9, marginBottom: 11 }}>
                <div style={{ position: "relative", width: 120, flexShrink: 0 }}><span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--text-muted)", pointerEvents: "none" }}>£</span><input placeholder="0.00" style={s.amountInput} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <input placeholder="Reason (comp, refund…)" style={s.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <button style={s.btnPrimary} disabled={busy} onClick={() => adjust(+1)}><Plus size={14} /> Add credit</button>
                <button style={s.btnDanger} disabled={busy} onClick={() => adjust(-1)}><Minus size={14} /> Debit</button>
              </div>
            </div>
          </div>

          {/* Payments */}
          <div style={{ ...s.card, marginBottom: 14 }}>
            <div style={{ ...s.blockTitle, marginBottom: 12 }}>Stripe payment attempts</div>
            {!payments && <Spinner />}
            {payments && payments.payments.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{payments.configured === false ? "Stripe is not configured." : payments.customer ? "No payment attempts on record." : "No Stripe customer yet — this client hasn't started a top-up."}</p>}
            {payments && payments.payments.map((p) => {
              const st = PAY_STATUS[p.status] || { label: p.status, ok: null };
              const col = st.ok === true ? "var(--ok-text)" : st.ok === false ? "var(--err-text)" : "var(--text-muted)";
              const dot = st.ok === true ? "var(--ok)" : st.ok === false ? "var(--err)" : "var(--text-muted)";
              return (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: "82px 92px 160px 1fr", gap: 14, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{p.created ? timeAgo(p.created) : "—"}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--mono, monospace)" }}>{gbp(p.amount_pence)}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: col }}><span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: dot }} />{st.label}</span>
                  <span style={{ fontSize: 12.5, color: st.ok === false ? "var(--err-text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.error || (st.ok === true ? "Card payment · top-up" : "")}</span>
                </div>
              );
            })}
          </div>

          {/* Billing info */}
          <div style={s.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div style={s.blockTitle}>Billing information</div>
              <div style={{ display: "flex", gap: 8 }}>
                <a style={s.btnGhostSm} href={api.adminInvoiceUrl(org.id)} target="_blank" rel="noreferrer"><FileText size={13} /> View invoices</a>
                <button style={s.btnPrimarySm} disabled={savingInfo || !info} onClick={saveInfo}>{savingInfo ? "Saving…" : "Save"}</button>
              </div>
            </div>
            {!info && <Spinner />}
            {info && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={s.label}>Billing email</label><input value={info.billing_email || ""} placeholder="billing@company.com" style={s.input} onChange={(e) => setInfo({ ...info, billing_email: e.target.value })} /></div>
                <div><label style={s.label}>Company name</label><input value={info.billing_company || ""} placeholder="Company Ltd" style={s.input} onChange={(e) => setInfo({ ...info, billing_company: e.target.value })} /></div>
                <div><label style={s.label}>VAT number</label><input value={info.billing_vat || ""} placeholder="GB 000 0000 00" style={s.input} onChange={(e) => setInfo({ ...info, billing_vat: e.target.value })} /></div>
                <div><label style={s.label}>Billing address</label><textarea value={info.billing_address || ""} placeholder="Address" style={{ ...s.input, minHeight: 38, resize: "vertical" }} onChange={(e) => setInfo({ ...info, billing_address: e.target.value })} /></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Clients() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const load = () => api.adminOrgs().then(setOrgs).catch(setError);
  useEffect(load, []);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!orgs) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  const isPastDue = (o) => o.billing_status === "arrears" || o.balance_pence < 0;
  const counts = { all: orgs.length, pastdue: orgs.filter(isPastDue).length, active: orgs.filter((o) => (o.balance_pence || 0) > 0).length };
  const filterDefs = [["all", "All clients"], ["pastdue", "Past due"], ["active", "In credit"]];
  const shown = orgs
    .filter((o) => filter === "all" ? true : filter === "pastdue" ? isPastDue(o) : (o.balance_pence || 0) > 0)
    .filter((o) => !q || (o.name + " " + o.slug).toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ padding: "26px 30px 48px", maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 25, fontWeight: 600, letterSpacing: "-.01em", color: "var(--text)" }}>Billing</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)" }}>Client organizations — prepaid credit, plans, usage and Stripe payment activity.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search size={15} style={{ position: "absolute", left: 11, pointerEvents: "none", color: "var(--text-muted)" }} />
            <input placeholder="Search clients" style={s.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button style={s.btnSecondary} onClick={() => csvDownload(shown)}><FileText size={14} /> Export CSV</button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
        {filterDefs.map(([id, label]) => {
          const active = filter === id;
          return (
            <button key={id} onClick={() => setFilter(id)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "2px 0", border: "none", background: "transparent", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", color: active ? "var(--text)" : "var(--text-muted)", borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent" }}>
              {label}
              {counts[id] > 0 && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: active ? "var(--accent-soft)" : "var(--neutral-soft)", color: active ? "var(--accent-text)" : "var(--neutral-text)", fontSize: 11, fontWeight: 700 }}>{counts[id]}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No clients match.</p>}
        {shown.map((o, i) => (
          <AccountCard
            key={o.id} org={o} color={AVATARS[i % AVATARS.length]}
            expanded={!!expanded[o.id]}
            onToggle={() => setExpanded((e) => ({ ...e, [o.id]: !e[o.id] }))}
            onChange={load}
          />
        ))}
      </div>
    </div>
  );
}
