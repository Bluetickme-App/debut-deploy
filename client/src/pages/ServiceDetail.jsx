import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Rocket, Play, Square, RotateCw, ExternalLink, GitBranch,
} from "lucide-react";
import { api } from "../lib/api.js";
import { StatusBadge, Spinner, Button, timeAgo } from "../components/ui.jsx";
import EnvEditor from "../components/EnvEditor.jsx";
import LogStream from "../components/LogStream.jsx";

const TABS = ["Events", "Logs", "Environment", "Settings"];

export default function ServiceDetail() {
  const { id } = useParams();
  const [svc, setSvc] = useState(null);
  const [tab, setTab] = useState("Events");
  const [deploys, setDeploys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvc(null);
    setDeploys(null);
    Promise.all([api.service(id), api.deployments(id)])
      .then(([service, deploymentList]) => {
        if (cancelled) return;
        setSvc(service);
        setDeploys(deploymentList);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function action(kind) {
    setBusy(true);
    try {
      if (kind === "deploy") await api.deploy(id);
      else await api.control(id, kind);
      api.deployments(id).then(setDeploys);
    } finally {
      setBusy(false);
    }
  }

  if (!svc) {
    if (error) {
      return (
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-2xl border border-white/8 bg-[#13161d] p-6">
            <div className="text-sm font-medium text-white">Unable to load service</div>
            <p className="mt-2 text-sm text-zinc-400">{error.message}</p>
            <Link to="/" className="mt-4 inline-flex text-sm text-indigo-300 hover:text-indigo-200">
              Back to services
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="h-4 w-4" /> Services
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-white">{svc.name}</h1>
        <StatusBadge status={svc.status} />
        {svc.domain && (
          <a
            href={`https://${svc.domain}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200"
          >
            {svc.domain} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" onClick={() => action("deploy")} disabled={busy}>
            {busy ? <Spinner /> : <Rocket className="h-4 w-4" />} Deploy
          </Button>
          {svc.status === "stopped" ? (
            <Button onClick={() => action("start")} disabled={busy}>
              <Play className="h-4 w-4" /> Start
            </Button>
          ) : (
            <Button onClick={() => action("stop")} disabled={busy}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          )}
          <Button variant="ghost" onClick={() => action("restart")} disabled={busy}>
            <RotateCw className="h-4 w-4" /> Restart
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <GitBranch className="h-3.5 w-3.5" /> {svc.repo} · {svc.branch}
        </span>
        <span>Runtime: {svc.runtime}</span>
        <span>Server: {svc.server}</span>
        <span>Last deploy: {timeAgo(svc.lastDeployedAt)}</span>
      </div>

      {/* tabs */}
      <div className="mt-6 flex gap-1 border-b border-white/8">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t
                ? "border-indigo-400 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="py-6">
        {tab === "Events" && <Events deploys={deploys} onRedeploy={() => action("deploy")} />}
        {tab === "Logs" && <LogStream serviceId={id} live={svc.status === "deploying"} />}
        {tab === "Environment" && <EnvEditor serviceId={id} />}
        {tab === "Settings" && <SettingsTab svc={svc} />}
      </div>
    </div>
  );
}

function Events({ deploys, onRedeploy }) {
  if (!deploys)
    return (
      <div className="text-sm text-zinc-500">
        <Spinner className="mr-2 inline" /> Loading deploys…
      </div>
    );
  return (
    <div className="overflow-hidden rounded-xl border border-white/8 bg-[#13161d]">
      {deploys.map((d, i) => (
        <div
          key={d.uuid}
          className={`flex items-center gap-4 px-4 py-3 ${i !== 0 ? "border-t border-white/6" : ""}`}
        >
          <StatusBadge status={d.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-200">{d.message}</div>
            <div className="text-xs text-zinc-500">
              <span className="font-mono">{d.commit}</span> · {d.branch} · {d.trigger}
            </div>
          </div>
          <div className="text-xs text-zinc-500">
            {d.durationSec != null ? `${d.durationSec}s` : "running…"}
          </div>
          <div className="w-20 text-right text-xs text-zinc-500">{timeAgo(d.startedAt)}</div>
        </div>
      ))}
      <div className="border-t border-white/6 px-4 py-2 text-right">
        <Button variant="ghost" onClick={onRedeploy}>
          <Rocket className="h-4 w-4" /> Redeploy latest
        </Button>
      </div>
    </div>
  );
}

function SettingsTab({ svc }) {
  const Row = ({ label, value }) => (
    <div className="flex items-center justify-between border-t border-white/6 px-4 py-3 first:border-t-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="font-mono text-sm text-zinc-200">{value || "—"}</span>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-white/8 bg-[#13161d]">
        <Row label="Repository" value={svc.repo} />
        <Row label="Branch" value={svc.branch} />
        <Row label="Runtime" value={svc.runtime} />
        <Row label="Custom domain" value={svc.domain} />
        <Row label="Server" value={svc.server} />
        <Row label="UUID" value={svc.uuid} />
      </div>
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
        <div className="text-sm font-medium text-rose-200">Danger zone</div>
        <p className="mt-1 text-xs text-zinc-400">
          Deleting a service removes it from Coolify. Databases are not affected.
        </p>
        <Button variant="danger" className="mt-3">
          Delete service
        </Button>
      </div>
    </div>
  );
}
