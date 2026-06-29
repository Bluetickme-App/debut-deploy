import { useEffect, useState } from "react";
import { Plus, Trash2, KeyRound } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Card, EmptyState, Field, Input, Mono, PageHeader, Spinner } from "../components/ui.jsx";

// Admin-only: shared environment variables injected across the team's services.
export default function SharedVars() {
  const [vars, setVars] = useState(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    api.sharedVars().then(setVars).catch((e) => setError(e.message || "Failed to load"));
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true); setError("");
    try {
      await api.createSharedVar({ key: key.trim(), value });
      setKey(""); setValue("");
      await load();
    } catch (e) { setError(e.message || "Failed to save"); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    if (!window.confirm("Delete this shared variable?")) return;
    try { await api.deleteSharedVar(id); await load(); }
    catch (e) { setError(e.message || "Failed to delete"); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shared variables"
        subtitle="Environment variables available to every service in the team."
      />

      <Card>
        <form onSubmit={add} className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Key" className="flex-1 min-w-[10rem]">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="SHARED_API_KEY" />
          </Field>
          <Field label="Value" className="flex-[2] min-w-[12rem]">
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </form>
      </Card>

      {error && <p style={{ color: "var(--err)" }} className="text-sm">{error}</p>}

      {vars === null ? (
        <Spinner />
      ) : vars.length === 0 ? (
        <EmptyState
          title="No shared variables"
          description="Add a variable above to share it across all services."
        />
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {vars.map((v) => (
              <li key={v.uuid || v.id || v.key} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                <Mono className="font-medium">{v.key}</Mono>
                <Mono className="ml-auto truncate" style={{ color: "var(--text-muted)" }}>
                  {v.is_secret ? "••••••" : v.value}
                </Mono>
                <button
                  onClick={() => remove(v.uuid || v.id)}
                  className="btn-ghost shrink-0"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" style={{ color: "var(--err)" }} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
