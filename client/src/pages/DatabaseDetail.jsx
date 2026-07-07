import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Eye, EyeOff, Copy } from "lucide-react";
import { api } from "../lib/api.js";
import { StatusPill, Spinner, Button, timeAgo } from "../components/ui.jsx";
import { SettingsSection, SettingsRow } from "../components/SettingsSection.jsx";
import MoveToProject from "../components/MoveToProject.jsx";

const DB_LABEL = {
  postgresql: "PostgreSQL",
  redis:      "Redis / Valkey",
  mysql:      "MySQL",
  mariadb:    "MariaDB",
  mongodb:    "MongoDB",
};

// version label e.g. "PostgreSQL 16"; falls back to raw type when unknown
function versionLabel(db) {
  const label = DB_LABEL[db.type] || db.type || "Database";
  return db.version ? `${label} ${db.version}` : label;
}

// map a limits value; 0 / null / undefined → "default"
function limitOrDefault(v, suffix = "") {
  if (v == null || v === 0 || v === "0") return "default";
  return `${v}${suffix}`;
}

// Plan's RAM string ("256 MB" / "4 GB") → Docker limits_memory ("256M" / "4G").
const dbRamToDocker = (ram) => String(ram || "").replace(/\s*MB/i, "M").replace(/\s*GB/i, "G").replace(/\s+/g, "");

// Scale a database up/down: pick a DB plan → price shows live → Save sets the
// billing plan AND applies the tier's memory limit to the container.
function DbPlanScale({ dbUuid, currentPlanId, onSaved }) {
  const [plans, setPlans] = useState(null);
  const [sel, setSel] = useState(currentPlanId || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let off = false;
    api.plans().then((d) => { if (!off) setPlans(d?.db || []); }).catch(() => { if (!off) setPlans([]); });
    return () => { off = true; };
  }, []);

  if (plans == null) return <div className="text-[13px]" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Loading plans…</div>;
  const plan = plans.find((p) => p.id === sel) || null;
  const dirty = (sel || "") !== (currentPlanId || "");

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api.setDatabasePlan(dbUuid, sel || null);
      // Apply the tier's memory limit too (best-effort — billing succeeds regardless).
      if (plan) { try { await api.updateDatabaseResources(dbUuid, { memory: dbRamToDocker(plan.ram) }); } catch { /* limit optional */ } }
      setMsg({ ok: true, text: "Saved — memory limit applies on next restart." });
      onSaved?.(sel || null);
    } catch (e) {
      setMsg({ ok: false, text: e.message || "Update failed" });
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <select className="input" value={sel} onChange={(e) => setSel(e.target.value)} style={{ minWidth: 260 }}>
          <option value="">Free tier (shared, no plan)</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ${p.priceMo}/mo · {p.ram} RAM · {p.storage}</option>)}
        </select>
        <Button variant="secondary" onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      {plan ? (
        <p className="text-[12.5px]" style={{ color: "var(--text)" }}>
          <span className="font-bold">${plan.priceMo}/mo</span>
          <span style={{ color: "var(--text-muted)" }}> · {plan.ram} RAM · {plan.storage} storage
            {plan.renderMo ? ` — ${Math.round((1 - plan.priceMo / plan.renderMo) * 100)}% under Render` : ""}
          </span>
        </p>
      ) : (
        <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>Free tier — shares the host, no monthly charge.</p>
      )}
      {msg && <p className="text-[12.5px]" style={{ color: msg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{msg.text}</p>}
    </div>
  );
}

function CopyBtn({ value }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title="Copy"
      onClick={() => { navigator.clipboard?.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200); }}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}>
      <Copy size={14} /> {ok ? "copied" : ""}
    </button>
  );
}

