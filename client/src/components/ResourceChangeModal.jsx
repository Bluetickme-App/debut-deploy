import { useEffect, useState } from "react";
import { X, AlertTriangle, ArrowRight, Check, RefreshCw } from "lucide-react";
import { Button, Spinner, Mono } from "./ui.jsx";
import { api } from "../lib/api.js";
import { fmtMinor, fmtDelta, fmtBillingDate } from "../lib/money.js";

// Confirm an instance-size change BEFORE it happens: the exact spec it moves between,
// what it costs from now on, what the mid-cycle difference is, when the new rate starts,
// and the fact that the service redeploys (brief downtime) to make the new CPU/RAM real.
//
// Saving used to write limits into Coolify and nothing else — the container kept the old
// CPU/RAM until someone redeployed, and the price never followed the plan. This dialog is
// the confirmation step for the operation that now does both.
export default function ResourceChangeModal({ serviceId, planId = null, cpus, memory, onClose, onApplied }) {
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let off = false;
    api.previewPlanChange(serviceId, { planId, cpus, memory })
      .then((p) => { if (!off) setPreview(p); })
      .catch((e) => { if (!off) setErr(e.message || "Could not price this change"); });
    return () => { off = true; };
  }, [serviceId, planId, cpus, memory]);

  async function confirm() {
    setApplying(true); setErr(null);
    try {
      const r = await api.applyPlanChange(serviceId, { planId, cpus, memory });
      setResult(r);
      onApplied?.(r);
    } catch (e) {
      setErr(e.message || "The change could not be applied");
    } finally { setApplying(false); }
  }

  const cur = preview?.currency || "gbp";
  const cycle = preview?.cycle;
  const proration = preview?.prorationMinor ?? 0;

  return (
    <Shell title={result ? "Change applied" : "Confirm instance change"} onClose={onClose} busy={applying}>
      {!preview && !err && (
        <p className="py-6 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
          <Spinner className="mr-2 inline" /> Pricing this change…
        </p>
      )}

      {preview && !result && (
        <div className="flex flex-col gap-4">
          {/* what the container becomes */}
          <Section label="Instance">
            <div className="flex items-center gap-3">
              <SpecCard title={preview.from.name || "Current"} cpus={preview.from.cpus} memory={preview.from.memory}
                        priceMinor={preview.from.monthlyMinor} currency={cur} />
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
              <SpecCard title={preview.to.name || "New"} cpus={preview.to.cpus} memory={preview.to.memory}
                        priceMinor={preview.to.monthlyMinor} currency={cur} highlight />
            </div>
            <p className="mt-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
              <Mono>{preview.service.name}</Mono> runs on host <Mono>{preview.service.serverUuid?.slice(0, 12) || "default"}</Mono>.
            </p>
          </Section>

          {/* what it costs */}
          <Section label="Billing">
            <Row k="New monthly rate" v={<strong>{fmtMinor(preview.to.monthlyMinor, cur)}/mo</strong>} />
            <Row k="Change vs today" v={fmtDelta(preview.deltaMinor, cur)} />
            {proration !== 0 && (
              <Row
                k={`Pro rata (${cycle.daysRemaining} of ${cycle.daysInPeriod} days left)`}
                v={fmtDelta(proration, cur)}
              />
            )}
            <Row
              k="Billing cycle"
              v={`${fmtMinor(preview.to.monthlyMinor, cur)}/mo from ${fmtBillingDate(cycle.end)}`}
            />
            <p className="mt-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              {cycle.mode === "subscription"
                ? `${proration >= 0 ? "The pro-rata charge" : "The pro-rata credit"} is settled on your next invoice on ${fmtBillingDate(cycle.end)}; Stripe calculates the final figure. Your card is not charged now.`
                : `${proration >= 0 ? "The pro-rata amount is deducted from" : "The pro-rata credit is added to"} your account credit immediately. The full ${fmtMinor(preview.to.monthlyMinor, cur)} is then charged each month from ${fmtBillingDate(cycle.end)}.`}
              {preview.comp?.comp && " This account is comped — nothing will be charged."}
              {preview.comp?.discountPct > 0 && ` A ${preview.comp.discountPct}% discount is already applied to these figures.`}
            </p>
          </Section>

          {/* what it does to the running service */}
          {preview.effects.redeploy && (
            <Callout icon={<RefreshCw className="h-4 w-4" />}>
              <strong>{preview.service.name}</strong> will redeploy now so Docker recreates the container with{" "}
              <Mono>{fmtCpu(preview.to.cpus)}</Mono> and <Mono>{fmtMem(preview.to.memory)}</Mono>. Expect a short
              restart — limits only change when the container is recreated.
            </Callout>
          )}

          {(preview.warnings || []).map((w) => (
            <Callout key={w} warn icon={<AlertTriangle className="h-4 w-4" />}>{w}</Callout>
          ))}
        </div>
      )}

      {result && <Steps result={result} currency={cur} />}

      {err && <p className="mt-3 text-[12.5px]" style={{ color: "var(--err-text)" }}>{err}</p>}

      <div className="mt-5 flex justify-end gap-2">
        {result ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={applying}>Cancel</Button>
            <Button variant="primary" onClick={confirm} disabled={!preview || applying}>
              {applying ? <><Spinner className="mr-2 inline" /> Applying…</>
                : preview?.effects?.redeploy ? "Confirm & redeploy" : "Confirm change"}
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
}

