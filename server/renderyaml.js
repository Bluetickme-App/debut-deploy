// Read a repo's Render Blueprint (render.yaml) and translate it to Coolify app
// config. Render's Blueprint carries exactly what Nixpacks can't infer — runtime,
// build/start commands, health-check path, root dir, and env defaults — so applying
// it makes migrated / GitHub-deployed apps build the way they did on Render.
//
// Docs: https://render.com/docs/blueprint-spec
import { parse as parseYaml } from "yaml";
import { createGithubApp } from "./github-app.js";

// Parse render.yaml text → the list of services we care about (web/worker/etc.),
// normalised to a flat shape. Never throws on bad YAML — returns [] instead, so a
// malformed blueprint can't break a deploy.
export function parseBlueprint(text) {
  let doc;
  try {
    doc = parseYaml(String(text || ""));
  } catch {
    return [];
  }
  const services = Array.isArray(doc?.services) ? doc.services : [];
  return services.map((s) => ({
    type: s.type || "web",
    name: s.name || "",
    runtime: s.runtime || s.env || "", // Render renamed `env` → `runtime`; accept both
    buildCommand: (s.buildCommand || "").trim(),
    startCommand: (s.startCommand || "").trim(),
    healthCheckPath: (s.healthCheckPath || "").trim(),
    rootDir: (s.rootDir || "").trim(),
    // envVars: [{key, value?}] with value set → a plain default we can apply;
    // sync:false (or no value) → a SECRET the operator must supply, so we skip it.
    env: (Array.isArray(s.envVars) ? s.envVars : [])
      .filter((e) => e && e.key && e.value != null && e.sync !== false)
      .map((e) => ({ key: String(e.key), value: String(e.value) })),
    // The keys we deliberately DON'T set (secrets) — surfaced so the UI can prompt.
    secretKeys: (Array.isArray(s.envVars) ? s.envVars : [])
      .filter((e) => e && e.key && (e.value == null || e.sync === false))
      .map((e) => String(e.key)),
  }));
}

// The primary deployable service in a blueprint: first `web`, else the first one.
export function primaryService(services) {
  if (!Array.isArray(services) || !services.length) return null;
  return services.find((s) => s.type === "web") || services[0];
}

// Find the GitHub App installation whose account matches the repo owner (so callers
// don't have to know the installation id). Returns null if none/unreadable.
export async function resolveInstallationId(owner, deps = {}) {
  const app = deps.app || createGithubApp();
  try {
    const res = await app.listInstallations();
    const list = Array.isArray(res) ? res : res?.installations || [];
    const found = list.find((i) => (i.account?.login || "").toLowerCase() === String(owner || "").toLowerCase());
    return found?.id || list[0]?.id || null;
  } catch {
    return null;
  }
}

// Fetch render.yaml (or render.yml) from a repo's branch via the GitHub App
// installation token. Returns the primary service config, or null if none/unreadable.
// deps injectable for tests.
export async function fetchBlueprint({ owner, repo, ref, installationId }, deps = {}) {
  const app = deps.app || createGithubApp();
  const instId = installationId || (await resolveInstallationId(owner, { app }));
  if (!instId) return null;
  let token;
  try {
    token = await app.installationToken(instId);
  } catch {
    return null; // no install / no access → treat as "no blueprint"
  }
  const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw", "User-Agent": "debutdeploy" };
  const branch = ref || "main";
  for (const name of ["render.yaml", "render.yml"]) {
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${name}?ref=${encodeURIComponent(branch)}`, { headers: H });
      if (!r.ok) continue;
      const text = await r.text();
      const svc = primaryService(parseBlueprint(text));
      if (svc) return svc;
    } catch { /* try next filename */ }
  }
  return null;
}

// Parse owner/repo out of any git remote form; null if it isn't a GitHub repo.
export function ownerRepo(url) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i.exec(String(url || ""));
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Apply a blueprint service's config to a freshly-created Coolify app: patch the
// build/start/health/base-dir, then set the PLAIN (non-secret) env defaults. Returns
// a summary (incl. the secret keys the operator still must supply). Best-effort —
// callers treat a throw as "skip", so a blueprint never breaks a deploy.
export async function applyBlueprint(appUuid, svc, deps = {}) {
  if (!svc) return { applied: false };
  await deps.patchApp(appUuid, {
    build_command: svc.buildCommand || undefined,
    start_command: svc.startCommand || undefined,
    health_check_path: svc.healthCheckPath || undefined,
    health_check_enabled: svc.healthCheckPath ? true : undefined,
    base_directory: svc.rootDir || undefined,
  });
  for (const { key, value } of svc.env || []) {
    await deps.upsertEnv(appUuid, { key, value });
  }
  return {
    applied: true,
    healthCheckPath: svc.healthCheckPath || null,
    rootDir: svc.rootDir || null,
    envApplied: (svc.env || []).map((e) => e.key),
    secretsNeeded: svc.secretKeys || [],
  };
}

// Overlay a blueprint service onto values already resolved from elsewhere (e.g. the
// Render API). Existing non-empty values win; the blueprint fills the GAPS — so it
// upgrades a migration without overriding what the API already told us.
export function mergeConfig(base, svc) {
  if (!svc) return base;
  const pick = (a, b) => (a && String(a).trim() ? a : b || "");
  return {
    ...base,
    buildCommand: pick(base.buildCommand, svc.buildCommand),
    startCommand: pick(base.startCommand, svc.startCommand),
    healthCheckPath: pick(base.healthCheckPath, svc.healthCheckPath),
    rootDir: pick(base.rootDir, svc.rootDir),
    blueprintEnv: svc.env || [],
    blueprintSecrets: svc.secretKeys || [],
  };
}
