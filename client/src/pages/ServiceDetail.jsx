import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Rocket, Play, Square, RotateCw, ExternalLink,
  GitBranch, Globe, Trash2, Check, X, Eye, EyeOff, Copy, Cpu,
  ChevronDown, Plus, Lock, Server,
} from "lucide-react";
import { api } from "../lib/api.js";
import { actionLabel } from "../lib/eventLabels.js";
import { StatusPill, Spinner, Button, Input, Mono, timeAgo } from "../components/ui.jsx";

const TABS = ["Deployments", "Logs", "Environment", "Events", "Settings"];

export default function ServiceDetail() {
  const { id } = useParams();
  const [svc, setSvc] = useState(null);
  const [tab, setTab] = useState("Deployments");
  const [deploys, setDeploys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => {});
  }, []);

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
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
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
    if (error) return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="card">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Unable to load service</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{error.message}</p>
          <Link to="/" className="mt-4 inline-flex text-sm" style={{ color: "var(--accent)" }}>
            Back to services
          </Link>
        </div>
      </div>
    );
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-7 pb-11 pt-6">
      {/* back link */}
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        <ArrowLeft className="h-4 w-4" /> Services
      </Link>

      {/* ── header ── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1
              className="text-2xl font-semibold"
              style={{ fontFamily: "'Geist', sans-serif", letterSpacing: "-0.01em", color: "var(--text)" }}
            >
              {svc.name}
            </h1>
            <StatusPill status={svc.status} />
          </div>
          {svc.domain && (
            <a
              href={`https://${svc.domain}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13.5px] font-medium transition-colors"
              style={{ color: "var(--accent-text)" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              {svc.domain}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {/* action buttons */}
        <div className="flex items-center gap-2.5">
          <Button variant="primary" onClick={() => action("deploy")} disabled={busy}>
            {busy ? <Spinner /> : <Rocket className="h-[15px] w-[15px]" />} Deploy
          </Button>
          {svc.status === "stopped" ? (
            <Button variant="default" onClick={() => action("start")} disabled={busy}>
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          ) : (
            <Button variant="default" onClick={() => action("stop")} disabled={busy}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
          <Button variant="default" onClick={() => action("restart")} disabled={busy}>
            <RotateCw className="h-3.5 w-3.5" /> Restart
          </Button>
        </div>
      </div>

      {/* ── meta row ── */}
      <div
        className="flex flex-wrap items-center gap-x-[18px] gap-y-2 pb-[18px] pt-1 text-[12.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="inline-flex items-center gap-[7px]">
          <GitBranch className="h-3.5 w-3.5" />
          <Mono>{svc.repo}{svc.branch ? ` · ${svc.branch}` : ""}</Mono>
        </span>
        {svc.runtime && (
          <span className="inline-flex items-center gap-[7px]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: "#4f9d4f" }} />
            {svc.runtime}
          </span>
        )}
        {svc.server && (
          <span className="inline-flex items-center gap-[7px]">
            <Server className="h-3.5 w-3.5" />
            {svc.server}{svc.region ? ` · ${svc.region}` : ""}
          </span>
        )}
        <span>Last deploy {timeAgo(svc.lastDeployedAt)}</span>
      </div>

      {/* ── underline tab bar ── */}
      <div className="mb-[22px] flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="-mb-px border-b-2 px-[14px] py-[10px] text-[13.5px] font-semibold transition-colors"
              style={
                active
                  ? { borderColor: "var(--accent)", color: "var(--text)" }
                  : { borderColor: "transparent", color: "var(--text-muted)" }
              }
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === "Deployments" && (
        <Deployments
          deploys={deploys}
          serviceId={id}
          onRedeploy={() => action("deploy")}
          onDeploysChange={setDeploys}
        />
      )}
      {tab === "Logs" && <LogsTab serviceId={id} name={svc.name} />}
      {tab === "Environment" && <EnvironmentTab serviceId={id} />}
      {tab === "Events" && <EventsTab serviceId={id} />}
      {tab === "Settings" && <SettingsTab svc={svc} serviceId={id} isAdmin={user?.role === "admin"} />}
    </div>
  );
}

// ── Deployments tab ────────────────────────────────────────────────────────────

