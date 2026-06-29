import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, GitBranch, Github } from "lucide-react";
import { api } from "../lib/api.js";
import { Spinner } from "../components/ui.jsx";

export default function NewService() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [branches, setBranches] = useState([]);

  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("3000");
  const [envs, setEnvs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getRepos().then((r) => {
      if (r.needsConnect) { setNeedsConnect(true); return; }
      setRepos(Array.isArray(r) ? r : r.repositories ?? []);
    }).catch(() => setRepos([]));
  }, []);

  function onRepoChange(full_name) {
    setRepo(full_name);
    setBranch("");
    setBranches([]);
    if (!full_name) return;
    const [owner, repoName] = full_name.split("/");
    api.getBranches(owner, repoName)
      .then((b) => {
        setBranches(Array.isArray(b) ? b : b.branches ?? []);
      })
      .catch(() => setBranches([]));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        repo,
        branch,
        name: name.trim(),
        port: Number(port),
        envs: envs.filter((r) => r.key.trim()),
      };
      const { uuid } = await api.createApp(body);
      navigate(uuid ? `/services/${uuid}` : "/");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  function addEnv() { setEnvs((prev) => [...prev, { key: "", value: "" }]); }
  function setEnvRow(i, field, val) {
    setEnvs((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }
  function removeEnv(i) { setEnvs((prev) => prev.filter((_, idx) => idx !== i)); }

  if (needsConnect) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <Github className="mx-auto mb-4 h-10 w-10 text-zinc-500" />
        <h1 className="text-xl font-semibold text-white">Connect your GitHub</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Install the GitHub App on your account so DebutDeploy can list your repositories.
        </p>
        <a
          href="/github/connect"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          <Github className="h-4 w-4" /> Connect GitHub
        </a>
      </div>
    );
  }

  if (repos === null) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">
        <Spinner className="mr-2" /> Loading repositories...
      </div>
    );
  }

  const canSubmit = repo && branch && name.trim() && port && !submitting;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-white">New Service</h1>
      <p className="mt-1 text-sm text-zinc-500">Deploy a GitHub repository to Coolify.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        {/* Repo */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">Repository</label>
          <select
            required
            value={repo}
            onChange={(e) => onRepoChange(e.target.value)}
            className="w-full rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500/60 focus:outline-none"
          >
            <option value="">Select a repository…</option>
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        </div>

        {/* Branch */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">Branch</label>
          <select
            required
            value={branch}
            disabled={!repo}
            onChange={(e) => setBranch(e.target.value)}
            className="w-full rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500/60 focus:outline-none disabled:opacity-40"
          >
            <option value="">{repo ? "Select a branch…" : "Select a repo first"}</option>
            {branches.map((b) => {
              const bname = typeof b === "string" ? b : b.name;
              return <option key={bname} value={bname}>{bname}</option>;
            })}
          </select>
        </div>

        {/* Name + Port */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">Service name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              className="w-full rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">Port</label>
            <input
              required
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500/60 focus:outline-none"
            />
          </div>
        </div>

        {/* Env vars */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300">Environment variables</label>
            <button
              type="button"
              onClick={addEnv}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" /> Add variable
            </button>
          </div>
          {envs.length > 0 && (
            <div className="space-y-2">
              {envs.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    placeholder="KEY"
                    value={row.key}
                    onChange={(e) => setEnvRow(i, "key", e.target.value)}
                    className="w-2/5 rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
                  />
                  <input
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => setEnvRow(i, "value", e.target.value)}
                    className="flex-1 rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnv(i)}
                    className="rounded-lg p-2 text-zinc-600 transition hover:bg-white/5 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? <><Spinner className="h-4 w-4" /> Creating…</> : <><GitBranch className="h-4 w-4" /> Create service</>}
        </button>
      </form>
    </div>
  );
}
