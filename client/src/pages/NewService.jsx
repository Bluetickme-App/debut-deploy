import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, GitBranch, Github } from "lucide-react";
import { api } from "../lib/api.js";
import { Field, Input, Select, Button, Card, PageHeader, Spinner, Mono } from "../components/ui.jsx";

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
      .then((b) => setBranches(Array.isArray(b) ? b : b.branches ?? []))
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
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <Github className="h-6 w-6" style={{ color: "var(--text-muted)" }} />
        </div>
        <h1
          className="text-xl font-bold"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}
        >
          Connect your GitHub
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Install the GitHub App on your account so DebutDeploy can list your repositories.
        </p>
        <a href="/github/connect" className="btn btn-primary mt-6 inline-flex">
          <Github className="h-4 w-4" /> Connect GitHub
        </a>
      </div>
    );
  }

  if (repos === null) {
    return (
      <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Spinner /> Loading repositories…
      </div>
    );
  }

  const canSubmit = repo && branch && name.trim() && port && !submitting;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader
        title="New Service"
        subtitle="Deploy a GitHub repository to Coolify on Hetzner."
      />

      <Card>
        <form onSubmit={onSubmit} className="space-y-6">
          <Field label="Repository">
            <Select required value={repo} onChange={(e) => onRepoChange(e.target.value)}>
              <option value="">Select a repository…</option>
              {repos.map((r) => (
                <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Branch">
            <Select
              required
              value={branch}
              disabled={!repo}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">{repo ? "Select a branch…" : "Select a repo first"}</option>
              {branches.map((b) => {
                const bname = typeof b === "string" ? b : b.name;
                return <option key={bname} value={bname}>{bname}</option>;
              })}
            </Select>
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="Service name">
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-app"
                />
              </Field>
            </div>
            <Field label="Port">
              {/* ponytail: mono class on port — it's a numeric datum */}
              <Input
                required
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="mono"
              />
            </Field>
          </div>

          {/* Env vars */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="label" style={{ marginBottom: 0 }}>Environment variables</span>
              <Button type="button" variant="ghost" onClick={addEnv} className="text-xs px-2 py-1">
                <Plus className="h-3.5 w-3.5" /> Add variable
              </Button>
            </div>
            {envs.length > 0 && (
              <div className="space-y-2">
                {envs.map((row, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      placeholder="KEY"
                      value={row.key}
                      onChange={(e) => setEnvRow(i, "key", e.target.value)}
                      className="input mono w-2/5"
                    />
                    <input
                      placeholder="value"
                      value={row.value}
                      onChange={(e) => setEnvRow(i, "value", e.target.value)}
                      className="input mono flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeEnv(i)}
                      className="btn btn-ghost p-2 flex-shrink-0"
                      style={{ color: "var(--text-muted)" }}
                      onMouseEnter={e => e.currentTarget.style.color = "var(--err)"}
                      onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {envs.length === 0 && (
              <p className="text-xs py-3 text-center rounded-lg" style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}>
                No variables yet — add them above
              </p>
            )}
          </div>

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                border: "1px solid color-mix(in srgb, var(--err) 25%, transparent)",
                background: "color-mix(in srgb, var(--err) 8%, transparent)",
                color: "var(--err)",
              }}
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {submitting
                ? <><Spinner /> Creating…</>
                : <><GitBranch className="h-4 w-4" /> Create service</>
              }
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
