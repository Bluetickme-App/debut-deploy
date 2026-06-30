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
  "app.limits": "Resource limits set",
  "app.healthcheck": "Health check configured",
  "db.create": "Database created",
  "db.delete": "Database deleted",
  "volume.add": "Volume added",
  "volume.delete": "Volume removed",
  "sharedvar.upsert": "Shared var set",
  "sharedvar.delete": "Shared var removed",
  "backup.schedule": "Backup scheduled",
  "backup.trigger": "Backup triggered",
  "token.create": "API token created",
  "token.delete": "API token deleted",
  "github.disconnect": "GitHub disconnected",
  "server.provision": "Provisioned server",
  "import.render": "Imported from Render",
  "notification.update": "Notifications updated",
  admin_assign: "Ownership assigned",
  "service.down": "Service went DOWN",
  "service.up": "Service recovered",
};

export const actionLabel = (action) => ACTION_LABEL[action] ?? action;

// Severity for coloring: "down" | "up" | null (neutral).
export const actionSeverity = (action) =>
  action === "service.down" ? "down" : action === "service.up" ? "up" : null;
