import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Button, Select } from "./ui.jsx";

// Move a service or database into a Coolify project. `kind` = "service" | "database".
export default function MoveToProject({ kind, resourceId, current }) {
  const [projects, setProjects] = useState(null);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.projects().then((p) => setProjects(Array.isArray(p) ? p : [])).catch(() => setProjects([]));
  }, []);

  async function move() {
    if (!sel || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      if (kind === "database") await api.moveDatabase(resourceId, sel);
      else await api.moveService(resourceId, sel);
      setMsg({ ok: true, text: "Moved ✓" });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={sel} onChange={(e) => setSel(e.target.value)} disabled={!projects?.length} style={{ flex: 1 }}>
        <option value="">{current ? `Currently: ${current}` : projects?.length ? "Select a project…" : "Loading…"}</option>
        {(projects || []).map((p) => (
          <option key={p.uuid} value={p.uuid}>{p.name}</option>
        ))}
      </Select>
      <Button variant="secondary" onClick={move} disabled={!sel || busy}>
        {busy ? "Moving…" : "Move"}
      </Button>
      {msg && <span className="text-xs" style={{ color: msg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{msg.text}</span>}
    </div>
  );
}
