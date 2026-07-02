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
  { description: "Trigger a deploy of a service.", inputSchema: { id } },
  tool(({ id }) => api(`/api/services/${id}/deploy`, { method: "POST" }))
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

const transport = new StdioServerTransport();
await server.connect(transport);
