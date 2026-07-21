#!/usr/bin/env node
// DebutDeploy MCP server — exposes the REST API (docs/api.md) as stdio MCP tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.DEBUTDEPLOY_URL || "https://app.debutdepoly.com").replace(/\/$/, "");
const TOKEN = process.env.DEBUTDEPLOY_TOKEN || "";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text; // non-JSON body (e.g. raw logs)
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : typeof data === "string" ? data : res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

// Wrap a handler so any throw becomes an MCP error text result instead of crashing.
const tool = (fn) => async (args) => {
  try {
    const data = await fn(args);
    return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
};

const server = new McpServer({ name: "debutdeploy-mcp", version: "1.0.0" });

const id = z.string().describe("Coolify UUID of the service");

server.registerTool(
  "list_services",
  { description: "List the services (applications) you own.", inputSchema: {} },
  tool(() => api("/api/services"))
);

server.registerTool(
  "get_service",
  { description: "Get one service by its UUID.", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}`))
);

server.registerTool(
  "deploy_service",
  {
    description: "Trigger a deploy of a service. Set clearCache to rebuild from scratch (clears the build cache).",
    inputSchema: { id, clearCache: z.boolean().optional().describe("Rebuild without the build cache") },
  },
  tool(({ id, clearCache }) => api(`/api/services/${id}/deploy`, { method: "POST", body: clearCache ? { clearCache: true } : undefined }))
);

server.registerTool(
  "control_service",
  {
    description: "Start, stop, or restart a service.",
    inputSchema: { id, action: z.enum(["start", "stop", "restart"]).describe("Lifecycle action") },
  },
  tool(({ id, action }) => api(`/api/services/${id}/${action}`, { method: "POST" }))
);

server.registerTool(
  "service_logs",
  { description: "Recent runtime log lines for a service.", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/logs`))
);

server.registerTool(
  "service_deployments",
  { description: "List a service's deployments (status per deploy).", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/deployments`))
);

server.registerTool(
  "rollback_service",
  {
    description: "Roll a service back to a specific commit.",
    inputSchema: { id, commit: z.string().describe("Commit SHA to roll back to") },
  },
  tool(({ id, commit }) => api(`/api/services/${id}/rollback`, { method: "POST", body: { commit } }))
);

server.registerTool(
  "service_envs",
  { description: "List a service's environment variables.", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/envs`))
);

server.registerTool(
  "set_service_env",
  {
    description: "Set (create or update) one environment variable on a service. Redeploy afterwards for it to take effect.",
    inputSchema: {
      id,
      key: z.string().describe("Env var name, e.g. DATABASE_URL"),
      value: z.string().describe("Env var value"),
      is_secret: z.boolean().optional().describe("Mask the value in the UI (default true)"),
    },
  },
  tool(({ id, key, value, is_secret }) =>
    api(`/api/services/${id}/envs`, { method: "POST", body: { key, value, is_secret: is_secret ?? true } })
  )
);

