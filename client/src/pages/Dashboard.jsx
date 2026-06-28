import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket, Plus, ChevronRight } from "lucide-react";
import { api } from "../lib/api.js";
import { StatusBadge, Spinner, Button, timeAgo, RuntimeIcon } from "../components/ui.jsx";

export default function Dashboard() {
  const [services, setServices] = useState(null);
  const [deploying, setDeploying] = useState({});
  const nav = useNavigate();

  useEffect(() => {
    api.services().then(setServices).catch(() => setServices([]));
  }, []);

  const groups = useMemo(() => {
    if (!services) return [];
    const map = {};
    for (const s of services) (map[s.group] ||= []).push(s);
    return Object.entries(map);
  }, [services]);

  const counts = useMemo(() => {
    if (!services) return { total: 0, live: 0, issues: 0 };
    return {
      total: services.length,
      live: services.filter((s) => s.status === "running").length,
      issues: services.filter((s) => ["degraded", "failed", "stopped"].includes(s.status || s.health)).length,
    };
  }, [services]);

  async function quickDeploy(e, id) {
    e.stopPropagation();
    setDeploying((d) => ({ ...d, [id]: true }));
    try {
      await api.deploy(id);
    } finally {
      setTimeout(() => setDeploying((d) => ({ ...d, [id]: false })), 1200);
    }
  }

  if (!services) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">
        <Spinner className="mr-2" /> Loading services…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Services</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {counts.total} services · <span className="text-emerald-400">{counts.live} live</span>
            {counts.issues > 0 && (
              <>
                {" "}
                · <span className="text-amber-400">{counts.issues} need attention</span>
              </>
            )}
          </p>
        </div>
        <Button variant="primary">
          <Plus className="h-4 w-4" /> New Service
        </Button>
      </div>

      <div className="mt-8 space-y-8">
        {groups.map(([group, items]) => (
          <section key={group}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {group}
            </h2>
            <div className="overflow-hidden rounded-xl border border-white/8 bg-[#13161d]">
              {items.map((s, i) => (
                <div
                  key={s.uuid}
                  onClick={() => nav(`/services/${s.uuid}`)}
                  className={`group flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-white/[0.03] ${
                    i !== 0 ? "border-t border-white/6" : ""
                  }`}
                >
                  <RuntimeIcon runtime={s.runtime} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-zinc-100">{s.name}</span>
                      <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                        {s.type}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {s.repo} · {s.branch}
                      {s.domain && <span className="text-zinc-400"> · {s.domain}</span>}
                    </div>
                  </div>
                  <div className="hidden w-28 text-xs text-zinc-500 sm:block">
                    {timeAgo(s.lastDeployedAt)}
                  </div>
                  <div className="w-24">
                    <StatusBadge status={s.status} />
                  </div>
                  <Button
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => quickDeploy(e, s.uuid)}
                    disabled={deploying[s.uuid]}
                  >
                    {deploying[s.uuid] ? <Spinner /> : <Rocket className="h-4 w-4" />}
                    Deploy
                  </Button>
                  <ChevronRight className="h-4 w-4 text-zinc-600" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
