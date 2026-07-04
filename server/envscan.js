// Migration env scanner. Copying a service's env off a PaaS (Render, Railway, …)
// drags along three kinds of value that break on the new host:
//   1. provider-url    — the app's own public URL still points at *.onrender.com
//   2. internal-datastore — DATABASE_URL / REDIS_URL point at a provider-INTERNAL
//      host (dpg-…, *.railway.internal) that doesn't resolve off-platform. This is
//      the one that makes deploys silently fail: the app boots, can't reach its
//      data, and crash-loops. Provision your own DB/cache first, then swap the URL.
//   3. provider-var    — RENDER_API_KEY / RAILWAY_* etc: meaningless after the move.
//
// Pure + deterministic: one rule set, called both at import time (Render's plaintext
// values, in hand) and on demand against our envstore mirror. No I/O here.

const PROVIDERS = [
  // dbHost: null means "no reliable internal-host signature" — we only flag URL + var
  // for that provider (avoids false-positives on legit AWS/self-hosted datastores).
  { name: "Render",  url: /\bonrender\.com\b/i,   dbHost: /(dpg-|red-)[a-z0-9]|\.[a-z0-9-]+\.render\.com\b/i, varKey: /^RENDER_/i },
  { name: "Railway", url: /\brailway\.app\b/i,     dbHost: /\.railway\.internal\b/i,                          varKey: /^RAILWAY_/i },
  { name: "Fly.io",  url: /\bfly\.dev\b/i,         dbHost: /\.flycast\b|\.internal:\d+/i,                     varKey: /^FLY_/i },
  { name: "Heroku",  url: /\bherokuapp\.com\b/i,   dbHost: null,                                              varKey: /^HEROKU_/i },
];

// Keys whose value is a datastore connection string. A provider-internal host in
// one of these means the app literally can't reach its data after the move.
const DATASTORE_KEY = /(DATABASE|DB_URL|POSTGRES|PG_|REDIS|MONGO|CONNECTION_STRING|KV_URL|QUEUE_URL|AMQP)/i;

/**
 * @param {{key:string, value:string}[]} envs
 * @returns {{key,provider,severity,category,message}[]} findings, worst-first
 */
export function scanEnv(envs = []) {
  const out = [];
  for (const e of envs) {
    const key = String(e?.key || "");
    const value = String(e?.value ?? "");
    if (!key || !value) continue;
    const isData = DATASTORE_KEY.test(key);
    const before = out.length;
    for (const p of PROVIDERS) {
      if (isData && p.dbHost && p.dbHost.test(value)) {
        out.push({ key, provider: p.name, severity: "high", category: "internal-datastore",
          message: `${key} points at a ${p.name}-internal datastore — unreachable from DebutDeploy. Provision your own database/cache here, migrate the data, then set ${key} to the new connection URL.` });
        break; // the datastore issue is the important one for this var
      }
      if (p.url.test(value)) {
        const host = (value.match(p.url) || [p.name])[0];
        out.push({ key, provider: p.name, severity: "medium", category: "provider-url",
          message: `${key} still points at ${p.name} (${host}). Update it to your DebutDeploy domain once the service is live.` });
        break;
      }
    }
    if (out.length > before) continue; // already flagged by value — don't double-report
    for (const p of PROVIDERS) {
      if (p.varKey.test(key)) {
        out.push({ key, provider: p.name, severity: "low", category: "provider-var",
          message: `${key} is a ${p.name}-specific variable — likely unused after migration; safe to remove once confirmed.` });
        break;
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
