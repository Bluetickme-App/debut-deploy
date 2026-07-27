import { useEffect, useState } from "react";
import { X, AlertTriangle, HardDrive, RefreshCw } from "lucide-react";
import { Button, Spinner, Mono } from "./ui.jsx";
import { api } from "../lib/api.js";
import { fmtMinor, fmtBillingDate } from "../lib/money.js";

const SIZE_PRESETS = [1, 5, 10, 20, 50, 100, 250, 500];

// Attaching a disk costs money every month and restarts the service, so it is confirmed
// like a plan change: pick a mount path and a size, see the monthly rate, the pro-rata
// amount for the rest of this cycle and when the full rate starts — then create it.
//
// Before this, "Add Disk" took a path only: no size, no price, and no billing record —
// storage was attached and never charged.
export default function AddDiskModal({ serviceId, onClose, onAdded }) {
  const [path, setPath] = useState("/data");
  const [sizeGb, setSizeGb] = useState(10);
  const [preview, setPreview] = useState(null);
  const [pricing, setPricing] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const validPath = path.trim().startsWith("/") && path.trim().length > 1;
  const validSize = Number.isInteger(sizeGb) && sizeGb >= 1 && sizeGb <= 500;

  // Re-price whenever the size changes — the number in the dialog is always the number
  // the server will charge, never a client-side guess.
  useEffect(() => {
    if (!validSize) { setPreview(null); return; }
    let off = false;
    setPricing(true);
    api.previewServiceVolume(serviceId, { sizeGb, action: "add" })
      .then((p) => { if (!off) { setPreview(p); setErr(null); } })
      .catch((e) => { if (!off) { setPreview(null); setErr(e.message || "Could not price this disk"); } })
      .finally(() => { if (!off) setPricing(false); });
    return () => { off = true; };
  }, [serviceId, sizeGb, validSize]);

  async function confirm() {
    if (!validPath || !validSize || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.addServiceVolume(serviceId, path.trim(), sizeGb);
      onAdded?.(r);
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to add the disk");
      setBusy(false);
    }
  }

  const cur = preview?.currency || "gbp";

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 94vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
            <HardDrive className="h-4 w-4" /> Add persistent disk
          </h3>
          <button onClick={onClose} disabled={busy} title="Close" style={{ color: "var(--text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".04em" }}>Mount path</span>
            <input className="input" style={{ fontFamily: "var(--font-mono, monospace)" }}
                   value={path} onChange={(e) => setPath(e.target.value)} placeholder="/data" disabled={busy} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".04em" }}>Size</span>
            <select className="input" style={{ minWidth: 130 }} value={sizeGb} disabled={busy}
                    onChange={(e) => setSizeGb(Number(e.target.value))}>
              {SIZE_PRESETS.map((g) => <option key={g} value={g}>{g} GB</option>)}
            </select>
          </label>
        </div>
        {!validPath && (
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            Must be an absolute path inside the container, e.g. <Mono>/data</Mono>.
          </p>
        )}

        {/* the cost, straight from the server */}
        <div className="mt-4 rounded-md border px-3.5 py-3"
             style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          {pricing && !preview && (
            <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2 inline" /> Pricing…</p>
          )}
          {preview && (
            <>
              <p className="text-[13px]" style={{ color: "var(--text)" }}>
                <span className="font-bold">{fmtMinor(preview.deltaMinor, cur)}/mo</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {" "}· {preview.sizeGb} GB × {fmtMinor(preview.unit.pricePerGbMinor, cur)}/GB per month
                </span>
              </p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {preview.prorationMinor > 0
                  ? `${fmtMinor(preview.prorationMinor, cur)} now for the remaining ${preview.cycle.daysRemaining} of ${preview.cycle.daysInPeriod} days, then ${fmtMinor(preview.deltaMinor, cur)} every month from ${fmtBillingDate(preview.cycle.end)}.`
                  : `Billed ${fmtMinor(preview.deltaMinor, cur)} every month from ${fmtBillingDate(preview.cycle.end)}.`}
              </p>
              <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                {preview.cycle.mode === "subscription"
                  ? "Added to your subscription — the pro-rata amount appears on your next invoice."
                  : "The pro-rata amount is taken from your account credit now."}
                {" "}Storage total after this: {preview.totals.orgGbAfter} GB.
              </p>
            </>
          )}
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]"
             style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The service redeploys so Docker can mount the disk — expect a short restart.</span>
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]"
             style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Size is the capacity you are billed for. It is a commitment, not a filesystem quota — the volume is not hard-capped on disk.</span>
        </div>

        {err && <p className="mt-3 text-[12.5px]" style={{ color: "var(--err-text)" }}>{err}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!validPath || !validSize || !preview || busy}>
            {busy ? <><Spinner className="mr-2 inline" /> Creating…</>
              : preview ? `Add disk — ${fmtMinor(preview.deltaMinor, cur)}/mo` : "Add disk"}
          </Button>
        </div>
      </div>
    </div>
  );
}
