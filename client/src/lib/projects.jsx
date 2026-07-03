// Projects context sourced from api.projects() (panel-native backend).
// Keeps the same exported interface { projects, activeId, activeProject, setActive, addProject }
// that the ProjectSwitcher in App.jsx reads.
// ponytail: no local "added" accumulator — API is the source of truth; addProject refreshes.
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { api } from "./api.js";

const PALETTE = ["#2563eb", "#8b5cf6", "#0d9488", "#d9822b", "#e11d48", "#475569"];
export function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Never let the UI crash on an empty API — the switcher dereferences activeProject.
const FALLBACK = [{
  id: "apps", name: "Apps", color: PALETTE[0],
}];

const ProjectsCtx = createContext(null);

export function ProjectProvider({ children }) {
  const [raw, setRaw] = useState([]);  // from api.projects()
  const [activeId, setActiveId] = useState(() => {
    try { return localStorage.getItem("activeProject") || null; } catch { return null; }
  });

  const load = useCallback(() => {
    api.projects()
      .then((list) => setRaw(list || []))
      .catch(() => setRaw([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => {
    // Enrich with stable color; keep at least { id, name, color } for the switcher.
    const projects = raw.map((p) => ({ ...p, color: colorFor(p.name) }));
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
      // addProject calls API, refreshes, sets the new project active.
      addProject: async ({ name }) => {
        const proj = await api.createProject(name);
        load();
        setActiveId(proj.id ?? proj.project?.id);
        return proj;
      },
    };
  }, [raw, activeId, load]);

  return <ProjectsCtx.Provider value={value}>{children}</ProjectsCtx.Provider>;
}

export function useProjects() {
  const ctx = useContext(ProjectsCtx);
  if (!ctx) throw new Error("useProjects must be used inside ProjectProvider");
  return ctx;
}
