import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { Spinner } from "../components/ui.jsx";

function authLink(path, returnTo = "/") {
  const destination = encodeURIComponent(new URL(returnTo, window.location.origin).href);
  return `${path}?returnTo=${destination}`;
}

// Brand-exact 4-color Google G
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
    </svg>
  );
}

// Brand-exact GitHub octocat mark
function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.87.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/>
    </svg>
  );
}

// Right brand panel — fixed gradient, both themes
function BrandPanel() {
  return (
    <div
      style={{
        width: "52%",
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
        background: "radial-gradient(130% 120% at 18% 12%, #4f8cff 0%, #2545c4 42%, #161a4a 78%, #0b0e2e 100%)",
      }}
    >
      {/* Masked grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "radial-gradient(90% 80% at 60% 30%, #000 30%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(90% 80% at 60% 30%, #000 30%, transparent 80%)",
        }}
      />
      {/* Ambient glow blob */}
      <div
        style={{
          position: "absolute",
          width: 340,
          height: 340,
          borderRadius: "50%",
          right: -90,
          bottom: -110,
          background: "radial-gradient(circle, rgba(120,170,255,.45), transparent 70%)",
          filter: "blur(20px)",
        }}
      />

      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "56px 56px 56px 52px",
          color: "#fff",
        }}
      >
        <h2
          style={{
            margin: "0 0 16px",
            fontFamily: "'Inter', sans-serif",
            fontSize: 34,
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: "-0.015em",
            maxWidth: 420,
          }}
        >
          Ship to your own cloud, on your own terms.
        </h2>
        <p
          style={{
            margin: "0 0 36px",
            fontSize: 15,
            lineHeight: 1.6,
            color: "rgba(255,255,255,.78)",
            maxWidth: 400,
          }}
        >
          A Render-style control panel for apps and databases — running on infrastructure you own and control.
        </p>

        {/* Frosted-glass floating service card */}
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: 14,
            width: 312,
            padding: 18,
            borderRadius: 8,
            background: "rgba(255,255,255,.1)",
            border: "1px solid rgba(255,255,255,.2)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 24px 50px -16px rgba(0,0,0,.5)",
            animation: "dd-float 6s ease-in-out infinite",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>api-gateway</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 9px",
                borderRadius: 999,
                background: "rgba(34,197,94,.22)",
                color: "#aef0c4",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d77a", display: "inline-block" }} />
              running · healthy
            </span>
          </div>
          <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, color: "rgba(255,255,255,.8)" }}>
            api.mflh.io
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,.16)" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: "rgba(255,255,255,.65)" }}>
            <span>debutweb/mflh-api · main</span>
            <span>7m ago</span>
          </div>
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: 9, marginTop: 30 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 13px",
              borderRadius: 999,
              background: "rgba(255,255,255,.12)",
              border: "1px solid rgba(255,255,255,.18)",
              fontSize: 12.5,
              fontWeight: 500,
            }}
          >
            {/* GitHub icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2c-3.34.72-4.04-1.62-4.04-1.62-.55-1.38-1.34-1.75-1.34-1.75-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.87.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/>
            </svg>
            GitHub-native
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 13px",
              borderRadius: 999,
              background: "rgba(255,255,255,.12)",
              border: "1px solid rgba(255,255,255,.18)",
              fontSize: 12.5,
              fontWeight: 500,
            }}
          >
            {/* Shield icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>
            </svg>
            Your data, your servers
          </span>
        </div>
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
      <div style={{ display: "grid", minHeight: "100vh", placeItems: "center", background: "var(--bg)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
          <Spinner /> Checking session…
        </div>
      </div>
    );
  }

  if (user) return <Navigate to={from} replace />;

  return (
    <>
      {/* Float keyframe for service card */}
      <style>{`@keyframes dd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}`}</style>

      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--bg)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* LEFT column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
            position: "relative",
            background: "radial-gradient(120% 90% at 50% 0%, var(--surface-2) 0%, var(--bg) 60%)",
          }}
        >
          <div style={{ width: 372, maxWidth: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>

            {/* D mark + wordmark */}
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 26 }}>
              <img
                src="/icon.svg"
                alt=""
                width={38}
                height={38}
                style={{ display: "block", filter: "drop-shadow(0 4px 12px rgba(68,96,238,.45))" }}
              />
              <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em", color: "var(--text)" }}>
                Debut<span style={{ color: "var(--accent-text)" }}>Deploy</span>
              </span>
            </div>

            {/* Sign-in card */}
            <div
              style={{
                width: "100%",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "30px 30px 24px",
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <h1
                style={{
                  margin: "0 0 7px",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 21,
                  fontWeight: 600,
                  textAlign: "center",
                  color: "var(--text)",
                  letterSpacing: "-0.01em",
                }}
              >
                Welcome back
              </h1>
              <p style={{ margin: "0 0 24px", fontSize: 13.5, textAlign: "center", color: "var(--text-muted)", lineHeight: 1.5 }}>
                Deploy apps &amp; databases to your own cloud.
              </p>

              {/* Error box */}
              {error && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "10px 14px",
                    borderRadius: 6,
                    background: "var(--err-soft)",
                    border: "1px solid color-mix(in srgb, var(--err) 30%, transparent)",
                    color: "var(--err-text)",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {error.message}
                </div>
              )}

              {/* Google OAuth button */}
              <OAuthButton href={authLink("/auth/google", from)} icon={<GoogleG />} label="Continue with Google" />

              {/* GitHub OAuth button */}
              <div style={{ marginTop: 11 }}>
                <OAuthButton href={authLink("/auth/github", from)} icon={<GitHubMark />} label="Continue with GitHub" />
              </div>

              <p style={{ margin: "20px 0 0", fontSize: 11.5, textAlign: "center", color: "var(--text-muted)", lineHeight: 1.55 }}>
                By continuing you agree to the{" "}
                <span style={{ color: "var(--accent-text)", cursor: "pointer" }}>Terms</span>
                {" "}&amp;{" "}
                <span style={{ color: "var(--accent-text)", cursor: "pointer" }}>Privacy Policy</span>.
              </p>
            </div>

            {/* Beta note */}
            <p style={{ margin: "22px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              New to DebutDeploy? Access is invite-only during beta.
            </p>
          </div>
        </div>

        {/* RIGHT brand panel — hidden on small screens via media query workaround */}
        <div className="login-brand-panel">
          <BrandPanel />
        </div>

        {/* ponytail: inline style rather than a new CSS file — single-screen component, no reuse */}
        <style>{`
          @media (max-width: 767px) { .login-brand-panel { display: none !important; } }
          .login-brand-panel { display: contents; }
        `}</style>
      </div>
    </>
  );
}

// Secondary bordered OAuth button — anchor navigation (no fetch)
function OAuthButton({ href, icon, label }) {
  return (
    <a
      href={href}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 11,
        padding: "11px 16px",
        borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--surface)",
        color: "var(--text)",
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        textDecoration: "none",
        transition: "background .15s, border-color .15s",
        boxSizing: "border-box",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "var(--surface-2)";
        e.currentTarget.style.borderColor = "var(--text-muted)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "var(--surface)";
        e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
    >
      {icon}
      {label}
    </a>
  );
}
