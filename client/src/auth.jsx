import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./lib/api.js";
import { Spinner } from "./components/ui.jsx";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((err) => {
        if (!cancelled && err.status !== 401) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      refresh: async () => {
        const me = await api.me();
        setUser(me);
        return me;
      },
      logout: async () => {
        await api.logout();
        setUser(null);
      },
    }),
    [error, loading, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function RequireAuth({ children }) {
  const { user, loading, error } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-zinc-500">
        <div className="inline-flex items-center gap-2">
          <Spinner /> Loading session...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-md rounded-lg border border-white/8 bg-[#13161d] p-6">
          <div className="text-sm font-medium text-white">Session error</div>
          <p className="mt-2 text-sm text-zinc-400">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

