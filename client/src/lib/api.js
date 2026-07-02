// Tiny fetch wrapper. All calls go through the Express proxy at /api.

async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.detail = e.detail;
    throw err;
  }
  return res.json();
}

export const api = {
  health: () => req("/health"),
  me: () => req("/me"),
  // Auth routes live under /auth (not /api) — req() would hit /api/logout → 404.
  logout: () =>
    fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    }).then((res) => {
      if (!res.ok) throw new Error(`Logout failed: ${res.status}`);
      return res.json();
    }),
  services: () => req("/services"),
  service: (id) => req(`/services/${id}`),
  renameService: (id, name) => req(`/services/${id}/rename`, { method: "PATCH", body: { name } }),
  deploy: (id) => req(`/services/${id}/deploy`, { method: "POST" }),
  control: (id, action) => req(`/services/${id}/${action}`, { method: "POST" }),
  deployments: (id) => req(`/services/${id}/deployments`),
  // Returns the array of {time, level, message} lines; falls back if the shape is older (raw array/string).
  logs: (id) => req(`/services/${id}/logs`).then((d) => (Array.isArray(d?.lines) ? d.lines : Array.isArray(d) ? d : [])),
  metrics: (id) => req(`/services/${id}/metrics`),
  envs: (id) => req(`/services/${id}/envs`),
  revealEnv: (id, key) => req(`/services/${id}/envs/reveal?key=${encodeURIComponent(key)}`),
  saveEnv: (id, body) => req(`/services/${id}/envs`, { method: "POST", body }),
  deleteEnv: (id, envId) => req(`/services/${id}/envs/${envId}`, { method: "DELETE" }),
  // Persistent disks (redeploys the service)
  serviceVolumes: (id) => req(`/services/${id}/volumes`),
  addServiceVolume: (id, mountPath) => req(`/services/${id}/volumes`, { method: "POST", body: { mountPath } }),
  deleteServiceVolume: (id, vid) => req(`/services/${id}/volumes/${vid}`, { method: "DELETE" }),
  databases: () => req("/databases"),
  database: (uuid) => req(`/databases/${uuid}`),
  renameDatabase: (uuid, name) => req(`/databases/${uuid}/rename`, { method: "PATCH", body: { name } }),
  deleteDatabase: (uuid) => req(`/databases/${uuid}`, { method: "DELETE" }),
  servers: () => req("/servers"),
  getRepos: () =>
    fetch("/api/github/repos", { credentials: "same-origin" }).then((res) => {
      if (res.status === 409) return { needsConnect: true };
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    }),
  getBranches: (owner, repo) => req(`/github/repos/${owner}/${repo}/branches`),
  createApp: (body) => req("/apps", { method: "POST", body }),
  // Backups
  getBackupConfig: (id) => req(`/databases/${id}/backups`),
  setBackupSchedule: (id, body) => req(`/databases/${id}/backups`, { method: "POST", body }),
  triggerBackup: (id) => req(`/databases/${id}/backups/run`, { method: "POST" }),
  // Shared vars (admin)
  sharedVars: () => req("/shared-vars"),
  createSharedVar: (body) => req("/shared-vars", { method: "POST", body }),
  deleteSharedVar: (id) => req(`/shared-vars/${id}`, { method: "DELETE" }),
  // Hetzner provisioning (admin)
  hetznerServerTypes: () => req("/hetzner/server-types"),
  hetznerLocations:   () => req("/hetzner/locations"),
  provisionServer:    (body) => req("/servers/provision", { method: "POST", body }),
  provisionStatus:    (id) => req(`/servers/${id}/provision-status`),
  // Customers + billing (admin)
  customers: () => req("/customers"),
  billing: () => req("/billing"),
  // Deploy-key service creation (admin)
  prepareDeployKey: () => req("/git/prepare-key", { method: "POST" }),
  createGitService: (body) => req("/git/create-service", { method: "POST", body }),
  // GitHub
  githubInstallations: () => req("/github/installations"),
  // Render importer (admin)
  renderKeys:       () => req("/render/keys"),
  saveRenderKey:    (body) => req("/render/keys", { method: "POST", body }),
  deleteRenderKey:  (id) => req(`/render/keys/${id}`, { method: "DELETE" }),
  renderServices:  (creds) => req("/import/render/services", { method: "POST", body: creds }),
  renderDatabases: (creds) => req("/import/render/databases", { method: "POST", body: creds }),
  importRender:   (body) => req("/import/render", { method: "POST", body }),
  importRenderProject: (body) => req("/import/render/project", { method: "POST", body }),
  // Activity & notifications
  events:           (limit) => req(`/events${limit ? `?limit=${limit}` : ""}`),
  serviceEvents:    (id) => req(`/services/${id}/events`),
  getNotifications: () => req("/notifications"),
  saveNotifications:(body) => req("/notifications", { method: "PUT", body }),
  // Org + team
  org: () => req("/org"),
  orgMembers: () => req("/org/members"),
  createInvite: (body) => req("/org/invites", { method: "POST", body }),
  orgInvites: () => req("/org/invites"),
  revokeInvite: (id) => req(`/org/invites/${id}`, { method: "DELETE" }),
  acceptInvite: (token) => req("/org/invites/accept", { method: "POST", body: { token } }),
  setMemberRole: (userId, role) => req(`/org/members/${userId}`, { method: "PATCH", body: { role } }),
  removeMember: (userId) => req(`/org/members/${userId}`, { method: "DELETE" }),
  // Master Admin orgs
  adminOrgs: () => req("/admin/orgs"),
  adminOrg: (id) => req(`/admin/orgs/${id}`),
};
