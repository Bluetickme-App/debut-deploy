import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Copy, Check, Rocket, GitBranch, ExternalLink } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Field, Input, Button, Spinner } from "../components/ui.jsx";

// Deploy ANY git repo without the GitHub App: generate a deploy key → add it to
// the repo → create + deploy. ponytail: admin-only; single Coolify host.
export default function NewServiceGit() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    repo: "", name: "", branch: "main", buildPack: "nixpacks",
    installCommand: "", buildCommand: "", startCommand: "", port: "3000", domain: "",
  });
  const [key, setKey] = useState(null);      // { keyUuid, publicKey }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { appUuid }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function genKey() {
    setError(null); setBusy(true);
    try { setKey(await api.prepareDeployKey()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function create() {
    setError(null); setBusy(true);
    try {
      const r = await api.createGitService({ keyUuid: key.keyUuid, ...form });
      setResult(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // repo → the repo's deploy-keys settings page (best-effort for github)
  const repoSettings = (() => {
    const m = form.repo.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
    return m ? `https://github.com/${m[1]}/${m[2]}/settings/keys` : null;
  })();

  return (
    <div className="mx-auto max-w-2xl px-4 pb-11 pt-4 sm:px-7 sm:pt-6">
      <PageHeader title="Deploy from Git URL" subtitle="Deploy any repository using a deploy key — no GitHub App needed." />

      {result ? (
        <Card>
          <div className="flex items-center gap-2" style={{ color: "var(--ok-text)" }}>
            <Check size={18} /> <span className="font-semibold">Service created — deploying now.</span>
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <span className="mono">{result.appUuid}</span> is building. It'll appear in Services once the first deploy finishes.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => nav("/")}>Go to Services</Button>
            <Button variant="default" onClick={() => { setResult(null); setKey(null); }}>Deploy another</Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Repository (SSH URL)"><Input placeholder="git@github.com:owner/repo.git" value={form.repo} onChange={set("repo")} /></Field>
              <Field label="Service name"><Input placeholder="my-app" value={form.name} onChange={set("name")} /></Field>
              <Field label="Branch"><Input value={form.branch} onChange={set("branch")} /></Field>
              <Field label="Build pack">
                <select className="select" value={form.buildPack} onChange={set("buildPack")}>
                  <option value="nixpacks">Nixpacks (auto)</option>
                  <option value="dockerfile">Dockerfile</option>
                  <option value="static">Static</option>
                </select>
              </Field>
              <Field label="Install command (optional)"><Input placeholder="npm install" value={form.installCommand} onChange={set("installCommand")} /></Field>
              <Field label="Build command (optional)"><Input placeholder="npm run build" value={form.buildCommand} onChange={set("buildCommand")} /></Field>
              <Field label="Start command (optional)"><Input placeholder="npm start" value={form.startCommand} onChange={set("startCommand")} /></Field>
              <Field label="Port"><Input value={form.port} onChange={set("port")} /></Field>
              <Field label="Domain (optional)"><Input placeholder="app.yourdomain.com" value={form.domain} onChange={set("domain")} /></Field>
            </div>
          </Card>

          {/* Step 1 — generate + add the deploy key */}
          <Card>
            <div className="flex items-center gap-2 mb-1" style={{ color: "var(--text)" }}>
              <KeyRound size={16} /> <span className="font-semibold text-sm">1 · Deploy key</span>
            </div>
            {!key ? (
              <>
                <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
                  Generate a read-only deploy key, then add it to your repo so Coolify can clone it.
                </p>
                <Button variant="primary" onClick={genKey} disabled={busy || !form.repo}>
                  {busy ? <Spinner /> : <KeyRound size={15} />} Generate deploy key
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm mb-2" style={{ color: "var(--text-muted)" }}>
                  Add this as a <b>read-only</b> deploy key to your repo{repoSettings && <> → <a href={repoSettings} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }} className="inline-flex items-center gap-1">deploy keys settings <ExternalLink size={12} /></a></>}, then continue.
                </p>
                <div className="flex items-start gap-2">
                  <code className="mono flex-1 break-all rounded-lg p-3 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}>
                    {key.publicKey}
                  </code>
                  <Button variant="default" onClick={() => { navigator.clipboard?.writeText(key.publicKey); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* Step 2 — create + deploy */}
          <Card>
            <div className="flex items-center gap-2 mb-1" style={{ color: "var(--text)" }}>
              <Rocket size={16} /> <span className="font-semibold text-sm">2 · Create & deploy</span>
            </div>
            <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
              Once the deploy key is added to the repo, create the service.
            </p>
            <Button variant="primary" onClick={create} disabled={busy || !key || !form.repo || !form.name}>
              {busy ? <Spinner /> : <Rocket size={15} />} Create & deploy
            </Button>
          </Card>

          {error && (
            <div className="rounded-lg p-3 text-sm" style={{ border: "1px solid color-mix(in srgb, var(--err) 30%, transparent)", background: "var(--err-soft)", color: "var(--err-text)" }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
