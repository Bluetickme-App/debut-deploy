import { ArrowRight, Github, Chrome, ShieldCheck } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { Spinner } from "../components/ui.jsx";

function authLink(path, returnTo = "/") {
  const destination = encodeURIComponent(new URL(returnTo, window.location.origin).href);
  return `${path}?returnTo=${destination}`;
}

export default function Login() {
  const { loading, user, error } = useAuth();
  const location = useLocation();

  const from = location.state?.from || "/";

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center">
        <div className="inline-flex items-center gap-2 text-zinc-400">
          <Spinner /> Checking session...
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.22),_transparent_35%),linear-gradient(180deg,#07090d_0%,#0b0d12_40%,#090b0f_100%)] px-6 py-10 text-zinc-100">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
            Tenant-isolated control plane
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Sign in to the DebutDeploy control panel.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
            Continue with Google or GitHub to access your assigned Coolify resources.
            Non-owned resources stay hidden at the proxy layer.
          </p>
          {error && (
            <div className="mt-6 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
              {error.message}
            </div>
          )}
        </section>

        <aside className="rounded-3xl border border-white/10 bg-[#10131a]/90 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Access</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Choose a provider</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            The server verifies emails, creates or links your account, and sets a secure
            session cookie before returning you to the app.
          </p>

          <div className="mt-6 space-y-3">
            <a
              href={authLink("/auth/google", from)}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.07]"
            >
              <span className="inline-flex items-center gap-3">
                <Chrome className="h-4 w-4 text-sky-300" />
                Continue with Google
              </span>
              <ArrowRight className="h-4 w-4 text-zinc-500" />
            </a>
            <a
              href={authLink("/auth/github", from)}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.07]"
            >
              <span className="inline-flex items-center gap-3">
                <Github className="h-4 w-4 text-zinc-200" />
                Continue with GitHub
              </span>
              <ArrowRight className="h-4 w-4 text-zinc-500" />
            </a>
          </div>

          <div className="mt-6 rounded-2xl border border-white/8 bg-black/20 p-4 text-xs leading-6 text-zinc-400">
            Demo mode automatically signs in as an admin in non-production environments.
            Live mode requires OAuth credentials and a session secret at startup.
          </div>
        </aside>
      </div>
    </div>
  );
}
