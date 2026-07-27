import { useEffect, useState } from "react";
import { Server, Cpu, MemoryStick, HardDrive, Plus, CheckCircle, XCircle, Loader } from "lucide-react";
import { api } from "../lib/api.js";
import {
  Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, StatusPill,
} from "../components/ui.jsx";

export default function Servers() {
  const [servers, setServers]       = useState(null);
  const [serverTypes, setServerTypes] = useState([]);
  const [locations, setLocations]   = useState([]);
  const [loadErr, setLoadErr]       = useState("");

  // form state
  const [name, setName]         = useState("");
  const [serverType, setServerType] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState(null); // { serverUuid, ip, status, steps }
  const [formErr, setFormErr]   = useState("");

  useEffect(() => {
    api.servers()
      .then(setServers)
      .catch((e) => { setLoadErr(e.message || "Failed to load servers"); setServers([]); });
    api.hetznerServerTypes()
      .then((types) => { setServerTypes(types); if (types[0]) setServerType(types[0].name); })
      .catch(() => {});
    api.hetznerLocations()
      .then((locs) => { setLocations(locs); if (locs[0]) setLocation(locs[0].name); })
      .catch(() => {});
  }, []);

  async function provision(e) {
    e.preventDefault();
    if (!name.trim() || !serverType) return;
    setBusy(true); setFormErr(""); setResult(null);
    try {
      const res = await api.provisionServer({ name: name.trim(), serverType, location });
      setResult(res);
      setName("");
      // refresh list
      api.servers().then(setServers).catch(() => {});
    } catch (err) {
      setFormErr(err.message || "Provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page space-y-8">
      <PageHeader
        title="Servers"
        subtitle={servers ? `${servers.length} server${servers.length !== 1 ? "s" : ""} running your workloads` : undefined}
      />
      {/* This list is the servers the deployment layer manages — nothing else. A standalone
          box (the mail server, say) is real infrastructure but isn't orchestrated here, so
          its absence is expected rather than a sign something is missing. */}
      <p className="text-xs -mt-4" style={{ color: "var(--text-muted)" }}>
        Servers that run deployed services. Standalone infrastructure that isn&apos;t orchestrated
        here — such as the mail server — is managed separately and won&apos;t appear.
      </p>

      {/* Server list */}
      {loadErr && <p className="text-sm" style={{ color: "var(--err)" }}>{loadErr}</p>}

      {servers === null ? (
        <div className="flex h-40 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
          <Spinner /> Loading…
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          title="No servers yet"
          description="Provision a Hetzner server below to get started."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {servers.map((s) => (
            <Card key={s.uuid || s.id || s.name}>
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 shrink-0" style={{ color: "var(--text-muted)" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate" style={{ color: "var(--text)" }}>{s.name}</span>
                    {/* The orchestrator names its own host "localhost" — say what it actually is. */}
                    {s.isHost && (
                      <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase"
                        style={{ color: "var(--accent, #6ea8ff)", background: "var(--surface-2)", letterSpacing: ".03em" }}
                        title="Runs the deployment control plane as well as your services">
                        primary
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {[s.ip, s.region, s.spec].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {s.resourceCount != null ? `${s.resourceCount} resource${s.resourceCount === 1 ? "" : "s"} deployed` : ""}
                    {s.usable === false ? " · not accepting deploys" : ""}
                  </div>
                </div>
                <StatusPill status={s.reachable ? "running" : (s.status || "stopped")} />
              </div>
              {(s.cpu != null || s.memory != null || s.disk != null) && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Meter icon={Cpu}         label="CPU"  value={s.cpu}    />
                  <Meter icon={MemoryStick} label="RAM"  value={s.memory} />
                  <Meter icon={HardDrive}   label="Disk" value={s.disk}   />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Provision form */}
      <div>
        <p className="label mb-3">Provision new server</p>
        <Card>
          <form onSubmit={provision} className="p-4 space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <Field label="Name" className="flex-1 min-w-[10rem]">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-server-01"
                  required
                />
              </Field>

              <Field label="Server type" className="flex-1 min-w-[12rem]">
                <Select value={serverType} onChange={(e) => setServerType(e.target.value)} disabled={serverTypes.length === 0}>
                  {serverTypes.length === 0
                    ? <option value="">Loading…</option>
                    : serverTypes.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}{t.cores ? ` — ${t.cores} vCPU` : ""}{t.memory ? `, ${t.memory} GB RAM` : ""}{t.disk ? `, ${t.disk} GB` : ""}
                        </option>
                      ))
                  }
                </Select>
              </Field>

              {locations.length > 0 && (
                <Field label="Location" className="flex-1 min-w-[10rem]">
                  <Select value={location} onChange={(e) => setLocation(e.target.value)}>
                    {locations.map((l) => (
                      <option key={l.name} value={l.name}>
                        {l.city ? `${l.city} (${l.name})` : l.name}{l.country ? ` · ${l.country}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Button type="submit" disabled={busy || !name.trim() || !serverType}>
                {busy ? <Spinner /> : <Plus className="h-4 w-4" />} Provision
              </Button>
            </div>

            {formErr && <p className="text-sm" style={{ color: "var(--err)" }}>{formErr}</p>}
          </form>

          {/* Steps progress */}
          {busy && !result && (
            <div className="px-4 pb-4">
              <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <Spinner /> Provisioning…
              </div>
            </div>
          )}

          {result && (
            <div className="px-4 pb-4 space-y-3">
              <div className="text-sm font-medium" style={{ color: "var(--ok)" }}>
                Server provisioned — IP: {result.ip || "—"} · UUID: {result.serverUuid || "—"}
              </div>

              {result.steps?.length > 0 && (
                <ul className="space-y-1">
                  {result.steps.map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      <StepIcon status={s.status} />
                      <span style={{ color: "var(--text)" }}>{s.step}</span>
                      {s.detail && <span>— {typeof s.detail === "string" ? s.detail : Object.values(s.detail).join(" ")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StepIcon({ status }) {
  if (status === "done" || status === "success") return <CheckCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--ok)" }} />;
  if (status === "error" || status === "failed") return <XCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--err)" }} />;
  return <Loader className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: "var(--warn)" }} />;
}

function Meter({ icon: Icon, label, value }) {
  const v = value ?? 0;
  const color = v > 85 ? "var(--err)" : v > 65 ? "var(--warn)" : "var(--ok)";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" /> {label}</span>
        <span style={{ color: "var(--text)" }}>{value != null ? `${v}%` : "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}
