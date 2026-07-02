// Run: node --test server/test_deploykey.mjs
process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://demo.local";
process.env.COOLIFY_API_TOKEN = "demo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";

const { generateDeployKeypair, registerDeployKey, createDeployKeyApp, toSshUrl, ensureAccountKey } = await import("./deploykey.js");

test("toSshUrl normalises every git remote form to git@github.com:O/R.git", () => {
  assert.equal(toSshUrl("https://github.com/Bluetickme-App/debut-deploy"), "git@github.com:Bluetickme-App/debut-deploy.git");
  assert.equal(toSshUrl("https://github.com/Bluetickme-App/debut-deploy.git"), "git@github.com:Bluetickme-App/debut-deploy.git");
  assert.equal(toSshUrl("Bluetickme-App/debut-deploy"), "git@github.com:Bluetickme-App/debut-deploy.git");
  assert.equal(toSshUrl("github.com/Bluetickme-App/debut-deploy"), "git@github.com:Bluetickme-App/debut-deploy.git");
  assert.equal(toSshUrl("git@github.com:Bluetickme-App/debut-deploy.git"), "git@github.com:Bluetickme-App/debut-deploy.git");
  assert.equal(toSshUrl("git@github.com:Bluetickme-App/debut-deploy"), "git@github.com:Bluetickme-App/debut-deploy.git");
  assert.equal(toSshUrl("https://github.com/O/R/"), "git@github.com:O/R.git");
});

test("demo ensureAccountKey returns a stub uuid + public key", async () => {
  const { uuid, publicKey } = await ensureAccountKey();
  assert.ok(uuid);
  assert.match(publicKey, /^ssh-ed25519 /);
});

test("generateDeployKeypair returns a valid ssh-ed25519 public key + PKCS8 private", () => {
  const { publicKey, privateKeyPem } = generateDeployKeypair();
  assert.match(publicKey, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+ debutdeploy$/);
  assert.ok(privateKeyPem.startsWith("-----BEGIN PRIVATE KEY-----"));
  // the private key parses (so it's a real key, not garbage)
  const pub = createPublicKey(privateKeyPem);
  assert.equal(pub.asymmetricKeyType, "ed25519");
});

test("demo registerDeployKey + createDeployKeyApp return stub ids", async () => {
  const { uuid } = await registerDeployKey({ name: "k", privateKeyPem: "x" });
  assert.ok(uuid.startsWith("demo-key"));
  const app = await createDeployKeyApp({ keyUuid: uuid, repo: "git@github.com:a/b.git", name: "svc" });
  assert.ok(app.uuid.startsWith("demo-app"));
});
