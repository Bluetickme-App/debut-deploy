import { ArrowRight, Github, Chrome } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { Spinner } from "../components/ui.jsx";

function authLink(path, returnTo = "/") {
  const destination = encodeURIComponent(new URL(returnTo, window.location.origin).href);
  return `${path}?returnTo=${destination}`;
}

// Ambient status motif — three static service rows hinting at the product
function AmbientPanel() {
  const rows = [
    { name: "api-gateway",    status: "running",   pill: "pill-ok",    pulse: false, commit: "a3f9c12" },
    { name: "worker-queue",   status: "building",  pill: "pill-warn",  pulse: true,  commit: "b81e04a" },
    { name: "postgres-main",  status: "healthy",   pill: "pill-ok",    pulse: false, commit: "—" },
  ];

  return (
    <div className="card w-full max-w-sm select-none" style={{ opacity: 0.85 }}>
      <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-muted)", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Live services
      </div>
      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.name} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`pulse-dot flex-shrink-0 ${r.pill === "pill-ok" ? "bg-[var(--ok)]" : r.pill === "pill-warn" ? "bg-[var(--warn)]" : "bg-[var(--text-muted)]"} ${r.pulse ? "is-pulsing" : ""}`}
                style={r.pulse ? { color: "var(--warn)" } : undefined}
              />
              <span className="text-sm truncate" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}>{r.name}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="mono text-xs" style={{ color: "var(--text-muted)" }}>{r.commit}</span>
              <span className={`pill ${r.pill}`}>
                {r.status === "building" ? "Building" : r.status === "running" ? "Running" : "Healthy"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Login() {
  const { loading, user, error } = useAuth();
  const location = useLocation();
  const from = location.state?.from || "/";

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center">
        <div className="inline-flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <Spinner /> Checking session…
        </div>
      </div>
    );
  }

  if (user) return <Navigate to={from} replace />;

  return (
    <div
      className="min-h-full px-6 py-10"
      style={{ background: "var(--bg)" }}
    >
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl items-center gap-12 lg:grid-cols-[1fr_auto]">

        {/* Left: hero copy */}
        <section className="max-w-xl">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-8"
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-muted)",
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: "0.05em",
            }}
          >
            <span className="pulse-dot bg-[var(--ok)]" />
            Hetzner infrastructure · Coolify control plane
          </div>

          <h1
            className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}
          >
            Ship to your<br />own cloud.
          </h1>
          <p className="mt-5 text-lg leading-relaxed" style={{ color: "var(--text-muted)" }}>
            A Render-style control panel for your Coolify on Hetzner —
            full ownership, zero lock-in.
          </p>

          {error && (
            <div
              className="mt-6 rounded-xl p-4 text-sm"
              style={{
                border: "1px solid color-mix(in srgb, var(--err) 30%, transparent)",
                background: "color-mix(in srgb, var(--err) 8%, transparent)",
                color: "var(--err)",
              }}
            >
              {error.message}
            </div>
          )}
        </section>

        {/* Right: sign-in card + ambient panel */}
        <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto lg:mx-0">
          <div className="card w-full" style={{ padding: "1.75rem" }}>
            <p className="label mb-1">Access</p>
            <h2
              className="text-xl font-bold mb-1"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}
            >
              Sign in
            </h2>
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
              OAuth sets a secure session cookie. Your resources only.
            </p>

            <div className="flex flex-col gap-3">
              <a
                href={authLink("/auth/google", from)}
                className="flex items-center justify-between rounded-[8px] px-4 py-3 text-sm font-medium transition"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
              >
                <span className="inline-flex items-center gap-3">
                  <Chrome className="h-4 w-4" style={{ color: "var(--info)" }} />
                  Continue with Google
                </span>
                <ArrowRight className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
              </a>

              <a
                href={authLink("/auth/github", from)}
                className="flex items-center justify-between rounded-[8px] px-4 py-3 text-sm font-medium transition"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
              >
                <span className="inline-flex items-center gap-3">
                  <Github className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
                  Continue with GitHub
                </span>
                <ArrowRight className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
              </a>
            </div>
          </div>

          <AmbientPanel />
        </div>
      </div>
    </div>
  );
}
