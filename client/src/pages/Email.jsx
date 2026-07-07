import { useEffect, useState } from "react";
import { Mail, Plus, Trash2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Button, Field, Input, Spinner, EmptyState } from "../components/ui.jsx";
import DnsSetup from "../components/DnsSetup.jsx";

// Business email hosting — add a domain, publish its DNS, manage mailboxes.
// Wired to the panel's /api/mail routes (Stalwart). Until the mail box is
// configured (STALWART_URL/ADMIN), status.configured is false and we say so.
export default function Email() {
  const [status, setStatus] = useState(null);
  const [domains, setDomains] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newOrgId, setNewOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function load() {
    api.mailStatus().then(setStatus).catch(() => setStatus({ configured: false }));
    api.mailDomains().then((d) => setDomains(Array.isArray(d) ? d : [])).catch(() => setDomains([]));
    api.customers().then((o) => setOrgs(Array.isArray(o) ? o : [])).catch(() => setOrgs([]));
  }
  useEffect(load, []);

  async function addDomain(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createMailDomain(newDomain.trim().toLowerCase(), newOrgId || null);
      setNewDomain(""); setNewOrgId(""); setAdding(false); load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function removeDomain(domain) {
    if (!window.confirm(`Remove ${domain} and all its mailboxes?`)) return;
    try { await api.deleteMailDomain(domain); load(); } catch (e) { alert(e.message); }
  }

  if (!status || domains === null) {
    return <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}><Spinner /> Loading…</div>;
  }

  return (
    <div className="page">
      <PageHeader
        title="Email"
        subtitle="Business mailboxes on your customers' domains — send, receive, webmail."
        actions={<Button variant="primary" onClick={() => setAdding((v) => !v)}><Plus size={16} /> Add domain</Button>}
      />

      {!status.configured && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border p-3.5" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "#b45309" }} />
          <div className="text-[13px]" style={{ color: "#92400e" }}>
            <b>Mail server not yet connected.</b> The mailcow box is provisioned ({status.hostname}) — set{" "}
            <code>MAILCOW_API_URL</code> + <code>MAILCOW_API_KEY</code> in the panel env to enable mailbox management.
            You can still stage domains + copy their DNS records below.
          </div>
        </div>
      )}

      {adding && (
        <Card className="mb-4">
          <form onSubmit={addDomain} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Field label="Domain"><Input placeholder="acme.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} autoFocus /></Field>
            </div>
            <Field label="Bill to account">
              <select value={newOrgId} onChange={(e) => setNewOrgId(e.target.value)}
                className="rounded-md border px-2.5 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)", minWidth: 170 }}>
                <option value="">— unassigned —</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Button type="submit" variant="primary" disabled={busy || !newDomain.trim()}>{busy ? <Spinner /> : "Add domain"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Button>
          </form>
          {err && <p className="mt-2 text-sm" style={{ color: "var(--err-text)" }}>{err}</p>}
        </Card>
      )}

      {domains.length === 0 ? (
        <EmptyState title="No email domains yet" description="Add a domain to start hosting mailboxes on it." />
      ) : (
        <div className="flex flex-col gap-3">
          {domains.map((d) => <DomainCard key={d.domain} d={d} orgs={orgs} webmail={status.webmail} onChange={load} onRemove={() => removeDomain(d.domain)} />)}
        </div>
      )}
    </div>
  );
}

function DomainCard({ d, orgs, webmail, onChange, onRemove }) {
  const [showMailbox, setShowMailbox] = useState(false);
  const count = (d.mailboxes || []).length;
  const owner = orgs?.find((o) => o.id === d.org_id)?.name;
  const monthly = (count * 2.99).toFixed(2);
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Mail size={18} style={{ color: "var(--accent)" }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold" style={{ color: "var(--text)" }}>{d.domain}</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {count} mailbox{count === 1 ? "" : "es"}
            {owner ? ` · ${owner}` : " · unassigned"}
            {count > 0 && ` · £${monthly}/mo`}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setShowMailbox((v) => !v)}><Plus size={14} /> Mailbox</Button>
        <button onClick={onRemove} title="Remove domain" className="btn btn-ghost p-1.5" style={{ color: "var(--err-text)" }}><Trash2 size={16} /></button>
      </div>

      {showMailbox && <NewMailbox domain={d.domain} onDone={() => { setShowMailbox(false); onChange(); }} />}

      {(d.mailboxes || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
          {d.mailboxes.map((m) => (
            <span key={m.address} className="mono inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
              {m.address}
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete mailbox ${m.address}? This removes the inbox and all its mail.`)) return;
                  try { await api.deleteMailbox(m.address); onChange(); } catch (e) { alert(e.message); }
                }}
                title="Delete mailbox"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0, color: "var(--err-text)" }}
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <DnsSetup domain={d.domain} kind="mail" webmail={webmail} records={d.records} />
    </Card>
  );
}

function NewMailbox({ domain, onDone }) {
  const [local, setLocal] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function create(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api.createMailbox({ address: `${local}@${domain}`, password: pw, quotaMb: 2048 }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-end gap-1">
        <Field label="Mailbox"><Input placeholder="hello" value={local} onChange={(e) => setLocal(e.target.value.replace(/[^a-z0-9._-]/gi, ""))} /></Field>
        <span className="pb-2.5 text-sm" style={{ color: "var(--text-muted)" }}>@{domain}</span>
      </div>
      <Field label="Password">
        <div className="flex items-center gap-1.5">
          <Input type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 8 chars" />
          <button type="button" onClick={() => setShowPw((v) => !v)} title={showPw ? "Hide password" : "Show password"}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 0, color: "var(--text-muted)" }}>
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Field>
      <Button type="submit" variant="primary" disabled={busy || !local || pw.length < 8}>{busy ? <Spinner /> : "Create"}</Button>
      {err && <p className="w-full text-sm" style={{ color: "var(--err-text)" }}>{err}</p>}
    </form>
  );
}
