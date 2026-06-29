import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database } from "lucide-react";
import { Spinner } from "../components/ui.jsx";

const DB_TYPES = [
  { label: "PostgreSQL", value: "postgresql" },
  { label: "Redis",      value: "redis" },
  { label: "MySQL",      value: "mysql" },
  { label: "MariaDB",    value: "mariadb" },
  { label: "MongoDB",    value: "mongodb" },
];

export default function NewDatabase() {
  const navigate = useNavigate();
  const [type, setType]           = useState("postgresql");
  const [name, setName]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name: name.trim() }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}));
        throw new Error(msg || `HTTP ${res.status}`);
      }
      navigate("/databases");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim() && !submitting;

  return (
    <div className="mx-auto max-w-lg px-6 py-8">
      <h1 className="text-2xl font-semibold text-white">New Database</h1>
      <p className="mt-1 text-sm text-zinc-500">Provision a managed database on Coolify.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">Database type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500/60 focus:outline-none"
          >
            {DB_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">Database name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-db"
            className="w-full rounded-lg border border-white/8 bg-[#13161d] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
          />
        </div>

        {error && (
          <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting
            ? <><Spinner className="h-4 w-4" /> Creating…</>
            : <><Database className="h-4 w-4" /> Create database</>}
        </button>
      </form>
    </div>
  );
}
