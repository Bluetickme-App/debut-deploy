import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveResourceKind } from "./resourcekind.js";

test("postgres database", () => {
  assert.equal(deriveResourceKind({ type: "database", image: "postgres:16-alpine" }), "postgres");
  assert.equal(deriveResourceKind({ type: "database", image: "pgvector/pgvector:pg17" }), "postgres");
});
test("key_value database (redis/keydb/dragonfly)", () => {
  assert.equal(deriveResourceKind({ type: "database", image: "redis:7" }), "key_value");
  assert.equal(deriveResourceKind({ type: "database", image: "keydb" }), "key_value");
  assert.equal(deriveResourceKind({ type: "database", image: "dragonfly" }), "key_value");
});
test("static site (build pack static)", () => {
  assert.equal(deriveResourceKind({ type: "application", buildPack: "static" }), "static_site");
});
test("background worker (no domain + worker-ish start)", () => {
  assert.equal(deriveResourceKind({ type: "application", hasDomain: false, startCommand: "pnpm start:workers" }), "background_worker");
});
test("web service (default application)", () => {
  assert.equal(deriveResourceKind({ type: "application", hasDomain: true, startCommand: "npm start" }), "web_service");
});
test("unknown → web_service (safe default)", () => {
  assert.equal(deriveResourceKind({ type: "service" }), "web_service");
  assert.equal(deriveResourceKind({}), "web_service");
});
