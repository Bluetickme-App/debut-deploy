// node --test server/test_webhook.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { repoKey, verifyWebhookSig } from "./webhook.js";

test("repoKey normalises every git remote form to owner/repo", () => {
  assert.equal(repoKey("git@github.com:Bluetickme-App/debut-deploy.git"), "bluetickme-app/debut-deploy");
  assert.equal(repoKey("https://github.com/Bluetickme-App/debut-deploy"), "bluetickme-app/debut-deploy");
  assert.equal(repoKey("https://github.com/Bluetickme-App/debut-deploy.git"), "bluetickme-app/debut-deploy");
  assert.equal(repoKey("Bluetickme-App/debut-deploy"), "bluetickme-app/debut-deploy");
  assert.equal(repoKey(""), "");
  assert.equal(repoKey(null), "");
});

const SECRET = "s3cr3t-webhook";
const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
const goodSig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

test("verifyWebhookSig accepts a correct signature", () => {
  assert.equal(verifyWebhookSig(body, goodSig, SECRET), true);
});

test("verifyWebhookSig rejects a tampered body", () => {
  const tampered = Buffer.from(JSON.stringify({ ref: "refs/heads/evil" }));
  assert.equal(verifyWebhookSig(tampered, goodSig, SECRET), false);
});

test("verifyWebhookSig rejects wrong secret, missing header, missing secret", () => {
  assert.equal(verifyWebhookSig(body, goodSig, "wrong-secret"), false);
  assert.equal(verifyWebhookSig(body, "", SECRET), false);
  assert.equal(verifyWebhookSig(body, goodSig, ""), false);
  assert.equal(verifyWebhookSig(null, goodSig, SECRET), false);
});

test("verifyWebhookSig rejects a length-mismatched signature (no timingSafeEqual throw)", () => {
  assert.equal(verifyWebhookSig(body, "sha256=short", SECRET), false);
});
