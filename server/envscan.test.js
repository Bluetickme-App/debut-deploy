import { test } from "node:test";
import assert from "node:assert/strict";
import { scanEnv } from "./envscan.js";

// Fixtures taken from a real Render → DebutDeploy migration (values redacted).
const envs = [
  { key: "NODE_API_URL", value: "https://fans-automation.onrender.com" },
  { key: "CLOUD_ONEDRIVE_REDIRECT_URI", value: "https://fans-automation.onrender.com/api/cloud-sync/onedrive" },
  { key: "REDIS_URL", value: "redis://default:secret@red-abc123def456:6379" },
  { key: "DATABASE_URL", value: "postgres://u:p@dpg-d8hnskernols73au2q5g-a.frankfurt-postgres.render.com/fansauto_db" },
  { key: "RENDER_API_KEY", value: "rnd_vKJ5woNkAVWvgVVjDoVJYeWK96yC" },
  { key: "RENDER_REGION", value: "frankfurt" },
  { key: "NODE_ENV", value: "production" },              // clean — must not flag
  { key: "MEDIA_STORE_PATH", value: "/var/data/media_store" }, // clean
  { key: "GOOGLE_OIDC_CLIENT_ID", value: "683518768980-x.apps.googleusercontent.com" }, // clean
];

test("flags internal datastores as high severity (DB + Redis)", () => {
  const f = scanEnv(envs);
  const db = f.find((x) => x.key === "DATABASE_URL");
  const redis = f.find((x) => x.key === "REDIS_URL");
  assert.equal(db.severity, "high");
  assert.equal(db.category, "internal-datastore");
  assert.equal(redis.severity, "high");
  assert.match(db.message, /Provision your own/);
});

test("flags provider URLs as medium, reporting the host", () => {
  const f = scanEnv(envs);
  const u = f.find((x) => x.key === "NODE_API_URL");
  assert.equal(u.severity, "medium");
  assert.equal(u.category, "provider-url");
  assert.match(u.message, /onrender\.com/);
});

test("flags provider-specific vars as low", () => {
  const f = scanEnv(envs);
  const v = f.find((x) => x.key === "RENDER_API_KEY");
  assert.equal(v.severity, "low");
  assert.equal(v.category, "provider-var");
});

test("does not flag clean vars", () => {
  const f = scanEnv(envs).map((x) => x.key);
  for (const clean of ["NODE_ENV", "MEDIA_STORE_PATH", "GOOGLE_OIDC_CLIENT_ID"]) {
    assert.ok(!f.includes(clean), `${clean} should not be flagged`);
  }
});

test("findings are sorted worst-first", () => {
  const sev = scanEnv(envs).map((x) => x.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a] - { high: 0, medium: 1, low: 2 }[b])));
});

test("empty / valueless input is safe", () => {
  assert.deepEqual(scanEnv([]), []);
  assert.deepEqual(scanEnv([{ key: "X", value: "" }]), []);
});
