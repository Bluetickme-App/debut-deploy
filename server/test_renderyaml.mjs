import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlueprint, primaryService, mergeConfig } from "./renderyaml.js";

// The real claude-trader blueprint shape (secrets as sync:false, plain defaults with value).
const BLUEPRINT = `
services:
  - type: web
    name: sentinel-dashboard
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: python dashboard.py
    healthCheckPath: /healthz
    envVars:
      - key: DASH_HOST
        value: 0.0.0.0
      - key: ALPACA_PAPER
        value: "true"
      - key: ALPACA_API_KEY
        sync: false
      - key: DASH_USER
        sync: false
`;

test("parses the primary web service's build/start/health/runtime", () => {
  const svc = primaryService(parseBlueprint(BLUEPRINT));
  assert.equal(svc.type, "web");
  assert.equal(svc.runtime, "python");
  assert.equal(svc.buildCommand, "pip install -r requirements.txt");
  assert.equal(svc.startCommand, "python dashboard.py");
  assert.equal(svc.healthCheckPath, "/healthz");
});

test("splits envVars: plain defaults applied, sync:false treated as secrets", () => {
  const svc = primaryService(parseBlueprint(BLUEPRINT));
  const env = Object.fromEntries(svc.env.map((e) => [e.key, e.value]));
  assert.deepEqual(env, { DASH_HOST: "0.0.0.0", ALPACA_PAPER: "true" });
  assert.deepEqual(svc.secretKeys.sort(), ["ALPACA_API_KEY", "DASH_USER"]);
});

test("accepts legacy `env:` key as runtime", () => {
  const svc = primaryService(parseBlueprint("services:\n  - type: web\n    env: node\n"));
  assert.equal(svc.runtime, "node");
});

test("picks first web service when multiple exist", () => {
  const svc = primaryService(parseBlueprint("services:\n  - type: worker\n    name: w\n  - type: web\n    name: site\n"));
  assert.equal(svc.name, "site");
});

test("malformed / empty YAML returns [] (never throws — can't break a deploy)", () => {
  assert.deepEqual(parseBlueprint("::: not : valid : yaml :::"), []);
  assert.deepEqual(parseBlueprint(""), []);
  assert.deepEqual(parseBlueprint(null), []);
  assert.equal(primaryService(parseBlueprint("nope: true")), null);
});

test("mergeConfig: existing values win, blueprint fills only the gaps", () => {
  const base = { buildCommand: "npm build", startCommand: "", healthCheckPath: "", rootDir: "" };
  const svc = { buildCommand: "pip install", startCommand: "python x.py", healthCheckPath: "/healthz", rootDir: "app", env: [{ key: "A", value: "1" }], secretKeys: ["S"] };
  const merged = mergeConfig(base, svc);
  assert.equal(merged.buildCommand, "npm build", "base build command must win");
  assert.equal(merged.startCommand, "python x.py", "empty base filled from blueprint");
  assert.equal(merged.healthCheckPath, "/healthz");
  assert.equal(merged.rootDir, "app");
  assert.deepEqual(merged.blueprintEnv, [{ key: "A", value: "1" }]);
  assert.deepEqual(merged.blueprintSecrets, ["S"]);
});