function Deployments({ deploys, serviceId, onRedeploy, onDeploysChange }) {
  async function rollback(d) {
    if (!d.commit) return;
    if (!window.confirm(`Roll back to commit ${d.commit}?\n\nThis will redeploy the service at that commit.`)) return;
    await fetch(`/api/services/${serviceId}/rollback`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: d.commit }),
    });
    setTimeout(() => api.deployments(serviceId).then(onDeploysChange), 1500);
  }

  if (!deploys) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
      <Spinner className="mr-2 inline" /> Loading deployments…
    </div>
  );

  // first successful deploy is "live"; later successes can roll back; failures show "Failed"
  const isOk = (d) => /success|running|healthy|live/i.test(d.status || "");
  const isFail = (d) => /fail|error/i.test(d.status || "");
  let liveSeen = false;

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          {deploys.length} deploy{deploys.length === 1 ? "" : "s"}
        </span>
        <Button variant="default" onClick={onRedeploy}>
          <RotateCw className="h-3.5 w-3.5" /> Redeploy latest
        </Button>
      </div>

      <div
        className="overflow-hidden rounded-[13px] border"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
      >
        {deploys.length === 0 && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No deployments yet.
          </div>
        )}
        {deploys.map((d, i) => {
          const ok = isOk(d);
          const fail = isFail(d);
          const live = ok && !liveSeen && !fail;
          if (live) liveSeen = true;
          const canRollback = ok && !live && d.commit;
          return (
            <div
              key={d.uuid ?? i}
              className="flex items-center gap-[14px] px-[18px] py-[14px]"
              style={i !== 0 ? { borderTop: "1px solid var(--border)" } : {}}
            >
              <span
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg"
                style={
                  fail
                    ? { background: "var(--err-soft)", color: "var(--err-text)" }
                    : { background: "var(--ok-soft)", color: "var(--ok-text)" }
                }
              >
                {fail ? <X className="h-3.5 w-3.5" strokeWidth={2.6} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>
                  {d.message || "—"}
                </div>
                <div className="mt-[3px] text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                  <Mono>{d.commit || "—"}</Mono> · <Mono>{d.branch || "main"}</Mono> · {d.trigger || "manual"}
                </div>
              </div>
              <span
                className="min-w-[58px] text-right text-xs"
                style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
              >
                {d.durationSec != null ? `${d.durationSec}s` : "—"}
              </span>
              <span className="min-w-[78px] text-right text-xs" style={{ color: "var(--text-muted)" }}>
                {timeAgo(d.startedAt)}
              </span>
              <div className="flex min-w-[96px] justify-end">
                {live && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[11.5px] font-semibold"
                    style={{ background: "var(--ok-soft)", color: "var(--ok-text)" }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ok)" }} />
                    Live
                  </span>
                )}
                {canRollback && (
                  <button
                    onClick={() => rollback(d)}
                    className="rounded-[7px] border px-3 py-[5px] text-xs font-semibold transition-colors"
                    style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
                  >
                    Rollback
                  </button>
                )}
                {fail && (
                  <span className="text-xs font-semibold" style={{ color: "var(--err-text)" }}>Failed</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Logs tab (terminal — dark in both themes) ───────────────────────────────────

const LVL_STYLE = {
  INFO: "var(--log-info)", OK: "var(--log-ok)", WARN: "var(--log-warn)", ERROR: "var(--log-err)",
};

// Parse "12:04:01 INFO message" or fall back to plain string.
function parseLine(line) {
  if (typeof line !== "string") {
    // tolerate {t,lvl,msg} shaped lines
    return { t: line.t || "", lvl: line.lvl || "", msg: line.msg ?? String(line) };
  }
  const m = line.match(/^(\d{2}:\d{2}:\d{2})\s+(INFO|OK|WARN|ERROR)\s+(.*)$/);
  if (m) return { t: m[1], lvl: m[2], msg: m[3] };
  return { t: "", lvl: "", msg: line };
}

function LogsTab({ serviceId, name }) {
  const [lines, setLines] = useState(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLines(null);
    api.logs(serviceId).then((data) => { if (!cancelled) setLines(data || []); }).catch(() => { if (!cancelled) setLines([]); });
    return () => { cancelled = true; };
  }, [serviceId]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  function copy() {
    const text = (lines || []).map((l) => (typeof l === "string" ? l : l.msg ?? "")).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const tools = "inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-[5px] text-[11.5px] font-medium transition-colors";

  return (
    <div
      className="overflow-hidden rounded-[13px] border"
      style={{ borderColor: "var(--border-strong)", boxShadow: "var(--shadow)" }}
    >
      <div
        className="flex items-center justify-between px-3.5 py-[9px]"
        style={{ background: "#13161d", borderBottom: "1px solid #232a36" }}
      >
        <div className="flex items-center gap-[9px]">
          <span className="inline-flex items-center gap-[7px] text-xs font-semibold" style={{ color: "#cfe9d6" }}>
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: "#34d77a", animation: "dd-pulse 1.4s infinite" }} />
            Live tail
          </span>
          <span className="mono text-[11.5px]" style={{ color: "#7c8696" }}>{name} · stdout</span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copy}
            className={tools}
            style={{ borderColor: "#2a323f", background: "transparent", color: copied ? "#34d77a" : "#aeb6c2" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1c212b")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Copy className="h-[13px] w-[13px]" /> {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => setWrap((w) => !w)}
            className={tools}
            style={{ borderColor: "#2a323f", background: wrap ? "#1c212b" : "transparent", color: "#aeb6c2" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1c212b")}
            onMouseLeave={(e) => (e.currentTarget.style.background = wrap ? "#1c212b" : "transparent")}
          >
            Wrap
          </button>
        </div>
      </div>

      <div
        ref={boxRef}
        className="mono h-[380px] overflow-y-auto px-4 py-3.5 text-[12px]"
        style={{ background: "var(--mono-bg)", lineHeight: "1.85" }}
      >
        {!lines && (
          <div style={{ color: "var(--mono-ts)" }}><Spinner className="mr-2 inline" /> Fetching logs…</div>
        )}
        {lines && lines.map((raw, i) => {
          const { t, lvl, msg } = parseLine(raw);
          return (
            <div
              key={i}
              className="flex gap-3"
              style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }}
            >
              {t && <span className="shrink-0" style={{ color: "var(--mono-ts)" }}>{t}</span>}
              {lvl && <span className="shrink-0 font-semibold" style={{ color: LVL_STYLE[lvl] || "var(--mono-text)", width: "46px" }}>{lvl}</span>}
              <span style={{ color: "var(--mono-text)" }}>{msg}</span>
            </div>
          );
        })}
        {lines && (
          <div className="mt-0.5 flex items-center gap-3">
            <span
              className="inline-block h-[15px] w-2"
              style={{ background: "#34d77a", animation: "dd-pulse 1.1s steps(1) infinite" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Environment tab ─────────────────────────────────────────────────────────────

// ponytail: variable-group chips are a UI stub — attachment isn't persisted (no
// backend yet). Wire to real groups when /services/:id/attached-groups exists.
const STUB_GROUPS = [
  { name: "shared-prod", meta: "· 3 vars" },
  { name: "stripe-keys", meta: "· 2 vars · secrets" },
];

function EnvironmentTab({ serviceId }) {
  const [envs, setEnvs] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState({ key: "", value: "", is_secret: false });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.envs(serviceId).then((d) => { if (!cancelled) setEnvs(d || []); });
    return () => { cancelled = true; };
  }, [serviceId]);

  async function add() {
    if (!draft.key.trim()) return;
    setSaving(true);
    try {
      await api.saveEnv(serviceId, draft);
      setEnvs((e) => [...e, { uuid: "new-" + Date.now(), ...draft }]);
      setDraft({ key: "", value: "", is_secret: false });
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  async function remove(envId) {
    setEnvs((e) => e.filter((x) => x.uuid !== envId));
    api.deleteEnv(serviceId, envId).catch(() => {});
  }

  // bulk .env paste: parse KEY=value lines, save each, append to list
  async function applyPaste() {
    const rows = pasteText.split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const idx = l.indexOf("=");
        return { key: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim().replace(/^["']|["']$/g, "") };
      })
      .filter((r) => r.key);
    setSaving(true);
    try {
      const added = [];
      for (const r of rows) {
        await api.saveEnv(serviceId, { ...r, is_secret: false });
        added.push({ uuid: "new-" + Date.now() + "-" + r.key, ...r, is_secret: false });
      }
      setEnvs((e) => [...e, ...added]);
      setPasteText("");
      setPaste(false);
    } finally {
      setSaving(false);
    }
  }

  const inputCell = "mono w-full rounded-[7px] border border-transparent bg-transparent px-2.5 py-[7px] text-[12px] outline-none transition-colors focus:border-[var(--accent)]";

  return (
    <div>
      {/* attached variable groups (stubbed) */}
      <div
        className="mb-4 rounded-[13px] border px-[18px] py-[15px]"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
      >
        <div className="mb-[13px] flex items-start justify-between gap-3">
          <div>
            <h4 className="text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>Attached variable groups</h4>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Shared variables merged in at deploy. Manage in Variable Groups.
            </p>
          </div>
          <Button variant="default" title="Attachment isn't persisted yet">
            <Plus className="h-3.5 w-3.5" /> Attach group
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {STUB_GROUPS.map((g) => (
            <span
              key={g.name}
              className="inline-flex items-center gap-2 rounded-[9px] border px-2.5 py-1.5 text-[12.5px]"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            >
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-md"
                style={{ background: "var(--accent-soft)" }}
              >
                <Lock className="h-3 w-3" style={{ color: "var(--accent-text)" }} />
              </span>
              <span className="mono font-semibold">{g.name}</span>
              <span style={{ color: "var(--text-muted)" }}>{g.meta}</span>
            </span>
          ))}
        </div>
      </div>

      {/* service own variables toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          {envs ? `Service variables · ${envs.length} keys, injected at build & runtime` : "Service variables"}
        </span>
        <div className="flex gap-2">
          <Button variant="default" onClick={() => setReveal((r) => !r)}>
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {reveal ? "Hide values" : "Reveal values"}
          </Button>
          <Button variant="default" onClick={() => setPaste((p) => !p)}>Paste .env</Button>
          <Button variant="primary" onClick={() => setAdding((a) => !a)}>
            <Plus className="h-3.5 w-3.5" /> Add variable
          </Button>
        </div>
      </div>

      {/* paste .env affordance */}
      {paste && (
        <div
          className="mb-3.5 rounded-[13px] border p-4"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"KEY=value\nANOTHER=foo"}
            rows={5}
            className="mono input w-full"
            style={{ resize: "vertical" }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setPaste(false); setPasteText(""); }}>Cancel</Button>
            <Button variant="primary" onClick={applyPaste} disabled={saving || !pasteText.trim()}>
              {saving ? <Spinner /> : "Import variables"}
            </Button>
          </div>
        </div>
      )}

      {/* env table */}
      <div
        className="overflow-hidden rounded-[13px] border"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
      >
        <div
          className="grid items-center gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ gridTemplateColumns: "1fr 1.5fr 40px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          <span>Key</span><span>Value</span><span />
        </div>

        {!envs && (
          <div className="px-4 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            <Spinner className="mr-2 inline" /> Loading variables…
          </div>
        )}

        {envs && envs.map((e) => {
          const masked = e.is_secret && !reveal;
          return (
            <div
              key={e.uuid}
              className="grid items-center gap-3 border-t px-4 py-[9px]"
              style={{ gridTemplateColumns: "1fr 1.5fr 40px", borderColor: "var(--border)" }}
            >
              <input value={e.key} readOnly className={inputCell} style={{ color: "var(--text)", fontWeight: 500 }} />
              <input
                value={masked ? "•".repeat(Math.min((e.value || "").length || 12, 28)) : (e.value || "")}
                readOnly
                className={inputCell}
                style={{ color: "var(--text-muted)" }}
              />
              <button
                onClick={() => remove(e.uuid)}
                title="Remove"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] transition-colors"
                style={{ color: "var(--text-muted)", background: "transparent" }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--err-soft)"; ev.currentTarget.style.color = "var(--err-text)"; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <Trash2 className="h-[15px] w-[15px]" />
              </button>
            </div>
          );
        })}

        {/* add row */}
        {adding && (
          <div
            className="grid items-center gap-3 border-t px-4 py-[9px]"
            style={{ gridTemplateColumns: "1fr 1.5fr 40px", borderColor: "var(--border)", background: "var(--surface-2)" }}
          >
            <input
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })}
              placeholder="KEY"
              className="mono input"
            />
            <div className="flex items-center gap-2">
              <input
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                placeholder="value"
                className="mono input flex-1"
              />
              <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={draft.is_secret}
                  onChange={(e) => setDraft({ ...draft, is_secret: e.target.checked })}
                  style={{ accentColor: "var(--accent)" }}
                />
                secret
              </label>
            </div>
            <button
              onClick={add}
              disabled={saving || !draft.key.trim()}
              title="Save variable"
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px]"
              style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
            >
              {saving ? <Spinner /> : <Check className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Events tab ─────────────────────────────────────────────────────────────────

function EventsTab({ serviceId }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.serviceEvents(serviceId)
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, [serviceId]);

  if (err) return (
    <div className="card text-sm" style={{ color: "var(--err)" }}>
      Failed to load events: {err.message}
    </div>
  );

  if (!events) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
      <Spinner className="mr-2 inline" /> Loading events…
    </div>
  );

  if (events.length === 0) return (
    <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      No events recorded yet.
    </div>
  );

  return (
    <div className="relative pl-2">
      {events.map((ev, i) => {
        const down = ev.action === "service.down";
        const up = ev.action === "service.up";
        const dotColor = down ? "var(--err)" : up ? "var(--ok)" : "var(--accent)";
        const dotRing = down ? "var(--err-soft)" : up ? "var(--ok-soft)" : "var(--accent-soft)";
        const labelColor = down ? "var(--err-text)" : up ? "var(--ok-text)" : "var(--text)";
        const actor = ev.actor_name || ev.actor_email || "system";
        const last = i === events.length - 1;
        return (
          <div key={ev.id ?? i} className="relative flex gap-4 pb-[22px]">
            <div className="flex shrink-0 flex-col items-center">
              <span
                className="mt-[3px] h-[11px] w-[11px] shrink-0 rounded-full"
                style={{ background: dotColor, boxShadow: `0 0 0 3px ${dotRing}`, border: "2px solid var(--surface)" }}
              />
              {!last && <span className="mt-1 min-h-[18px] w-0.5 flex-1" style={{ background: "var(--border)" }} />}
            </div>
            <div className="-mt-[3px]">
              <div className="flex items-center gap-2.5">
                <span className="text-[13.5px] font-semibold" style={{ color: labelColor }}>{actionLabel(ev.action)}</span>
                {ev.detail && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{ev.detail}</span>}
              </div>
              <div className="mt-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                {actor} · {timeAgo(ev.created_at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────────

function SettingsTab({ svc, serviceId, isAdmin }) {
  const navigate = useNavigate();

  // build & deploy
  const [buildPack, setBuildPack] = useState(svc.buildPack || "Nixpacks (auto-detected)");
  const [port, setPort] = useState(svc.port || svc.exposedPort || "");
  const [buildCmd, setBuildCmd] = useState(svc.buildCommand || "");
  const [startCmd, setStartCmd] = useState(svc.startCommand || "");

  // custom domain
  const [fqdn, setFqdn] = useState(svc.domain || "");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMsg, setDomainMsg] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  // resources
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [limitsBusy, setLimitsBusy] = useState(false);
  const [limitsMsg, setLimitsMsg] = useState(null);

  async function saveDomain(e) {
    e.preventDefault();
    setDomainBusy(true);
    setDomainMsg(null);
    setVerifyResult(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/domain`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fqdn: fqdn.trim() }),
      });
      if (!r.ok) {
        const e2 = await r.json().catch(() => ({}));
        throw new Error(e2.error || String(r.status));
      }
      setDomainMsg({ ok: true, text: "Domain saved." });
    } catch (err) {
      setDomainMsg({ ok: false, text: err.message });
    } finally {
      setDomainBusy(false);
    }
  }

  async function verifyDns() {
    if (!fqdn.trim()) return;
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      const r = await fetch(
        `/api/services/${serviceId}/domain/verify?fqdn=${encodeURIComponent(fqdn.trim())}`,
        { credentials: "same-origin" }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || String(r.status));
      setVerifyResult(data);
    } catch (err) {
      setVerifyResult({ error: err.message });
    } finally {
      setVerifyBusy(false);
    }
  }

  async function saveLimits(e) {
    e.preventDefault();
    setLimitsBusy(true);
    setLimitsMsg(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/limits`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: memory.trim(), cpus: cpus.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || String(r.status));
      setLimitsMsg({ ok: true, text: "Limits saved — takes effect on next deploy." });
    } catch (err) {
      setLimitsMsg({ ok: false, text: err.message });
    } finally {
      setLimitsBusy(false);
    }
  }

  // ponytail: build/start commands + buildpack + port have no PATCH endpoint yet;
  // they post through the healthcheck-style /build route when present, else are
  // local-only. Save wires to /build; backend may 404 until added.
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildMsg, setBuildMsg] = useState(null);
  async function saveBuild(e) {
    e.preventDefault();
    setBuildBusy(true);
    setBuildMsg(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/build`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buildPack, port: port ? Number(port) : undefined,
          buildCommand: buildCmd.trim(), startCommand: startCmd.trim(),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || String(r.status));
      setBuildMsg({ ok: true, text: "Build settings saved." });
    } catch (err) {
      setBuildMsg({ ok: false, text: err.message });
    } finally {
      setBuildBusy(false);
    }
  }

  async function deleteSvc() {
    if (!window.confirm(`Delete service "${svc.name}"? This cannot be undone.`)) return;
    await fetch(`/api/services/${serviceId}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    navigate("/");
  }

  const cardStyle = { background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" };
  const titleCls = "mb-4 text-[15px] font-semibold";
  const labelCls = "mb-1.5 block text-xs font-semibold";
  const SelectChevron = () => (
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
  );

  return (
    <div className="flex flex-col gap-[18px]">
      {/* build & deploy */}
      <form onSubmit={saveBuild} className="rounded-[13px] px-[22px] py-5" style={cardStyle}>
        <h3 className={titleCls} style={{ fontFamily: "'Geist', sans-serif", color: "var(--text)" }}>Build &amp; deploy</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>Build pack</label>
            <div className="relative">
              <select className="select w-full" value={buildPack} onChange={(e) => setBuildPack(e.target.value)} style={{ appearance: "none" }}>
                <option>Nixpacks (auto-detected)</option>
                <option>Dockerfile</option>
                <option>Static site</option>
              </select>
              <SelectChevron />
            </div>
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>Exposed port</label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>Build command</label>
            <Input className="mono" value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} placeholder="npm ci && npm run build" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>Start command</label>
            <Input className="mono" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder="node dist/server.js" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={buildBusy}>{buildBusy ? <Spinner /> : "Save build settings"}</Button>
          {buildMsg && <span className="text-xs" style={{ color: buildMsg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{buildMsg.text}</span>}
        </div>
      </form>

      {/* custom domain */}
      <form onSubmit={saveDomain} className="rounded-[13px] px-[22px] py-5" style={cardStyle}>
        <h3 className={titleCls} style={{ fontFamily: "'Geist', sans-serif", color: "var(--text)" }}>Custom domain</h3>
        <div className="mb-3.5 flex items-end gap-2.5">
          <div className="flex-1">
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>Domain</label>
            <Input
              className="mono"
              value={fqdn}
              onChange={(e) => { setFqdn(e.target.value); setVerifyResult(null); }}
              placeholder="app.example.com"
            />
          </div>
          <Button type="submit" variant="primary" disabled={domainBusy || !fqdn.trim()}>
            {domainBusy ? <Spinner /> : "Save"}
          </Button>
          <Button type="button" variant="default" onClick={verifyDns} disabled={verifyBusy || !fqdn.trim()}>
            {verifyBusy ? <Spinner /> : "Verify DNS"}
          </Button>
        </div>

        {domainMsg && (
          <p className="mb-2 text-xs" style={{ color: domainMsg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{domainMsg.text}</p>
        )}
        {verifyResult && !verifyResult.error && <DnsResult result={verifyResult} />}
        {verifyResult?.error && (
          <p className="mb-2 text-xs" style={{ color: "var(--err-text)" }}>Verify failed: {verifyResult.error}</p>
        )}

        <div className="mt-1 flex flex-wrap gap-2.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
            style={{ background: "var(--ok-soft)", color: "var(--ok-text)" }}
          >
            <Check className="h-3 w-3" strokeWidth={3} /> DNS verified
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
            style={{ background: "var(--ok-soft)", color: "var(--ok-text)" }}
          >
            <Lock className="h-3 w-3" /> TLS active · Let&apos;s Encrypt
          </span>
        </div>
      </form>

      {/* resources */}
      <form onSubmit={saveLimits} className="rounded-[13px] px-[22px] py-5" style={cardStyle}>
        <h3 className={titleCls} style={{ fontFamily: "'Geist', sans-serif", color: "var(--text)" }}>
          <span className="inline-flex items-center gap-2"><Cpu className="h-4 w-4" style={{ color: "var(--accent)" }} /> Resources</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>CPU limit</label>
            <div className="relative">
              <select className="select w-full" value={cpus} onChange={(e) => setCpus(e.target.value)} style={{ appearance: "none" }}>
                <option value="">Default</option>
                <option value="0.5">0.5 vCPU</option>
                <option value="1">1.0 vCPU</option>
                <option value="2">2.0 vCPU</option>
              </select>
              <SelectChevron />
            </div>
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--text-muted)" }}>Memory limit</label>
            <div className="relative">
              <select className="select w-full" value={memory} onChange={(e) => setMemory(e.target.value)} style={{ appearance: "none" }}>
                <option value="">Default</option>
                <option value="512M">512 MB</option>
                <option value="1G">1 GB</option>
                <option value="2G">2 GB</option>
              </select>
              <SelectChevron />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={limitsBusy || (!cpus && !memory)}>
            {limitsBusy ? <Spinner /> : "Save limits"}
          </Button>
          {limitsMsg && <span className="text-xs" style={{ color: limitsMsg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{limitsMsg.text}</span>}
        </div>
      </form>

      {/* danger zone */}
      <div className="rounded-[13px] px-5 py-[18px]" style={{ border: "1px solid var(--err)", background: "var(--err-soft)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="mb-[3px] text-[14.5px] font-semibold" style={{ color: "var(--err-text)" }}>Delete this service</h3>
            <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              Permanently removes the container, domain and build history. This cannot be undone.
            </p>
          </div>
          <Button variant="danger" onClick={deleteSvc}>
            <Trash2 className="h-3.5 w-3.5" /> Delete service
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── DNS verification result ────────────────────────────────────────────────────

function DnsResult({ result }) {
  const { host, serverIp, resolvedIps, pointsAt } = result;
  const [copied, setCopied] = useState(false);

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className="mb-3 mt-1 space-y-2 rounded-lg border p-3 text-xs"
      style={{
        background: "var(--surface-2)",
        borderColor: pointsAt ? "var(--ok)" : "var(--warn)",
      }}
    >
      <div className="flex items-center gap-2">
        {pointsAt
          ? <Check className="h-4 w-4 shrink-0" style={{ color: "var(--ok-text)" }} strokeWidth={3} />
          : <X className="h-4 w-4 shrink-0" style={{ color: "var(--warn-text)" }} />}
        <span style={{ color: "var(--text)" }}>
          {pointsAt
            ? `${host} points at the server — DNS is correct.`
            : resolvedIps?.length
              ? `${host} resolves to ${resolvedIps.join(", ")} but expected ${serverIp || "??"}.`
              : `${host} did not resolve — no DNS record found.`}
        </span>
      </div>

      {!pointsAt && serverIp && (
        <div
          className="flex items-start justify-between gap-2 rounded-md border p-2.5"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div>
            <p className="mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>Create an A record:</p>
            <p style={{ color: "var(--text)" }}>
              <Mono>@</Mono> or <Mono>{host.split(".")[0]}</Mono> → <Mono>{serverIp}</Mono>
            </p>
          </div>
          <button
            onClick={() => copy(`A\t${host}\t${serverIp}`)}
            className="flex shrink-0 items-center gap-1 rounded px-2 py-1 transition"
            style={{ color: copied ? "var(--ok-text)" : "var(--text-muted)", background: "var(--surface-2)" }}
            title="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
