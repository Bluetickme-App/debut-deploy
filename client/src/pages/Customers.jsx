import { useEffect, useState } from "react";
import { Users, Layers, Database, ShieldCheck } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState, timeAgo } from "../components/ui.jsx";

// Admin view of customers/clients and the resources each owns.
export default function Customers() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.customers()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, []);

  const initials = (u) =>
    (u.name || u.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");

  return (
    <div className="mx-auto max-w-5xl px-7 pb-11 pt-6">
      <PageHeader title="Customers" subtitle="Everyone with access, and what each one owns." />

      {error && <p className="text-sm" style={{ color: "var(--err)" }}>Failed to load: {error.message}</p>}
      {!rows && !error && <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>}

      {rows && rows.length === 0 && (
        <EmptyState title="No customers yet" description="Users appear here after they sign in." />
      )}

      {rows && rows.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Services</th>
                <th className="px-4 py-3 font-semibold">Databases</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid place-items-center rounded-full text-[11px] font-semibold"
                        style={{ width: 30, height: 30, background: "linear-gradient(135deg,#6366f1,#2563eb)", color: "#fff" }}
                      >
                        {initials(u)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium truncate" style={{ color: "var(--text)" }}>{u.name || u.email}</div>
                        <div className="mono truncate" style={{ color: "var(--text-muted)", fontSize: 12 }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`pill ${u.role === "admin" ? "pill-accent" : "pill-neutral"}`}>
                      {u.role === "admin" && <ShieldCheck size={12} />}{u.role || "customer"}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text)" }}>
                    <span className="inline-flex items-center gap-1.5"><Layers size={14} style={{ color: "var(--text-muted)" }} /> {u.owned?.applications ?? 0}</span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text)" }}>
                    <span className="inline-flex items-center gap-1.5"><Database size={14} style={{ color: "var(--text-muted)" }} /> {u.owned?.databases ?? 0}</span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{u.created_at ? timeAgo(u.created_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
