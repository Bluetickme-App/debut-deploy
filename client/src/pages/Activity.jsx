import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Card, EmptyState, PageHeader, Spinner, timeAgo } from "../components/ui.jsx";
import { actionLabel } from "../lib/eventLabels.js";

// dot color: service.down = err, service.up = ok, others = accent
function dotColor(action) {
  if (action === "service.down") return "var(--err)";
  if (action === "service.up")   return "var(--ok)";
  return "var(--accent)";
}

export default function Activity() {
  const [events, setEvents] = useState(null);
  const [error,  setError]  = useState("");

  useEffect(() => {
    api.events(200)
      .then(setEvents)
      .catch((e) => setError(e.message || "Failed to load activity"));
  }, []);

  return (
    <div className="page space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Recent events across your services."
      />

      {error && <p style={{ color: "var(--err)" }} className="text-sm">{error}</p>}

      {events === null && !error ? (
        <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
          <Spinner /> Loading…
        </div>
      ) : events?.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Events will appear here as you deploy and manage services."
        />
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {events?.map((ev) => (
              <li key={ev.id} className="flex items-start gap-3 px-4 py-3">
                {/* colored dot */}
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: dotColor(ev.action) }}
                />

                <div className="flex-1 min-w-0">
                  {/* action label */}
                  <span className="font-medium text-sm" style={{ color: "var(--text)" }}>
                    {actionLabel(ev.action)}
                  </span>

                  {/* resource */}
                  {ev.resource_type && (
                    <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {ev.resource_type}
                      {ev.resource_uuid ? ` · ${ev.resource_uuid.slice(0, 8)}` : ""}
                    </span>
                  )}

                  {/* actor */}
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {ev.actor_name || ev.actor_email || "system"}
                  </div>
                </div>

                {/* timestamp */}
                <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(ev.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
