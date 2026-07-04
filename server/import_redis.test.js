// node --test server/import_redis.test.js
// Verifies the redisTarget path: provision our own Redis, point REDIS_URL at it,
// and never let Render's stale REDIS_URL clobber the swap.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DEMO_MODE = "true";
const { importFromRender } = await import("./migrate.js");

// Render env includes a Redis pointing at a Render-internal host — must be replaced.
function deps(envUpserts, provisionCalls) {
  return {
    getService: async () => ({ id: "srv1", name: "app", repo: "https://github.com/o/r", branch: "main", buildCommand: "", startCommand: "" }),
    getEnvVars: async () => [
      { key: "FOO", value: "bar" },
      { key: "REDIS_URL", value: "redis://default:x@red-abc123:6379" },
    ],
    ensureAccountKey: async () => ({ uuid: "key-1" }),
    toSshUrl: (r) => r,
    ownerRepo: () => null,
    fetchBlueprint: async () => null,
    createDeployKeyApp: async () => ({ uuid: "app-x" }),
    provisionRedis: async () => { provisionCalls.push("redis"); return { uuid: "redis-1", url: "redis://default:new@redis-1:6379" }; },
    upsertEnv: async (_uuid, e) => { envUpserts.push(e); return {}; },
    assign: () => {},
    deleteApp: async () => {},
    deployService: async () => ({ ok: true }),
  };
}

test("redisTarget dedicated: provisions Redis and swaps REDIS_URL to ours", async () => {
  const envUpserts = [], provisionCalls = [];
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "shared", dbTarget: { mode: "none" }, redisTarget: { mode: "dedicated" } },
    deps: deps(envUpserts, provisionCalls),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(provisionCalls, ["redis"], "provisioned exactly one Redis");
  const redisWrites = envUpserts.filter((e) => e.key === "REDIS_URL");
  // Only our provisioned URL is written — Render's stale value is gated out.
  assert.equal(redisWrites.length, 1, "REDIS_URL written exactly once");
  assert.equal(redisWrites[0].value, "redis://default:new@redis-1:6379");
  assert.ok(r.steps.some((s) => s.step === "provision-redis" && s.status === "ok"));
});

test("no redisTarget: keeps Render's REDIS_URL and flags it in warnings", async () => {
  const envUpserts = [], provisionCalls = [];
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "shared", dbTarget: { mode: "none" } }, // no redisTarget
    deps: deps(envUpserts, provisionCalls),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(provisionCalls, [], "provisioned no Redis");
  const redisWrites = envUpserts.filter((e) => e.key === "REDIS_URL");
  assert.equal(redisWrites[0].value, "redis://default:x@red-abc123:6379", "kept Render's value");
  assert.ok(r.warnings.some((w) => w.key === "REDIS_URL" && w.severity === "high"), "Render Redis flagged");
});
