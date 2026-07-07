import { useEffect, useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Spinner } from "./ui.jsx";

// One-click DNS setup for a domain. `kind` is "mail" or "hosting". Falls back to a
// copy-paste records table when the provider isn't Domain-Connect-capable.
export default function DnsSetup({ domain, kind, webmail }) {
  const [state, setState] = useState(null); // { supported, provider, applyUrl, records }
  const [status, setStatus] = useState(null); // { status, provider, verified }
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.dnsStatus(domain, kind).then(setStatus).catch(() => {}); }, [domain, kind]);

  async function discover() {
    setBusy(true);
    try {
      const s = await api.dnsDiscover(domain, kind);
      setState(s);
      if (s.supported && s.applyUrl) window.open(s.applyUrl, "_blank", "noopener");
      else setOpen(true);
    } finally { setBusy(false); }
  }

  const records = state?.records;
  const badge = status?.verified ? "Configured ✓"
    : status?.status === "applied" ? "Applied — verifying…"
    : status?.status === "failed" ? "Setup failed"
    : status?.status === "manual" ? "Manual setup" : null;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={discover} disabled={busy}>
          {busy ? <Spinner /> : <Wand2 size={14} />} Set up DNS automatically
        </Button>
        {badge && <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {badge}{status?.provider ? ` · ${status.provider}` : ""}
        </span>}
        {records && (
          <button onClick={() => setOpen((v) => !v)} className="ml-auto flex items-center gap-1 text-xs"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Or add records manually
          </button>
        )}
      </div>
      {open && records && <RecordsTable records={records} webmail={webmail} domain={domain} kind={kind} />}
    </div>
  );
}

function RecordsTable({ records, webmail, domain, kind }) {
  const all = kind === "mail" && webmail
    ? [...records, { type: "CNAME", name: webmail, value: "mail.debutdepoly.com", note: "Webmail" }]
    : records;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead><tr style={{ color: "var(--text-muted)" }}>
          <th className="px-2 py-1 text-left font-semibold uppercase">Type</th>
          <th className="px-2 py-1 text-left font-semibold uppercase">Name</th>
          <th className="px-2 py-1 text-left font-semibold uppercase">Value</th>
        </tr></thead>
        <tbody>
          {all.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="px-2 py-1.5 mono">{r.type}</td>
              <td className="px-2 py-1.5 mono" style={{ color: "var(--text-muted)" }}>{r.name}</td>
              <td className="px-2 py-1.5"><CopyVal value={r.value} /><div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{r.note}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyVal({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="mono inline-flex items-center gap-1.5" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text)" }} title="Copy">
      {value} {copied ? <Check size={12} style={{ color: "var(--ok-text)" }} /> : <Copy size={12} style={{ opacity: 0.5 }} />}
    </button>
  );
}
