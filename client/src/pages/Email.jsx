import { useEffect, useState } from "react";
import { Mail, Plus, Trash2, AlertTriangle, Eye, EyeOff, KeyRound, Copy, Check, X, RefreshCw, LifeBuoy } from "lucide-react";
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
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  // Pull in anything created straight on the mail server. Reports what it found rather
  // than silently succeeding — "0 imported" is the useful answer when you expected some.
  async function reconcile() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await api.reconcileMail();
      const parts = [
        `${r.domainsAdded} domain${r.domainsAdded === 1 ? "" : "s"} imported`,
        `${r.mailboxesAdded} mailbox${r.mailboxesAdded === 1 ? "" : "es"} imported`,
        r.mailboxesReStamped ? `${r.mailboxesReStamped} re-billed` : null,
        r.mailboxesRemoved ? `${r.mailboxesRemoved} removed (gone upstream)` : null,
      ].filter(Boolean);
      const unassigned = r.unassigned?.length
        ? ` — still unassigned, billing nobody: ${r.unassigned.join(", ")}`
        : "";
      setSyncMsg(parts.join(" · ") + unassigned);
      load();
    } catch (e) { setSyncMsg(`Sync failed: ${e.message}`); }
    finally { setSyncing(false); }
  }

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
        actions={
          <>
            <Button variant="secondary" onClick={reconcile} disabled={syncing}
              title="Import domains/mailboxes created directly on the mail server into billing">
              {syncing ? <Spinner /> : <RefreshCw size={14} />} Sync from mail server
            </Button>
            <Button variant="primary" onClick={() => setAdding((v) => !v)}><Plus size={16} /> Add domain</Button>
          </>
        }
      />

      {syncMsg && (
        <div className="mb-4 rounded-lg border p-3 text-[13px]" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}>
          {syncMsg}
        </div>
      )}

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

      {status.configured && <MailClientSettings host={status.hostname} webmail={status.webmail} />}

      {adding && (
        <Card className="mb-4">
          <form onSubmit={addDomain} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Field label="Domain"><Input placeholder="acme.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} autoFocus /></Field>
            </div>
            {orgs.length > 0 && (
              <Field label="Bill to account">
                <select value={newOrgId} onChange={(e) => setNewOrgId(e.target.value)}
                  className="rounded-md border px-2.5 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)", minWidth: 170 }}>
                  <option value="">— unassigned —</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
            )}
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
          {domains.map((d) => <DomainCard key={d.domain} d={d} orgs={orgs} onChange={load} onRemove={() => removeDomain(d.domain)} />)}
        </div>
      )}
    </div>
  );
}

