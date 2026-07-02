import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Button, Card, Field, Input, PageHeader, Spinner } from "../components/ui.jsx";

// "deploy.succeeded" -> "Deploy succeeded"
function humanize(t) {
  const s = t.replace(/\./g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [checked, setChecked] = useState({}); // { [eventType]: bool }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.getNotifications()
      .then((d) => {
        setWebhookUrl(d.webhook_url || "");
        setEnabled(!!d.enabled);
        const cat = d.catalog || [];
        setCatalog(cat);
        // null/empty events => all checked
        const all = !d.events || d.events.length === 0;
        setChecked(Object.fromEntries(cat.map((t) => [t, all || d.events.includes(t)])));
      })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(""); setSuccess(false);
    try {
      const selected = catalog.filter((t) => checked[t]);
      // all checked => [] means "all events"
      const events = selected.length === catalog.length ? [] : selected;
      await api.saveNotifications({ webhookUrl, enabled, events });
      setSuccess(true);
    } catch (e) { setError(e.message || "Failed to save"); }
    finally { setBusy(false); }
  }

  return (
    <div className="page space-y-6">
      <PageHeader
        title="Webhooks"
        subtitle="Get a webhook when your services go down or deploys finish."
      />

      {loading ? (
        <Spinner />
      ) : (
        <Card>
          <form onSubmit={save} className="flex flex-col gap-5 p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                Enable notifications
              </span>
            </label>

            <Field label="Webhook URL">
              <Input
                type="text"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.example.com/..."
              />
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                We POST a JSON payload on <code>service.down</code> / <code>service.up</code> and deploy events.
                Internal/private addresses are rejected.
              </p>
            </Field>

            {catalog.length > 0 && (
              <Field label="Events">
                <div className="flex flex-col gap-2">
                  {catalog.map((t) => (
                    <label key={t} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!checked[t]}
                        onChange={(e) => setChecked((c) => ({ ...c, [t]: e.target.checked }))}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="text-sm" style={{ color: "var(--text)" }}>{humanize(t)}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  Leave all checked to receive every event.
                </p>
              </Field>
            )}

            {error && <p className="text-sm" style={{ color: "var(--err)" }}>{error}</p>}
            {success && <p className="text-sm" style={{ color: "var(--ok)" }}>Saved</p>}

            <div>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? <Spinner /> : null} Save
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
