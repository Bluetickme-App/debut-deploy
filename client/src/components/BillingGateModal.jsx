import { useState } from "react";
import { Button } from "./ui.jsx";
import { api } from "../lib/api.js";

// Shown when a deploy is blocked by the billing gate (HTTP 402). Maps the server `code` to the
// exact action that clears it: assign a plan, start the subscription, or top up credit. Stripe
// actions open Checkout/portal in a new tab, then close the modal.
export default function BillingGateModal({ gate, onClose, onGoToSettings }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const openCheckout = async (fn) => {
    setBusy(true); setErr(null);
    try {
      const { url } = await fn();
      if (url) window.open(url, "_blank", "noopener");
      onClose();
    } catch (e) { setErr(e?.message || "Something went wrong"); setBusy(false); }
  };

  const config = {
    plan_required: {
      title: "Choose a plan first",
      body: "This service has no plan assigned, so it can't be billed or deployed. Pick a plan under Settings → Scale, then deploy.",
      actions: [{ label: "Go to plan settings", primary: true, onClick: () => { onClose(); onGoToSettings?.(); } }],
    },
    billing_setup_required: {
      title: "Set up billing to deploy",
      body: "Add a card and start your monthly subscription. We'll also seed £25 of usage credit for anything beyond your plan.",
      actions: [
        { label: "Start subscription", primary: true, onClick: () => openCheckout(api.startMySubscription) },
        { label: "Add £25 credit", onClick: () => openCheckout(() => api.topup(2500)) },
      ],
    },
    account_suspended: {
      title: "Account suspended",
      body: "This account is suspended for non-payment. Settle the balance to resume deploys.",
      actions: [
        { label: "Add £25 credit", primary: true, onClick: () => openCheckout(() => api.topup(2500)) },
        { label: "Billing portal", onClick: () => openCheckout(api.billingPortal) },
      ],
    },
  };
  const c = config[gate.code] || { title: "Billing setup required", body: gate.message, actions: [] };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(470px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{c.title}</h3>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)", marginTop: 8 }}>{c.body}</p>
        {err && <p style={{ fontSize: 12.5, color: "var(--err-text)", marginTop: 10 }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          {c.actions.map((a) => (
            <Button key={a.label} variant={a.primary ? "primary" : "secondary"} disabled={busy} onClick={a.onClick}>
              {busy && a.primary ? "Opening…" : a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
