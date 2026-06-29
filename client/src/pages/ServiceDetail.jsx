import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Rocket, Play, Square, RotateCw, ExternalLink,
  GitBranch, Globe, Trash2, CheckCircle2, XCircle, Copy, ChevronDown, ChevronUp,
} from "lucide-react";
import { api } from "../lib/api.js";
import {
  StatusPill, Spinner, Button, Input, Mono, timeAgo,
} from "../components/ui.jsx";
import EnvEditor from "../components/EnvEditor.jsx";
import LogStream from "../components/LogStream.jsx";

const TABS = ["Deployments", "Logs", "Environment", "Settings"];

export default function ServiceDetail() {
  const { id } = useParams();
  const [svc, setSvc] = useState(null);
  const [tab, setTab] = useState("Deployments");
  const [deploys, setDeploys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [envKey, setEnvKey] = useState(0); // bump to remount EnvEditor after bulk paste

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvc(null);
    setDeploys(null);
    Promise.all([api.service(id), api.deployments(id)])
      .then(([service, deploymentList]) => {
        if (cancelled) return;
        setSvc(service);
        setDeploys(deploymentList);
      })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [id]);

  async function action(kind) {
    setBusy(true);
    try {
      if (kind === "deploy") await api.deploy(id);
      else await api.control(id, kind);
      api.deployments(id).then(setDeploys);
    } finally {
      setBusy(false);
    }
  }

  if (!svc) {
    if (error) return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="card">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Unable to load service</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{error.message}</p>
          <Link to="/" className="mt-4 inline-flex text-sm" style={{ color: "var(--accent)" }}>
            Back to services
          </Link>
        </div>
      </div>
    );
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* breadcrumb */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        <ArrowLeft className="h-4 w-4" /> Services
      </Link>

      {/* ── header ── */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}
        >
          {svc.name}
        </h1>
        <StatusPill status={svc.status} />
        {svc.domain && (
          <a
            href={`https://${svc.domain}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm transition-colors"
            style={{ color: "var(--accent)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-strong)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--accent)")}
          >
            <Globe className="h-3.5 w-3.5" />
            {svc.domain}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* action buttons */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => action("deploy")} disabled={busy}>
            {busy ? <Spinner /> : <Rocket className="h-4 w-4" />} Deploy
          </Button>
          {svc.status === "stopped" ? (
            <Button onClick={() => action("start")} disabled={busy}>
              <Play className="h-4 w-4" /> Start
            </Button>
          ) : (
            <Button onClick={() => action("stop")} disabled={busy}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          )}
          <Button variant="ghost" onClick={() => action("restart")} disabled={busy}>
            <RotateCw className="h-4 w-4" /> Restart
          </Button>
        </div>
      </div>

      {/* meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1">
          <GitBranch className="h-3.5 w-3.5" />
          <Mono>{svc.repo}</Mono> · <Mono>{svc.branch}</Mono>
        </span>
        <span>Runtime: {svc.runtime}</span>
        <span>Server: {svc.server}</span>
        <span>Last deploy: {timeAgo(svc.lastDeployedAt)}</span>
      </div>

      {/* ── tabs ── */}
      <div className="mt-6 flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="-mb-px border-b-2 px-3 py-2 text-sm font-medium transition"
            style={
              tab === t
                ? { borderColor: "var(--accent)", color: "var(--text)" }
                : { borderColor: "transparent", color: "var(--text-muted)" }
            }
            onMouseEnter={(e) => { if (tab !== t) e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { if (tab !== t) e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="py-6">
        {tab === "Deployments" && <Deployments deploys={deploys} serviceId={id} onRedeploy={() => action("deploy")} />}
        {tab === "Logs" && <LogStream serviceId={id} live={svc.status === "deploying"} />}
        {tab === "Environment" && (
          <div className="space-y-6">
            <BulkEnvPaste serviceId={id} onDone={() => setEnvKey((k) => k + 1)} />
            <EnvEditor key={envKey} serviceId={id} />
          </div>
        )}
        {tab === "Settings" && <SettingsTab svc={svc} serviceId={id} />}
      </div>
    </div>
  );
}

// ── Deployments tab ────────────────────────────────────────────────────────────

function Deployments({ deploys, onRedeploy }) {
  if (!deploys) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
      <Spinner className="mr-2 inline" /> Loading deployments…
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      {deploys.length === 0 && (
        <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No deployments yet.
        </div>
      )}
      {deploys.map((d, i) => (
        <div
          key={d.uuid}
          className="flex items-center gap-4 px-4 py-3"
          style={i !== 0 ? { borderTop: "1px solid var(--border)" } : {}}
        >
          <StatusPill status={d.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm" style={{ color: "var(--text)" }}>{d.message || "—"}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              <Mono>{d.commit || "—"}</Mono> · <Mono>{d.branch}</Mono> · {d.trigger}
            </div>
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {d.durationSec != null ? `${d.durationSec}s` : "running…"}
          </div>
          <div className="w-20 text-right text-xs" style={{ color: "var(--text-muted)" }}>
            {timeAgo(d.startedAt)}
          </div>
        </div>
      ))}
      <div className="px-4 py-2 text-right" style={{ borderTop: "1px solid var(--border)" }}>
        <Button variant="ghost" onClick={onRedeploy}>
          <Rocket className="h-4 w-4" /> Redeploy latest
        </Button>
      </div>
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────────

function SettingsTab({ svc, serviceId }) {
  const navigate = useNavigate();

  // custom domain
  const [fqdn, setFqdn] = useState(svc.domain || "");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMsg, setDomainMsg] = useState(null); // { ok, text }

  // dns verify
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // { host, serverIp, resolvedIps, pointsAt }

  async function saveDomain(e) {
    e.preventDefault();
    setDomainBusy(true);
    setDomainMsg(null);
    setVerifyResult(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/domain`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fqdn: fqdn.trim() }),
      });
      if (!r.ok) {
        const e2 = await r.json().catch(() => ({}));
        throw new Error(e2.error || String(r.status));
      }
      setDomainMsg({ ok: true, text: "Domain saved." });
    } catch (err) {
      setDomainMsg({ ok: false, text: err.message });
    } finally {
      setDomainBusy(false);
    }
  }

  async function verifyDns() {
    if (!fqdn.trim()) return;
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      const r = await fetch(
        `/api/services/${serviceId}/domain/verify?fqdn=${encodeURIComponent(fqdn.trim())}`,
        { credentials: "same-origin" }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || String(r.status));
      setVerifyResult(data);
    } catch (err) {
      setVerifyResult({ error: err.message });
    } finally {
      setVerifyBusy(false);
    }
  }

  async function deleteSvc() {
    if (!window.confirm(`Delete service "${svc.name}"? This cannot be undone.`)) return;
    await fetch(`/api/services/${serviceId}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    navigate("/");
  }

  const MetaRow = ({ label, value }) => (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <span className="text-sm" style={{ color: "var(--text-muted)" }}>{label}</span>
      <Mono className="text-sm" style={{ color: "var(--text)" }}>{value || "—"}</Mono>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* service info */}
      <div className="overflow-hidden rounded-xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
          Service info
        </div>
        {[
          ["Repository", svc.repo],
          ["Branch", svc.branch],
          ["Runtime", svc.runtime],
          ["Server", svc.server],
          ["UUID", svc.uuid],
        ].map(([label, value]) => (
          <MetaRow key={label} label={label} value={value} />
        ))}
      </div>

      {/* custom domain */}
      <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4" style={{ color: "var(--accent)" }} />
          <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}>
            Custom domain
          </span>
        </div>

        <form onSubmit={saveDomain} className="flex gap-2">
          <Input
            value={fqdn}
            onChange={(e) => { setFqdn(e.target.value); setVerifyResult(null); }}
            placeholder="app.example.com"
          />
          <Button type="submit" variant="primary" disabled={domainBusy || !fqdn.trim()}>
            {domainBusy ? <Spinner /> : "Save domain"}
          </Button>
          <Button type="button" variant="ghost" onClick={verifyDns} disabled={verifyBusy || !fqdn.trim()}>
            {verifyBusy ? <Spinner /> : "Verify DNS"}
          </Button>
        </form>

        {domainMsg && (
          <p className="mt-2 text-xs" style={{ color: domainMsg.ok ? "var(--ok)" : "var(--err)" }}>
            {domainMsg.text}
          </p>
        )}

        {verifyResult && !verifyResult.error && (
          <DnsResult result={verifyResult} />
        )}
        {verifyResult?.error && (
          <p className="mt-3 text-xs" style={{ color: "var(--err)" }}>Verify failed: {verifyResult.error}</p>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Auto HTTPS is managed by Coolify via Let&apos;s Encrypt — TLS provisions automatically once DNS resolves.
        </p>
      </div>

      {/* danger zone */}
      <div
        className="rounded-xl border p-5"
        style={{ background: "color-mix(in srgb, var(--err) 5%, transparent)", borderColor: "color-mix(in srgb, var(--err) 20%, transparent)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Trash2 className="h-4 w-4" style={{ color: "var(--err)" }} />
          <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--err)" }}>
            Danger zone
          </span>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Deletes the service from Coolify permanently. Databases are not affected.
        </p>
        <Button variant="danger" onClick={deleteSvc}>
          <Trash2 className="h-4 w-4" /> Delete service
        </Button>
      </div>
    </div>
  );
}

// ── DNS verification result ────────────────────────────────────────────────────

function DnsResult({ result }) {
  const { host, serverIp, resolvedIps, pointsAt } = result;
  const [copied, setCopied] = useState(false);

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className="mt-3 rounded-lg border p-3 text-xs space-y-2"
      style={{
        background: "var(--surface-2)",
        borderColor: pointsAt ? "color-mix(in srgb, var(--ok) 30%, transparent)" : "color-mix(in srgb, var(--warn) 30%, transparent)",
      }}
    >
      <div className="flex items-center gap-2">
        {pointsAt
          ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--ok)" }} />
          : <XCircle className="h-4 w-4 shrink-0" style={{ color: "var(--warn)" }} />}
        <span style={{ color: "var(--text)" }}>
          {pointsAt
            ? `${host} points at the server — DNS is correct.`
            : resolvedIps.length
              ? `${host} resolves to ${resolvedIps.join(", ")} but expected ${serverIp || "??"}.`
              : `${host} did not resolve — no DNS record found.`}
        </span>
      </div>

      {!pointsAt && serverIp && (
        <div
          className="rounded-md border p-2.5 flex items-start justify-between gap-2"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div>
            <p className="font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Create an A record:</p>
            <p style={{ color: "var(--text)" }}>
              <Mono>@</Mono> or <Mono>{host.split(".")[0]}</Mono> → <Mono>{serverIp}</Mono>
            </p>
          </div>
          <button
            onClick={() => copy(`A\t${host}\t${serverIp}`)}
            className="flex items-center gap-1 shrink-0 rounded px-2 py-1 transition"
            style={{ color: copied ? "var(--ok)" : "var(--text-muted)", background: "var(--surface-2)" }}
            title="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
