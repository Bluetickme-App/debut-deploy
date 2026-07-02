// node --test server/test_sharedcluster.mjs
process.env.DEMO_MODE = "true";
process.env.DATABASE_FILE = ":memory:";
process.env.SESSION_SECRET = "test-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

const { pgIdent, createProjectDatabase, ensureSharedCluster } = await import("./sharedcluster.js");

test("pgIdent sanitises to a safe pg identifier (injection-proof)", () => {
  assert.equal(pgIdent("Premium-Agent-Hub"), "premium_agent_hub");
  assert.equal(pgIdent("123abc"), "p_123abc"); // must start with a letter
  assert.equal(pgIdent(""), "proj");
  assert.match(pgIdent("a'; DROP TABLE users;--"), /^[a-z][a-z0-9_]*$/);
});

test("createProjectDatabase (demo) returns a project-scoped credential-safe url", async () => {
  const r = await createProjectDatabase("Premium-Agent-Hub");
  assert.equal(r.db, "premium_agent_hub");
  assert.equal(r.role, "premium_agent_hub_u");
  assert.match(r.url, /^postgresql:\/\/premium_agent_hub_u:.+@.+\/premium_agent_hub$/);
});

test("ensureSharedCluster (demo) returns a url", async () => {
  assert.match(await ensureSharedCluster(), /^postgresql:\/\//);
});
