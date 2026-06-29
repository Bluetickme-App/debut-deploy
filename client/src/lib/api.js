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
  logout: () => req("/logout", { method: "POST" }),
  services: () => req("/services"),
  service: (id) => req(`/services/${id}`),
  deploy: (id) => req(`/services/${id}/deploy`, { method: "POST" }),
  control: (id, action) => req(`/services/${id}/${action}`, { method: "POST" }),
  deployments: (id) => req(`/services/${id}/deployments`),
  logs: (id) => req(`/services/${id}/logs`),
  envs: (id) => req(`/services/${id}/envs`),
  saveEnv: (id, body) => req(`/services/${id}/envs`, { method: "POST", body }),
  deleteEnv: (id, envId) => req(`/services/${id}/envs/${envId}`, { method: "DELETE" }),
  databases: () => req("/databases"),
  servers: () => req("/servers"),
  getRepos: () =>
    fetch("/api/github/repos", { credentials: "same-origin" }).then((res) => {
      if (res.status === 409) return { needsConnect: true };
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    }),
  getBranches: (owner, repo) => req(`/github/repos/${owner}/${repo}/branches`),
  createApp: (body) => req("/apps", { method: "POST", body }),
};
