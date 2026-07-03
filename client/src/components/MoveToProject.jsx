import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Button, Select } from "./ui.jsx";

// Place a service/database into a panel Project → Environment. `kind` = "service" | "database".
// (Replaces the old Coolify project move — grouping is now panel-native via placement.)
export default function MoveToProject({ kind, resourceId }) {
  const type = kind === "database" ? "database" : "application";
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [envs, setEnvs] = useState([]);
  const [envId, setEnvId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.projects().then((p) => setProjects(Array.isArray(p) ? p : [])).catch(() => setProjects([]));
  }, []);

  // Environments only make sense inside a project — load them when one is picked.
  useEffect(() => {
    setEnvId("");
    setEnvs([]);
    if (!projectId) return;
    api.project(projectId).then((d) => setEnvs(d?.environments || [])).catch(() => setEnvs([]));
  }, [projectId]);

  async function move() {
    if (!envId || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.placeResource(type, resourceId, Number(envId));
      setMsg({ ok: true, text: "Moved ✓" });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects?.length} style={{ minWidth: 150 }}>
        <option value="">{projects?.length ? "Project…" : "Loading…"}</option>
        {(projects || []).map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
      <Select value={envId} onChange={(e) => setEnvId(e.target.value)} disabled={!projectId || !envs.length} style={{ minWidth: 140 }}>
        <option value="">{projectId ? (envs.length ? "Environment…" : "…") : "Environment"}</option>
        {envs.map((en) => (
          <option key={en.id} value={en.id}>{en.name}</option>
        ))}
      </Select>
      <Button variant="secondary" onClick={move} disabled={!envId || busy}>
        {busy ? "Moving…" : "Move"}
      </Button>
      {msg && <span className="text-xs" style={{ color: msg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{msg.text}</span>}
    </div>
  );
}
