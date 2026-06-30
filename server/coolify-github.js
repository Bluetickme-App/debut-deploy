// Maps GitHub App installation IDs to Coolify GitHub source UUIDs.
// Coolify stores one installation_id per GitHub App source; this module
// finds or updates the right source so private-repo deployments work.

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";

if (!DEMO && (!BASE || !TOKEN)) {
  throw new Error("COOLIFY_BASE_URL and COOLIFY_API_TOKEN are required outside demo mode");
}

export const isDemo = () => DEMO;

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Coolify ${method} ${path} → ${res.status}`), {
      status: res.status,
      detail: text,
    });
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Returns the Coolify GitHub App source UUID whose installation_id matches
 * the given GitHub App installation. Creates/patches the source if needed.
 *
 * @param {number|string} installationId — GitHub App installation ID
 * @returns {Promise<{ github_app_uuid: string }>}
 */
export async function ensureCoolifySourceForInstallation(installationId) {
  if (!installationId) {
    throw Object.assign(new Error("installationId required"), { status: 400 });
  }

  if (isDemo()) return { github_app_uuid: "demo-ghsource-" + installationId };

  // VERIFY LIVE — endpoint /sources may not exist in all Coolify versions;
  // field name `installation_id` on each source object is unverified against
  // Coolify v4.1.2 schema. Confirm with: GET /api/v1/sources on a live instance.
  const sources = await cf("/sources");

  const githubSources = Array.isArray(sources)
    ? sources.filter((s) => s.type === "github" || s.installation_id !== undefined)
    : [];

  const match = githubSources.find(
    (s) => String(s.installation_id) === String(installationId)
  );
  if (match) return { github_app_uuid: match.uuid };

  if (githubSources.length === 0) {
    throw Object.assign(new Error("No Coolify GitHub source configured"), { status: 404 });
  }

  // ponytail: single-source switch — races if two accounts deploy concurrently;
  // per-account sources is the upgrade path.
  if (githubSources.length === 1) {
    const [src] = githubSources;
    // VERIFY LIVE — PATCH /sources/:uuid field name for installation_id is unverified.
    await cf(`/sources/${src.uuid}`, {
      method: "PATCH",
      body: { installation_id: installationId },
    });
    return { github_app_uuid: src.uuid };
  }

  // Multiple sources, none matched — can't safely pick one.
  throw Object.assign(
    new Error(`No Coolify GitHub source matches installation_id ${installationId}`),
    { status: 404 }
  );
}
