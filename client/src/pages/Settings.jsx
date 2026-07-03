import { useEffect, useState } from "react";
import { FileText, Download, Key, Copy, Trash2, Terminal } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.jsx";
import { PageHeader, Card, Spinner, timeAgo } from "../components/ui.jsx";

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

// API keys: personal, hashed Bearer tokens. The same token is what the MCP
// server reads as DEBUTDEPLOY_TOKEN, so a read-only key limits MCP to read tools.
function ApiKeysCard() {
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("full");
  const [fresh, setFresh] = useState(null); // { name, scope, token } — shown ONCE
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => api.tokens().then(setKeys).catch(setErr);
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.createToken({ name: name || "token", scope });
      setFresh(res); setName(""); setScope("full"); load();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const revoke = async (id) => {
    if (!confirm("Revoke this key? Anything using it stops working immediately.")) return;
    await api.deleteToken(id); load();
  };

  const origin = window.location.origin;
  const mcpCmd = fresh &&
    `claude mcp add debutdeploy \\\n  -e DEBUTDEPLOY_URL=${origin} \\\n  -e DEBUTDEPLOY_TOKEN=${fresh.token} \\\n  -- node /path/to/debut-deploy/mcp/server.js`;

  return (
    <Card className="mb-4">
      <div className="flex items-center gap-2 mb-1" style={{ color: "var(--text)" }}>
        <Key size={16} /><span className="text-sm font-semibold">API keys</span>
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Bearer tokens for the REST API and the MCP server. A <span className="mono">full</span> key can do
        anything your role allows; a <span className="mono">read-only</span> key is limited to GET requests.
      </div>

      {/* Create */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input className="input" placeholder="Key name (e.g. ci, laptop)" value={name}
          onChange={(e) => setName(e.target.value)} style={{ minWidth: 200 }} />
        <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="full">Full access</option>
          <option value="read">Read-only</option>
        </select>
        <button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create key"}</button>
      </div>

      {/* One-time reveal */}
      {fresh && (
        <div className="mb-3 p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            Copy your key now — it won't be shown again.
          </div>
          <div className="flex items-center gap-2 mb-3">
            <input className="input mono" readOnly value={fresh.token} style={{ flex: 1 }} />
            <button className="btn" onClick={() => navigator.clipboard.writeText(fresh.token)}><Copy size={14} /> Copy</button>
          </div>
          <details>
            <summary className="text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
              <Terminal size={12} style={{ display: "inline", verticalAlign: "-1px" }} /> Use with Claude (MCP)
            </summary>
            <pre className="mono mt-2 p-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap", color: "var(--text)" }}>{mcpCmd}</pre>
            <button className="btn mt-1" onClick={() => navigator.clipboard.writeText(mcpCmd)}><Copy size={14} /> Copy command</button>
          </details>
        </div>
      )}

      {err && <div className="text-xs mb-2" style={{ color: "var(--err)" }}>{err.message}</div>}

      {/* List */}
      {!keys && <div className="text-xs" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>}
      {keys && keys.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No keys yet.</div>}
      {keys && keys.length > 0 && (
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th className="py-2 font-semibold">Name</th>
            <th className="py-2 font-semibold">Scope</th>
            <th className="py-2 font-semibold">Last used</th>
            <th className="py-2 font-semibold"></th>
          </tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2" style={{ color: "var(--text)" }}>{k.name || "—"}</td>
                <td className="py-2"><span className={`pill ${k.scope === "read" ? "pill-neutral" : "pill-accent"}`}>{k.scope || "full"}</span></td>
                <td className="py-2" style={{ color: "var(--text-muted)" }}>{k.last_used_at ? timeAgo(k.last_used_at) : "never"}</td>
                <td className="py-2 text-right"><button className="btn btn-danger" onClick={() => revoke(k.id)}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
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

      {/* API keys */}
      <ApiKeysCard />

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
            <textarea
              className="input mt-2" style={{ width: "100%", minHeight: 64, resize: "vertical" }}
              placeholder="Billing address" value={info?.billing_address || ""} disabled={!isOwner}
              onChange={(e) => { setInfo({ ...info, billing_address: e.target.value }); setSaved(false); }}
            />
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
