import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Trash2, GitBranch, Github, ChevronDown, ChevronUp, X } from "lucide-react";
import { api } from "../lib/api.js";
import { Field, Input, Select, Button, Card, PageHeader, Spinner, Mono } from "../components/ui.jsx";

const BUILD_PACKS = [
  { value: "nixpacks", label: "Auto-detect (Nixpacks)" },
  { value: "dockerfile", label: "Docker (Dockerfile)" },
  { value: "static", label: "Static" },
];

function parseDotEnv(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      const key = l.slice(0, idx).trim();
      let value = l.slice(idx + 1).trim();
      // strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return { key, value };
    })
    .filter((r) => r.key);
}

export default function NewService() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [branches, setBranches] = useState([]);
  const [databases, setDatabases] = useState([]);

  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("3000");
  const [buildPack, setBuildPack] = useState("nixpacks");
  const [installCommand, setInstallCommand] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [linkedDb, setLinkedDb] = useState(null); // { id, name, internalUrl }
  const [envs, setEnvs] = useState([]);
  const [bulkEnv, setBulkEnv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getRepos().then((r) => {
      if (r.needsConnect) { setNeedsConnect(true); return; }
      setRepos(Array.isArray(r) ? r : r.repositories ?? []);
    }).catch(() => setRepos([]));

    api.databases().then((d) => setDatabases(Array.isArray(d) ? d : d.data ?? [])).catch(() => {});
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

  function onDbChange(id) {
    if (!id) { setLinkedDb(null); return; }
    const db = databases.find((d) => String(d.id ?? d.uuid) === id);
    if (!db) return;
    setLinkedDb({
      id,
      name: db.name,
      internalUrl: db.internal_db_url ?? db.internalUrl ?? db.internal_url ?? "",
    });
  }

  function applyBulkEnv() {
    const parsed = parseDotEnv(bulkEnv);
    if (!parsed.length) return;
    setEnvs((prev) => {
      const existing = new Map(prev.map((r) => [r.key, r]));
      parsed.forEach((r) => existing.set(r.key, r));
      return [...existing.values()];
    });
    setBulkEnv("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const allEnvs = [...envs.filter((r) => r.key.trim())];
      if (linkedDb?.internalUrl) {
        // put DATABASE_URL first, skip any manual row with same key
        const withoutDbUrl = allEnvs.filter((r) => r.key !== "DATABASE_URL");
        allEnvs.splice(0, allEnvs.length, { key: "DATABASE_URL", value: linkedDb.internalUrl }, ...withoutDbUrl);
      }
      const body = {
        repo,
        branch,
        name: name.trim(),
        port: Number(port),
        buildPack,
        envs: allEnvs,
      };
      if (installCommand.trim()) body.installCommand = installCommand.trim();
      if (buildCommand.trim()) body.buildCommand = buildCommand.trim();
      if (startCommand.trim()) body.startCommand = startCommand.trim();

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
          {/* Repo / Branch */}
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

          {/* Name / Port */}
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

          {/* Build pack */}
          <Field label="Build">
            <Select value={buildPack} onChange={(e) => setBuildPack(e.target.value)}>
              {BUILD_PACKS.map((bp) => (
                <option key={bp.value} value={bp.value}>{bp.label}</option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              Start and build commands are optional — Nixpacks auto-detects them from your project.
            </p>
          </Field>

          {/* Advanced (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Advanced
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-1">
                <Field label="Install command">
                  <Input
                    value={installCommand}
                    onChange={(e) => setInstallCommand(e.target.value)}
                    placeholder="npm install"
                    className="mono"
                  />
                </Field>
                <Field label="Build command">
                  <Input
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    placeholder="npm run build"
                    className="mono"
                  />
                </Field>
                <Field label="Start command">
                  <Input
                    value={startCommand}
                    onChange={(e) => setStartCommand(e.target.value)}
                    placeholder="npm start"
                    className="mono"
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Link a database */}
          <Field label="Link a database">
            {databases.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No databases yet —{" "}
                <Link to="/new-database" style={{ color: "var(--accent)" }}>create one</Link>
              </p>
            ) : (
              <>
                <Select value={linkedDb?.id ?? ""} onChange={(e) => onDbChange(e.target.value)}>
                  <option value="">None</option>
                  {databases.map((db) => {
                    const id = String(db.id ?? db.uuid);
                    return <option key={id} value={id}>{db.name}</option>;
                  })}
                </Select>
                {linkedDb && (
                  <div
                    className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                    style={{ background: "color-mix(in srgb, var(--info) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--info) 25%, transparent)", color: "var(--info)" }}
                  >
                    <span className="font-medium mono">DATABASE_URL</span>
                    <span style={{ color: "var(--text-muted)" }}>→</span>
                    <Mono className="flex-1 truncate" style={{ color: "var(--text-muted)" }}>{linkedDb.internalUrl || "internal URL not available"}</Mono>
                    <button
                      type="button"
                      onClick={() => setLinkedDb(null)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--info)", lineHeight: 1 }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </Field>

          {/* Env vars */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="label" style={{ marginBottom: 0 }}>Environment variables</span>
              <Button type="button" variant="ghost" onClick={addEnv} className="text-xs px-2 py-1">
                <Plus className="h-3.5 w-3.5" /> Add variable
              </Button>
            </div>
            {envs.length > 0 && (
              <div className="space-y-2 mb-3">
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
              <p className="text-xs py-3 mb-3 text-center rounded-lg" style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}>
                No variables yet — add them above or paste a .env below
              </p>
            )}

            {/* Bulk paste */}
            <div>
              <label className="label text-xs" style={{ color: "var(--text-muted)" }}>Paste .env</label>
              <textarea
                value={bulkEnv}
                onChange={(e) => setBulkEnv(e.target.value)}
                onBlur={applyBulkEnv}
                rows={3}
                placeholder={"KEY=value\nANOTHER_KEY=value"}
                className="input mono w-full resize-y text-xs"
                style={{ fontFamily: "monospace" }}
              />
              {bulkEnv.trim() && (
                <Button type="button" variant="ghost" onClick={applyBulkEnv} className="mt-1.5 text-xs px-2 py-1">
                  Apply
                </Button>
              )}
            </div>
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
