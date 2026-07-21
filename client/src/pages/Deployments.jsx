import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GitCommit } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, StatusPill, Spinner, EmptyState, timeAgo } from "../components/ui.jsx";

// Coolify deploy status → StatusPill status (which drives colour + label).
const DEPLOY_STATUS = {
  in_progress: "building", queued: "queued", finished: "success",
  failed: "failed", "cancelled-by-user": "stopped",
};
const isActive = (s) => s === "in_progress" || s === "queued";

// SQLite/Postgres stamp UTC without a zone; parse as UTC so day grouping doesn't
// drift by the viewer's offset (same approach as the Activity page).
function parseTs(s) {
  if (!s) return new Date(NaN);
  const str = String(s);
  if (/(Z|[+-]\d\d:?\d\d)$/.test(str)) return new Date(str);
  return new Date(str.replace(" ", "T") + "Z");
}
function dayKey(d) {
  const dt = parseTs(d);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(dt)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
const clock = (d) => parseTs(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtDur = (s) => (s == null ? "" : s >= 60 ? `${Math.round(s / 60)}m ${s % 60}s` : `${s}s`);

function Row({ d }) {
  const building = d.status === "in_progress";
  const body = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", minWidth: 0 }}>
      <div style={{ width: 88, flexShrink: 0 }}>
        <StatusPill status={DEPLOY_STATUS[d.status] || d.status} />
      </div>
      <span style={{
        fontSize: 13.5, fontWeight: 600, color: "var(--text)", flexShrink: 0, maxWidth: 200,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {d.app}
      </span>
      {d.commit && (
        <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0 }}>
          <GitCommit size={12} />{d.commit}
        </span>
      )}
      <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {d.message || (d.trigger === "git push" ? "git push" : "manual deploy")}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0, textAlign: "right", minWidth: 96 }}
            title={parseTs(d.startedAt).toLocaleString()}>
        {building && d.progress
          ? `~${d.progress.etaSec >= 60 ? Math.round(d.progress.etaSec / 60) + "m" : d.progress.etaSec + "s"} left`
          : isActive(d.status)
            ? "waiting…"
            : `${clock(d.startedAt)}${d.durationSec != null ? " · " + fmtDur(d.durationSec) : ""}`}
      </span>
    </div>
  );

  const bar = building && d.progress ? (
    <div style={{ height: 2, background: "var(--border)" }}>
      <div style={{ height: "100%", width: `${d.progress.pct}%`, background: "var(--accent, #6366f1)", transition: "width 1s linear" }} />
    </div>
  ) : null;

  return (
    <li>
      {d.uuid
        ? <Link to={`/services/${d.uuid}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{body}</Link>
        : body}
      {bar}
    </li>
  );
}

export default function Deployments() {
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState("");

  useEffect(() => {
    let off = false, timer;
    async function tick() {
      try {
        const d = await api.deploymentLog();
        if (off) return;
        const list = Array.isArray(d) ? d : [];
        setRows(list);
        // Poll fast while anything's building/queued, slow otherwise.
        const active = list.some((x) => isActive(x.status));
        timer = setTimeout(tick, active ? 4000 : 20000);
      } catch (e) {
        if (off) return;
        setError(e.message || "Failed to load deployments");
        timer = setTimeout(tick, 20000);
      }
    }
    tick();
    return () => { off = true; clearTimeout(timer); };
  }, []);

  const groups = useMemo(() => {
    if (!rows) return [];
    const out = [];
    let cur = null;
    for (const d of rows) {
      const key = dayKey(d.startedAt);
      if (!cur || cur.key !== key) { cur = { key, items: [] }; out.push(cur); }
      cur.items.push(d);
    }
    return out;
  }, [rows]);

  const activeCount = useMemo(() => (rows || []).filter((d) => isActive(d.status)).length, [rows]);

  return (
    <div className="page space-y-5">
      <PageHeader
        title="Deployments"
        subtitle={rows?.length
          ? `${rows.length} recent deploy${rows.length === 1 ? "" : "s"}${activeCount ? ` · ${activeCount} in progress` : ""}`
          : "Recent deploys across your services."}
      />

      {error && <p className="text-sm" style={{ color: "var(--err)" }}>{error}</p>}

      {rows === null && !error ? (
        <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
          <Spinner /> Loading…
        </div>
      ) : rows?.length === 0 ? (
        <EmptyState title="No deployments yet" description="Deploys will appear here as you ship services." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 flex items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{g.key}</span>
                <span className="h-px flex-1" style={{ background: "var(--border)" }} />
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{g.items.length}</span>
              </div>
              <div className="overflow-hidden rounded-lg border" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}>
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {g.items.map((d) => <Row key={d.deploymentUuid} d={d} />)}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
