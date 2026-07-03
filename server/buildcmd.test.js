// node --test server/buildcmd.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DEMO_MODE = "true"; // coolify.js (imported by migrate.js) throws at load otherwise
const { splitBuildCommand } = await import("./migrate.js");

test("splits Render 'install; build' into separate fields", () => {
  assert.deepEqual(splitBuildCommand("npm install; npm run build"), { installCommand: "npm install", buildCommand: "npm run build" });
});
test("handles && separator and install-only / build-only", () => {
  assert.deepEqual(splitBuildCommand("yarn install && yarn build"), { installCommand: "yarn install", buildCommand: "yarn build" });
  assert.deepEqual(splitBuildCommand("npm ci"), { installCommand: "npm ci", buildCommand: undefined });
  assert.deepEqual(splitBuildCommand("go build ./..."), { installCommand: undefined, buildCommand: "go build ./..." });
  assert.deepEqual(splitBuildCommand(""), { installCommand: undefined, buildCommand: undefined });
});

const { renderBuildConfig } = await import("./migrate.js");
test("renderBuildConfig: docker → dockerfile, no commands", () => {
  assert.deepEqual(renderBuildConfig({ env: "docker", buildCommand: "make" }),
    { buildPack: "dockerfile", installCommand: undefined, buildCommand: undefined, startCommand: undefined });
});
test("renderBuildConfig: node → nixpacks + split commands", () => {
  assert.deepEqual(renderBuildConfig({ env: "node", buildCommand: "npm install; npm run build", startCommand: "npm start" }),
    { buildPack: "nixpacks", installCommand: "npm install", buildCommand: "npm run build", startCommand: "npm start" });
});
