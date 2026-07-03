import { db, getProject, listEnvironments } from "./db.js";

const KINDS = ["web_service", "background_worker", "cron_job", "static_site", "postgres", "key_value"];

// Render-shaped project detail: { project, environments:[{..., resourcesByKind}] }, org-scoped.
export function buildProjectDetail(orgId, projectId) {
  const project = getProject(orgId, projectId);
  if (!project) return undefined;
  const rows = db.prepare(
    "SELECT coolify_uuid, type, kind, environment_id FROM resource_ownership WHERE org_id = ? AND environment_id IS NOT NULL"
  ).all(orgId);
  const environments = listEnvironments(projectId).map((env) => {
    const resourcesByKind = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const r of rows.filter((r) => r.environment_id === env.id)) {
      (resourcesByKind[r.kind] || resourcesByKind.web_service).push({ coolify_uuid: r.coolify_uuid, type: r.type, kind: r.kind });
    }
    return { id: env.id, name: env.name, slug: env.slug, resourcesByKind };
  });
  return { project, environments };
}
