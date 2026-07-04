// Single source of truth for human labels of audit_event actions (Activity feed
// + per-service Events tab). Unknown actions fall back to the raw string.
// Keep in sync with the record(...)/recordSystem(...) action strings in server/.
export const ACTION_LABEL = {
  login: "Signed in",
  logout: "Signed out",
  deploy: "Deployed",
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
  rollback: "Rolled back",
  env_upsert: "Env var set",
  env_delete: "Env var removed",
  "app.create": "Service created",
  "app.delete": "Service deleted",
  "app.domain": "Domain set",
  "app.domain.remove": "Domain removed",
  "app.limits": "Resource limits set",
  "app.healthcheck": "Health check configured",
  "service.rename": "Service renamed",
  "service.resources": "Instance type changed",
  "resource.place": "Resource moved",
  "db.create": "Database created",
  "db.delete": "Database deleted",
  "database.rename": "Database renamed",
  "volume.add": "Volume added",
  "volume.delete": "Volume removed",
  "sharedvar.upsert": "Shared var set",
  "sharedvar.delete": "Shared var removed",
  "backup.schedule": "Backup scheduled",
  "backup.trigger": "Backup triggered",
  "token.create": "API token created",
  "token.delete": "API token deleted",
  "deploykey.prepare": "Deploy key generated",
  "github.disconnect": "GitHub disconnected",
  "server.provision": "Provisioned server",
  "import.render": "Imported from Render",
  "import.render.project": "Imported project from Render",
  "import.render.group": "Imported group from Render",
  "project.transfer": "Project transferred",
  "billing.info_updated": "Billing info updated",
  "billing.admin_adjust": "Credit adjusted",
  "billing.subscribe_initiated": "Subscription started",
  "billing.currency_set": "Currency changed",
  "stripe.mode_switch": "Stripe mode switched",
  "notification.update": "Notifications updated",
  admin_assign: "Ownership assigned",
  "service.down": "Service went DOWN",
  "service.up": "Service recovered",
};

export const actionLabel = (action) => ACTION_LABEL[action] ?? action;

// Severity for coloring: "down" | "up" | null (neutral).
export const actionSeverity = (action) =>
  action === "service.down" ? "down" : action === "service.up" ? "up" : null;

// Coarse category → drives the icon + accent colour in the Activity feed.
// The Activity page maps the category string to a lucide icon component.
export function actionCategory(action) {
  const a = String(action || "");
  if (a === "service.down") return "down";
  if (a === "service.up") return "up";
  if (a === "deploy" || a === "rollback") return "deploy";
  if (a === "start" || a === "stop" || a === "restart") return "lifecycle";
  if (a.startsWith("env") || a.startsWith("sharedvar")) return "env";
  if (a.startsWith("db") || a.startsWith("database") || a.startsWith("backup") || a.startsWith("volume")) return "db";
  if (a.startsWith("app.domain")) return "domain";
  if (a === "login" || a === "logout") return "auth";
  if (a.startsWith("billing") || a.startsWith("stripe")) return "billing";
  if (a.startsWith("token") || a === "deploykey.prepare" || a === "github.disconnect") return "key";
  if (a.startsWith("server") || a.startsWith("import")) return "server";
  if (a === "admin_assign" || a === "project.transfer" || a === "resource.place") return "admin";
  return "config";
}

const fmtCpu = (v) => (v === "0" || v == null ? "shared" : `${v} vCPU`);
const fmtMem = (v) => (v === "0" || v == null ? "no limit" : String(v).replace(/M$/, " MB").replace(/G$/, " GB"));

// Turn an event's metadata into a short human detail line ("" if nothing useful).
// Every branch is defensive — metadata shapes vary and old rows may lack fields.
export function describeEvent(ev) {
  const m = ev?.metadata || {};
  switch (ev?.action) {
    case "deploy":            return m.force ? "Forced rebuild & deploy" : "Deploy triggered";
    case "service.rename":
    case "database.rename":   return m.name ? `Renamed to “${m.name}”` : "";
    case "service.resources":
    case "app.limits":        return (m.cpus != null || m.memory != null) ? `Limits → ${fmtCpu(m.cpus)} · ${fmtMem(m.memory)}` : "";
    case "env_upsert":        return m.key ? `${m.key}${m.is_secret ? " · secret" : ""}` : "";
    case "app.domain":
    case "app.domain.remove": return m.fqdn || "";
    case "resource.place":    return m.kind ? `As ${m.kind}` : "";
    case "project.transfer":  return m.toEmail ? `→ ${m.toEmail}${m.moved != null ? ` (${m.moved} resource${m.moved === 1 ? "" : "s"})` : ""}` : "";
    case "app.create":        return m.repo || (m.via ? `via ${m.via}` : "");
    case "token.create":      return [m.name, m.scope].filter(Boolean).join(" · ");
    case "server.provision":  return m.serverType ? `${m.serverType}${m.location ? ` · ${m.location}` : ""}` : "";
    case "import.render.project":
    case "import.render.group": return m.count != null ? `${m.count} service${m.count === 1 ? "" : "s"}` : "";
    case "billing.admin_adjust": return m.amount_pence != null ? `${m.amount_pence >= 0 ? "+" : ""}£${(m.amount_pence / 100).toFixed(2)}${m.notes ? ` · ${m.notes}` : ""}` : "";
    case "billing.currency_set": return m.currency || "";
    case "stripe.mode_switch": return m.mode || "";
    default:                  return "";
  }
}
