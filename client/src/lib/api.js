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
    err.code = e.code; // machine-readable server code (e.g. billing_setup_required)
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
  // projects & environments (panel-native)
  projects:        () => req("/projects"),
  project:         (id) => req(`/projects/${id}`),
  createProject:   (name) => req("/projects", { method: "POST", body: { name } }),
  renameProject:   (id, name) => req(`/projects/${id}`, { method: "PATCH", body: { name } }),
  deleteProject:   (id) => req(`/projects/${id}`, { method: "DELETE" }),
  createEnvironment: (projectId, name) => req(`/projects/${projectId}/environments`, { method: "POST", body: { name } }),
  renameEnvironment: (id, name) => req(`/environments/${id}`, { method: "PATCH", body: { name } }),
  deleteEnvironment: (id) => req(`/environments/${id}`, { method: "DELETE" }),
  placeResource:   (type, id, environmentId) => req(`/resources/${type}/${id}/placement`, { method: "PATCH", body: { environmentId } }),
  transferProject: (id, email) => req(`/admin/projects/${id}/transfer`, { method: "POST", body: { email } }), // master-admin only
  updateResources: (id, body) => req(`/services/${id}/resources`, { method: "PATCH", body }), // { cpus?, memory? } — low-level; no pricing, no redeploy
  // Instance-size change as one priced, confirmed operation. previewPlanChange returns the
  // spec/price/proration/cycle the confirmation dialog shows; applyPlanChange then sets the
  // limits, moves the billing, and redeploys so the new CPU/RAM actually takes effect.
  previewPlanChange: (id, body) => req(`/services/${id}/plan-change/preview`, { method: "POST", body }), // { planId|null, cpus?, memory? }
  applyPlanChange:   (id, body) => req(`/services/${id}/plan-change`, { method: "POST", body }),
  // custom domains (Render-style manager)
  listDomains:  (id) => req(`/services/${id}/domains`),
  addDomain:    (id, fqdn) => req(`/services/${id}/domain`, { method: "POST", body: { fqdn } }),
  removeDomain: (id, fqdn) => req(`/services/${id}/domains`, { method: "DELETE", body: { fqdn } }),
  deploy: (id, opts) => req(`/services/${id}/deploy`, { method: "POST", body: opts }), // opts?: { clearCache: true }
  rollback: (id, commit) => req(`/services/${id}/rollback`, { method: "POST", body: { commit } }),
  control: (id, action) => req(`/services/${id}/${action}`, { method: "POST" }),
  deployments: (id) => req(`/services/${id}/deployments`),
  activeDeployments: () => req(`/deployments/active`), // fleet build queue (active + queued)
  deploymentLog: () => req(`/deployments`), // fleet-wide recent deployment history
  cancelDeployment: (uuid) => req(`/deployments/${uuid}/cancel`, { method: "POST" }),
  concurrentBuilds: (serverUuid) => req(`/servers/${serverUuid}/concurrent-builds`), // admin: current lane count
  setConcurrentBuilds: (serverUuid, n) => req(`/servers/${serverUuid}/concurrent-builds`, { method: "PATCH", body: { concurrentBuilds: n } }),
  // Returns the array of {time, level, message} lines; falls back if the shape is older (raw array/string).
  logs: (id) => req(`/services/${id}/logs`).then((d) => (Array.isArray(d?.lines) ? d.lines : Array.isArray(d) ? d : [])),
  metrics: (id) => req(`/services/${id}/metrics`),
  metricsHistory: (id, window = "1h") => req(`/services/${id}/metrics/history?window=${window}`), // { window, series:{cpu,mem,net,throughput,diskio,pids}, stats }
  metricsHost: (window = "1h") => req(`/metrics/host?window=${window}`), // host CPU/RAM/disk % (admin)
  buildLogs: (id) => req(`/services/${id}/build-logs`), // { lines: [{time,type,message}], error? }
  envs: (id) => req(`/services/${id}/envs`),
  envScan: (id) => req(`/services/${id}/env-scan`), // { warnings: [...], scannable }
  revealEnv: (id, key) => req(`/services/${id}/envs/reveal?key=${encodeURIComponent(key)}`),
  saveEnv: (id, body) => req(`/services/${id}/envs`, { method: "POST", body }),
  deleteEnv: (id, envId) => req(`/services/${id}/envs/${envId}`, { method: "DELETE" }),
  // Persistent disks — billed per GB and redeploys the service, so size and cost are
  // previewed and confirmed before anything is created.
  serviceVolumes: (id) => req(`/services/${id}/volumes`),
  previewServiceVolume: (id, body) => req(`/services/${id}/volumes/preview`, { method: "POST", body }), // { sizeGb, action? }
  addServiceVolume: (id, mountPath, sizeGb) => req(`/services/${id}/volumes`, { method: "POST", body: { mountPath, sizeGb } }),
  deleteServiceVolume: (id, vid) => req(`/services/${id}/volumes/${vid}`, { method: "DELETE" }),
  databases: () => req("/databases"),
  database: (uuid) => req(`/databases/${uuid}`),
  renameDatabase: (uuid, name) => req(`/databases/${uuid}/rename`, { method: "PATCH", body: { name } }),
  deleteDatabase: (uuid) => req(`/databases/${uuid}`, { method: "DELETE" }),
  dbCredentials: (id) => req(`/databases/${encodeURIComponent(id)}/credentials`),
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
  // Variable groups (org-scoped, attachable to services)
  varGroups:          (reveal) => req(`/var-groups${reveal ? "?reveal=1" : ""}`),
  createVarGroup:     (body) => req("/var-groups", { method: "POST", body }),
  updateVarGroup:     (id, body) => req(`/var-groups/${id}`, { method: "PATCH", body }),
  deleteVarGroup:     (id) => req(`/var-groups/${id}`, { method: "DELETE" }),
  setVarGroupVars:    (id, vars) => req(`/var-groups/${id}/vars`, { method: "POST", body: { vars } }),
  renameVarGroupVar:  (id, key, next) => req(`/var-groups/${id}/vars/${encodeURIComponent(key)}`, { method: "PATCH", body: { key: next } }),
  deleteVarGroupVar:  (id, key) => req(`/var-groups/${id}/vars/${encodeURIComponent(key)}`, { method: "DELETE" }),
  attachVarGroup:     (id, uuid) => req(`/var-groups/${id}/services`, { method: "POST", body: { uuid } }),
  detachVarGroup:     (id, uuid) => req(`/var-groups/${id}/services/${uuid}`, { method: "DELETE" }),
  // Hetzner provisioning (admin)
  hetznerServerTypes: () => req("/hetzner/server-types"),
  hetznerLocations:   () => req("/hetzner/locations"),
  provisionServer:    (body) => req("/servers/provision", { method: "POST", body }),
  provisionStatus:    (id) => req(`/servers/${id}/provision-status`),
  // Business email hosting (admin)
  mailStatus:      () => req("/mail/status"),
  mailDomains:     () => req("/mail/domains"),
  createMailDomain:(domain, orgId) => req("/mail/domains", { method: "POST", body: { domain, orgId } }),
  deleteMailDomain:(domain) => req(`/mail/domains/${encodeURIComponent(domain)}`, { method: "DELETE" }),
  // Who pays for this domain's mailboxes. Cascades to the mailbox rows billing counts.
  assignMailDomain:(domain, orgId) => req(`/mail/domains/${encodeURIComponent(domain)}`, { method: "PATCH", body: { orgId } }),
  // Import what the mail server actually has into the panel's billing tables. Safe to re-run.
  reconcileMail:  () => req("/mail/reconcile", { method: "POST" }),
  createMailbox:   (body) => req("/mail/mailboxes", { method: "POST", body }), // { address, password, quotaMb }
  deleteMailbox:   (address) => req(`/mail/mailboxes/${encodeURIComponent(address)}`, { method: "DELETE" }),
  // Omit `password` for a generated temp one. The plaintext comes back ONCE — mailcow
  // stores only a hash, so it can never be read again. Show it, don't persist it.
  // Recovery address = the user's OTHER email; without one they cannot self-serve a reset.
  setMailboxRecovery: (address, recoveryEmail) =>
    req(`/mail/mailboxes/${encodeURIComponent(address)}/recovery`, { method: "POST", body: { recoveryEmail } }),
  clearMailboxRecovery: (address) =>
    req(`/mail/mailboxes/${encodeURIComponent(address)}/recovery`, { method: "DELETE" }),
  resetMailboxPassword: (address, password) =>
    req(`/mail/mailboxes/${encodeURIComponent(address)}/password`, { method: "POST", body: password ? { password } : {} }),
  verifyMailDns:   (domain) => req(`/mail/domains/${encodeURIComponent(domain)}/verify`), // { checks:[{key,label,ok,detail}] }
  // One-click DNS (Domain Connect)
  dnsDiscover: (domain, kind) => req(`/dns/discover?domain=${encodeURIComponent(domain)}&kind=${kind}`),
  dnsStatus:   (domain, kind) => req(`/dns/status?domain=${encodeURIComponent(domain)}&kind=${kind}`),
  // Customers + billing (admin)
  customers: () => req("/customers"),
  billing: () => req("/billing"),
  plans: () => req("/plans"), // customer-facing priced presets { compute:[], db:[] }
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
  // Provision one dedicated box + import a group of services onto it (admin).
  importRenderGroup: (body) => req("/import/render/dedicated-group", { method: "POST", body }),
  // Activity & notifications
  events:           (limit) => req(`/events${limit ? `?limit=${limit}` : ""}`),
  serviceEvents:    (id) => req(`/services/${id}/events`),
  getNotifications: () => req("/notifications"),
  saveNotifications:(body) => req("/notifications", { method: "PUT", body }),
  // API keys (programmatic access — also used as the MCP DEBUTDEPLOY_TOKEN)
  tokens: () => req("/tokens"),
  createToken: (body) => req("/tokens", { method: "POST", body }), // { name, scope: 'full'|'read' } → { token } shown once
  deleteToken: (id) => req(`/tokens/${id}`, { method: "DELETE" }),
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
  // Billing (prepaid wallet)
  wallet: () => req("/billing/wallet"),
  topup: (amount_pence) => req("/billing/topup", { method: "POST", body: { amount_pence } }),
  billingPortal: () => req("/billing/portal", { method: "POST" }),
  startMySubscription: () => req("/billing/subscribe", { method: "POST" }),
  autoRecharge: () => req("/billing/autorecharge"),
  setAutoRecharge: (body) => req("/billing/autorecharge", { method: "PATCH", body }),
  setServicePlan: (id, planId) => req(`/services/${id}/plan`, { method: "PATCH", body: { planId } }),
  setDatabasePlan: (id, planId) => req(`/databases/${id}/plan`, { method: "PATCH", body: { planId } }),
  updateDatabaseResources: (id, body) => req(`/databases/${id}/resources`, { method: "PATCH", body }), // { memory }
  // Client self-service billing (org owner)
  orgBillingInfo: () => req("/org/billing-info"),
  saveOrgBillingInfo: (body) => req("/org/billing-info", { method: "PATCH", body }),
  orgInvoiceUrl: (period, download) => `/api/org/invoice${period ? `?period=${period}` : ""}${download ? `${period ? "&" : "?"}download=1` : ""}`,
  adminInvoiceUrl: (id, period, download) => `/api/admin/orgs/${id}/invoice${period ? `?period=${period}` : ""}${download ? `${period ? "&" : "?"}download=1` : ""}`,
  // Usage metering
  usage: (period) => req(`/org/usage${period ? `?period=${period}` : ""}`),
  usageCurrent: () => req("/org/usage/current"),
  adminOrgUsage: (id, period) => req(`/admin/orgs/${id}/usage${period ? `?period=${period}` : ""}`),
  adminOrgWallet: (id) => req(`/admin/orgs/${id}/wallet`),
  adminOrgPayments: (id) => req(`/admin/orgs/${id}/payments`),
  adminOrgResources: (id) => req(`/admin/orgs/${id}/resources`),
  adminOrgBillingInfo: (id) => req(`/admin/orgs/${id}/billing-info`),
  adminSaveBillingInfo: (id, body) => req(`/admin/orgs/${id}/billing-info`, { method: "PATCH", body }),
  adminAdjustCredit: (id, body) => req(`/admin/orgs/${id}/credit`, { method: "POST", body }),
  orgBilling: (id) => req(`/admin/orgs/${id}/billing`),
  orgServicePlans: (id) => req(`/admin/orgs/${id}/service-plans`),
  setOrgCurrency: (id, currency) => req(`/admin/orgs/${id}/currency`, { method: "PUT", body: { currency } }),
  subscribeOrg: (id) => req(`/admin/orgs/${id}/subscribe`, { method: "POST" }),
  setOrgComp: (id, body) => req(`/admin/orgs/${id}/comp`, { method: "PATCH", body }),
  // Stripe admin dashboard (operator) — see data + flip test/live without a Stripe login
  stripeConfig: () => req("/admin/stripe/config"),
  stripeOverview: () => req("/admin/stripe/overview"),
  setStripeMode: (mode) => req("/admin/stripe/mode", { method: "PUT", body: { mode } }),
  syncStripeCatalog: () => req("/admin/stripe/catalog", { method: "POST" }),
  // Fleet monitoring
  fleetOverview: () => req("/fleet/overview"),
  restartService: (id) => req(`/services/${id}/restart`, { method: "POST" }),
  // Unwedge one service's stuck deploys: fails its in_progress/queued rows, drops the
  // hung build helpers, nudges the worker. Scoped to that service only.
  clearDeployQueue: (id) => req(`/services/${id}/clear-queue`, { method: "POST" }),
  // Master-admin: consoles behind the platform, and host power. rebootHost echoes the
  // IP back as `confirm` — the server rejects the call without it.
  adminPortals: () => req("/admin/portals"),
  rebootHost: (ip) => req("/admin/hosts/reboot", { method: "POST", body: { ip, confirm: ip } }),
  situations: () => req("/situations"),
  remediateSituation: (id) => req(`/situations/${id}/remediate`, { method: "POST" }),
};
