import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Layers, Database, Clock, Globe, ArrowRight, Pencil, Trash2, Plus, X, ArrowLeft } from "lucide-react";
import { api } from "../lib/api.js";
import {
  Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, StatusPill, timeAgo,
} from "../components/ui.jsx";

// ── Kind config ───────────────────────────────────────────────────────────────

const KIND_SECTIONS = [
  { key: "web_service",        label: "Web Services",        icon: Layers },
  { key: "background_worker",  label: "Background Workers",  icon: ArrowRight },
  { key: "cron_job",           label: "Cron Jobs",           icon: Clock },
  { key: "postgres",           label: "Databases",           icon: Database },
  { key: "key_value",          label: "Key Value",           icon: Database },
  { key: "static_site",        label: "Static Sites",        icon: Globe },
];

function kindRoute(kind) {
  return kind === "postgres" || kind === "key_value" ? "databases" : "services";
}

// ── Move Modal ────────────────────────────────────────────────────────────────

function MoveModal({ resource, onClose, onMoved }) {
  const [projects, setProjects] = useState(null);
  const [envs, setEnvs]         = useState([]);
  const [projectId, setProjectId] = useState("");
  const [envId, setEnvId]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);

  useEffect(() => {
    api.projects().then(list => { setProjects(list || []); }).catch(() => setProjects([]));
  }, []);

  // Load environments when project changes
  useEffect(() => {
    if (!projectId) { setEnvs([]); setEnvId(""); return; }
    api.project(projectId).then(detail => {
      const e = detail.environments || [];
      setEnvs(e);
      setEnvId(e[0]?.id ?? "");
    }).catch(() => { setEnvs([]); setEnvId(""); });
  }, [projectId]);

  async function handleMove() {
    if (!envId) return;
    setBusy(true); setErr(null);
    try {
      // type is "application" for services, "database" for databases
      const type = resource.kind === "postgres" || resource.kind === "key_value" ? "database" : "application";
      await api.placeResource(type, resource.coolify_uuid, envId);
      onMoved();
      onClose();
    } catch (e) {
      setErr(e.message || "Move failed");
    } finally { setBusy(false); }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(10,12,17,.45)",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 64, zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 440, maxWidth: "calc(100% - 40px)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, boxShadow: "var(--shadow-lg)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontFamily: "'Inter', sans-serif", fontSize: 16.5, fontWeight: 600, color: "var(--text)" }}>
            Move resource
          </h3>
          <button onClick={onClose} style={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 6, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            Moving <strong style={{ color: "var(--text)" }}>{resource.name || resource.coolify_uuid}</strong>
          </p>

          {projects === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
              <Spinner /> Loading projects…
            </div>
          ) : (
            <>
              <Field label="Project">
                <Select value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">— select project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Environment">
                <Select value={envId} onChange={e => setEnvId(e.target.value)} disabled={!projectId || envs.length === 0}>
                  {envs.length === 0
                    ? <option value="">— select project first —</option>
                    : envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)
                  }
                </Select>
              </Field>
            </>
          )}

          {err && <p style={{ margin: 0, fontSize: 12.5, color: "var(--err)" }}>{err}</p>}
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 9,
          padding: "16px 22px", borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleMove} disabled={!envId || busy}>
            {busy ? <Spinner /> : null} Move
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── New Environment Modal ─────────────────────────────────────────────────────

function NewEnvModal({ projectId, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.createEnvironment(projectId, name.trim());
      onCreate();
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to create environment");
    } finally { setBusy(false); }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(10,12,17,.45)",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 64, zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 380, maxWidth: "calc(100% - 40px)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, boxShadow: "var(--shadow-lg)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontFamily: "'Inter', sans-serif", fontSize: 16.5, fontWeight: 600, color: "var(--text)" }}>
            New environment
          </h3>
          <button onClick={onClose} style={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 6, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: "20px 22px" }}>
          <Field label="Name">
            <Input
              placeholder="e.g. Staging"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              autoFocus
            />
          </Field>
          {err && <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--err)" }}>{err}</p>}
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 9,
          padding: "16px 22px", borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!name.trim() || busy}>
            {busy ? <Spinner /> : null} Create
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Resource card within a kind section ───────────────────────────────────────