function MailClientSettings({ host, webmail }) {
  const [open, setOpen] = useState(false);
  // Comes from /api/mail/status, which derives it from the mail host (SOGo is served
  // there on a path — there is no working webmail.* subdomain). Fallback keeps the link
  // alive against an older server that still returns a bare hostname.
  const webmailUrl = webmail?.startsWith("http") ? webmail : `https://${host}/SOGo`;
  const rows = [
    ["IMAP (incoming)", `${host} · port 993 · SSL/TLS`],
    ["SMTP (outgoing)", `${host} · port 587 (STARTTLS) or 465 (SSL)`],
    ["Username", "your full email address"],
    ["Password", "your mailbox password"],
  ];
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <Mail size={16} style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Connect your mail app</span>
        <a href={webmailUrl} target="_blank" rel="noreferrer" className="btn btn-secondary text-sm" style={{ padding: "5px 12px" }}>Open webmail →</a>
        <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
          {open ? "Hide manual settings" : "Manual IMAP/SMTP settings"}
        </button>
      </div>
      {open && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <p className="mb-2.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
            Most apps (Apple Mail, Outlook, Thunderbird) configure <b>automatically</b> — just enter your email address + password (autoconfig/autodiscover is published for your domain). Use these only if you set it up by hand:
          </p>
          <table className="w-full text-[13px]">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-1.5 pr-4 font-medium" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{k}</td>
                  <td className="py-1.5 mono" style={{ color: "var(--text)" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DomainCard({ d, orgs, onChange, onRemove }) {
  const [showMailbox, setShowMailbox] = useState(false);
  // The new password lives in component state ONLY, until dismissed. It is never
  // written anywhere — the server doesn't store it either, so once this is gone the
  // only way to recover the mailbox is another reset.
  const [newPw, setNewPw] = useState(null);        // { address, password } | null
  const [resettingFor, setResettingFor] = useState(null);

  // A recovery address is what turns "email the admin" into self-service: the reset link
  // goes THERE, because the mailbox itself is the one they cannot read.
  async function setRecovery(address) {
    const v = window.prompt(
      `Recovery email for ${address}

` +
      `Their OTHER address (personal email). A password-reset link gets sent there, so it ` +
      `must not be ${address} itself.

Leave blank and press OK to remove it.`
    );
    if (v === null) return;
    try {
      if (!v.trim()) await api.clearMailboxRecovery(address);
      else await api.setMailboxRecovery(address, v.trim());
      onChange();
    } catch (e) { alert(e.message); }
  }

  async function resetPassword(address) {
    const ok = window.confirm(
      `Reset the password for ${address}?\n\n` +
      `The current password cannot be recovered — the mail server stores only a hash — so ` +
      `this replaces it with a new temporary one, shown to you once.\n\n` +
      `${address} will be signed out of webmail and their mail apps until they enter it.`
    );
    if (!ok) return;
    setResettingFor(address);
    try {
      const r = await api.resetMailboxPassword(address);
      setNewPw({ address: r.address, password: r.password });
    } catch (e) {
      alert(e.message);
    } finally {
      setResettingFor(null);
    }
  }
  // Seed from the last cached verify (persisted on the domain row) so checks show on load.
  const [checks, setChecks] = useState(d.dnsChecks || null);   // null | [{key,label,ok,detail,required}]
  const [verifying, setVerifying] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const count = (d.mailboxes || []).length;
  const owner = orgs?.find((o) => o.id === d.org_id)?.name;
  const monthly = (count * 2.99).toFixed(2);
  async function verify() {
    setVerifying(true);
    try { const r = await api.verifyMailDns(d.domain); setChecks(r.checks || []); }
    catch (e) { alert(e.message); }
    finally { setVerifying(false); }
  }
  // The overall badge keys on the REQUIRED records only — the convenience CNAMEs
  // (autoconfig/autodiscover) don't make a working mail domain "incomplete".
  const allOk = checks && checks.filter((c) => c.required).every((c) => c.ok);
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Mail size={18} style={{ color: "var(--accent)" }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            {d.domain}
            {checks && (
              <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "var(--surface-2)", color: allOk ? "var(--ok-text)" : "var(--err-text)" }}>
                {allOk ? "DNS verified" : "DNS incomplete"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>{count} mailbox{count === 1 ? "" : "es"}</span>
            <span>·</span>
            {/* Unassigned isn't cosmetic: the monthly charge counts mailboxes BY ORG, so a
                domain with no org bills nobody. Flag it in red and make it fixable here. */}
            {orgs?.length > 0 ? (
              <select
                className="rounded border px-1 py-0.5 text-xs"
                style={{
                  background: "var(--surface)", borderColor: d.org_id ? "var(--border)" : "var(--err-text)",
                  color: d.org_id ? "var(--text)" : "var(--err-text)", cursor: "pointer",
                }}
                value={d.org_id ?? ""}
                disabled={assigning}
                title={d.org_id ? `Billed to ${owner}` : "Not billed to anyone — pick an account"}
                onChange={async (e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setAssigning(true);
                  try { await api.assignMailDomain(d.domain, v); onChange(); }
                  catch (err) { alert(err.message); }
                  finally { setAssigning(false); }
                }}
              >
                <option value="">⚠ unassigned — bills nobody</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <span style={{ color: d.org_id ? undefined : "var(--err-text)" }}>{owner || "unassigned"}</span>
            )}
            {count > 0 && <span>· £{monthly}/mo{d.org_id ? "" : " (uncharged)"}</span>}
          </div>
        </div>
        <Button variant="ghost" onClick={verify} disabled={verifying}>{verifying ? <Spinner /> : "Verify DNS"}</Button>
        <Button variant="secondary" onClick={() => setShowMailbox((v) => !v)}><Plus size={14} /> Mailbox</Button>
        <button onClick={onRemove} title="Remove domain" className="btn btn-ghost p-1.5" style={{ color: "var(--err-text)" }}><Trash2 size={16} /></button>
      </div>

      {showMailbox && (
        <NewMailbox
          domain={d.domain}
          onDone={(r) => {
            setShowMailbox(false);
            // Only present when the server generated it — show it before the refresh,
            // because it exists nowhere else.
            if (r?.password) setNewPw({ address: r.address, password: r.password });
            onChange();
          }}
        />
      )}

      {newPw && <OneTimePassword {...newPw} onDismiss={() => setNewPw(null)} />}

      {(d.mailboxes || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
          {d.mailboxes.map((m) => (
            <span key={m.address} className="mono inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
              {m.address}
              <button
                onClick={() => setRecovery(m.address)}
                title={m.hasRecovery
                  ? "Backup email set — this user can reset their own password"
                  : "No backup email — this user CANNOT reset their own password"}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0,
                  color: m.hasRecovery ? "var(--ok-text)" : "var(--err-text)",
                }}
              >
                <LifeBuoy size={12} />
              </button>
              <button
                onClick={() => resetPassword(m.address)}
                disabled={resettingFor === m.address}
                title="Reset password — generates a new temporary one, shown once"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0, color: "var(--text-muted)" }}
              >
                <KeyRound size={12} />
              </button>
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

      <DnsSetup domain={d.domain} kind="mail" records={d.records} checks={checks} />
    </Card>
  );
}

// Shown once, after a reset. Deliberately loud and deliberately dismissible only by the
// operator: the value exists nowhere else the moment this unmounts.
function OneTimePassword({ address, password, onDismiss }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked (insecure context) — the value is on screen to type */ }
  }
  return (
    <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
      <div className="flex items-start gap-2">
        <KeyRound size={15} style={{ color: "var(--accent-text)", marginTop: 2, flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
            New password for <span className="mono">{address}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code
              className="mono select-all rounded px-2 py-1 text-[13.5px] font-semibold"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              {password}
            </code>
            <Button variant="secondary" onClick={copy} className="text-xs">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="mt-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            Shown once. It isn't stored anywhere — close this and the only way back is another reset.
            Send it over something private, not email to the address it unlocks.
          </div>
        </div>
        <button onClick={onDismiss} title="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function NewMailbox({ domain, onDone }) {
  const [local, setLocal] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // generate=true submits WITHOUT a password; the server makes one and returns it once,
  // which onDone surfaces in the same one-time panel a reset uses. Keeping generation
  // server-side means there's a single definition of a temp password, not a drifting copy.
  async function create(e, generate = false) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const address = `${local}@${domain}`;
      const r = await api.createMailbox({ address, quotaMb: 2048, ...(generate ? {} : { password: pw }) });
      // Collected at creation ON PURPOSE: without a backup address the user can never reset
      // their own password, and chasing it later never happens. Non-fatal — the mailbox is
      // already made, so a bad recovery address must not read as "creation failed".
      if (recovery.trim()) {
        try { await api.setMailboxRecovery(address, recovery.trim()); }
        catch (e) { alert(`Mailbox created, but the backup address was rejected: ${e.message}`); }
      }
      onDone(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
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
      <Field label="Backup email">
        <Input
          type="email"
          placeholder="their personal address"
          value={recovery}
          onChange={(e) => setRecovery(e.target.value)}
          title="Where a password-reset link is sent. Without one this user can't reset their own password."
        />
      </Field>
      <Button type="submit" variant="primary" disabled={busy || !local || pw.length < 8}>{busy ? <Spinner /> : "Create"}</Button>
      <Button
        type="button"
        variant="secondary"
        onClick={(e) => create(e, true)}
        disabled={busy || !local}
        title="Create with a generated temporary password, shown once"
      >
        <KeyRound size={14} /> Create with generated password
      </Button>
      {err && <p className="w-full text-sm" style={{ color: "var(--err-text)" }}>{err}</p>}
    </form>
  );
}
