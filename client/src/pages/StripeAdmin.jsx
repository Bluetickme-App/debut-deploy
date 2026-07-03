import { useEffect, useState, useCallback } from "react";
import { CreditCard, RefreshCw, AlertTriangle, Users, Banknote, Wallet, TrendingUp, Server, Repeat, Layers } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner } from "../components/ui.jsx";

// Operator Stripe dashboard: see the live account data and flip test<->live at
// runtime — no Stripe login, no server restart. Keys live in the server env; this
// page only reads data and stores which mode is active. All routes are admin-only.

const SYM = { USD: "$", GBP: "£", EUR: "€" };
const money = (minor, cur) =>
  (SYM[cur] || (cur ? cur + " " : "$")) +
  (Number(minor || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
const eur = (n) => "€" + Number(n || 0).toFixed(2); // Hetzner infra cost is already in euros, not minor units

const FILTERS = [
  { key: "all", label: "All" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
  { key: "refunded", label: "Refunded" },
  { key: "pending", label: "Pending" },
];
const matchFilter = (c, f) =>
  f === "all" ? true : f === "refunded" ? c.refunded : f === "pending" ? c.status === "pending" : (c.status === f && !c.refunded);

function StatusChip({ text, tone }) {
  const c = tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "err" ? "err" : "neutral";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
      color: `var(--${c}-text, var(--text-muted))`, background: `var(--${c}-soft, var(--surface-2))`,
      border: "1px solid var(--border)", whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

export default function StripeAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);

  async function syncCatalog() {
    if (syncing) return;
    setSyncing(true);
    try { await api.syncStripeCatalog(); load(); }
    catch (e) { setError(e); }
    finally { setSyncing(false); }
  }

  const load = useCallback(() => {
    setLoading(true);
    api.stripeOverview()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function switchMode(mode) {
    if (!data || busy || data.mode === mode || !data.available?.[mode]) return;
    if (mode === "live" && !window.confirm("Switch Stripe to LIVE mode?\n\nReal customer cards will be charged and real payouts will apply.")) return;
    setBusy(true);
    try { await api.setStripeMode(mode); load(); }
    catch (e) { setError(e); setBusy(false); }
    finally { setBusy(false); }
  }

  if (loading && !data) {
    return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading Stripe…</div>;
  }
  if (error && !data) {
    return <div className="page"><Card><p style={{ color: "var(--err-text)" }}>Failed to load Stripe: {error.message}</p></Card></div>;
  }

  const live = data.mode === "live";
  const modeBtn = (mode, label) => {
    const active = data.mode === mode;
    const avail = data.available?.[mode];
    return (
      <button
        onClick={() => switchMode(mode)}
        disabled={!avail || busy || active}
        title={!avail ? `No ${mode}-mode key configured (set STRIPE_SECRET_KEY_${mode.toUpperCase()} in the server env)` : ""}
        style={{
          fontSize: 13, fontWeight: 600, padding: "6px 16px", borderRadius: 999, border: "none",
          cursor: !avail || active ? "default" : "pointer", transition: ".15s",
          background: active ? (mode === "live" ? "var(--err-text,#dc2626)" : "var(--ink,#111)") : "transparent",
          color: active ? "#fff" : avail ? "var(--text-muted)" : "var(--text-muted)",
          opacity: !avail ? 0.4 : 1,
        }}
      >{label}</button>
    );
  };

  return (
    <div className="page">
      <PageHeader title="Stripe" subtitle="Your Stripe account, without leaving the panel — flip test/live in one click." />

      {/* Mode switch */}
      <Card className="mb-6">
        <div className="flex items-center justify-between gap-4" style={{ flexWrap: "wrap" }}>
          <div className="flex items-center gap-3">
            <CreditCard size={18} style={{ color: "var(--text-muted)" }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {data.account?.name || "Stripe account"}
                {data.mode && <span className="mono" style={{ marginLeft: 8 }}><StatusChip text={live ? "LIVE" : "TEST"} tone={live ? "err" : "warn"} /></span>}
              </div>
              <div className="mono text-xs" style={{ color: "var(--text-muted)", marginTop: 3 }}>
                {data.keyHint || "no key"}{data.account?.country ? ` · ${data.account.country}` : ""}
                {data.account && ` · charges ${data.account.charges_enabled ? "on" : "off"} · payouts ${data.account.payouts_enabled ? "on" : "off"}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div style={{ display: "flex", gap: 3, background: "var(--surface-2)", borderRadius: 999, padding: 3, border: "1px solid var(--border)" }}>
              {modeBtn("test", "Test")}
              {modeBtn("live", "Live")}
            </div>
            <button onClick={load} disabled={busy || loading} title="Refresh"
              style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {live && (
          <div className="flex items-center gap-2 mt-3" style={{ fontSize: 12.5, color: "var(--err-text,#b91c1c)", background: "var(--err-soft,#fef2f2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
            <AlertTriangle size={15} /> Live mode — real money. Payments and payouts below are your production Stripe account.
          </div>
        )}
      </Card>

      {!data.configured ? (
        <Card>
          <div className="text-sm" style={{ color: "var(--text)" }}>
            <b>No Stripe key for {data.mode} mode.</b>
            <p style={{ color: "var(--text-muted)", marginTop: 8 }}>
              Add the key to the server environment and it appears here — no code change:
            </p>
            <pre className="mono" style={{ marginTop: 8, padding: 12, background: "var(--surface-2)", borderRadius: 8, fontSize: 12, overflowX: "auto" }}>{`STRIPE_SECRET_KEY_TEST=sk_test_...
STRIPE_SECRET_KEY_LIVE=sk_live_...
STRIPE_WEBHOOK_SECRET_TEST=whsec_...
STRIPE_WEBHOOK_SECRET_LIVE=whsec_...`}</pre>
            <p style={{ color: "var(--text-muted)", marginTop: 8 }}>The Test/Live switch above enables each side once its key is present.</p>
          </div>
        </Card>
      ) : (
        <>
          {/* Revenue vs cost + counts */}
          <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
            <Card>
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}><Wallet size={14} /> Available balance</div>
              <div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
                {data.balance?.available?.length ? data.balance.available.map((b) => money(b.amount, b.currency)).join(" · ") : "—"}
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                pending {data.balance?.pending?.length ? data.balance.pending.map((b) => money(b.amount, b.currency)).join(" · ") : money(0, "USD")}
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}><TrendingUp size={14} /> Recurring / mo</div>
              <div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
                {data.mrr?.length ? data.mrr.map((m) => money(m.amount, m.currency)).join(" · ") : money(0, "GBP")}
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{data.counts?.active_subs ?? 0} active subscription{(data.counts?.active_subs ?? 0) === 1 ? "" : "s"}</div>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}><Server size={14} /> Infra cost / mo</div>
              <div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>{data.infra ? eur(data.infra.monthlyEur) : "—"}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{data.infra ? `${data.infra.servers} server${data.infra.servers === 1 ? "" : "s"} · live from Hetzner` : "Hetzner not configured"}</div>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}><CreditCard size={14} /> Payments</div>
              <div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts?.charges ?? 0}</div>
              <div className="text-xs mt-1" style={{ color: (data.counts?.failed ? "var(--err-text,#b91c1c)" : "var(--text-muted)") }}>{data.counts?.failed ?? 0} failed</div>
            </Card>
            <Card><div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}><Users size={14} /> Customers</div><div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts?.customers ?? 0}</div></Card>
            <Card><div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}><Banknote size={14} /> Payouts</div><div className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts?.payouts ?? 0}</div></Card>
          </div>

          {/* Plan catalog — the Stripe Products/Prices subscriptions bill against */}
          <div className="flex items-center justify-between mb-3" style={{ flexWrap: "wrap", gap: 8 }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
              <Layers size={16} /> Plan catalog
              <span style={{ fontWeight: 400, fontSize: 12.5, color: "var(--text-muted)" }}>· {data.catalog?.configured ? "ready" : "not created"} in {data.mode} mode</span>
            </div>
            <button onClick={syncCatalog} disabled={syncing} className="btn"
              style={{ fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", cursor: syncing ? "default" : "pointer", background: "var(--ink,#111)", color: "#fff", opacity: syncing ? 0.6 : 1 }}>
              {syncing ? "Syncing…" : data.catalog?.configured ? "Re-sync prices" : "Create prices"}
            </button>
          </div>
          <Card className="mb-6">
            <div style={{ overflowX: "auto" }}>
              <table className="w-full text-sm" style={{ minWidth: 480, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th className="py-2 pr-4 font-semibold">Plan</th><th className="py-2 pr-4 font-semibold">GBP / mo</th><th className="py-2 font-semibold">USD / mo</th>
                </tr></thead>
                <tbody>
                  {(data.catalog?.plans || []).map((p) => {
                    const cell = (c, cur) => (
                      <span className="flex items-center gap-2">
                        <span className="mono" style={{ color: "var(--text)" }}>{money(c.current, cur)}</span>
                        {c.priceId
                          ? <StatusChip text={c.upToDate ? "synced" : "price changed"} tone={c.upToDate ? "ok" : "warn"} />
                          : <StatusChip text="not created" tone="neutral" />}
                      </span>
                    );
                    return (
                      <tr key={p.plan} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="py-2 pr-4 font-semibold" style={{ color: "var(--text)" }}>{p.name}</td>
                        <td className="py-2 pr-4">{cell(p.gbp, "GBP")}</td>
                        <td className="py-2">{cell(p.usd, "USD")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Payments — with client link + status filters */}
          <div className="flex items-center justify-between mb-3" style={{ flexWrap: "wrap", gap: 8 }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}><CreditCard size={16} /> Payments</div>
            <div style={{ display: "flex", gap: 3, background: "var(--surface-2)", borderRadius: 999, padding: 3, border: "1px solid var(--border)" }}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const n = f.key === "all" ? (data.charges?.length ?? 0) : (data.charges || []).filter((c) => matchFilter(c, f.key)).length;
                return (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    style={{
                      fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, border: "none", cursor: "pointer",
                      background: active ? (f.key === "failed" ? "var(--err-text,#dc2626)" : "var(--ink,#111)") : "transparent",
                      color: active ? "#fff" : "var(--text-muted)",
                    }}>{f.label}{n ? ` ${n}` : ""}</button>
                );
              })}
            </div>
          </div>
          <Card className="mb-6">
            <div style={{ overflowX: "auto" }}>
              <table className="w-full text-sm" style={{ minWidth: 720, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th className="py-2 pr-4 font-semibold">Amount</th><th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">Client</th><th className="py-2 pr-4 font-semibold">Email</th>
                  <th className="py-2 pr-4 font-semibold">Detail</th><th className="py-2 font-semibold">When</th>
                </tr></thead>
                <tbody>
                  {(() => {
                    const shown = (data.charges || []).filter((c) => matchFilter(c, filter));
                    return shown.length ? shown.map((c) => (
                      <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="py-2 pr-4 mono font-semibold" style={{ color: "var(--text)" }}>{money(c.amount, c.currency)}</td>
                        <td className="py-2 pr-4"><StatusChip text={c.refunded ? "refunded" : c.status} tone={c.refunded ? "warn" : c.status === "succeeded" ? "ok" : c.status === "failed" ? "err" : "neutral"} /></td>
                        <td className="py-2 pr-4" style={{ color: c.client ? "var(--accent-text)" : "var(--text-muted)", fontWeight: c.client ? 600 : 400 }}>{c.client ? c.client.orgName : "unlinked"}</td>
                        <td className="py-2 pr-4 mono text-xs" style={{ color: "var(--text-muted)" }}>{c.email || "—"}</td>
                        <td className="py-2 pr-4" style={{ color: c.failure ? "var(--err-text,#b91c1c)" : "var(--text-muted)" }}>{c.failure || c.description || "—"}</td>
                        <td className="py-2 mono text-xs" style={{ color: "var(--text-muted)" }}>{when(c.created)}</td>
                      </tr>
                    )) : <tr><td colSpan={6} className="py-4 text-center" style={{ color: "var(--text-muted)" }}>No {filter === "all" ? "" : filter + " "}payments in {data.mode} mode.</td></tr>;
                  })()}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Subscriptions — monthly services + usage credits */}
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold" style={{ color: "var(--text)" }}><Repeat size={16} /> Subscriptions</div>
          <Card className="mb-6">
            <div style={{ overflowX: "auto" }}>
              <table className="w-full text-sm" style={{ minWidth: 640, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th className="py-2 pr-4 font-semibold">Client</th><th className="py-2 pr-4 font-semibold">Monthly</th>
                  <th className="py-2 pr-4 font-semibold">Status</th><th className="py-2 pr-4 font-semibold">Email</th>
                  <th className="py-2 font-semibold">Renews</th>
                </tr></thead>
                <tbody>
                  {data.subscriptions?.length ? data.subscriptions.map((s) => (
                    <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="py-2 pr-4" style={{ color: s.client ? "var(--accent-text)" : "var(--text-muted)", fontWeight: s.client ? 600 : 400 }}>{s.client ? s.client.orgName : "unlinked"}</td>
                      <td className="py-2 pr-4 mono font-semibold" style={{ color: "var(--text)" }}>{money(s.monthly, s.currency)}<span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>/mo</span></td>
                      <td className="py-2 pr-4"><StatusChip text={s.status} tone={s.status === "active" || s.status === "trialing" ? "ok" : s.status === "past_due" || s.status === "unpaid" ? "err" : "neutral"} /></td>
                      <td className="py-2 pr-4 mono text-xs" style={{ color: "var(--text-muted)" }}>{s.email || "—"}</td>
                      <td className="py-2 mono text-xs" style={{ color: "var(--text-muted)" }}>{when(s.current_period_end).split(",")[0]}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="py-4 text-center" style={{ color: "var(--text-muted)" }}>No subscriptions yet. Recurring monthly-service plans + usage credits appear here once set up.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Customers + Payouts side by side */}
          <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
            <div>
              <div className="flex items-center gap-2 mb-3 text-sm font-semibold" style={{ color: "var(--text)" }}><Users size={16} /> Customers</div>
              <Card>
                {data.customers?.length ? data.customers.map((c) => (
                  <div key={c.id} className="flex items-center justify-between" style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                    <div><div className="text-sm" style={{ color: "var(--text)" }}>{c.email || c.name || c.id}</div><div className="text-xs" style={{ color: c.client ? "var(--accent-text)" : "var(--text-muted)" }}>{c.client ? c.client.orgName : c.id}</div></div>
                    <div className="mono text-xs" style={{ color: "var(--text-muted)" }}>{when(c.created).split(",")[0]}</div>
                  </div>
                )) : <div className="text-sm py-2" style={{ color: "var(--text-muted)" }}>No customers in {data.mode} mode.</div>}
              </Card>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3 text-sm font-semibold" style={{ color: "var(--text)" }}><Banknote size={16} /> Payouts</div>
              <Card>
                {data.payouts?.length ? data.payouts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between" style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                    <div><div className="text-sm mono font-semibold" style={{ color: "var(--text)" }}>{money(p.amount, p.currency)}</div><div className="mono text-xs" style={{ color: "var(--text-muted)" }}>arrives {when(p.arrival).split(",")[0]}</div></div>
                    <StatusChip text={p.status} tone={p.status === "paid" ? "ok" : p.status === "failed" ? "err" : "neutral"} />
                  </div>
                )) : <div className="text-sm py-2" style={{ color: "var(--text-muted)" }}>No payouts in {data.mode} mode.</div>}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