function ResourceCard({ resource, onMove }) {
  const route = kindRoute(resource.kind);
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      padding: "11px 16px", borderBottom: "1px solid var(--border)",
    }}>
      <Link
        to={`/${route}/${resource.coolify_uuid}`}
        style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", textDecoration: "none", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--accent-text)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--text)")}
      >
        {resource.name || resource.coolify_uuid}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {resource.domain && (
          <a
            href={resource.domain.startsWith("http") ? resource.domain : `https://${resource.domain}`}
            target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 12, color: "var(--accent-text)", textDecoration: "none" }}
          >
            {resource.domain.replace(/^https?:\/\//, "")}
          </a>
        )}
        <StatusPill status={resource.status || "unknown"} />
        <button
          onClick={onMove}
          title="Move to another environment"
          style={{
            fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)", background: "none",
            border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px",
            cursor: "pointer", whiteSpace: "nowrap",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
        >
          Move
        </button>
      </div>
    </div>
  );
}

// ── Kind Section ──────────────────────────────────────────────────────────────

function KindSection({ kind, resources, onMove }) {
  const { label, icon: Icon } = KIND_SECTIONS.find(k => k.key === kind);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--surface-2)", borderRadius: "8px 8px 0 0",
        border: "1px solid var(--border)",
      }}>
        <Icon size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 2 }}>{resources.length}</span>
      </div>
      <div style={{ border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px", background: "var(--surface)" }}>
        {resources.length === 0 ? (
          <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--text-muted)" }}>None</div>
        ) : (
          resources.map(r => (
            <ResourceCard key={r.coolify_uuid} resource={r} onMove={() => onMove(r)} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Rename / Delete inline controls ──────────────────────────────────────────

function RenameInput({ value, onSave, onCancel }) {
  const [v, setV] = useState(value);
  return (
    <input
      className="input"
      value={v}
      autoFocus
      onChange={e => setV(e.target.value)}
      onBlur={() => onSave(v)}
      onKeyDown={e => {
        if (e.key === "Enter") onSave(v);
        if (e.key === "Escape") onCancel();
      }}
      style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Inter', sans-serif", padding: "4px 10px", maxWidth: 340 }}
    />
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject]   = useState(null);  // { project, environments }
  const [services, setServices] = useState([]);
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const [activeEnvId, setActiveEnvId] = useState(null);
  const [newEnvOpen, setNewEnvOpen]   = useState(false);
  const [moveTarget, setMoveTarget]   = useState(null); // resource being moved
  const [renaming, setRenaming]       = useState(false);
  const [deleting, setDeleting]       = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api.project(id),
      api.services().catch(() => []),
      api.databases().catch(() => []),
    ]).then(([detail, svcs, dbs]) => {
      setProject(detail);
      setServices(svcs || []);
      setDatabases(dbs || []);
      // Default to Production env, else first
      if (!activeEnvId || !detail.environments.find(e => e.id === activeEnvId)) {
        const prod = detail.environments.find(e => e.name.toLowerCase() === "production");
        setActiveEnvId((prod || detail.environments[0])?.id ?? null);
      }
    }).catch(e => setError(e.message || "Failed to load project"))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // ponytail: activeEnvId intentionally excluded — load() sets it only on first load

  useEffect(() => { load(); }, [load]);

  async function handleRename(name) {
    setRenaming(false);
    if (!name.trim() || name === project?.project?.name) return;
    try {
      await api.renameProject(id, name.trim());
      load();
    } catch (e) { alert(e.message || "Rename failed"); }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete project "${project?.project?.name}"? Its environments will be removed but resources are kept.`)) return;
    setDeleting(true);
    try {
      await api.deleteProject(id);
      navigate("/projects");
    } catch (e) {
      alert(e.message || "Delete failed");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Spinner /> Loading…
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="page">
        <PageHeader title="Project not found" subtitle={error || "This project no longer exists."} />
        <Link to="/projects"><Button variant="ghost"><ArrowLeft size={14} /> All projects</Button></Link>
      </div>
    );
  }

  const { project: proj, environments } = project;

  // Sort: Production first, then alphabetical
  const sortedEnvs = [...environments].sort((a, b) => {
    const ap = a.name.toLowerCase() === "production" ? 0 : 1;
    const bp = b.name.toLowerCase() === "production" ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });

  const activeEnv = sortedEnvs.find(e => e.id === activeEnvId) || sortedEnvs[0];

  // Build service/database lookup maps for enrichment
  const svcMap  = Object.fromEntries(services.map(s => [s.uuid, s]));
  const dbMap   = Object.fromEntries(databases.map(d => [d.uuid, d]));

  // Enrich resources in the active environment
  const kindMap = {};
  if (activeEnv) {
    for (const [kind, uuids] of Object.entries(activeEnv.resourcesByKind || {})) {
      kindMap[kind] = uuids.map(r => {
        const rich = svcMap[r.coolify_uuid] || dbMap[r.coolify_uuid] || {};
        return { ...r, name: rich.name, status: rich.status, domain: rich.domain };
      });
    }
  }

  return (
    <div className="page">
      {/* Back link */}
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px]"
        style={{ color: "var(--text-muted)", textDecoration: "none" }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        <ArrowLeft size={14} /> Projects
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
          {renaming ? (
            <RenameInput value={proj.name} onSave={handleRename} onCancel={() => setRenaming(false)} />
          ) : (
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {proj.name}
            </h1>
          )}
          {!renaming && (
            <button
              onClick={() => setRenaming(true)}
              title="Rename project"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          title="Delete project"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--err)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          {deleting ? <Spinner /> : <Trash2 size={16} />}
        </button>
      </div>

      {/* Environment tabs */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", marginBottom: 24, gap: 0 }}>
        {sortedEnvs.map(env => (
          <button
            key={env.id}
            onClick={() => setActiveEnvId(env.id)}
            style={{
              padding: "8px 18px", background: "transparent", border: "none", cursor: "pointer",
              fontSize: 13.5, fontWeight: 600, fontFamily: "inherit",
              color: activeEnv?.id === env.id ? "var(--text)" : "var(--text-muted)",
              borderBottom: `2px solid ${activeEnv?.id === env.id ? "var(--accent)" : "transparent"}`,
              marginBottom: -1, transition: "color .15s, border-color .15s",
            }}
          >
            {env.name}
          </button>
        ))}
        <button
          onClick={() => setNewEnvOpen(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 14px", background: "transparent", border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 500, color: "var(--text-muted)", marginBottom: -1,
            borderBottom: "2px solid transparent",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--accent-text)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <Plus size={14} /> New Environment
        </button>
      </div>

      {/* Environment body */}
      {!activeEnv ? (
        <EmptyState
          title="No environments"
          description="Create an environment to start placing resources."
          action={<Button variant="primary" onClick={() => setNewEnvOpen(true)}><Plus size={14} /> New Environment</Button>}
        />
      ) : (
        <div>
          {KIND_SECTIONS.map(({ key }) => (
            <KindSection
              key={key}
              kind={key}
              resources={kindMap[key] || []}
              onMove={r => setMoveTarget(r)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {newEnvOpen && (
        <NewEnvModal
          projectId={id}
          onClose={() => setNewEnvOpen(false)}
          onCreate={() => { setNewEnvOpen(false); load(); }}
        />
      )}
      {moveTarget && (
        <MoveModal
          resource={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={() => { setMoveTarget(null); load(); }}
        />
      )}
    </div>
  );
}
