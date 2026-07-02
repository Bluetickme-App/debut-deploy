import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layers, Database, Server, ExternalLink, Pencil } from "lucide-react";
import { api } from "../lib/api.js";
import { Card, PageHeader, StatusPill, Spinner, timeAgo } from "../components/ui.jsx";
import { useProjects } from "../lib/projects.jsx";

// Group id → its resources. Services carry `group`; databases/servers don't today,
// so those lists stay empty until the server adds a group field.
// ponytail: title rename is local state only — no Projects backend to PATCH.
function belongs(resource, projectName) {
  return (resource.group || "Apps") === projectName;
}

function ResourceRow({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      padding: "12px 16px", borderBottom: "1px solid var(--border)",
    }}>
      {children}
    </div>
  );
}

function Section({ icon, title, count, children }) {
  return (
    <Card className="p-0" >
      <div style={{
        display: "flex", alignItems: "center", gap: 9, padding: "13px 16px",
        borderBottom: "1px solid var(--border)",
      }}>
        {icon}
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>
          {title}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{count}</span>
      </div>
      {children}
    </Card>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects } = useProjects();
  const project = projects.find((p) => p.id === id);

  const [services, setServices] = useState(null); // null = loading
  const [databases, setDatabases] = useState([]);
  const [servers, setServers] = useState([]);

  // Local, editable title — user wants project titles always editable, but there's
  // no backend to persist a rename, so it lives in component state.
  const [title, setTitle] = useState(project?.name || "");
  const [editing, setEditing] = useState(false);

  useEffect(() => { setTitle(project?.name || ""); }, [project?.name]);

  useEffect(() => {
    api.services().then(setServices).catch(() => setServices([]));
    api.databases().then(setDatabases).catch(() => setDatabases([]));
    api.servers().then(setServers).catch(() => setServers([]));
  }, []);

  const groupName = project?.name;
  const projServices = useMemo(
    () => (services || []).filter((s) => belongs(s, groupName)),
    [services, groupName]
  );
  const projDatabases = databases.filter((d) => belongs(d, groupName));
  const projServers = servers.filter((s) => belongs(s, groupName));

  if (!project) {
    return (
      <div style={{ maxWidth: 900 }} className="px-4 pt-4 pb-10 sm:px-7 sm:pt-6">
        <PageHeader title="Project not found" subtitle="This project no longer exists." />
        <button className="btn btn-ghost" onClick={() => navigate("/projects")}>Back to projects</button>
      </div>
    );
  }

  const titleField = editing ? (
    <input
      className="input"
      value={title}
      autoFocus
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(false); }}
      style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Inter', sans-serif", padding: "4px 10px", maxWidth: 420 }}
    />
  ) : (
    <button
      onClick={() => setEditing(true)}
      title="Rename project"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, background: "transparent",
        border: "none", cursor: "text", padding: 0, color: "var(--text)",
        fontSize: 22, fontWeight: 700, fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em",
      }}
    >
      {title}
      <Pencil size={15} style={{ color: "var(--text-muted)" }} />
    </button>
  );

  return (
    <div style={{ maxWidth: 900 }} className="px-4 pt-4 pb-10 sm:px-7 sm:pt-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{
            width: 40, height: 40, borderRadius: 11, background: project.color, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: 17, fontFamily: "'Inter', sans-serif",
          }}>
            {project.name[0].toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            {titleField}
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
              {project.description}
            </p>
          </div>
        </div>
        <button className="btn btn-ghost shrink-0" onClick={() => navigate("/projects")}>
          All projects
        </button>
      </div>

      {services === null ? (
        <div className="flex items-center gap-2" style={{ color: "var(--text-muted)", fontSize: 13 }}>
          <Spinner /> Loading resources…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section icon={<Layers size={17} style={{ color: "var(--text-muted)" }} />} title="Services" count={projServices.length}>
            {projServices.length === 0 ? (
              <div style={{ padding: "16px", fontSize: 13, color: "var(--text-muted)" }}>No services in this project yet.</div>
            ) : projServices.map((s) => (
              <ResourceRow key={s.uuid}>
                <button
                  onClick={() => navigate(`/services/${s.uuid}`)}
                  style={{ display: "flex", flexDirection: "column", gap: 2, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0, minWidth: 0 }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>
                    {s.name}
                  </span>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>
                    {s.repo || s.name} · {s.branch || "main"}
                  </span>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                  {s.domain && (
                    <a href={s.domain.startsWith("http") ? s.domain : `https://${s.domain}`} target="_blank" rel="noreferrer"
                       onClick={(e) => e.stopPropagation()}
                       style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--accent-text)", textDecoration: "none" }}>
                      {s.domain} <ExternalLink size={12} />
                    </a>
                  )}
                  <StatusPill status={s.status} />
                </div>
              </ResourceRow>
            ))}
          </Section>

          {projDatabases.length > 0 && (
            <Section icon={<Database size={17} style={{ color: "var(--text-muted)" }} />} title="Databases" count={projDatabases.length}>
              {projDatabases.map((d) => (
                <ResourceRow key={d.uuid}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{d.name}</span>
                  <StatusPill status={d.status} />
                </ResourceRow>
              ))}
            </Section>
          )}

          {projServers.length > 0 && (
            <Section icon={<Server size={17} style={{ color: "var(--text-muted)" }} />} title="Servers" count={projServers.length}>
              {projServers.map((sv) => (
                <ResourceRow key={sv.uuid}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{sv.name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{sv.ip || sv.host || ""}</span>
                </ResourceRow>
              ))}
            </Section>
          )}

          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Updated {timeAgo(project.updatedAt)}
          </span>
        </div>
      )}
    </div>
  );
}
