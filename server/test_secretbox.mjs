// node --test server/test_secretbox.mjs
process.env.SESSION_SECRET = "test-session-secret"; // stable key for the module

import { test } from "node:test";
import assert from "node:assert/strict";

const { encryptSecret, decryptSecret } = await import("./secretbox.js");

test("encrypt/decrypt round-trips", () => {
  const secret = "rnd_ExampleRenderApiKey0000";
  const blob = encryptSecret(secret);
  assert.notEqual(blob, secret, "ciphertext must not equal plaintext");
  assert.equal(decryptSecret(blob), secret);
});

test("each encryption uses a fresh IV → ciphertexts differ", () => {
  assert.notEqual(encryptSecret("same"), encryptSecret("same"));
});

test("tampered ciphertext fails GCM auth", () => {
  const blob = Buffer.from(encryptSecret("secret"), "base64");
  blob[blob.length - 1] ^= 0xff; // flip a ciphertext byte
  assert.throws(() => decryptSecret(blob.toString("base64")));
});
