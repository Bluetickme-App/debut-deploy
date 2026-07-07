// node --test server/dbcreds.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInspect, getDatabaseCredentials } from "./dbcreds.js";

const PG = [{
  Config: { Image: "postgres:16-alpine", Env: ["PATH=/usr/bin", "POSTGRES_USER=myuser", "POSTGRES_PASSWORD=p@ss/w0rd", "POSTGRES_DB=appdb"] },
  HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5433" }] } },
  NetworkSettings: { Ports: {} },
}];
const REDIS = [{
  Config: { Image: "redis:7.2", Env: ["REDIS_PASSWORD=secretpass"] },
  HostConfig: { PortBindings: {} },
  NetworkSettings: { Ports: {} },
}];

test("postgres with a published port → full creds + internal & external URLs (encoded)", () => {
  const c = parseInspect(PG, { uuid: "abc123", publicHost: "10.0.0.9" });
  assert.equal(c.engine, "postgres");
  assert.equal(c.username, "myuser");
  assert.equal(c.password, "p@ss/w0rd");
  assert.equal(c.database, "appdb");
  assert.equal(c.internalUrl, "postgresql://myuser:p%40ss%2Fw0rd@abc123:5432/appdb");
  assert.equal(c.externalPort, 5433);
  assert.equal(c.externalUrl, "postgresql://myuser:p%40ss%2Fw0rd@10.0.0.9:5433/appdb");
});

test("redis with no public port → external URL is null, internal has no /db", () => {
  const c = parseInspect(REDIS, { uuid: "red1", publicHost: "10.0.0.9" });
  assert.equal(c.engine, "redis");
  assert.equal(c.username, "default");
  assert.equal(c.password, "secretpass");
  assert.equal(c.externalUrl, null);
  assert.equal(c.internalUrl, "redis://default:secretpass@red1:6379");
});

test("getDatabaseCredentials throws 404 when no container is found", async () => {
  const run = async () => "[]";
  await assert.rejects(() => getDatabaseCredentials("nope", { run }), (e) => e.status === 404);
});

test("getDatabaseCredentials parses a real-shaped inspect via injected run", async () => {
  const run = async () => JSON.stringify(PG);
  const c = await getDatabaseCredentials("abc123", { run });
  assert.equal(c.password, "p@ss/w0rd");
});
