import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Rocket, Play, Square, RotateCw, ExternalLink,
  GitBranch, Globe, Trash2, CheckCircle2, XCircle, Copy, ChevronDown, ChevronUp,
  HardDrive, Activity, Heart, Plus,
} from "lucide-react";
import { api } from "../lib/api.js";
import { actionLabel } from "../lib/eventLabels.js";
import {
  StatusPill, Spinner, Button, Input, Mono, timeAgo, Field,
} from "../components/ui.jsx";
import EnvEditor from "../components/EnvEditor.jsx";
import LogStream from "../components/LogStream.jsx";

const TABS = ["Deployments", "Logs", "Environment", "Events", "Settings"];

export default function ServiceDetail() {
  const { id } = useParams();
  const [svc, setSvc] = useState(null);
  const [tab, setTab] = useState("Deployments");
  const [deploys, setDeploys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [envKey, setEnvKey] = useState(0); // bump to remount EnvEditor after bulk paste
  const [user, setUser] = useState(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => {});
  }, []);

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
        {tab === "Deployments" && (
          <Deployments
            deploys={deploys}
            serviceId={id}
            onRedeploy={() => action("deploy")}
            onDeploysChange={setDeploys}
          />
        )}
        {tab === "Logs" && <LogStream serviceId={id} live={svc.status === "deploying"} />}
        {tab === "Environment" && (
          <div className="space-y-6">
            <BulkEnvPaste serviceId={id} onDone={() => setEnvKey((k) => k + 1)} />
            <EnvEditor key={envKey} serviceId={id} />
          </div>
        )}
        {tab === "Events" && <EventsTab serviceId={id} />}
        {tab === "Settings" && <SettingsTab svc={svc} serviceId={id} isAdmin={user?.role === "admin"} />}
      </div>
    </div>
  );
}

// ── Deployments tab ────────────────────────────────────────────────────────────

function Deployments({ deploys, serviceId, onRedeploy, onDeploysChange }) {
  if (!deploys) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
      <Spinner className="mr-2 inline" /> Loading deployments…
    </div>
  );

  async function rollback(d) {
    if (!d.commit) return;
    if (!window.confirm(`Roll back to commit ${d.commit}?\n\nThis will redeploy the service at that commit.`)) return;
    await fetch(`/api/services/${serviceId}/rollback`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: d.commit }),
    });
    // refresh deployments after a moment so the new one appears
    setTimeout(() => api.deployments(serviceId).then(onDeploysChange), 1500);
  }

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
          {d.commit && (
            <Button variant="ghost" className="text-xs px-2 py-1 shrink-0" onClick={() => rollback(d)}>
              Rollback
            </Button>
          )}
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

// ── Events tab ─────────────────────────────────────────────────────────────────