server.registerTool(
  "service_build_logs",
  { description: "Build logs for a service's latest deploy — use this to diagnose a failed build.", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/build-logs`))
);

server.registerTool(
  "update_service_resources",
  {
    description:
      "Set a service's CPU / memory / memory-swap limits. cpus '0'|'0.5'|'1'|'2'; memory & memorySwap '0'|'512M'|'1G'|'2G'|'4G' ('0' = no limit). " +
      "IMPORTANT: never set memorySwap without also setting memory — Docker refuses to start the container (the 'flaky deploy' bug). Set both together (swap >= memory), or leave both '0'. Applied on next deploy.",
    inputSchema: {
      id,
      cpus: z.string().optional().describe("CPU limit, e.g. '1' or '0' for no limit"),
      memory: z.string().optional().describe("Memory limit, e.g. '512M' or '0' for no limit"),
      memorySwap: z.string().optional().describe("Memory+swap limit; must be >= memory (or '0'). Do not set alone."),
    },
  },
  tool(({ id, cpus, memory, memorySwap }) => api(`/api/services/${id}/resources`, { method: "PATCH", body: { cpus, memory, memorySwap } }))
);

server.registerTool(
  "get_build_config",
  {
    description: "Read a service's build pipeline config: build_pack (nixpacks|dockerfile|static|dockercompose), base_directory, dockerfile_location, ports_exposes, git branch/commit, and CPU/memory/swap limits. Use this to SEE the config before changing it.",
    inputSchema: { id },
  },
  tool(({ id }) => api(`/api/services/${id}/build-config`))
);

server.registerTool(
  "set_build_pack",
  {
    description: "Change a service's build pack (e.g. flip dockerfile <-> nixpacks) and optionally its base directory / dockerfile path / exposed port. Applied on next deploy. Use get_build_config first to see current values.",
    inputSchema: {
      id,
      buildPack: z.enum(["nixpacks", "dockerfile", "static", "dockercompose"]).optional().describe("Build pack to switch to"),
      baseDirectory: z.string().optional().describe("Subdir to build from, e.g. '/' or '/ad-service'"),
      dockerfileLocation: z.string().optional().describe("Dockerfile path relative to base dir, e.g. '/Dockerfile' (dockerfile pack)"),
      portsExposes: z.string().optional().describe("Exposed container port, e.g. '10000'"),
    },
  },
  tool(({ id, ...body }) => api(`/api/services/${id}/build-pack`, { method: "PATCH", body }))
);

server.registerTool(
  "clear_deploy_queue",
  {
    description: "Unwedge a service's deploy queue: fails all ITS stuck in_progress/queued deploys, removes their (possibly hung) build-helper containers, and restarts the queue worker so the NEXT deploy dispatches cleanly. Use when deploys stick queued and never run. Only affects this service.",
    inputSchema: { id },
  },
  tool(({ id }) => api(`/api/services/${id}/clear-queue`, { method: "POST" }))
);

server.registerTool(
  "deploy_commit",
  {
    description: "Build + deploy a SPECIFIC commit SHA (not just the branch HEAD). Pins the service to that SHA and force-rebuilds. Use to deploy a known-good SHA when a bare HEAD deploy is undesirable. (Same as rollback_service.)",
    inputSchema: { id, commit: z.string().describe("Full or short commit SHA to build + deploy") },
  },
  tool(({ id, commit }) => api(`/api/services/${id}/rollback`, { method: "POST", body: { commit } }))
);

const serverUuid = z.string().describe("Coolify UUID of the server/host (from list_servers)");

server.registerTool(
  "list_servers",
  { description: "List the fleet's hosts (Coolify servers) with their UUIDs, IPs and capacity. Use to get a server UUID for get_/set_concurrent_builds. Admin.", inputSchema: {} },
  tool(() => api("/api/servers"))
);

server.registerTool(
  "get_concurrent_builds",
  {
    description: "Read how many builds a host runs at once (concurrent build lanes). Coolify serialises deploys per-server at this width (default 1) — a single stuck build then blocks the whole host's queue. Admin.",
    inputSchema: { serverUuid },
  },
  tool(({ serverUuid }) => api(`/api/servers/${serverUuid}/concurrent-builds`))
);

server.registerTool(
  "set_concurrent_builds",
  {
    description: "Set a host's concurrent build lanes (1..6). Higher = deploys build in parallel instead of queueing; too high OOMs a small box mid-build. Restarts the queue worker so it takes effect. Admin. Use get_concurrent_builds / host_metrics first to size it against the host's free RAM.",
    inputSchema: { serverUuid, concurrentBuilds: z.number().int().min(1).max(6).describe("Number of build lanes, 1..6") },
  },
  tool(({ serverUuid, concurrentBuilds }) => api(`/api/servers/${serverUuid}/concurrent-builds`, { method: "PATCH", body: { concurrentBuilds } }))
);

server.registerTool(
  "ssh_exec",
  {
    description:
      "Run a shell command on the host box (escape hatch for ops the other tools don't cover). ADMIN-ONLY and PASSWORD-GATED: you must pass the shared ssh-exec password an operator gives you per use — without it this fails. Every call is audited. Prefer the specific tools (clear_deploy_queue, set_build_pack, etc.) when they fit.",
    inputSchema: {
      command: z.string().describe("Shell command to run on the host"),
      password: z.string().describe("The ssh-exec password (SSH_EXEC_PASSWORD) — provided by a human per use"),
    },
  },
  tool(({ command, password }) => api(`/api/admin/ssh-exec`, { method: "POST", body: { command, password } }))
);

server.registerTool(
  "create_service",
  {
    description:
      "Create and instantly deploy a service from a repo in your connected GitHub App installation. Returns { uuid }.",
    inputSchema: {
      repo: z.string().describe("owner/name; must be accessible to your GitHub installation"),
      branch: z.string().describe("Branch to deploy; must exist in the repo"),
      name: z.string().describe("Service name"),
      port: z.union([z.string(), z.number()]).describe("Exposed port"),
      buildPack: z.string().optional().describe("Defaults to nixpacks"),
      installCommand: z.string().optional(),
      buildCommand: z.string().optional(),
      startCommand: z.string().optional(),
    },
  },
  tool((body) => api("/api/apps", { method: "POST", body }))
);

server.registerTool(
  "list_databases",
  { description: "List the databases you own.", inputSchema: {} },
  tool(() => api("/api/databases"))
);

server.registerTool(
  "get_database",
  { description: "Get one database by its UUID.", inputSchema: { uuid: z.string().describe("Database UUID") } },
  tool(({ uuid }) => api(`/api/databases/${uuid}`))
);

server.registerTool(
  "list_events",
  {
    description: "Activity feed (your events + system events on your apps).",
    inputSchema: { limit: z.number().int().positive().optional().describe("Max number of events to return") },
  },
  tool(({ limit }) => api(`/api/events${limit ? `?limit=${limit}` : ""}`))
);

server.registerTool(
  "billing",
  { description: "Infra cost (Hetzner) plus compute/db pricing plans. Admin only.", inputSchema: {} },
  tool(() => api("/api/billing"))
);

server.registerTool(
  "fleet_overview",
  { description: "Fleet snapshot: host RAM/CPU/root-disk/volume-disk + latest per-site memory/CPU/disk. Admin.", inputSchema: {} },
  tool(() => api("/api/fleet/overview"))
);

server.registerTool(
  "host_metrics",
  { description: "Host capacity history (CPU/RAM/disk %) for the box. Admin.",
    inputSchema: { window: z.enum(["1h", "6h", "24h"]).optional().describe("Lookback window (default 1h)") } },
  tool(({ window }) => api(`/api/metrics/host${window ? `?window=${window}` : ""}`))
);

server.registerTool(
  "container_disk",
  { description: "Live per-container resource stats for one service (incl. current usage).", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/metrics`))
);

server.registerTool(
  "list_situations",
  {
    description: "List active fleet situations (disk pressure, unhealthy services, zombie deploys). Pass all=true to include resolved. Admin.",
    inputSchema: { all: z.boolean().optional().describe("Include resolved situations (default: open only)") },
  },
  tool(({ all }) => api(`/api/situations${all ? "?all=1" : ""}`))
);

server.registerTool(
  "run_remediation",
  {
    description: "Execute the suggested remediation for a situation by its numeric id. Admin.",
    inputSchema: { id: z.number().int().describe("Situation id from list_situations") },
  },
  tool(({ id }) => api(`/api/situations/${id}/remediate`, { method: "POST" }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
