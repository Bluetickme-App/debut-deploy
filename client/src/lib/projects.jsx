// Projects are derived client-side by grouping real services (from api.services())
// by their `group` field — the Coolify environment/project name (server mapApp:
// group = environment_name || project.name || "Apps"). No Projects backend exists,
// so counts come from live resources and the active selection persists to
// localStorage. addProject stays a local add; renames live in ProjectDetail state.
// ponytail: client-only, group-by-services. Add databases/servers to counts once
// the server exposes a `group` on those shapes (it doesn't today).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

// Stable-ish color per project name so the switcher/tiles aren't all grey.
const PALETTE = ["#2563eb", "#8b5cf6", "#0d9488", "#d9822b", "#e11d48", "#475569"];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function toId(name) {
  return name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "project";
}

// Group services by `group` → project list with real service counts.
function deriveProjects(services) {
  const byGroup = new Map();
  for (const s of services) {
    const g = s.group || "Apps";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(s);
  }
  return [...byGroup.entries()].map(([name, svcs]) => ({
    id: toId(name),
    name,
    color: colorFor(name),
    env: name.toLowerCase().includes("staging") ? "staging" : "production",
    description: `${svcs.length} service${svcs.length !== 1 ? "s" : ""} in this project.`,
    counts: { services: svcs.length, databases: 0, servers: 0 },
    members: [],
    updatedAt: svcs.map((s) => s.lastDeployedAt).filter(Boolean).sort().at(-1) || null,
  }));
}

// Never let the UI crash on an empty API — the switcher dereferences activeProject.
const FALLBACK = [{
  id: "apps", name: "Apps", color: PALETTE[0], env: "production",
  description: "Your services.", counts: { services: 0, databases: 0, servers: 0 },
  members: [], updatedAt: null,
}];

const ProjectsCtx = createContext(null);

export function ProjectProvider({ children }) {
  const [derived, setDerived] = useState([]);   // from API
  const [added, setAdded] = useState([]);        // local addProject()
  const [activeId, setActiveId] = useState(() => {
    try { return localStorage.getItem("activeProject") || null; } catch { return null; }
  });

  useEffect(() => {
    api.services()
      .then((svcs) => setDerived(deriveProjects(svcs || [])))
      .catch(() => setDerived([]));
  }, []);

  const value = useMemo(() => {
    const projects = [...derived, ...added];
    const list = projects.length ? projects : FALLBACK;
    const activeProject = list.find((p) => p.id === activeId) || list[0];
    return {
      projects: list,
      activeId: activeProject.id,
      activeProject,
      setActive: (id) => {
        setActiveId(id);
        try { localStorage.setItem("activeProject", id); } catch { /* ignore */ }
      },
      // color/env/description from the New Project modal. Returns the created project.
      addProject: ({ name, color = "#2563eb", env = "production", description = "" }) => {
        const proj = {
          id: toId(name || `project-${added.length + 1}`),
          name, color, env, description,
          counts: { services: 0, databases: 0, servers: 0 },
          members: [], updatedAt: new Date().toISOString(),
        };
        setAdded((prev) => [...prev, proj]);
        return proj;
      },
    };
  }, [derived, added, activeId]);

  return <ProjectsCtx.Provider value={value}>{children}</ProjectsCtx.Provider>;
}

export function useProjects() {
  const ctx = useContext(ProjectsCtx);
  if (!ctx) throw new Error("useProjects must be used inside ProjectProvider");
  return ctx;
}
