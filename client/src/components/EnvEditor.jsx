import { useEffect, useState } from "react";
import { Plus, Trash2, Eye, EyeOff, Save } from "lucide-react";
import { api } from "../lib/api.js";
import { Spinner, Button } from "./ui.jsx";

export default function EnvEditor({ serviceId }) {
  const [envs, setEnvs] = useState(null);
  const [reveal, setReveal] = useState({});
  const [draft, setDraft] = useState({ key: "", value: "", is_secret: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.envs(serviceId).then(setEnvs);
  }, [serviceId]);

  async function add() {
    if (!draft.key.trim()) return;
    setSaving(true);
    try {
      await api.saveEnv(serviceId, draft);
      setEnvs((e) => [...e, { uuid: "new-" + Date.now(), ...draft }]);
      setDraft({ key: "", value: "", is_secret: false });
    } finally {
      setSaving(false);
    }
  }

  async function remove(envId) {
    setEnvs((e) => e.filter((x) => x.uuid !== envId));
    api.deleteEnv(serviceId, envId).catch(() => {});
  }

  if (!envs)
    return (
      <div className="text-sm text-zinc-500">
        <Spinner className="mr-2 inline" /> Loading variables…
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        {envs.length} environment variables · changes apply on next deploy.
      </p>

      <div className="overflow-hidden rounded-lg border border-white/8 bg-[#13161d]">
        {envs.map((e, i) => (
          <div
            key={e.uuid}
            className={`flex items-center gap-3 px-4 py-2.5 ${i !== 0 ? "border-t border-white/6" : ""}`}
          >
            <code className="w-64 shrink-0 truncate text-sm font-medium text-indigo-200">{e.key}</code>
            <code className="flex-1 truncate font-mono text-sm text-zinc-300">
              {e.is_secret && !reveal[e.uuid] ? "••••••••••••" : e.value}
            </code>
            {e.is_secret && (
              <button
                onClick={() => setReveal((r) => ({ ...r, [e.uuid]: !r[e.uuid] }))}
                className="text-zinc-500 hover:text-zinc-300"
                title="Reveal"
              >
                {reveal[e.uuid] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
            <button
              onClick={() => remove(e.uuid)}
              className="text-zinc-500 hover:text-rose-400"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        {/* add row */}
        <div className="flex items-center gap-3 border-t border-white/8 bg-white/[0.02] px-4 py-2.5">
          <input
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })}
            placeholder="KEY"
            className="w-64 rounded-md border border-white/8 bg-[#0e1117] px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
          />
          <input
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            placeholder="value"
            className="flex-1 rounded-md border border-white/8 bg-[#0e1117] px-2 py-1.5 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
          />
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={draft.is_secret}
              onChange={(e) => setDraft({ ...draft, is_secret: e.target.checked })}
            />
            secret
          </label>
          <Button variant="primary" onClick={add} disabled={saving || !draft.key.trim()}>
            {saving ? <Spinner /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="default">
          <Save className="h-4 w-4" /> Save &amp; redeploy
        </Button>
      </div>
    </div>
  );
}
