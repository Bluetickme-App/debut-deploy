// Client-side Projects state (no backend yet — UI redesign scope). A Project is
// a folder grouping services/databases/servers; the app is scoped to the active
// one via the sidebar switcher. Seeded from the design handoff; persisted to
// localStorage so the active selection survives reloads.
// ponytail: client-only until a Projects backend exists — addProject/setActive
// mutate local state, nothing is persisted server-side.
import { createContext, useContext, useMemo, useState } from "react";

const SEED = [
  { id: "mflh", name: "mflh", color: "#2563eb", env: "production",
    description: "Creator monetization platform — web, API, and workers.",
    counts: { services: 6, databases: 3, servers: 2 },
    members: [{ i: "MF", c: "#6366f1" }, { i: "JL", c: "#0d9488" }, { i: "AK", c: "#d9822b" }],
    updatedAt: "2026-06-29T18:00:00Z" },
  { id: "internal-tools", name: "internal-tools", color: "#8b5cf6", env: "staging",
    description: "Back-office dashboards and admin utilities.",
    counts: { services: 3, databases: 1, servers: 1 },
    members: [{ i: "MF", c: "#6366f1" }, { i: "RP", c: "#2563eb" }],
    updatedAt: "2026-06-28T10:30:00Z" },
  { id: "data-platform", name: "data-platform", color: "#d9822b", env: "production",
    description: "Pipelines, warehouse sync, and reporting jobs.",
    counts: { services: 4, databases: 2, servers: 2 },
    members: [{ i: "AK", c: "#d9822b" }, { i: "JL", c: "#0d9488" }],
    updatedAt: "2026-06-27T22:15:00Z" },
  { id: "marketing-site", name: "marketing-site", color: "#0d9488", env: "production",
    description: "Static marketing site + edge redirects.",
    counts: { services: 2, databases: 0, servers: 1 },
    members: [{ i: "RP", c: "#2563eb" }],
    updatedAt: "2026-06-25T09:00:00Z" },
];

const ProjectsCtx = createContext(null);

function loadActive(projects) {
  const saved = typeof localStorage !== "undefined" && localStorage.getItem("activeProject");
  return projects.some((p) => p.id === saved) ? saved : projects[0].id;
}

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState(SEED);
  const [activeId, setActiveId] = useState(() => loadActive(SEED));

  const value = useMemo(() => ({
    projects,
    activeId,
    activeProject: projects.find((p) => p.id === activeId) || projects[0],
    setActive: (id) => {
      setActiveId(id);
      try { localStorage.setItem("activeProject", id); } catch { /* ignore */ }
    },
    // Returns the created project. color/env/description from the New Project modal.
    addProject: ({ name, color = "#2563eb", env = "production", description = "" }) => {
      const id = (name || "project").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || `project-${projects.length + 1}`;
      const proj = {
        id, name, color, env, description,
        counts: { services: 0, databases: 0, servers: 0 },
        members: [], updatedAt: new Date().toISOString(),
      };
      setProjects((prev) => [...prev, proj]);
      return proj;
    },
  }), [projects, activeId]);

  return <ProjectsCtx.Provider value={value}>{children}</ProjectsCtx.Provider>;
}

export function useProjects() {
  const ctx = useContext(ProjectsCtx);
  if (!ctx) throw new Error("useProjects must be used inside ProjectProvider");
  return ctx;
}