function EventsTab({ serviceId }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.serviceEvents(serviceId)
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, [serviceId]);

  if (err) return (
    <div className="card text-sm" style={{ color: "var(--err)" }}>
      Failed to load events: {err.message}
    </div>
  );

  if (!events) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
      <Spinner className="mr-2 inline" /> Loading events…
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      {events.length === 0 && (
        <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No events recorded yet.
        </div>
      )}
      {events.map((ev, i) => {
        const isDown = ev.action === "service.down";
        const isUp = ev.action === "service.up";
        const labelColor = isDown ? "var(--err)" : isUp ? "var(--ok)" : "var(--text)";
        const label = actionLabel(ev.action);
        const actor = ev.actor_name || ev.actor_email || "system";
        return (
          <div
            key={ev.id ?? i}
            className="flex items-center gap-4 px-4 py-3 text-sm"
            style={i !== 0 ? { borderTop: "1px solid var(--border)" } : {}}
          >
            <span className="font-medium min-w-0" style={{ color: labelColor }}>{label}</span>
            <span className="truncate flex-1 text-xs" style={{ color: "var(--text-muted)" }}>{actor}</span>
            <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{timeAgo(ev.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────────

function SettingsTab({ svc, serviceId, isAdmin }) {
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

      {/* resources */}
      <ResourceLimits serviceId={serviceId} />

      {/* health check */}
      <HealthCheck serviceId={serviceId} />

      {/* persistent disks */}
      <PersistentDisks serviceId={serviceId} />

      {/* admin metrics strip */}
      {isAdmin && svc.serverUuid && <MetricsStrip serverUuid={svc.serverUuid} />}

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

// ── Resource limits ────────────────────────────────────────────────────────────

function ResourceLimits({ serviceId }) {
  const [memory, setMemory] = useState("");
  const [cpus, setCpus] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/limits`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: memory.trim(), cpus: cpus.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || String(r.status));
      setMsg({ ok: true, text: "Limits saved — takes effect on next deploy." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4" style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}>
          Resources
        </span>
      </div>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Memory limit (e.g. 512M, 1G)">
            <Input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="512M" />
          </Field>
          <Field label="CPU limit (e.g. 0.5, 1)">
            <Input value={cpus} onChange={(e) => setCpus(e.target.value)} placeholder="0.5" />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || (!memory.trim() && !cpus.trim())}>
            {busy ? <Spinner /> : "Save limits"}
          </Button>
          {msg && (
            <span className="text-xs" style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }}>
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Health check ───────────────────────────────────────────────────────────────

function HealthCheck({ serviceId }) {
  const [enabled, setEnabled] = useState(false);
  const [path, setPath] = useState("/");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/healthcheck`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, path: path.trim(), port: port ? Number(port) : undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || String(r.status));
      setMsg({ ok: true, text: "Health check updated." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 mb-4">
        <Heart className="h-4 w-4" style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}>
          Health check
        </span>
      </div>
      <form onSubmit={save} className="space-y-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded"
            style={{ accentColor: "var(--accent)" }}
          />
          <span className="text-sm" style={{ color: "var(--text)" }}>Enable health check</span>
        </label>
        {enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Path">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/healthz" />
            </Field>
            <Field label="Port (optional)">
              <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" />
            </Field>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : "Save"}
          </Button>
          {msg && (
            <span className="text-xs" style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }}>
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Persistent disks ───────────────────────────────────────────────────────────

function PersistentDisks({ serviceId }) {
  const [volumes, setVolumes] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [name, setName] = useState("");
  const [mountPath, setMountPath] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState(null);

  useEffect(() => {
    fetch(`/api/services/${serviceId}/volumes`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then(setVolumes)
      .catch((e) => setLoadErr(e.message));
  }, [serviceId]);

  async function addVolume(e) {
    e.preventDefault();
    if (!mountPath.trim()) return;
    setAddBusy(true);
    setAddMsg(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/volumes`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mountPath: mountPath.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || String(r.status));
      setName("");
      setMountPath("");
      setAddMsg({ ok: true, text: "Volume added." });
      // refresh
      fetch(`/api/services/${serviceId}/volumes`, { credentials: "same-origin" })
        .then((r) => r.json())
        .then(setVolumes)
        .catch(() => {});
    } catch (err) {
      setAddMsg({ ok: false, text: err.message });
    } finally {
      setAddBusy(false);
    }
  }

  async function deleteVolume(vid) {
    if (!window.confirm("Remove this volume? Data may be lost if the container used it.")) return;
    const r = await fetch(`/api/services/${serviceId}/volumes/${vid}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (r.ok) {
      setVolumes((v) => v.filter((vol) => vol.uuid !== vid && vol.id !== vid));
    }
  }

  return (
    <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 mb-4">
        <HardDrive className="h-4 w-4" style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}>
          Persistent disks
        </span>
      </div>

      {loadErr && (
        <p className="text-xs mb-3" style={{ color: "var(--err)" }}>Failed to load volumes: {loadErr}</p>
      )}

      {volumes === null && !loadErr && (
        <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Loading…</div>
      )}

      {volumes && volumes.length === 0 && (
        <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>No persistent volumes configured.</p>
      )}

      {volumes && volumes.length > 0 && (
        <div className="overflow-hidden rounded-lg border mb-4" style={{ borderColor: "var(--border)" }}>
          {volumes.map((vol, i) => (
            <div
              key={vol.uuid || vol.id || i}
              className="flex items-center justify-between px-3 py-2 text-sm"
              style={i !== 0 ? { borderTop: "1px solid var(--border)" } : {}}
            >
              <div>
                <span style={{ color: "var(--text)" }}>{vol.name || vol.mount_path}</span>
                {vol.mount_path && vol.name && (
                  <Mono className="ml-2" style={{ color: "var(--text-muted)" }}>{vol.mount_path}</Mono>
                )}
              </div>
              <button
                onClick={() => deleteVolume(vol.uuid || vol.id)}
                className="text-xs px-2 py-1 rounded transition"
                style={{ color: "var(--err)", background: "transparent" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--err) 10%, transparent)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                title="Delete volume"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addVolume} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Volume name (optional)"
          />
          <Input
            value={mountPath}
            onChange={(e) => setMountPath(e.target.value)}
            placeholder="/data (mount path, required)"
            required
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={addBusy || !mountPath.trim()}>
            {addBusy ? <Spinner /> : <><Plus className="h-4 w-4" /> Add volume</>}
          </Button>
          {addMsg && (
            <span className="text-xs" style={{ color: addMsg.ok ? "var(--ok)" : "var(--err)" }}>
              {addMsg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Admin metrics strip ────────────────────────────────────────────────────────

function MetricsStrip({ serverUuid }) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    fetch(`/api/servers/${serverUuid}/usage`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setUsage(d))
      .catch(() => {});
  }, [serverUuid]);

  if (!usage) return null;

  const bars = [
    { label: "CPU", value: usage.cpu, color: "var(--info)" },
    { label: "Memory", value: usage.memory, color: "var(--warn)" },
    { label: "Disk", value: usage.disk, color: "var(--accent)" },
  ].filter((b) => b.value != null);

  if (bars.length === 0) return null;

  return (
    <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4" style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}>
          Server usage
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {bars.map(({ label, value, color }) => (
          <div key={label}>
            <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              <span>{label}</span>
              <span style={{ color: "var(--text)" }}>{Math.round(value)}%</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: "var(--surface-2)" }}>
              <div
                className="h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, value)}%`, background: color }}
              />
            </div>
          </div>
        ))}
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
