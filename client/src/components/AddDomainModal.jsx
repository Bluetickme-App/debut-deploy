import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, X, Copy } from "lucide-react";
import { Button, Input, Mono, Spinner } from "./ui.jsx";

// Render-style two-step wizard: choose a domain, then show the exact DNS records
// (root + www) to add. Binding happens on step 1 (POST /domain merges + redeploys);
// step 2 lets the user verify propagation. `subdomain` is the free {svc}.debutdepoly.com
// CNAME target; `platformIp` (from /api/me) is the A-record fallback.
export default function AddDomainModal({ serviceId, subdomain, platformIp, onClose, onBound }) {
  const [step, setStep] = useState(1);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const apex = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^www\./, "");
  const www = apex ? `www.${apex}` : "";

  async function addDomain(e) {
    e?.preventDefault();
    if (!apex || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/domain`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fqdn: apex }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || String(r.status)); }
      onBound?.();
      setStep(2);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Add Custom Domain</h3>
          <button onClick={onClose} title="Close" style={{ color: "var(--text-muted)" }}><X className="h-4 w-4" /></button>
        </div>

        {/* step tabs */}
        <div className="mb-4 flex gap-4 text-[13px]">
          <StepTab n={1} label="Choose domain name" active={step === 1} done={step > 1} />
          <StepTab n={2} label="Add DNS records" active={step === 2} done={false} />
        </div>

        {step === 1 && (
          <form onSubmit={addDomain}>
            <p className="mb-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              Enter the domain you want to point at this service. We'll set up both the root and <Mono>www</Mono>.
            </p>
            <Input autoFocus value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.example.com" style={{ width: "100%", fontFamily: "monospace" }} />
            {err && <p className="mt-2 text-xs" style={{ color: "var(--err-text)" }}>{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="default" disabled={!apex || busy}>{busy ? <Spinner /> : "Add Domain"}</Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <Step2 apex={apex} www={www} subdomain={subdomain} platformIp={platformIp} serviceId={serviceId} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function StepTab({ n, label, active, done }) {
  return (
    <div className="flex items-center gap-1.5" style={{ color: active || done ? "var(--text)" : "var(--text-muted)", opacity: active || done ? 1 : 0.6 }}>
      <span
        className="grid h-5 w-5 place-items-center rounded-full text-[11px]"
        style={{ background: active ? "var(--accent)" : "var(--surface-2)", color: active ? "#fff" : "var(--text-muted)", border: "1px solid var(--border)" }}
      >
        {done ? <Check className="h-3 w-3" /> : n}
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function Step2({ apex, www, subdomain, platformIp, serviceId, onClose }) {
  const [results, setResults] = useState(null); // { host: pointsAt bool }
  const [verifying, setVerifying] = useState(false);

  async function verify() {
    setVerifying(true);
    const out = {};
    for (const host of [www, apex]) {
      try {
        const r = await fetch(`/api/services/${serviceId}/domain/verify?fqdn=${encodeURIComponent(host)}`, { credentials: "same-origin" });
        const d = await r.json();
        out[host] = { ok: !!d.pointsToServer, ips: d.resolvedIps || [], expected: d.expectedIp };
      } catch (e) { out[host] = { ok: false, error: e.message }; }
    }
    setResults(out); setVerifying(false);
  }

  return (
    <div>
      <p className="mb-3 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
        Add these two records at your DNS provider, then verify. TLS is issued automatically once DNS points here.
      </p>
      <Record n={1} host="www" name={www} target={subdomain} status={results?.[www]} />
      <Record n={2} host="@" name={apex} target={subdomain} status={results?.[apex]} />
      <div className="mt-2 rounded-md border p-2.5 text-[11.5px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-muted)" }}>
        Some providers can't use a <Mono>CNAME</Mono> on the root — use an <Mono>A</Mono> (or <Mono>ALIAS</Mono>/<Mono>ANAME</Mono>) record instead.
        For <Mono>A</Mono> records, target: <CopyInline text={platformIp || ""}><Mono>{platformIp || "…"}</Mono></CopyInline>
      </div>
      <p className="mt-3 text-[11.5px]" style={{ color: "var(--text-muted)" }}>ℹ DNS changes can take up to 24 hours to propagate.</p>
      <div className="mt-4 flex items-center justify-between">
        <Link to="/docs/custom-domains" target="_blank" className="text-[12.5px]" style={{ color: "var(--accent-text)" }}>Read the docs →</Link>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="default" onClick={verify} disabled={verifying}>{verifying ? <Spinner /> : "Verify"}</Button>
        </div>
      </div>
    </div>
  );
}

function Record({ n, host, name, target, status }) {
  return (
    <div className="mb-2 rounded-lg border p-3" style={{ borderColor: status ? (status.ok ? "var(--ok)" : "var(--warn)") : "var(--border)", background: "var(--surface-2)" }}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>{n}. {name}</span>
        {status && (status.ok
          ? <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--ok-text)" }}><Check className="h-3.5 w-3.5" strokeWidth={3} /> verified</span>
          : <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--warn-text)" }}><X className="h-3.5 w-3.5" /> {status.ips?.length ? `resolves to ${status.ips.join(", ")}` : "not resolving yet"}</span>)}
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-3 text-[12px]">
        <Cell label="Hostname" value={host} />
        <Cell label="Target value (CNAME)" value={target} />
      </div>
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
      <CopyInline text={value}>
        <span className="mono block truncate rounded border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>{value}</span>
      </CopyInline>
    </div>
  );
}

function CopyInline({ text, children }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => text && navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      title="Copy"
      className="inline-flex w-full items-center gap-1 text-left"
      style={{ color: copied ? "var(--ok-text)" : "inherit" }}
    >
      {children}
      <Copy className="h-3 w-3 shrink-0" style={{ color: "var(--text-muted)" }} />
    </button>
  );
}
