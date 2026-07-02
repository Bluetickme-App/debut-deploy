// AES-256-GCM encryption for secrets stored at rest (saved Render API keys).
// The key is derived from SESSION_SECRET, so rotating SESSION_SECRET invalidates
// stored ciphertexts (acceptable — the user re-adds the key). No new env needed.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const KEY = scryptSync(process.env.SESSION_SECRET || "debutdeploy-demo-secret", "render-cred-v1", 32);

// Returns base64( iv[12] | authTag[16] | ciphertext ).
export function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(String(plaintext), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(blob) {
  const buf = Buffer.from(String(blob), "base64");
  const dc = createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
  dc.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([dc.update(buf.subarray(28)), dc.final()]).toString("utf8");
}
