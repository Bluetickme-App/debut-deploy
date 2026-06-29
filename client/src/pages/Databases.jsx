import { useEffect, useState } from "react";
import { Database, Server, Cpu, MemoryStick, HardDrive, Plus, Play, Square, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { StatusBadge, Spinner } from "../components/ui.jsx";
import { useAuth } from "../auth.jsx";

const DB_LABEL = {
  postgresql: "PostgreSQL",
  redis: "Redis / Valkey",
  mysql: "MySQL",
  mongodb: "MongoDB",
};

async function dbAction(uuid, action) {
  return fetch(`/api/databases/${uuid}/${action}`, {
    method: action === "delete" ? "DELETE" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
}

export default function Databases() {
  const [dbs, setDbs] = useState(null);
  const [servers, setServers] = useState(null);
  const [busy, setBusy] = useState({});
  const { user } = useAuth();

  useEffect(() => {
    api.databases().then(setDbs).catch(() => setDbs([]));
    if (user?.role === "admin") {
      api.servers().then(setServers).catch(() => setServers([]));
    } else {
      setServers([]);
    }
  }, [user]);

  async function handleAction(uuid, action) {
    if (action === "delete" && !window.confirm("Delete this database? This cannot be undone.")) return;
    setBusy((b) => ({ ...b, [uuid]: action }));
    try {
      await dbAction(uuid, action);
      api.databases().then(setDbs).catch(() => {});
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[uuid]; return n; });
    }
  }

  if (!dbs || servers === null) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">
        <Spinner className="mr-2" /> Loading...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Infrastructure</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {user?.role === "admin" ? `${servers.length} Hetzner servers · ` : ""}
            {dbs.length} databases
          </p>
        </div>
        <Link
          to="/new-database"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" /> New Database
        </Link>
      </div>

      {user?.role === "admin" && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {servers.map((s) => (
            <div key={s.uuid} className="rounded-xl border border-white/8 bg-[#13161d] p-5">
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 text-zinc-400" />
                <div className="flex-1">
                  <div className="font-medium text-zinc-100">{s.name}</div>
                  <div className="text-xs text-zinc-500">
                    {s.region} · {s.ip} {s.spec && `· ${s.spec}`}
                  </div>
                </div>
                <StatusBadge status={s.reachable ? "running" : "stopped"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Meter icon={Cpu} label="CPU" value={s.cpu} />
                <Meter icon={MemoryStick} label="RAM" value={s.memory} />
                <Meter icon={HardDrive} label="Disk" value={s.disk} />
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Databases
      </h2>
      <div className="overflow-hidden rounded-xl border border-white/8 bg-[#13161d]">
        {dbs.map((d, i) => (
          <div key={d.uuid} className={`px-4 py-4 ${i !== 0 ? "border-t border-white/6" : ""}`}>
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-zinc-400" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-100">{d.name}</span>
                  <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {DB_LABEL[d.type] || d.type} {d.version}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-xs text-zinc-500">{d.internalUrl}</div>
              </div>
              <div className="text-right text-xs text-zinc-500">
                {d.sizeMb != null && <div>{(d.sizeMb / 1024).toFixed(1)} GB</div>}
                {d.connections != null && <div>{d.connections} conns</div>}
              </div>
              <StatusBadge status={d.status} />
              <div className="flex items-center gap-1 ml-2">
                {busy[d.uuid] ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <>
                    {d.status === "stopped" ? (
                      <button onClick={() => handleAction(d.uuid, "start")} title="Start" className="rounded p-1 text-zinc-400 hover:bg-white/8 hover:text-emerald-300">
                        <Play className="h-4 w-4" />
                      </button>
                    ) : (
                      <button onClick={() => handleAction(d.uuid, "stop")} title="Stop" className="rounded p-1 text-zinc-400 hover:bg-white/8 hover:text-amber-300">
                        <Square className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => handleAction(d.uuid, "delete")} title="Delete" className="rounded p-1 text-zinc-400 hover:bg-white/8 hover:text-rose-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
            {d.logicalDbs?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-8">
                {d.logicalDbs.map((name) => (
                  <span
                    key={name}
                    className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-400"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Meter({ icon: Icon, label, value }) {
  const v = value ?? 0;
  const color = v > 85 ? "bg-rose-500" : v > 65 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="text-zinc-300">{value != null ? `${v}%` : "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
