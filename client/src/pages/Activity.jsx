import { useEffect, useMemo, useState } from "react";
import {
  Rocket, Play, Braces, Database, Globe, LogIn, CreditCard,
  KeyRound, Server, Shuffle, Settings, ArrowDownCircle, ArrowUpCircle,
} from "lucide-react";
import { api } from "../lib/api.js";
import { EmptyState, PageHeader, Spinner, timeAgo } from "../components/ui.jsx";
import { actionLabel, actionCategory, describeEvent } from "../lib/eventLabels.js";

// category → icon + accent colour. The tile tints the colour at ~14% behind the icon.
const CAT = {
  down:      { Icon: ArrowDownCircle, color: "var(--err)" },
  up:        { Icon: ArrowUpCircle,   color: "var(--ok)" },
  deploy:    { Icon: Rocket,          color: "var(--accent)" },
  lifecycle: { Icon: Play,            color: "var(--accent)" },
  env:       { Icon: Braces,          color: "#8b5cf6" },
  db:        { Icon: Database,        color: "#0ea5e9" },
  domain:    { Icon: Globe,           color: "#14b8a6" },
  auth:      { Icon: LogIn,           color: "var(--text-muted)" },
  billing:   { Icon: CreditCard,      color: "#f59e0b" },
  key:       { Icon: KeyRound,        color: "#f43f5e" },
  server:    { Icon: Server,          color: "#6366f1" },
  admin:     { Icon: Shuffle,         color: "var(--accent)" },
  config:    { Icon: Settings,        color: "var(--text-muted)" },
};

// SQLite stamps UTC as "YYYY-MM-DD HH:MM:SS" (no zone). Parse as UTC so day
// grouping + tooltips don't drift by the viewer's timezone offset.
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

function Row({ ev }) {
  const cat = CAT[actionCategory(ev.action)] || CAT.config;
  const { Icon, color } = cat;
  const detail = describeEvent(ev);
  const actor = ev.actor_name || ev.actor_email || "system";

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {/* icon tile */}
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      >
        <Icon size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{actionLabel(ev.action)}</span>
          {ev.resource_type && (
            <span
              className="mono rounded px-1.5 py-0.5 text-[11px]"
              style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
              title={ev.resource_uuid || ""}
            >
              {ev.resource_type}{ev.resource_uuid ? `·${ev.resource_uuid.slice(0, 8)}` : ""}
            </span>
          )}
        </div>
        {detail && (
          <div className="mono mt-0.5 truncate text-[12.5px]" style={{ color: "var(--text-muted)" }} title={detail}>
            {detail}
          </div>
        )}
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{actor}</div>
      </div>

      {/* time: relative, absolute on hover */}
      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--text-muted)" }} title={parseTs(ev.created_at).toLocaleString()}>
        {clock(ev.created_at)} · {timeAgo(ev.created_at)}
      </span>
    </li>
  );
}

export default function Activity() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.events(200)
      .then(setEvents)
      .catch((e) => setError(e.message || "Failed to load activity"));
  }, []);

  // Group in-order (events arrive newest-first) into day buckets.
  const groups = useMemo(() => {
    if (!events) return [];
    const out = [];
    let cur = null;
    for (const ev of events) {
      const key = dayKey(ev.created_at);
      if (!cur || cur.key !== key) { cur = { key, items: [] }; out.push(cur); }
      cur.items.push(ev);
    }
    return out;
  }, [events]);

  return (
    <div className="page space-y-5">
      <PageHeader
        title="Activity"
        subtitle={events?.length ? `${events.length} recent event${events.length === 1 ? "" : "s"} across your services` : "Recent events across your services."}
      />

      {error && <p className="text-sm" style={{ color: "var(--err)" }}>{error}</p>}

      {events === null && !error ? (
        <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
          <Spinner /> Loading…
        </div>
      ) : events?.length === 0 ? (
        <EmptyState title="No activity yet" description="Events will appear here as you deploy and manage services." />
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
                  {g.items.map((ev) => <Row key={ev.id} ev={ev} />)}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
