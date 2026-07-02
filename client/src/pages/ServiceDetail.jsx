import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Rocket, Play, Square, RotateCw, ExternalLink,
  Trash2, Check, X, Eye, EyeOff, Copy, Lock, Plus, RefreshCw,
  ChevronDown, KeyRound, FileText, Database, HardDrive,
} from "lucide-react";
import { api } from "../lib/api.js";
import { actionLabel } from "../lib/eventLabels.js";
import { StatusPill, Spinner, Button, Mono, timeAgo } from "../components/ui.jsx";
import { SettingsSection, SettingsRow, AnchorNav } from "../components/SettingsSection.jsx";
import ConfirmDelete from "../components/ConfirmDelete.jsx";

const TABS = ["Deployments", "Logs", "Metrics", "Environment", "Events", "Settings"];

export default function ServiceDetail() {
  const { id } = useParams();
  const [svc, setSvc] = useState(null);
  const [tab, setTab] = useState("Deployments");
  const [deploys, setDeploys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => { api.me().then(setUser).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null); setSvc(null); setDeploys(null);
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
    } finally { setBusy(false); }
  }

  if (!svc) {
    if (error) return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="card">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Unable to load service</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{error.message}</p>
          <Link to="/" className="mt-4 inline-flex text-sm" style={{ color: "var(--accent)" }}>Back to services</Link>
        </div>
      </div>
    );
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  const running = svc.status === "running";
  const healthy = svc.health === "healthy";
  const region = svc.region || (svc.server ? "hel-prod-1 · Helsinki" : "hel-prod-1 · Helsinki");
  const runtimeLabel = runtimeName(svc.runtime);

  return (
    <div className="page">
      {/* back link */}
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        <ArrowLeft className="h-[15px] w-[15px]" /> Services
      </Link>

      {/* ── header ── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h1
              className="text-2xl font-semibold"
              style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em", color: "var(--text)" }}
            >
              {svc.name}
            </h1>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
              style={{
                background: running ? "var(--ok-soft)" : "var(--neutral-soft)",
                color: running ? "var(--ok-text)" : "var(--neutral-text)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: running ? "var(--ok)" : "var(--text-muted)" }} />
              {running ? `running · ${healthy ? "healthy" : svc.health || "healthy"}` : (svc.status || "unknown")}
            </span>
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
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="primary" onClick={() => action("deploy")} disabled={busy}>
            {busy ? <Spinner /> : <Rocket className="h-[15px] w-[15px]" />} Deploy
          </Button>
          {svc.status === "stopped" ? (
            <Button variant="secondary" onClick={() => action("start")} disabled={busy}>
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => action("stop")} disabled={busy}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
          <Button variant="secondary" onClick={() => action("restart")} disabled={busy}>
            <RotateCw className="h-3.5 w-3.5" /> Restart
          </Button>
        </div>
      </div>

      {/* ── meta row ── */}
      <div
        className="flex flex-wrap items-center gap-x-[18px] gap-y-2 pb-[18px] pt-[3px] text-[12.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        <Mono>{svc.repo || "—"}{svc.branch ? ` · ${svc.branch}` : ""}</Mono>
        <span>{runtimeLabel}</span>
        <span>{region}</span>
        <span>Last deploy {timeAgo(svc.lastDeployedAt)}</span>
      </div>

      {/* ── underline tab bar ── */}
      <div className="tab-bar mb-[22px]">
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="-mb-px border-b-2 px-[14px] py-[10px] text-[13.5px] font-semibold transition-colors"
              style={active
                ? { borderColor: "var(--accent)", color: "var(--text)" }
                : { borderColor: "transparent", color: "var(--text-muted)" }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === "Deployments" && (
        <Deployments deploys={deploys} serviceId={id} onRedeploy={() => action("deploy")} onDeploysChange={setDeploys} />
      )}
      {tab === "Logs" && <LogsTab serviceId={id} name={svc.name} />}
      {tab === "Metrics" && <MetricsTab serviceId={id} />}
      {tab === "Environment" && <EnvironmentTab serviceId={id} onDeploy={() => action("deploy")} />}
      {tab === "Events" && <EventsTab serviceId={id} />}
      {tab === "Settings" && <SettingsTab svc={svc} serviceId={id} region={region} onDeploy={() => action("deploy")} deployBusy={busy} onRename={(name) => setSvc((s) => ({ ...s, name }))} />}
    </div>
  );
}

function runtimeName(runtime) {
  if (!runtime) return "Node 20";
  const r = String(runtime).toLowerCase();
  if (r.includes("node") || r === "nixpacks") return "Node 20";
  if (r.includes("docker")) return "Docker";
  return runtime;
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

  const isOk = (d) => /success|running|healthy|live/i.test(d.status || "");
  const isFail = (d) => /fail|error/i.test(d.status || "");
  let liveSeen = false;

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          Showing latest {deploys.length} deploy{deploys.length === 1 ? "" : "s"}
        </span>
        <Button variant="secondary" onClick={onRedeploy}>
          <RotateCw className="h-3.5 w-3.5" /> Redeploy latest
        </Button>
      </div>

      <div
        className="overflow-hidden rounded-lg border"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
      >
        {deploys.length === 0 && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No deployments yet.</div>
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
                style={fail
                  ? { background: "var(--err-soft)", color: "var(--err-text)" }
                  : { background: "var(--ok-soft)", color: "var(--ok-text)" }}
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
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ok)" }} /> Live
                  </span>
                )}
                {canRollback && (
                  <button
                    onClick={() => rollback(d)}
                    className="rounded-md border px-3 py-[5px] text-xs font-semibold transition-colors"
                    style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
                  >
                    Rollback
                  </button>
                )}
                {fail && <span className="text-xs font-semibold" style={{ color: "var(--err-text)" }}>Failed</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Logs tab (Render-style terminal — dark in both themes) ──────────────────────

const LVL_STYLE = { INFO: "#6ea8fe", LOG: "#7c8696", OK: "#34d77a", WARN: "#f5b945", ERROR: "#f87171" };

// ISO timestamp → HH:MM:SS (local); "" if missing/unparseable.
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 8);
}

