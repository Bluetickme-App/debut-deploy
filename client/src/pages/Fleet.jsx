import { useEffect, useState } from "react";
import { Cpu, MemoryStick, HardDrive, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Card, PageHeader, Spinner, StatusPill } from "../components/ui.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

const gb = (b) => (b == null ? "—" : `${(b / 1e9).toFixed(1)} GB`);
const barColor = (v) => (v > 90 ? "var(--err)" : v > 75 ? "var(--warn)" : "var(--ok)");

function Gauge({ icon: Icon, label, pct, sub }) {
  return (
    <Card>
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1"><Icon className="h-4 w-4" /> {label}</span>
        <span style={{ color: "var(--text)" }}>{pct == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct || 0}%`, background: barColor(pct || 0) }} />
      </div>
      {sub && <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </Card>
  );
}

export default function Fleet() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [situations, setSituations] = useState([]);
  // ponytail: single shared dialog avoids N dialog states
  const [dialog, setDialog] = useState(null); // { situation } | null
  const [remBusy, setRemBusy] = useState(false);
  const [remErr, setRemErr] = useState("");

  const load = () => {
    api.fleetOverview().then((d) => { setErr(""); setData(d); }).catch((e) => setErr(e.message || "Failed to load"));
    // ponytail: situations failure is isolated — fleet overview still renders
    api.situations().then((d) => setSituations(d.situations || [])).catch(() => setSituations([]));
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  async function restart(uuid) {
    setBusy(uuid);
    try { await api.restartService(uuid); setTimeout(load, 2000); }
    catch (e) { setErr(e.message || "Restart failed"); }
    finally { setBusy(""); }
  }

  async function remediate() {
    if (!dialog) return;
    setRemBusy(true);
    setRemErr("");
    try {
      await api.remediateSituation(dialog.situation.id);
      setDialog(null);
      load();
    } catch (e) {
      setRemErr(e.message || "Remediation failed");
    } finally {
      setRemBusy(false);
    }
  }

  const h = data?.host;
  return (
    <div className="page space-y-6">
      <PageHeader title="Fleet" subtitle="Host capacity and per-site usage" />
      {err && <p className="text-sm" style={{ color: "var(--err)" }}>{err}</p>}

      {situations.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Situations</div>
          {remErr && <p className="mb-2 text-xs" style={{ color: "var(--err)" }}>{remErr}</p>}
          <div className="space-y-2">
            {situations.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 rounded p-2" style={{ background: "var(--surface-2)" }}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 rounded px-1.5 py-0.5 text-xs font-semibold" style={{
                    background: s.severity === "crit" ? "var(--err)" : "var(--warn)",
                    color: "#fff",
                  }}>{s.severity}</span>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.type}</div>
                    {s.detail && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{s.detail}</div>}
                  </div>
                </div>
                {s.suggested_remediation && (
                  <Button variant="ghost" onClick={() => { setRemErr(""); setDialog({ situation: s }); }}>
                    Apply fix
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {!data ? (
        <div className="flex h-40 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}><Spinner /> Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Gauge icon={Cpu} label="CPU" pct={h.cpu} />
            <Gauge icon={MemoryStick} label="RAM" pct={h.mem.pct} sub={`${gb(h.mem.used)} / ${gb(h.mem.total)}`} />
            <Gauge icon={HardDrive} label="Root disk" pct={h.diskRoot.pct} sub={`${gb(h.diskRoot.used)} / ${gb(h.diskRoot.total)}`} />
            {h.diskVolume && <Gauge icon={HardDrive} label="Docker volume" pct={h.diskVolume.pct} sub={`${gb(h.diskVolume.used)} / ${gb(h.diskVolume.total)}`} />}
          </div>

          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs">
                  <th className="p-2">Site</th><th className="p-2">Status</th><th className="p-2">CPU</th>
                  <th className="p-2">Memory</th><th className="p-2">Disk</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {/* ponytail: sort by disk desc — highest consumers first */}
                {[...data.sites].sort((a, b) => (b.disk_bytes || 0) - (a.disk_bytes || 0)).map((s) => (
                  <tr key={s.uuid} style={{ borderTop: "1px solid var(--surface-2)" }}>
                    <td className="p-2" style={{ color: "var(--text)" }}>{s.name || s.uuid}</td>
                    <td className="p-2">{s.status ? <StatusPill status={s.status} /> : "—"}</td>
                    <td className="p-2">{s.cpu_pct != null ? `${s.cpu_pct}%` : "—"}</td>
                    <td className="p-2">{gb(s.mem_bytes)}{s.mem_pct != null ? ` (${s.mem_pct}%)` : ""}</td>
                    <td className="p-2">{gb(s.disk_bytes)}</td>
                    <td className="p-2 text-right">
                      <Button variant="ghost" disabled={busy === s.uuid} onClick={() => restart(s.uuid)}>
                        {busy === s.uuid ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} Restart
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={!!dialog}
        title="Apply fix?"
        message={dialog ? `Run suggested remediation "${dialog.situation.suggested_remediation}" for ${dialog.situation.type}${dialog.situation.target ? ` on ${dialog.situation.target}` : ""}?` : ""}
        confirmLabel="Apply fix"
        busy={remBusy}
        onConfirm={remediate}
        onCancel={() => { setDialog(null); setRemErr(""); }}
      />
    </div>
  );
}
