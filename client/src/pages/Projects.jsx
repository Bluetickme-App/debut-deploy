import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, X, FolderOpen } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Card, EmptyState, Field, Input, PageHeader, Spinner, timeAgo } from "../components/ui.jsx";
import { useProjects, colorFor } from "../lib/projects.jsx";

// ── New Project Modal ─────────────────────────────────────────────────────────

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await onCreate(name.trim());
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to create project");
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
        width: 420, maxWidth: "calc(100% - 40px)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, boxShadow: "var(--shadow-lg)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontFamily: "'Inter', sans-serif", fontSize: 16.5, fontWeight: 600, color: "var(--text)" }}>
            New project
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
          <Field label="Project name">
            <Input
              placeholder="e.g. Aurora Travel"
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
            {busy ? <Spinner /> : null} Create project
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, totalCount, loading }) {
  const color = colorFor(project.name);
  return (
    <Link
      to={`/projects/${project.id}`}
      style={{ textDecoration: "none" }}
    >
      <Card className="card-hover" style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <span style={{
            width: 36, height: 36, borderRadius: 8, background: color, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "'Inter', sans-serif",
          }}>
            {project.name[0].toUpperCase()}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: "var(--text)",
              fontFamily: "'Inter', sans-serif", letterSpacing: "-0.005em",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {project.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {loading ? "…" : `${totalCount} resource${totalCount !== 1 ? "s" : ""}`}
              {" · "}
              {project.created_at ? timeAgo(project.created_at) : "—"}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Projects() {
  const { addProject } = useProjects();
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null); // null = loading
  const [counts, setCounts] = useState({});        // id → total count
  const [modalOpen, setModalOpen] = useState(false);

  function load() {
    api.projects()
      .then(list => {
        setProjects(list || []);
        // Fetch detail for each project to get counts — ponytail: acceptable for ~5 projects
        (list || []).forEach(p => {
          api.project(p.id).then(detail => {
            const total = Object.values(detail.environments || []).reduce((sum, env) => {
              return sum + Object.values(env.resourcesByKind || {}).reduce((s, arr) => s + arr.length, 0);
            }, 0);
            setCounts(c => ({ ...c, [p.id]: total }));
          }).catch(() => {});
        });
      })
      .catch(() => setProjects([]));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(name) {
    const proj = await addProject({ name });
    load();
    const id = proj?.id ?? proj?.project?.id;
    if (id) navigate(`/projects/${id}`);
  }

  if (projects === null) {
    return (
      <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Spinner /> Loading…
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length !== 1 ? "s" : ""}`}
        actions={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project to organise your services and databases into environments."
          action={
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" /> New Project
            </Button>
          }
        />
      ) : (
        <div className="projects-grid">
          {projects.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              totalCount={counts[p.id] ?? 0}
              loading={!(p.id in counts)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <NewProjectModal
          onClose={() => setModalOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
