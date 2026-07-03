// Map a raw error (Coolify / Render / Postgres / build) to a user-facing shape that
// also tells the user how to fix it with the DebutDeploy MCP (Claude Desktop / Claude
// Code). Pure + deterministic. ctx = { step?, resource?: { type, id } }.
//
// Shape: { code, title, message, fix, mcpFixable, mcp: { tools, hint, resource } | null }
// mcp is present only when the fix is achievable with the MCP toolset — credential /
// GitHub-connection problems are honestly marked mcpFixable:false (a human step).

const MCP = "DebutDeploy MCP"; // available in Claude Desktop or Claude Code

const svcId = (ctx) => (ctx?.resource?.type === "application" ? ctx.resource.id : null);

const RULES = [
  {
    code: "RENDER_AUTH",
    test: (h) => /render .*→ 40[13]\b|unauthorized|invalid api key/i.test(h),
    title: "Render rejected your API key",
    message: "The Render API key was expired or lacks access to this service.",
    fix: "Generate a new key in Render (Account Settings → API Keys) and re-run the import.",
    mcpFixable: false,
  },
  {
    // Build/install/start command validation — tighter than a bare 422 so it doesn't
    // swallow other validation errors (Render combines "install; build", Coolify rejects it).
    code: "BUILD_CONFIG",
    test: (h) => /build command field|install command field|start command field|command field format/i.test(h),
    title: "Invalid build or start command",
    message: "Coolify rejected the build/install/start command format — often a combined \"install; build\" string that Coolify won't accept in one field.",
    fix: "The importer now splits install and build automatically — retry the import.",
    mcpFixable: false,
  },
  {
    code: "REPO_ACCESS",
    test: (h) => /git_branch|no git repository|could not.*clone|repository not found|repository.*access/i.test(h),
    title: "Couldn't access the repository or branch",
    message: "Coolify couldn't reach the repo, or the branch doesn't exist — usually a GitHub connection issue or a wrong branch name.",
    fix: "Connect the GitHub App to this repo and confirm the branch name, then retry.",
    mcpFixable: false,
  },
  {
    code: "PG_VERSION",
    test: (h) => /unrecognized configuration parameter|server version mismatch|pg_dump.*version|unsupported postgresql version|transaction_timeout/i.test(h),
    title: "Database version mismatch",
    message: "The source Postgres is a newer major version than the target, so the dump can't be restored as-is.",
    fix: "Re-run the import and choose a target Postgres of the same or newer major version.",
    mcpFixable: false,
  },
  // MISSING_ENV before DB_CONNECT: when DATABASE_URL is explicitly named the fix is
  // "set the var" (MCP-fixable) — more actionable than a generic "DB unreachable".
  {
    code: "MISSING_ENV",
    test: (h) => /database_url|missing.*env|is not defined|environment variable/i.test(h),
    title: "A required environment variable is missing",
    message: "The service crashed because an expected variable (e.g. DATABASE_URL) isn't set.",
    fix: "Set the missing variable, then redeploy.",
    mcpFixable: true,
    mcp: (ctx) => ({
      tools: ["service_envs", "set_service_env", "deploy_service"],
      hint: `Ask Claude (with the ${MCP}): "On service ${svcId(ctx)}, list the env vars, set the missing one (e.g. DATABASE_URL), and redeploy."`,
    }),
  },
  {
    code: "DB_CONNECT",
    test: (h) => /econnrefused|could not connect|password authentication failed|timeout expired|no pg_hba|database .*suspended/i.test(h),
    title: "Couldn't connect to the database",
    message: "The source or target database refused the connection — unreachable host, wrong credentials, or a suspended database.",
    fix: "Confirm the database is running and the connection string is valid, then retry.",
    mcpFixable: false,
  },
  {
    code: "BUILD_FAILED",
    test: (h) => /build failed|npm err|nixpacks|exit code [1-9]|non-zero|module not found|cannot find module/i.test(h),
    title: "The build failed",
    message: "The service didn't build — usually a bad build/start command or a code or dependency error.",
    fix: "Read the build logs, fix the build, then redeploy.",
    mcpFixable: true,
    mcp: (ctx) => ({
      tools: ["service_build_logs", "deploy_service"],
      hint: `Ask Claude (with the ${MCP}): "Show the build logs for service ${svcId(ctx)}, tell me what failed, and redeploy." In Claude Code you can also edit the repo to fix it before redeploying.`,
    }),
  },
  {
    code: "PORT_MISMATCH",
    test: (h) => /\b502\b|bad gateway|not listening|no available server/i.test(h),
    title: "The service isn't reachable on its port",
    message: "The proxy can't reach the app — the container isn't listening on the exposed port (often a missing or wrong PORT).",
    fix: "Set PORT to the port your app listens on, then redeploy.",
    mcpFixable: true,
    mcp: (ctx) => ({
      tools: ["set_service_env", "deploy_service"],
      hint: `Ask Claude (with the ${MCP}): "Set PORT on service ${svcId(ctx)} to the port the app listens on, then redeploy."`,
    }),
  },
];

const FALLBACK = {
  code: "UNKNOWN",
  title: "The step failed",
  fix: "Retry — if it persists, check the service logs and last deployment.",
  mcpFixable: true,
  mcp: (ctx) => ({
    tools: ["service_logs", "service_deployments", "deploy_service"],
    hint: `Ask Claude (with the ${MCP}): "Check the logs and last deployment for service ${svcId(ctx)} and tell me why it failed."`,
  }),
};

export function friendlyError(err = {}, ctx = {}) {
  const haystack = `${err.message || ""} ${err.detail || ""} ${err.status || ""}`;
  const rule = RULES.find((r) => r.test(haystack)) || FALLBACK;
  const id = svcId(ctx);
  const mcp = rule.mcpFixable && id && rule.mcp ? { ...rule.mcp(ctx), resource: { type: "service", id } } : null;
  return {
    code: rule.code,
    title: rule.title,
    message: rule.message || err.message || "The step failed.",
    fix: rule.fix,
    mcpFixable: !!mcp,
    mcp,
  };
}