// --- what actually happened, step by step -----------------------------------

const STEP_LABEL = {
  limits: "Container limits updated",
  plan: "Billing plan changed",
  billing: "Billing settled",
  redeploy: "Service redeploying",
};

const SKIP_REASON = {
  plan_required: "not redeployed — an unpriced custom size has no plan, and there is no free tier. Pick a plan to deploy.",
  "limits unchanged": "no redeploy needed — the container limits did not change.",
};

function Steps({ result, currency }) {
  return (
    <div className="flex flex-col gap-2">
      {result.steps.map((s) => (
        <div key={s.step} className="flex items-start gap-2 text-[12.5px]">
          {s.ok
            ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--ok-text)" }} />
            : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--warn)" }} />}
          <span style={{ color: s.ok ? "var(--text)" : "var(--text-muted)" }}>
            {!s.ok && s.detail?.skipped
              ? (SKIP_REASON[s.detail.skipped] || `${STEP_LABEL[s.step] || s.step} — skipped (${s.detail.skipped})`)
              : STEP_LABEL[s.step] || s.step}
            {!s.ok && s.detail?.error && ` — ${s.detail.error}`}
          </span>
        </div>
      ))}
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
        {result.billing?.mode === "subscription"
          ? "Your subscription has been updated; the difference appears on your next invoice."
          : result.billing?.changed
            ? `Account credit adjusted by ${fmtMinor(-(result.billing.prorationMinor ?? 0), currency)}.`
            : "No billing change was needed."}
      </p>
    </div>
  );
}

// --- presentation -----------------------------------------------------------

const fmtCpu = (v) => (v === "0" || v == null ? "shared CPU" : `${v} vCPU`);
const fmtMem = (v) => (v === "0" || v == null ? "no memory limit" : String(v).replace(/M$/, " MB").replace(/G$/, " GB"));

function Shell({ title, children, onClose, busy }) {
  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 94vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{title}</h3>
          <button onClick={onClose} disabled={busy} title="Close" style={{ color: "var(--text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".04em" }}>{label}</p>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <span style={{ color: "var(--text-muted)" }}>{k}</span>
      <span style={{ color: "var(--text)" }}>{v}</span>
    </div>
  );
}

function SpecCard({ title, cpus, memory, priceMinor, currency, highlight = false }) {
  return (
    <div
      className="min-w-0 flex-1 rounded-md border px-3 py-2"
      style={{ borderColor: highlight ? "var(--accent, var(--border))" : "var(--border)", background: "var(--surface-2)" }}
    >
      <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text)" }}>{title}</p>
      <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>{fmtCpu(cpus)} · {fmtMem(memory)}</p>
      <p className="mt-1 text-[12.5px] font-semibold" style={{ color: "var(--text)" }}>
        {priceMinor ? `${fmtMinor(priceMinor, currency)}/mo` : "No billed plan"}
      </p>
    </div>
  );
}

function Callout({ children, icon, warn = false }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]"
      style={{
        borderColor: warn ? "var(--warn)" : "var(--border)",
        background: "var(--surface-2)",
        color: warn ? "var(--text)" : "var(--text-muted)",
      }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: warn ? "var(--warn)" : "var(--text-muted)" }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
