# debutdeploy-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
DebutDeploy's REST API as tools, so Claude Code / Claude Desktop can operate the
platform with an API token.

## Install

```bash
cd mcp
npm install
```

## Configure

The server reads two environment variables:

| Variable             | Default                          | Notes                         |
|----------------------|----------------------------------|-------------------------------|
| `DEBUTDEPLOY_URL`    | `https://app.debutdepoly.com`    | Base URL of your instance.    |
| `DEBUTDEPLOY_TOKEN`  | *(required)*                     | Bearer API token.             |

Mint a token from the DebutDeploy web UI — **Account settings → API keys → Create key**.
Choose **Full access** or **Read-only**, then copy the raw token (shown **once**). A
**read-only** key restricts this server to read tools (`list_services`, `service_logs`,
…); write tools (`deploy_service`, `create_service`, `control_service`) return `403`.
That page also shows a ready-to-paste `claude mcp add` command with your token filled in.

## Claude Desktop / Claude Code config

Add this to your MCP config (`claude_desktop_config.json`, or `claude mcp add`).
Use the **absolute** path to `server.js`:

```json
{
  "mcpServers": {
    "debutdeploy": {
      "command": "node",
      "args": ["C:\\Dev\\debut-deploy\\mcp\\server.js"],
      "env": {
        "DEBUTDEPLOY_URL": "https://app.debutdepoly.com",
        "DEBUTDEPLOY_TOKEN": "your-token-here"
      }
    }
  }
}
```

Or via the Claude Code CLI:

```bash
claude mcp add debutdeploy -e DEBUTDEPLOY_TOKEN=your-token-here -- node C:\\Dev\\debut-deploy\\mcp\\server.js
```

## Tools

| Tool                  | Endpoint                                  |
|-----------------------|-------------------------------------------|
| `list_services`       | `GET /api/services`                       |
| `get_service`         | `GET /api/services/:id`                   |
| `deploy_service`      | `POST /api/services/:id/deploy`           |
| `control_service`     | `POST /api/services/:id/{start\|stop\|restart}` |
| `service_logs`        | `GET /api/services/:id/logs`              |
| `service_deployments` | `GET /api/services/:id/deployments`       |
| `rollback_service`    | `POST /api/services/:id/rollback`         |
| `service_envs`        | `GET /api/services/:id/envs`              |
| `set_service_env`     | `POST /api/services/:id/envs`             |
| `service_build_logs`  | `GET /api/services/:id/build-logs`        |
| `update_service_resources` | `PATCH /api/services/:id/resources`  |
| `create_service`      | `POST /api/apps`                          |
| `list_databases`      | `GET /api/databases`                      |
| `get_database`        | `GET /api/databases/:uuid`                |
| `list_events`         | `GET /api/events?limit=N`                 |
| `billing`             | `GET /api/billing` (admin only)           |

## Fixing failed imports/deploys

When an import or deploy fails, DebutDeploy attaches a **friendly error** with a
copy-pasteable prompt (shown in the import results UI). Paste it into Claude with
this MCP connected and it will remediate using the tools above — e.g. read
`service_build_logs`, `set_service_env`, then `deploy_service`. Credential and
GitHub-connection problems are marked as manual (the MCP can't fix those).
