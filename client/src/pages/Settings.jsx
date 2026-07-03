import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.jsx";
import { PageHeader, Card, Spinner } from "../components/ui.jsx";

// Current month + the previous 5, as YYYY-MM (for the invoice picker).
function recentPeriods(n = 6) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export default function Settings() {
  const { user } = useAuth();
  const isOwner = user?.orgRole === "owner";
  const [info, setInfo] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [period, setPeriod] = useState(recentPeriods(1)[0]);

  useEffect(() => { api.orgBillingInfo().then(setInfo).catch(() => setInfo({})); }, []);

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try { setInfo(await api.saveOrgBillingInfo(info)); setSaved(true); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const field = (k, placeholder, wide) => (
    <input
      className="input" style={{ minWidth: wide ? 260 : 160, flex: wide ? 1 : "none" }}
      placeholder={placeholder} value={info?.[k] || ""} disabled={!isOwner}
      onChange={(e) => { setInfo({ ...info, [k]: e.target.value }); setSaved(false); }}
    />
  );

  return (
    <div className="page">
      <PageHeader title="Account settings" subtitle="Your profile, billing details, and invoices." />

      {/* Profile */}
      <Card className="mb-4">
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>Profile</div>
        <div className="grid gap-1 text-sm" style={{ gridTemplateColumns: "120px 1fr", maxWidth: 460 }}>
          <div style={{ color: "var(--text-muted)" }}>Name</div><div style={{ color: "var(--text)" }}>{user?.name || "—"}</div>
          <div style={{ color: "var(--text-muted)" }}>Email</div><div className="mono" style={{ color: "var(--text)" }}>{user?.email}</div>
          <div style={{ color: "var(--text-muted)" }}>Role</div><div><span className="pill pill-neutral">{user?.orgRole || user?.role}</span></div>
        </div>
      </Card>

      {/* Billing information */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>Billing information</div>
          {isOwner && <button className="btn btn-primary" disabled={busy || !info} onClick={save}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save"}</button>}
        </div>
        {!info && <div className="text-xs" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>}
        {info && (
          <>
            <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>Used on your invoices. {isOwner ? "" : "Only an org owner can edit these."}</div>
            <div className="flex flex-wrap gap-2">
              {field("billing_company", "Company name", false)}
              {field("billing_email", "Billing email", true)}
              {field("billing_vat", "VAT number", false)}
            </div>
            {err && <div className="text-xs mt-2" style={{ color: "var(--err)" }}>{err.message}</div>}
          </>
        )}
      </Card>

      {/* Invoices */}
      <Card>
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>Invoices</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {recentPeriods(12).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <a className="btn" href={api.orgInvoiceUrl(period)} target="_blank" rel="noreferrer"><FileText size={14} /> View</a>
          <a className="btn" href={api.orgInvoiceUrl(period, true)}><Download size={14} /> Download</a>
        </div>
        <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Opens a printable invoice — use your browser's “Save as PDF”.</div>
      </Card>
    </div>
  );
}