function LogsTab({ serviceId, name }) {
  const [lines, setLines] = useState(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [tail, setTail] = useState(true);
  const boxRef = useRef(null);

  // Fetch on mount; while live-tail is on, re-fetch every 4s. Interval cleared on unmount/toggle.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.logs(serviceId).then((data) => { if (!cancelled) setLines(data); }).catch(() => { if (!cancelled) setLines((l) => l || []); });
    setLines(null);
    load();
    if (!tail) return () => { cancelled = true; };
    const t = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [serviceId, tail]);

  const q = query.trim().toLowerCase();
  const shown = (lines || []).filter((l) => !q || String(l.message ?? "").toLowerCase().includes(q));

  // Auto-scroll to bottom on new lines while tailing.
  useEffect(() => {
    if (tail && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown.length, tail]);

  function copy() {
    const text = shown.map((l) => `${fmtTime(l.time)} ${l.level || ""} ${l.message ?? ""}`.trim()).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const tools = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-[5px] text-[11.5px] font-medium transition-colors";

  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border-strong)", boxShadow: "var(--shadow)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-[9px]" style={{ background: "#13161d", borderBottom: "1px solid #232a36" }}>
        <div className="flex items-center gap-[9px]">
          <button
            onClick={() => setTail((v) => !v)}
            className="inline-flex items-center gap-[7px] text-xs font-semibold"
            style={{ color: tail ? "#cfe9d6" : "#7c8696" }}
            title={tail ? "Pause live tail" : "Resume live tail"}
          >
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: tail ? "#34d77a" : "#4a5261", animation: tail ? "dd-pulse 1.4s infinite" : "none" }} />
            Live tail {tail ? "on" : "off"}
          </button>
          <span className="mono text-[11.5px]" style={{ color: "#7c8696" }}>{name} · stdout</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs…"
            className="mono rounded-md border px-2.5 py-[5px] text-[11.5px] outline-none"
            style={{ borderColor: "#2a323f", background: "#0b0e14", color: "#cdd6e4", width: "160px" }}
          />
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
        className="mono h-[380px] overflow-y-auto px-2 py-2 text-[12px]"
        style={{ background: "#0b0e14", lineHeight: "1.7" }}
      >
        {!lines && (
          <div className="px-2" style={{ color: "#5b6678" }}><Spinner className="mr-2 inline" /> Fetching logs…</div>
        )}
        {lines && shown.length === 0 && (
          <div className="px-2 py-8 text-center" style={{ color: "#5b6678" }}>
            {q ? `No log lines match “${query.trim()}”.` : "No logs yet — output appears here once the service produces some."}
          </div>
        )}
        {shown.map((l, i) => {
          const t = fmtTime(l.time);
          const lvl = l.level || "";
          const isErr = lvl === "ERROR";
          return (
            <div
              key={i}
              className="flex gap-3 rounded px-2 py-[1px]"
              style={{
                whiteSpace: wrap ? "pre-wrap" : "pre",
                background: isErr ? "rgba(248,113,113,0.08)" : undefined,
                borderLeft: isErr ? "2px solid #f87171" : "2px solid transparent",
              }}
            >
              <span className="shrink-0" style={{ color: "#5b6678", width: "58px" }}>{t || "—"}</span>
              {lvl && <span className="shrink-0 font-semibold" style={{ color: LVL_STYLE[lvl] || "#cdd6e4", width: "46px" }}>{lvl}</span>}
              <span style={{ color: isErr ? "#f6b6b6" : "#cdd6e4" }}>{l.message}</span>
            </div>
          );
        })}
        {lines && tail && shown.length > 0 && (
          <div className="mt-0.5 flex items-center gap-3 px-2">
            <span className="inline-block h-[15px] w-2" style={{ background: "#34d77a", animation: "dd-pulse 1.1s steps(1) infinite" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Metrics tab (live, point-in-time CPU + memory) ──────────────────────────────

// Strip "%"/whitespace → number, NaN → 0, clamp 0–100.
function pct(str) {
  const n = parseFloat(String(str ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function Bar({ value, color }) {
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

function MetricCard({ label, big, sub, value, color }) {
  return (
    <div className="rounded-lg border px-[18px] py-4" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="mt-1.5 text-[26px] font-semibold" style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{big}</div>
      {sub && <div className="mt-0.5 mono text-[12px]" style={{ color: "var(--text-muted)" }}>{sub}</div>}
      <Bar value={value} color={color} />
    </div>
  );
}

function MetricsTab({ serviceId }) {
  const [data, setData] = useState(null);   // null = loading; else { containers, error? }

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.metrics(serviceId)
        .then((d) => { if (!cancelled) setData(d || { containers: [] }); })
        .catch((e) => { if (!cancelled) setData({ containers: [], error: e.message }); });
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [serviceId]);

  if (!data) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Loading metrics…</div>
  );

  const containers = data.containers || [];
  const unavailable = data.error || containers.length === 0;

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between">
        <h4 className="text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>Application Metrics</h4>
        <span className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold" style={{ color: "var(--ok-text)" }}>
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--ok)", animation: "dd-pulse 1.4s infinite" }} />
          Live
        </span>
      </div>

      {unavailable ? (
        <div className="rounded-lg border px-4 py-10 text-center text-[13px]" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-muted)", boxShadow: "var(--shadow)" }}>
          Live metrics unavailable — the service isn't running or the metrics host isn't configured yet.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {containers.map((c, i) => (
            <div key={c.name || i}>
              <div className="mb-2 mono text-[12px]" style={{ color: "var(--text-muted)" }}>{c.name || "container"}</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <MetricCard label="CPU" big={c.cpu ?? "—"} value={pct(c.cpu)} color="var(--accent)" />
                <MetricCard label="Memory" big={c.memPerc ?? "—"} sub={c.mem} value={pct(c.memPerc)} color="var(--ok)" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Environment tab ─────────────────────────────────────────────────────────────

// Strong random secret: 32-char base64url. ponytail: getRandomValues, no crypto lib.
function genSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Parse pasted .env text → [{key,value}] (ignore blanks/#comments, split on first =, strip quotes).
function parseEnvText(text) {
  return text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return { key: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim().replace(/^["']|["']$/g, "") };
    })
    .filter((r) => r.key);
}

function EnvironmentTab({ serviceId, onDeploy }) {
  const [envs, setEnvs] = useState(null);
  const [baseline, setBaseline] = useState({});   // uuid → serialized "key\0value" at last load/save
  const [groups, setGroups] = useState(null);
  const [shown, setShown] = useState({});         // uuid → true when its secret value is revealed
  const [menu, setMenu] = useState(null);         // null | "root" | "datastore"
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [databases, setDatabases] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);   // { ok, text }

  useEffect(() => {
    let cancelled = false;
    api.envs(serviceId).then((d) => {
      if (cancelled) return;
      const rows = (d || []).map((e) => ({ ...e }));
      setEnvs(rows);
      setBaseline(snapshot(rows));
    });
    // sharedVars is admin-only; ignore failures and render the card empty.
    api.sharedVars().then((d) => { if (!cancelled) setGroups(Array.isArray(d) ? d : []); }).catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, [serviceId]);

  // build a key\0value map keyed by uuid for dirty comparison
  function snapshot(rows) {
    return Object.fromEntries(rows.map((r) => [r.uuid, `${r.key}\0${r.value ?? ""}`]));
  }

  // a row is dirty if new (uuid starts "new-") or its key/value differs from baseline
  function isDirtyRow(r) {
    return String(r.uuid).startsWith("new-") || baseline[r.uuid] !== `${r.key}\0${r.value ?? ""}`;
  }
  const dirty = !!envs && envs.some((r) => isDirtyRow(r) && r.key.trim());

  // keys (trimmed, case-sensitive) that appear on more than one row → every row in the group is flagged
  const dupKeys = (() => {
    const counts = {};
    (envs || []).forEach((r) => { const k = r.key.trim(); if (k) counts[k] = (counts[k] || 0) + 1; });
    return new Set(Object.keys(counts).filter((k) => counts[k] > 1));
  })();
  const hasDups = dupKeys.size > 0;

  function addRow(row) {
    setEnvs((e) => [...(e || []), { uuid: "new-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), key: "", value: "", is_secret: false, ...row }]);
    setSaveMsg(null);
  }

  function editRow(uuid, patch) {
    setEnvs((e) => e.map((r) => (r.uuid === uuid ? { ...r, ...patch } : r)));
    setSaveMsg(null);
  }

  // Reveal a secret's value. Coolify's API never returns values, so the list ships
  // secrets blank + revealable; fetch the plaintext from our encrypted store on the
  // first reveal, drop it into the row, and rebaseline so viewing ≠ editing.
  async function toggleReveal(e) {
    const willShow = !shown[e.uuid];
    if (willShow && (e.value ?? "") === "" && e.revealable && !String(e.uuid).startsWith("new-")) {
      try {
        const r = await api.revealEnv(serviceId, e.key);
        if (r?.revealable && r.value != null) {
          setEnvs((rows) => rows.map((x) => (x.uuid === e.uuid ? { ...x, value: r.value } : x)));
          setBaseline((b) => ({ ...b, [e.uuid]: `${e.key}\0${r.value}` }));
        }
      } catch { /* leave blank on failure */ }
    }
    setShown((s) => ({ ...s, [e.uuid]: willShow }));
  }

  // Reveal every secret at once: fetch each blank+revealable value, rebaseline, show all.
  async function revealAll() {
    const secrets = (envs || []).filter((e) => e.is_secret);
    const toFetch = secrets.filter((e) => (e.value ?? "") === "" && e.revealable && !String(e.uuid).startsWith("new-"));
    const results = await Promise.all(
      toFetch.map((e) => api.revealEnv(serviceId, e.key).then((r) => ({ e, r })).catch(() => null))
    );
    const vals = {};
    for (const it of results) if (it?.r?.revealable && it.r.value != null) vals[it.e.uuid] = it.r.value;
    if (Object.keys(vals).length) {
      setEnvs((rows) => rows.map((x) => (vals[x.uuid] != null ? { ...x, value: vals[x.uuid] } : x)));
      setBaseline((b) => {
        const n = { ...b };
        for (const e of secrets) if (vals[e.uuid] != null) n[e.uuid] = `${e.key}\0${vals[e.uuid]}`;
        return n;
      });
    }
    setShown(Object.fromEntries(secrets.map((e) => [e.uuid, true])));
  }

  async function remove(envId) {
    setEnvs((e) => e.filter((x) => x.uuid !== envId));
    if (!String(envId).startsWith("new-")) api.deleteEnv(serviceId, envId).catch(() => {});
  }

  function importPaste() {
    parseEnvText(pasteText).forEach((r) => addRow(r));
    setPasteText("");
    setPaste(false);
  }

  function openDatastore() {
    setMenu("datastore");
    if (databases == null) api.databases().then((d) => setDatabases(Array.isArray(d) ? d : [])).catch(() => setDatabases([]));
  }

  async function pickDatabase(db) {
    setMenu(null);
    try {
      const detail = await api.database(db.uuid);
      addRow({ key: "DATABASE_URL", value: detail?.internalUrl || "" });
    } catch {
      addRow({ key: "DATABASE_URL", value: "" });
    }
  }

  // Save every row with a non-empty key that changed (or is new). Returns true on success.
  async function save() {
    setSaving(true); setSaveMsg(null);
    try {
      for (const r of envs) {
        if (r.key.trim() && isDirtyRow(r)) {
          await api.saveEnv(serviceId, { key: r.key.trim(), value: r.value ?? "", is_secret: !!r.is_secret });
        }
      }
      setBaseline(snapshot(envs));
      setSaveMsg({ ok: true, text: "Saved." });
      return true;
    } catch (err) {
      setSaveMsg({ ok: false, text: err.message || "Save failed" });
      return false;
    } finally { setSaving(false); }
  }

  async function saveAndRedeploy() {
    if (await save()) {
      setSaveMsg({ ok: true, text: "Saved — redeploying…" });
      onDeploy?.();
    }
  }

  const inputCell = "mono w-full rounded-md border border-transparent bg-transparent px-2.5 py-[7px] text-[12px] outline-none transition-colors focus:border-[var(--accent)]";

  return (
    <div>
      {/* attached variable groups */}
      <div
        className="mb-4 rounded-lg border px-[18px] py-[15px]"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
      >
        <div className="mb-[13px] flex items-start justify-between gap-3">
          <div>
            <h4 className="text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>Attached variable groups</h4>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Shared variables merged in at deploy. Manage them under Variable Groups.
            </p>
          </div>
          <Button variant="secondary" title="Group attachment isn't persisted yet (display only)">
            <Plus className="h-3.5 w-3.5" /> Attach group
          </Button>
        </div>
        {!groups && <p className="text-xs" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Loading groups…</p>}
        {groups && groups.length === 0 && (
          <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>No variable groups attached.</p>
        )}
        {groups && groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <span
                key={g.id ?? g.uuid ?? g.key ?? g.name}
                className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]"
                style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md" style={{ background: "var(--accent-soft)" }}>
                  <Lock className="h-3 w-3" style={{ color: "var(--accent-text)" }} />
                </span>
                <span className="mono font-semibold">{g.key || g.name || g.group || "group"}</span>
                <span style={{ color: "var(--text-muted)" }}>{g.is_secret ? "· secret" : "· shared"}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* service own variables toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          {envs ? `Service variables · ${envs.length} keys, injected at build & runtime` : "Service variables"}
        </span>
        <div className="flex gap-2">
          {(() => {
            const anyShown = !!envs && envs.some((e) => e.is_secret && shown[e.uuid]);
            return (
              <Button
                variant="secondary"
                onClick={() => (anyShown ? setShown({}) : revealAll())}
              >
                {anyShown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {anyShown ? "Hide values" : "Reveal values"}
              </Button>
            );
          })()}

          {/* + Add variable dropdown (Render-style) */}
          <div className="relative">
            <Button variant="primary" onClick={() => setMenu((m) => (m ? null : "root"))}>
              <Plus className="h-3.5 w-3.5" /> Add variable <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {menu && (
              <>
                {/* click-away backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                <div
                  className="absolute right-0 z-20 mt-1.5 w-[230px] overflow-hidden rounded-lg border py-1 text-[13px]"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
                >
                  {menu === "root" && (
                    <>
                      <MenuItem icon={Plus} label="Add a variable" onClick={() => { addRow({}); setMenu(null); }} />
                      <MenuItem icon={KeyRound} label="Generated secret" onClick={() => { addRow({ value: genSecret(), is_secret: true }); setMenu(null); }} />
                      <MenuItem icon={FileText} label="Import from .env" onClick={() => { setPaste(true); setMenu(null); }} />
                      <MenuItem icon={Database} label="Datastore URL" chevron onClick={openDatastore} />
                    </>
                  )}
                  {menu === "datastore" && (
                    <>
                      <MenuItem icon={ArrowLeft} label="Back" onClick={() => setMenu("root")} />
                      <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                      {databases == null && <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Loading…</div>}
                      {databases && databases.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>No databases found.</div>}
                      {databases && databases.map((db) => (
                        <MenuItem key={db.uuid} icon={Database} label={db.name || db.uuid} onClick={() => pickDatabase(db)} />
                      ))}
                      <p className="px-3 pb-1.5 pt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Password isn't exposed by Coolify — you may need to fill it in.
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {paste && (
        <div className="mb-3.5 rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
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
            <Button variant="primary" onClick={importPaste} disabled={!pasteText.trim()}>
              Import variables
            </Button>
          </div>
        </div>
      )}

      {/* env table */}
      <div
        className="overflow-hidden rounded-lg border"
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

        {envs && envs.length === 0 && (
          <div className="px-4 py-6 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            No variables yet. Use “Add variable” to create one.
          </div>
        )}

        {envs && envs.map((e) => {
          const secret = !!e.is_secret;
          const maskValue = secret && !shown[e.uuid];
          const isDup = dupKeys.has(e.key.trim());
          return (
            <div
              key={e.uuid}
              className="grid items-center gap-3 border-t px-4 py-[9px]"
              style={{
                gridTemplateColumns: "1fr 1.5fr 40px",
                borderColor: "var(--border)",
                background: isDup ? "var(--err-soft)" : (isDirtyRow(e) && e.key.trim() ? "var(--surface-2)" : undefined),
                borderLeft: isDup ? "3px solid var(--err)" : "3px solid transparent",
              }}
            >
              <div>
                <input
                  value={e.key}
                  onChange={(ev) => editRow(e.uuid, { key: ev.target.value.toUpperCase() })}
                  placeholder="KEY"
                  className={inputCell}
                  style={{ color: "var(--text)", fontWeight: 500 }}
                />
                {isDup && <span className="px-2.5 text-[10.5px] font-semibold" style={{ color: "var(--err-text)" }}>duplicate key</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={e.value ?? ""}
                  onChange={(ev) => editRow(e.uuid, { value: ev.target.value })}
                  placeholder="value"
                  type={maskValue ? "password" : "text"}
                  className={inputCell}
                  style={{ color: "var(--text-muted)" }}
                />
                {secret && (
                  <button
                    type="button"
                    onClick={() => toggleReveal(e)}
                    title={maskValue ? "Reveal value" : "Hide value"}
                    className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition-colors"
                    style={{ color: "var(--text-muted)", background: "transparent" }}
                    onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                  >
                    {maskValue ? <Eye className="h-[15px] w-[15px]" /> : <EyeOff className="h-[15px] w-[15px]" />}
                  </button>
                )}
                <label className="flex shrink-0 items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={secret}
                    onChange={(ev) => editRow(e.uuid, { is_secret: ev.target.checked })}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  secret
                </label>
              </div>
              <button
                onClick={() => remove(e.uuid)}
                title="Remove"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors"
                style={{ color: "var(--text-muted)", background: "transparent" }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--err-soft)"; ev.currentTarget.style.color = "var(--err-text)"; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <Trash2 className="h-[15px] w-[15px]" />
              </button>
            </div>
          );
        })}
      </div>

      {/* save controls */}
      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-3">
        {hasDups && (
          <span className="text-xs font-semibold" style={{ color: "var(--err-text)" }}>
            Duplicate key{dupKeys.size > 1 ? "s" : ""}: {[...dupKeys].join(", ")} — resolve before saving.
          </span>
        )}
        {saveMsg && <span className="text-xs" style={{ color: saveMsg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{saveMsg.text}</span>}
        <Button variant="secondary" onClick={save} disabled={!dirty || saving || hasDups}>
          {saving ? <Spinner /> : <Check className="h-3.5 w-3.5" />} Save
        </Button>
        <Button variant="primary" onClick={saveAndRedeploy} disabled={!dirty || saving || hasDups}>
          {saving ? <Spinner /> : <Rocket className="h-3.5 w-3.5" />} Save &amp; Redeploy
        </Button>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, chevron }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
      style={{ color: "var(--text)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
      <span className="flex-1 truncate">{label}</span>
      {chevron && <ChevronDown className="h-3.5 w-3.5 -rotate-90" style={{ color: "var(--text-muted)" }} />}
    </button>
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
    <div className="card text-sm" style={{ color: "var(--err)" }}>Failed to load events: {err.message}</div>
  );
  if (!events) return (
    <div className="text-sm" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Loading events…</div>
  );
  if (events.length === 0) return (
    <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No events recorded yet.</div>
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
              <div className="mt-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{actor} · {timeAgo(ev.created_at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────────

const NAV = [
  { id: "general", label: "General" },
  { id: "build", label: "Build" },
  { id: "deploy", label: "Deploy" },
  { id: "domains", label: "Custom Domains" },
  { id: "pr-previews", label: "PR Previews" },
  { id: "networking", label: "Networking" },
  { id: "edge-caching", label: "Edge Caching" },
  { id: "notifications", label: "Notifications" },
  { id: "log-stream", label: "Log Stream" },
  { id: "health", label: "Health Checks" },
  { id: "disk", label: "Disk" },
  { id: "maintenance", label: "Maintenance Mode" },
  { id: "danger", label: "Delete or suspend" },
];

function SettingsTab({ svc, serviceId, region, onDeploy, deployBusy, onRename }) {
  const navigate = useNavigate();

  // build & deploy (wired to /build; backend may 404 until added)
  const [rootDir, setRootDir] = useState(svc.rootDirectory || "");
  const [buildCmd, setBuildCmd] = useState(svc.buildCommand || "");
  const [startCmd, setStartCmd] = useState(svc.startCommand || "");
  const [preDeploy, setPreDeploy] = useState(svc.preDeployCommand || "");
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildMsg, setBuildMsg] = useState(null);

  // custom domain (wired to /domain + /domain/verify)
  const [fqdn, setFqdn] = useState(svc.domain || "");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMsg, setDomainMsg] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [subdomainOn, setSubdomainOn] = useState(true);

  // health check (wired to /build alongside commands; falls through if unsupported)
  const [healthPath, setHealthPath] = useState(svc.healthCheckPath || "/");

  // display-only local state (no backend)
  const [autoDeploy, setAutoDeploy] = useState("On commit");
  const [prPreview, setPrPreview] = useState("Off");
  const [edgeCache, setEdgeCache] = useState("Static assets");
  const [svcNotify, setSvcNotify] = useState("Workspace default");
  const [previewNotify, setPreviewNotify] = useState("Off");
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceUrl, setMaintenanceUrl] = useState("");
  const [hookRevealed, setHookRevealed] = useState(false);
  const [included, setIncluded] = useState([]);
  const [ignored, setIgnored] = useState([]);

  const deployHook = `https://app.debutdepoly.com/deploy/hook/${serviceId}?key=whsec_${serviceId.slice(0, 8)}`;

  async function saveBuild(e) {
    e?.preventDefault();
    setBuildBusy(true);
    setBuildMsg(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/build`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDirectory: rootDir.trim() || undefined,
          buildCommand: buildCmd.trim(),
          startCommand: startCmd.trim(),
          preDeployCommand: preDeploy.trim() || undefined,
          healthCheckPath: healthPath.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || String(r.status));
      setBuildMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setBuildMsg({ ok: false, text: err.message });
    } finally { setBuildBusy(false); }
  }

  async function saveDomain(e) {
    e.preventDefault();
    setDomainBusy(true); setDomainMsg(null); setVerifyResult(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/domain`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fqdn: fqdn.trim() }),
      });
      if (!r.ok) { const e2 = await r.json().catch(() => ({})); throw new Error(e2.error || String(r.status)); }
      setDomainMsg({ ok: true, text: "Domain saved." });
    } catch (err) {
      setDomainMsg({ ok: false, text: err.message });
    } finally { setDomainBusy(false); }
  }

  async function verifyDns() {
    if (!fqdn.trim()) return;
    setVerifyBusy(true); setVerifyResult(null);
    try {
      const r = await fetch(`/api/services/${serviceId}/domain/verify?fqdn=${encodeURIComponent(fqdn.trim())}`, { credentials: "same-origin" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || String(r.status));
      setVerifyResult(data);
    } catch (err) {
      setVerifyResult({ error: err.message });
    } finally { setVerifyBusy(false); }
  }

  const [confirmDel, setConfirmDel] = useState(false);
  async function deleteSvc() {
    const res = await fetch(`/api/services/${serviceId}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Delete failed (${res.status})`);
    }
    navigate("/");
  }

  // anchor nav — track visible section
  const [activeSection, setActiveSection] = useState("general");
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveSection(vis[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    NAV.forEach((n) => { const el = document.getElementById(n.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  function jump(secId) {
    document.getElementById(secId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(secId);
  }

  const subdomain = `${svc.name}.debutdepoly.app`;

  return (
    <div className="flex gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-[18px]">

        {/* 1 · General */}
        <SettingsSection id="general" title="General">
          <SettingsRow label="Name" desc="A friendly name for this service.">
            <EditableName
              value={svc.name}
              onSave={(name) => api.renameService(serviceId, name).then(() => onRename(name))}
            />
          </SettingsRow>
          <SettingsRow label="Region" desc="The region this service runs in.">
            <ReadOnly value={region} />
          </SettingsRow>
          <SettingsRow label="Instance type" desc="Scaling is managed at the workspace level.">
            <div
              className="flex items-center justify-between gap-3 rounded-md border px-3.5 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
            >
              <div>
                <p className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>Pro · 2 CPU · 4 GB</p>
                <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>Current plan for this service.</p>
              </div>
              <Button variant="secondary" title="Plan changes are workspace-level (display only)">Change plan</Button>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 2 · Build */}
        <SettingsSection id="build" title="Build">
          <SettingsRow label="Source" desc="Repository this service builds from.">
            <ReadOnly mono value={svc.repo || "—"} />
          </SettingsRow>
          <SettingsRow label="Branch" desc="Branch used for deploys.">
            <ReadOnly mono value={svc.branch || "main"} />
          </SettingsRow>
          <SettingsRow label="Root directory" desc="Optional. Subdirectory to build from.">
            <TextInput mono value={rootDir} onChange={setRootDir} placeholder="./" />
          </SettingsRow>
          <SettingsRow label="Build command" desc="Runs to build your service each deploy.">
            <div className="flex flex-col gap-2">
              <TextInput mono value={buildCmd} onChange={setBuildCmd} placeholder="npm ci && npm run build" />
              <SaveInline busy={buildBusy} msg={buildMsg} onSave={saveBuild} />
            </div>
          </SettingsRow>
          <SettingsRow label="Git credentials" desc="How DebutDeploy authenticates to your repo.">
            <div className="flex items-center gap-2">
              <ReadOnly value="Deploy key · debutdeploy-platform" />
              <Button variant="secondary" title="Uses the workspace app install (display only)">Use my credentials</Button>
            </div>
          </SettingsRow>
          <SettingsRow label="Build filters" desc="Paths that trigger or skip a build.">
            <div className="flex flex-col gap-3">
              <PathList label="Included paths" items={included} onChange={setIncluded} />
              <PathList label="Ignored paths" items={ignored} onChange={setIgnored} />
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 3 · Deploy */}
        <SettingsSection id="deploy" title="Deploy">
          <SettingsRow label="Pre-deploy command" desc="Optional. Runs before the release goes live.">
            <TextInput mono value={preDeploy} onChange={setPreDeploy} placeholder="npx prisma migrate deploy" />
          </SettingsRow>
          <SettingsRow label="Start command" desc="Command that starts your service.">
            <div className="flex flex-col gap-2">
              <TextInput mono value={startCmd} onChange={setStartCmd} placeholder="node dist/server.js" />
              <SaveInline busy={buildBusy} msg={buildMsg} onSave={saveBuild} />
            </div>
          </SettingsRow>
          <SettingsRow label="Auto-deploy" desc="Deploy automatically when you push to your branch.">
            <SelectInput value={autoDeploy} onChange={setAutoDeploy} options={["On commit", "Off", "After CI"]} />
          </SettingsRow>
          <SettingsRow label="Deploy hook" desc="POST to this URL to trigger a deploy.">
            <div className="flex items-center gap-2">
              <ReadOnly
                mono
                value={hookRevealed ? deployHook : "https://app.debutdepoly.com/deploy/hook/••••••••"}
              />
              <IconBtn title={hookRevealed ? "Hide" : "Reveal"} onClick={() => setHookRevealed((v) => !v)}>
                {hookRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </IconBtn>
              <IconBtn title="Copy" onClick={() => navigator.clipboard?.writeText(deployHook)}>
                <Copy className="h-4 w-4" />
              </IconBtn>
              <Button variant="secondary" title="Regeneration isn't wired (display only)">
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate hook
              </Button>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 4 · Custom Domains */}
        <SettingsSection id="domains" title="Custom Domains">
          <SettingsRow label="Add custom domain" desc="Point your own domain, verify DNS, then TLS is issued.">
            <form onSubmit={saveDomain} className="flex flex-col gap-2.5">
              <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
                <TextInput mono value={fqdn} onChange={(v) => { setFqdn(v); setVerifyResult(null); }} placeholder="app.example.com" />
                <Button type="submit" variant="primary" disabled={domainBusy || !fqdn.trim()}>
                  {domainBusy ? <Spinner /> : "Add custom domain"}
                </Button>
                <Button type="button" variant="secondary" onClick={verifyDns} disabled={verifyBusy || !fqdn.trim()}>
                  {verifyBusy ? <Spinner /> : "Verify DNS"}
                </Button>
              </div>
              {domainMsg && <p className="text-xs" style={{ color: domainMsg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{domainMsg.text}</p>}
              {verifyResult && !verifyResult.error && <DnsResult result={verifyResult} />}
              {verifyResult?.error && <p className="text-xs" style={{ color: "var(--err-text)" }}>Verify failed: {verifyResult.error}</p>}
            </form>
          </SettingsRow>
          <SettingsRow label="DebutDeploy subdomain" desc="A free subdomain always reachable for this service.">
            <div className="flex flex-col gap-2">
              <ToggleRow on={subdomainOn} onToggle={() => setSubdomainOn((v) => !v)} label="Enable free subdomain" />
              {subdomainOn && (
                <a
                  href={`https://${subdomain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono inline-flex items-center gap-1.5 text-[12.5px]"
                  style={{ color: "var(--accent-text)" }}
                >
                  {subdomain}<ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 5 · PR Previews */}
        <SettingsSection id="pr-previews" title="PR Previews">
          <SettingsRow label="Pull request previews" desc="Spin up a temporary environment for each PR.">
            <SelectInput value={prPreview} onChange={setPrPreview} options={["Off", "Automatic", "Manual"]} />
          </SettingsRow>
        </SettingsSection>

        {/* 6 · Networking */}
        <SettingsSection id="networking" title="Networking">
          <SettingsRow label="Private networking" desc="Reach other services over an internal network.">
            <div
              className="flex items-start gap-3 rounded-md border px-3.5 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
              <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                Private networking is available on Pro plans. Services in the same workspace can talk to each other over a private network without exposing ports publicly.
              </p>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 7 · Edge Caching */}
        <SettingsSection id="edge-caching" title="Edge Caching">
          <SettingsRow label="Cacheable file types" desc="Which responses the edge network may cache.">
            <SelectInput value={edgeCache} onChange={setEdgeCache} options={["None", "Static assets", "All GET"]} />
          </SettingsRow>
        </SettingsSection>

        {/* 8 · Notifications */}
        <SettingsSection id="notifications" title="Notifications">
          <SettingsRow label="Service notifications" desc="Alerts for failed deploys and downtime.">
            <SelectInput value={svcNotify} onChange={setSvcNotify} options={["Workspace default", "All events", "Failures only", "Off"]} />
          </SettingsRow>
          <SettingsRow label="Preview-env notifications" desc="Alerts for PR preview environments.">
            <SelectInput value={previewNotify} onChange={setPreviewNotify} options={["Off", "Failures only", "All events"]} />
          </SettingsRow>
        </SettingsSection>

        {/* 9 · Log Stream */}
        <SettingsSection id="log-stream" title="Log Stream">
          <SettingsRow label="Destination" desc="Ship logs to an external endpoint.">
            <div
              className="flex flex-col gap-2 rounded-md border px-3.5 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>Log endpoint</span>
                <span className="mono text-[12px]" style={{ color: "var(--text)" }}>None</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>Token</span>
                <span className="mono text-[12px]" style={{ color: "var(--text)" }}>None</span>
              </div>
              <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>Using workspace default.</p>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 10 · Health Checks */}
        <SettingsSection id="health" title="Health Checks">
          <SettingsRow label="Health check path" desc="Path DebutDeploy polls to decide the service is healthy.">
            <div className="flex flex-col gap-2">
              <TextInput mono value={healthPath} onChange={setHealthPath} placeholder="/healthz" />
              <SaveInline busy={buildBusy} msg={buildMsg} onSave={saveBuild} />
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* 10b · Disk */}
        <DiskSection serviceId={serviceId} />

        {/* 11 · Maintenance Mode */}
        <SettingsSection id="maintenance" title="Maintenance Mode">
          <SettingsRow label="Enable maintenance mode" desc="Serve a maintenance page instead of your service.">
            <ToggleRow on={maintenance} onToggle={() => setMaintenance((v) => !v)} label="Maintenance mode" />
          </SettingsRow>
          <SettingsRow label="Custom maintenance page" desc="Optional. URL to redirect visitors to.">
            <TextInput mono value={maintenanceUrl} onChange={setMaintenanceUrl} placeholder="https://status.example.com" />
          </SettingsRow>
        </SettingsSection>

        {/* 12 · Delete or suspend */}
        <section
          id="danger"
          className="scroll-mt-24 rounded-lg px-5 py-[18px]"
          style={{ border: "1px solid var(--err)", background: "var(--err-soft)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="mb-[3px] text-[14.5px] font-semibold" style={{ color: "var(--err-text)" }}>Delete web service</h3>
              <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                Permanently removes the container, domain and build history. This cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete web service
            </Button>
          </div>
        </section>
      </div>

      {confirmDel && (
        <ConfirmDelete
          name={svc.name}
          kind="service"
          onConfirm={deleteSvc}
          onCancel={() => setConfirmDel(false)}
        />
      )}

      <div className="w-[172px] shrink-0">
        <AnchorNav items={NAV} active={activeSection} onJump={jump} />
      </div>
    </div>
  );
}

// ── Disk (persistent volumes) ───────────────────────────────────────────────────

function DiskSection({ serviceId }) {
  const [disks, setDisks] = useState(null);   // null = loading
  const [err, setErr] = useState(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);    // true while adding/removing (redeploying)

  function load() {
    setErr(null);
    api.serviceVolumes(serviceId)
      .then((d) => setDisks(Array.isArray(d) ? d : []))
      .catch((e) => { setDisks([]); setErr(e.message || "Failed to load disks"); });
  }
  useEffect(load, [serviceId]);

  const valid = path.trim().startsWith("/");

  async function add() {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.addServiceVolume(serviceId, path.trim());
      setPath("");
      load();
    } catch (e) {
      setErr(e.message || "Failed to add disk");
    } finally { setBusy(false); }
  }

  async function remove(vid) {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await api.deleteServiceVolume(serviceId, vid);
      load();
    } catch (e) {
      setErr(e.message || "Failed to remove disk");
    } finally { setBusy(false); }
  }

  return (
    <SettingsSection id="disk" title="Disk">
      <SettingsRow label="Persistent disks" desc="Attach a persistent disk to keep filesystem data across deploys.">
        <div className="flex flex-col gap-3">
          <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            Adding or removing a disk redeploys the service.
          </p>

          {busy && (
            <p className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              <Spinner /> Redeploying…
            </p>
          )}

          {!disks && (
            <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              <Spinner className="mr-2 inline" /> Loading disks…
            </p>
          )}

          {disks && disks.length === 0 && (
            <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>No disks attached.</p>
          )}

          {disks && disks.length > 0 && (
            <div className="flex flex-col gap-2">
              {disks.map((d) => (
                <div
                  key={d.uuid}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                  style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                >
                  <HardDrive className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                  <div className="min-w-0 flex-1">
                    <Mono>{d.mountPath}</Mono>
                    {d.name && <span className="ml-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{d.name}</span>}
                  </div>
                  <Button variant="secondary" onClick={() => remove(d.uuid)} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* add disk form */}
          <div className="flex items-center gap-2">
            <TextInput
              mono
              value={path}
              onChange={setPath}
              placeholder="/data"
            />
            <Button variant="primary" onClick={add} disabled={!valid || busy}>
              {busy ? <Spinner /> : <Plus className="h-3.5 w-3.5" />} Add Disk
            </Button>
          </div>

          {err && <p className="text-xs" style={{ color: "var(--err-text)" }}>{err}</p>}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

// ── Settings field primitives ───────────────────────────────────────────────────

function ReadOnly({ value, mono }) {
  return (
    <div
      className={`${mono ? "mono " : ""}truncate rounded-md border px-3 py-[9px] text-[13px]`}
      style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
      title={value}
    >
      {value}
    </div>
  );
}

// Inline-editable name field (Render-style): read-only + Edit → input + Save/Cancel.
function EditableName({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function start() { setDraft(value); setErr(null); setEditing(true); }

  async function save() {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    try {
      await onSave(name);
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Rename failed");
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <ReadOnly value={value} />
        <Button variant="secondary" onClick={start}>Edit</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          className="input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        />
        <Button variant="primary" onClick={save} disabled={busy || !draft.trim()}>{busy ? <Spinner /> : "Save"}</Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
      </div>
      {err && <span className="text-xs" style={{ color: "var(--err-text)" }}>{err}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, mono }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${mono ? "mono " : ""}input`}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SaveInline({ busy, msg, onSave }) {
  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="primary" onClick={onSave} disabled={busy}>{busy ? <Spinner /> : "Save"}</Button>
      {msg && <span className="text-xs" style={{ color: msg.ok ? "var(--ok-text)" : "var(--err-text)" }}>{msg.text}</span>}
    </div>
  );
}

function IconBtn({ children, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-md border transition-colors"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
    >
      {children}
    </button>
  );
}

function ToggleRow({ on, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2.5 self-start"
      title="Display only"
    >
      <span
        className="relative inline-block h-[22px] w-[38px] rounded-full transition-colors"
        style={{ background: on ? "var(--accent)" : "var(--border-strong)" }}
      >
        <span
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: on ? "19px" : "3px" }}
        />
      </span>
      <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>{label}</span>
    </button>
  );
}

// dashed "Add path" list — client-side local state only (display only)
function PathList({ label, items, onChange }) {
  const [val, setVal] = useState("");
  return (
    <div>
      <p className="mb-1.5 text-[11.5px] font-semibold" style={{ color: "var(--text-muted)" }}>{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {items.map((p, i) => (
          <span
            key={p + i}
            className="mono inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
          >
            {p}
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ color: "var(--text-muted)" }}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {val !== null && (
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && val.trim()) { e.preventDefault(); onChange([...items, val.trim()]); setVal(""); }
            }}
            placeholder="Add path…"
            className="mono rounded-md border border-dashed bg-transparent px-2.5 py-1 text-[12px] outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)", width: "140px" }}
          />
        )}
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
      className="space-y-2 rounded-lg border p-3 text-xs"
      style={{ background: "var(--surface-2)", borderColor: pointsAt ? "var(--ok)" : "var(--warn)" }}
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
