import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Hammer, Clock, ChevronRight } from "lucide-react";
import { api } from "../lib/api.js";
import { Spinner, timeAgo } from "./ui.jsx";

// Render-style live build queue: what's building or queued right now, across the
// fleet, grouped by server. Polls while anything is active, then goes quiet (and
// renders nothing when the queue is empty — zero footprint at rest).
//
// The point it makes visible: Coolify deploys one-at-a-time PER APP, so several
// triggers on the same app stack up as "queued" behind an "in_progress" one.
export default function BuildQueue() {
  const [rows, setRows] = useState(null); // null = first load

  useEffect(() => {
    let off = false;
    let timer;
    async function tick() {
      try {
        const d = await api.activeDeployments();
        if (off) return;
        const list = Array.isArray(d) ? d : [];
        setRows(list);
        // Poll fast while active, slow (still catches new triggers) when idle.
        timer = setTimeout(tick, list.length ? 4000 : 15000);
      } catch {
        if (!off) timer = setTimeout(tick, 15000);
      }
    }
    tick();
    return () => { off = true; clearTimeout(timer); };
  }, []);

  if (!rows || rows.length === 0) return null; // silent unless something's building

  // Group by server so a per-box pile-up is obvious. Within a server, in_progress
  // first, then queued in trigger order (Coolify runs them top-down per app).
  const byServer = {};
  for (const r of rows) (byServer[r.server || "—"] ||= []).push(r);
  const building = rows.filter((r) => r.status === "in_progress").length;
  const queued = rows.length - building;

  return (
    <div className="mb-4 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
      <div className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold" style={{ borderBottom: "1px solid var(--border)" }}>
        <Hammer size={15} style={{ color: "var(--accent, #6366f1)" }} />
        Build queue
        <span className="ml-1 font-normal" style={{ color: "var(--text-muted)" }}>
          {building} building{queued ? ` · ${queued} queued` : ""}
        </span>
        <Spinner className="ml-auto" />
      </div>
      {Object.entries(byServer).map(([server, list]) => (
        <div key={server}>
          <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {server}
          </div>
          {list.map((r) => (
            <QueueRow key={r.id} r={r} position={r.status === "queued" ? list.filter((x) => x.status === "queued" && x.id <= r.id).length : 0} />
          ))}
        </div>
      ))}
    </div>
  );
}

function QueueRow({ r, position }) {
  const building = r.status === "in_progress";
  const body = (
    <div className="flex items-center gap-3 px-4 py-2 text-[13px]" style={{ borderTop: "1px solid var(--border)" }}>
      <StatusChip building={building} />
      <span className="font-medium" style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {r.app}
      </span>
      {r.commit && <span className="mono" style={{ color: "var(--text-muted)" }}>{r.commit}</span>}
      <span className="truncate" style={{ color: "var(--text-muted)", minWidth: 0 }}>
        {r.message || (r.force ? "clear-cache rebuild" : r.rollback ? "rollback" : r.trigger)}
      </span>
      <span className="ml-auto flex items-center gap-1 shrink-0" style={{ color: "var(--text-muted)" }}>
        {building
          ? <><Clock size={12} /> {timeAgo(r.startedAt)}</>
          : <>#{position} in line</>}
      </span>
      {r.uuid && <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
    </div>
  );
  return r.uuid
    ? <Link to={`/services/${r.uuid}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>{body}</Link>
    : body;
}

function StatusChip({ building }) {
  const [bg, text, label] = building
    ? ["#eff6ff", "#1d4ed8", "Building"]
    : ["#fffbeb", "#b45309", "Queued"];
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: bg, color: text }}>
      {building && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: text }} />}
      {label}
    </span>
  );
}
