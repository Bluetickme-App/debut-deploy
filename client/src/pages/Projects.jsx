import { useState } from "react";
import { FolderOpen, Layers, Database, Server, Plus, X } from "lucide-react";
import { PageHeader, Button, Field, Input, timeAgo } from "../components/ui.jsx";
import { useProjects } from "../lib/projects.jsx";

const SWATCHES = ["#2563eb", "#8b5cf6", "#0d9488", "#d9822b", "#e11d48", "#475569"];

function FolderTile({ color }) {
  return (
    <span style={{
      width: 40, height: 40, borderRadius: 11, background: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, boxShadow: `0 2px 6px -1px ${color}66`,
    }}>
      <FolderOpen size={20} color="#fff" strokeWidth={1.9} />
    </span>
  );
}

function EnvBadge({ env }) {
  const isProd = env === "production";
  return (
    <span className={`pill ${isProd ? "pill-ok" : "pill-warn"}`} style={{ marginTop: 4, fontSize: "10.5px" }}>
      {isProd ? "Production" : "Staging"}
    </span>
  );
}

function MemberAvatar({ member, index }) {
  return (
    <span style={{
      width: 26, height: 26, borderRadius: "50%", background: member.c,
      color: "#fff", fontSize: 10, fontWeight: 600,
      display: "flex", alignItems: "center", justifyContent: "center",
      border: "2px solid var(--surface)",
      marginLeft: index === 0 ? 0 : -8,
      flexShrink: 0,
    }}>
      {member.i}
    </span>
  );
}

function ProjectCard({ project }) {
  const { counts, members } = project;
  return (
    <div className="card card-hover" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "18px 19px", cursor: "pointer" }}>
      {/* Top row: tile + name/badge + chevron */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <FolderTile color={project.color} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.005em", fontFamily: "'Geist', sans-serif" }}>
              {project.name}
            </div>
            <EnvBadge env={project.env} />
          </div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {project.description}
      </p>

      {/* Resource counts */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "4px 0 2px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text)" }}>
          <Layers size={15} color="var(--text-muted)" strokeWidth={1.8} />
          <strong style={{ fontWeight: 600 }}>{counts.services}</strong> services
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text)" }}>
          <Database size={15} color="var(--text-muted)" strokeWidth={1.8} />
          <strong style={{ fontWeight: 600 }}>{counts.databases}</strong> databases
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text)" }}>
          <Server size={15} color="var(--text-muted)" strokeWidth={1.8} />
          <strong style={{ fontWeight: 600 }}>{counts.servers}</strong> servers
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "var(--border)" }} />

      {/* Footer: avatars + updated */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {members.map((m, i) => <MemberAvatar key={i} member={m} index={i} />)}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Updated {timeAgo(project.updatedAt)}
        </span>
      </div>
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
    padding: "6px 14px", borderRadius: 7, border: "none",
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
        borderRadius: 16, boxShadow: "var(--shadow-lg)", overflow: "hidden",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontFamily: "'Geist', sans-serif", fontSize: 16.5, fontWeight: 600, color: "var(--text)" }}>
            New project
          </h3>
          <button onClick={onClose} style={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 7, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer",
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
                    width: 30, height: 30, borderRadius: 9, background: c, cursor: "pointer",
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
              border: "1px solid var(--border)", borderRadius: 9,
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

  function handleCreate(vals) {
    addProject(vals);
  }

  return (
    <div style={{ padding: "26px 30px 40px", maxWidth: 1000 }}>
      <PageHeader
        title="Projects"
        subtitle="Group services, databases and servers into isolated environments."
        actions={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} strokeWidth={2.2} />
            New Project
          </Button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 6 }}>
        {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>

      {modalOpen && (
        <NewProjectModal
          onClose={() => setModalOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
