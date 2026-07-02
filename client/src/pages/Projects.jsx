import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Layers, Plus, X } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Field, Input, StatusPill, timeAgo } from "../components/ui.jsx";
import { useProjects } from "../lib/projects.jsx";

const SWATCHES = ["#2563eb", "#8b5cf6", "#0d9488", "#d9822b", "#e11d48", "#475569"];

// Render-style project card: name + env badge, thin border, subtle hover.
function ProjectCard({ project, onClick }) {
  const isProd = project.env !== "staging";
  return (
    <button
      onClick={onClick}
      className="card card-hover"
      style={{
        display: "flex", alignItems: "center", gap: 13, padding: "18px 18px",
        cursor: "pointer", textAlign: "left", width: "100%",
        background: "var(--surface)", border: "1px solid var(--border)",
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 6, background: project.color, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontWeight: 700, fontSize: 15, fontFamily: "'Inter', sans-serif",
      }}>
        {project.name[0].toUpperCase()}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em", fontFamily: "'Inter', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {project.name}
        </div>
        <span className={`pill ${isProd ? "pill-ok" : "pill-warn"}`} style={{ marginTop: 5, fontSize: "10.5px" }}>
          {isProd ? "Production" : "Staging"}
        </span>
      </div>
    </button>
  );
}

// Dashed "create" card at the end of the grid.
function CreateCard({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "18px", borderRadius: 8, cursor: "pointer", width: "100%",
        border: "1px dashed var(--border-strong)", background: "transparent",
        color: "var(--text-muted)", fontSize: 13.5, fontWeight: 600,
        transition: "background .15s, color .15s, border-color .15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
    >
      <Plus size={16} strokeWidth={2.2} /> Create new project
    </button>
  );
}

const SUSPENDED = new Set(["stopped", "suspended", "failed", "error"]);

// Render-style ungrouped services table with Active/Suspended/All tabs.
function UngroupedServices({ services }) {
  const [tab, setTab] = useState("active"); // active | suspended | all
  const active = services.filter((s) => !SUSPENDED.has(s.status));
  const suspended = services.filter((s) => SUSPENDED.has(s.status));
  const rows = tab === "active" ? active : tab === "suspended" ? suspended : services;

  const TABS = [
    { id: "active", label: "Active", n: active.length },
    { id: "suspended", label: "Suspended", n: suspended.length },
    { id: "all", label: "All", n: services.length },
  ];

  const th = { fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-muted)" };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: "'Inter', sans-serif", margin: "0 0 12px" }}>
        Ungrouped Services
      </h2>

      {/* tabs */}
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "0 0 10px", background: "transparent", border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              color: tab === t.id ? "var(--text)" : "var(--text-muted)",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {t.label} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({t.n})</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "28px 4px", fontSize: 13, color: "var(--text-muted)" }}>
          No ungrouped services.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            {/* header */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr 1fr", gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--border)" }}>
              <span style={th}>Service</span>
              <span style={th}>Status</span>
              <span style={th}>Runtime</span>
              <span style={th}>Region</span>
              <span style={{ ...th, textAlign: "right" }}>Updated</span>
            </div>
            {/* rows */}
            {rows.map((s) => (
              <div key={s.uuid} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr 1fr", gap: 12, padding: "13px 4px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                <Link to={`/services/${s.uuid}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: "var(--text)", textDecoration: "none", minWidth: 0 }}>
                  <Layers size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                </Link>
                <div><StatusPill status={s.status} /></div>
                <span style={{ fontSize: 12.5, color: "var(--text)" }}>{s.runtime || "—"}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{s.region || "—"}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "right" }}>{s.lastDeployedAt ? timeAgo(s.lastDeployedAt) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [description, setDescription] = useState("");
  const [env, setEnv] = useState("production");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), color, env, description: description.trim() });
    onClose();
  }

  const segBtn = (active) => ({
    padding: "6px 14px", borderRadius: 6, border: "none",
    fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    boxShadow: active ? "var(--shadow)" : "none",
    transition: "background .15s, color .15s, box-shadow .15s",
  });

  return (
    /* backdrop */
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(10,12,17,.45)",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 64, zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* modal card */}
      <div style={{
        width: 440, maxWidth: "calc(100% - 40px)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, boxShadow: "var(--shadow-lg)", overflow: "hidden",
      }}>
        {/* header */}
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

        {/* body */}
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 17 }}>
          <Field label="Project name">
            <Input
              placeholder="e.g. mobile-backend"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              autoFocus
            />
          </Field>

          <div>
            <label className="label">Color</label>
            <div style={{ display: "flex", gap: 9 }}>
              {SWATCHES.map((c) => (
                <span
                  key={c}
                  role="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: 6, background: c, cursor: "pointer",
                    boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : "none",
                    transition: "box-shadow .12s",
                  }}
                />
              ))}
            </div>
          </div>

          <Field label="Description">
            <Input
              placeholder="What lives in this project?"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </Field>

          <div>
            <label className="label">Environment</label>
            <div style={{
              display: "flex", gap: 2, padding: 3,
              border: "1px solid var(--border)", borderRadius: 6,
              background: "var(--surface-2)", width: "fit-content",
            }}>
              <button style={segBtn(env === "production")} onClick={() => setEnv("production")}>Production</button>
              <button style={segBtn(env === "staging")} onClick={() => setEnv("staging")}>Staging</button>
            </div>
          </div>
        </div>

        {/* footer */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 9,
          padding: "16px 22px", borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!name.trim()}>
            Create project
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Projects() {
  const { projects, addProject } = useProjects();
  const [modalOpen, setModalOpen] = useState(false);
  const [services, setServices] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.services().then((s) => setServices(s || [])).catch(() => setServices([]));
  }, []);

  // "Ungrouped" = no real project group (server defaults missing groups to "Apps").
  const ungrouped = useMemo(
    () => services.filter((s) => !s.group || s.group === "Apps"),
    [services]
  );

  return (
    <div className="page">
      <h1 className="text-2xl font-bold" style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em", color: "var(--text)", marginBottom: 24 }}>
        Overview
      </h1>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: "'Inter', sans-serif", margin: "0 0 12px" }}>
        Projects
      </h2>
      <div className="projects-grid" style={{ marginBottom: 40 }}>
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onClick={() => navigate(`/projects/${p.id}`)} />
        ))}
        <CreateCard onClick={() => setModalOpen(true)} />
      </div>

      <UngroupedServices services={ungrouped} />

      {modalOpen && (
        <NewProjectModal
          onClose={() => setModalOpen(false)}
          onCreate={(vals) => addProject(vals)}
        />
      )}
    </div>
  );
}