// On-demand reveal of the database's connection details. Nothing is fetched until
// the owner/admin clicks Reveal; the password sits behind a show/hide toggle.
function DbCredentials({ dbUuid }) {
  const [creds, setCreds] = useState(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function reveal() {
    setBusy(true); setErr(null);
    try { setCreds(await api.dbCredentials(dbUuid)); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <SettingsSection id="credentials" title="Connection details">
      {!creds ? (
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={reveal} disabled={busy}>{busy ? <Spinner /> : <Eye size={16} />} Reveal</Button>
          {err && <span className="text-sm" style={{ color: "var(--err-text)" }}>{err}</span>}
        </div>
      ) : (
        <>
          <SettingsRow label="Username"><span className="mono">{creds.username || "—"}</span></SettingsRow>
          <SettingsRow label="Password">
            <span className="mono">{show ? (creds.password ?? "—") : "••••••••••"}</span>{" "}
            <button type="button" onClick={() => setShow((v) => !v)} title={show ? "Hide" : "Show"}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {creds.password && <> <CopyBtn value={creds.password} /></>}
          </SettingsRow>
          <SettingsRow label="Host"><span className="mono">{creds.internalHost}:{creds.internalPort}</span></SettingsRow>
          {creds.database && <SettingsRow label="Database"><span className="mono">{creds.database}</span></SettingsRow>}
          {creds.internalUrl && (
            <SettingsRow label="Internal URL">
              <span className="mono break-all">{show ? creds.internalUrl : creds.internalUrl.replace(/:[^:@/]+@/, ":••••@")}</span> <CopyBtn value={creds.internalUrl} />
            </SettingsRow>
          )}
          <SettingsRow label="External URL">
            {creds.externalUrl ? (
              <><span className="mono break-all">{show ? creds.externalUrl : creds.externalUrl.replace(/:[^:@/]+@/, ":••••@")}</span> <CopyBtn value={creds.externalUrl} /></>
            ) : (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>No public port — enable one to connect from outside the platform.</span>
            )}
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}

export default function DatabaseDetail() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null); setDb(null);
    api.database(uuid)
      .then((d) => { if (!cancelled) setDb(d); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [uuid]);

  async function handleDelete() {
    if (!window.confirm(`Delete database "${db.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteDatabase(uuid);
      navigate("/databases");
    } catch (err) {
      setError(err);
      setDeleting(false);
    }
  }

  if (!db) {
    if (error) return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="card">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Unable to load database</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{error.message}</p>
          <Link to="/databases" className="mt-4 inline-flex text-sm" style={{ color: "var(--accent)" }}>Back to infrastructure</Link>
        </div>
      </div>
    );
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  const region = db.server || "hel-prod-1 · Helsinki";

  return (
    <div className="page">
      {/* back link */}
      <Link
        to="/databases"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        <ArrowLeft className="h-[15px] w-[15px]" /> Infrastructure
      </Link>

      {/* ── header ── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h1
              className="text-2xl font-semibold"
              style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em", color: "var(--text)" }}
            >
              {db.name}
            </h1>
            <StatusPill status={db.status} />
            <span className="pill pill-muted text-[10px] uppercase tracking-wider">
              {DB_LABEL[db.type] || db.type}
            </span>
          </div>
          <p className="mono text-[12px]" style={{ color: "var(--text-muted)" }}>
            Service ID {db.uuid}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-[18px]">
        {/* 1 · General */}
        <SettingsSection id="general" title="General">
          <SettingsRow label="Name" desc="A friendly name for this database.">
            <EditableName
              value={db.name}
              onSave={(name) => api.renameDatabase(uuid, name).then(() => setDb((d) => ({ ...d, name })))}
            />
          </SettingsRow>
          <SettingsRow label="Created" desc="When this database was provisioned.">
            <ReadOnly value={db.createdAt ? new Date(db.createdAt).toLocaleString() : "—"} />
          </SettingsRow>
          <SettingsRow label="Last online" desc="Most recent time the instance reported healthy.">
            <ReadOnly value={db.lastOnlineAt ? timeAgo(db.lastOnlineAt) : "—"} />
          </SettingsRow>
          <SettingsRow label="Status" desc="Current runtime state of the database.">
            <div className="flex items-center gap-2">
              <StatusPill status={db.status} />
              {db.health && <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>· {db.health}</span>}
            </div>
          </SettingsRow>
          <SettingsRow label="Version" desc="Engine and version this database runs.">
            <ReadOnly value={versionLabel(db)} />
          </SettingsRow>
          <SettingsRow label="Region" desc="The server this database runs on.">
            <ReadOnly value={region} />
          </SettingsRow>
          <SettingsRow label="Project" desc="Group this database under a project & environment.">
            <MoveToProject kind="database" resourceId={db.uuid} />
          </SettingsRow>
        </SettingsSection>

        {/* 2 · Postgres Instance */}
        <SettingsSection id="instance" title="Instance">
          <SettingsRow label="Image" desc="Container image backing this instance.">
            <ReadOnly mono value={db.image || "—"} />
          </SettingsRow>
          <SettingsRow label="RAM" desc="Memory limit. Blank uses the server default.">
            <ReadOnly value={limitOrDefault(db.limits?.memory)} />
          </SettingsRow>
          <SettingsRow label="CPU" desc="CPU limit. Blank uses the server default.">
            <ReadOnly value={limitOrDefault(db.limits?.cpus)} />
          </SettingsRow>
          <SettingsRow label="CPU shares" desc="Relative CPU weighting. Blank uses the default.">
            <ReadOnly value={limitOrDefault(db.limits?.cpuShares)} />
          </SettingsRow>
        </SettingsSection>

        {/* Plan & scaling */}
        <SettingsSection id="plan" title="Plan & scaling">
          <SettingsRow label="Plan" desc="Scale this database up or down. Price updates live; the memory limit applies on the next restart.">
            <DbPlanScale
              dbUuid={db.uuid}
              currentPlanId={db.plan_id}
              onSaved={(pid) => setDb((d) => ({ ...d, plan_id: pid }))}
            />
          </SettingsRow>
        </SettingsSection>

        {/* 3 · Connection details (on-demand reveal) */}
        <DbCredentials dbUuid={uuid} />

        {/* 4 · Connections */}
        <SettingsSection id="connections" title="Connections">
          <SettingsRow label="Hostname" desc="Internal hostname within the Coolify network.">
            <ReadOnly mono value={db.host || "—"} />
          </SettingsRow>
          <SettingsRow label="Port" desc="Port the database listens on.">
            <ReadOnly mono value={db.port != null ? String(db.port) : "—"} />
          </SettingsRow>
          {db.type === "postgresql" && (
            <>
              <SettingsRow label="Database" desc="Default database name.">
                <ReadOnly mono value={db.postgresDb || "—"} />
              </SettingsRow>
              <SettingsRow label="Username" desc="Default connection user.">
                <ReadOnly mono value={db.postgresUser || "—"} />
              </SettingsRow>
            </>
          )}
          <SettingsRow label="Internal URL" desc="Host-only connection string (no password) exposed by Coolify.">
            <RevealField value={db.internalUrl} />
          </SettingsRow>
          <SettingsRow label="Password" desc="Set when the database was created.">
            <NotAvailable note="Not available via API — Coolify does not expose the database password." />
          </SettingsRow>
        </SettingsSection>

        {/* 4 · Networking */}
        <SettingsSection id="networking" title="Networking">
          <SettingsRow label="Public access" desc="Whether the database is reachable from outside the internal network.">
            <ReadOnly value={db.isPublic ? "Public" : "Private"} />
          </SettingsRow>
          <SettingsRow label="SSL" desc="TLS enforcement for connections.">
            <ReadOnly value={db.ssl ? `Enabled${db.sslMode ? ` · ${db.sslMode}` : ""}` : "Disabled"} />
          </SettingsRow>
        </SettingsSection>

        {/* 5 · Health checks */}
        <SettingsSection id="health" title="Health checks">
          <SettingsRow label="Enabled" desc="Whether Coolify polls this database for health.">
            <ReadOnly value={db.healthCheck?.enabled ? "Enabled" : "Disabled"} />
          </SettingsRow>
          <SettingsRow label="Interval" desc="How often the health check runs.">
            <ReadOnly value={db.healthCheck?.interval != null ? `${db.healthCheck.interval}s` : "default"} />
          </SettingsRow>
        </SettingsSection>

        {/* 6 · Delete */}
        <section
          className="scroll-mt-24 rounded-lg px-5 py-[18px]"
          style={{ border: "1px solid var(--err)", background: "var(--err-soft)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="mb-[3px] text-[14.5px] font-semibold" style={{ color: "var(--err-text)" }}>Delete database</h3>
              <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                Permanently removes the database container and all its data. This cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />} Delete database
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── field primitives (mirrors ServiceDetail's read-only look) ──────────────────

function ReadOnly({ value, mono }) {
  return (
    <div
      className={`${mono ? "mono " : ""}truncate rounded-md border px-3 py-[9px] text-[13px]`}
      style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
      title={String(value)}
    >
      {value}
    </div>
  );
}

// masked value with a client-side reveal toggle + copy button
function RevealField({ value }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!value) return <NotAvailable note="Not available via API." />;

  function copy() {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <ReadOnly mono value={shown ? value : "•".repeat(Math.min(value.length, 40))} />
      <IconBtn title={shown ? "Hide" : "Reveal"} onClick={() => setShown((v) => !v)}>
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </IconBtn>
      <IconBtn title={copied ? "Copied" : "Copy"} onClick={copy}>
        <Copy className="h-4 w-4" style={copied ? { color: "var(--ok-text)" } : undefined} />
      </IconBtn>
    </div>
  );
}

// Inline-editable name field (Render-style): read-only + Edit → input + Save/Cancel.
function EditableName({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function start() { setDraft(value); setErr(null); setEditing(true); }

  async function save() {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    try {
      await onSave(name);
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Rename failed");
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <ReadOnly value={value} />
        <Button variant="secondary" onClick={start}>Edit</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          className="input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        />
        <Button variant="primary" onClick={save} disabled={busy || !draft.trim()}>{busy ? <Spinner /> : "Save"}</Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
      </div>
      {err && <span className="text-xs" style={{ color: "var(--err-text)" }}>{err}</span>}
    </div>
  );
}

function NotAvailable({ note }) {
  return (
    <div
      className="rounded-md border px-3 py-[9px] text-[12.5px] italic"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
    >
      {note}
    </div>
  );
}

function IconBtn({ children, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-md border transition-colors"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
    >
      {children}
    </button>
  );
}
