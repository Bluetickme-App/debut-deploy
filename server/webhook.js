// Pure helpers for the GitHub push webhook (extracted from index.js so they're
// unit-testable without booting the Express server).

import { createHmac, timingSafeEqual } from "node:crypto";

// Normalise any git remote form to a lowercase "owner/repo" key for matching a
// push payload's repository.full_name against a Coolify app's git_repository.
//   git@github.com:Owner/Repo.git · https://github.com/Owner/Repo · Owner/Repo
export function repoKey(gitUrl) {
  const m = String(gitUrl || "").replace(/\.git$/, "").match(/([^/:]+\/[^/:]+)$/);
  return m ? m[1].toLowerCase() : "";
}

// Constant-time verify of GitHub's X-Hub-Signature-256 over the RAW request body.
export function verifyWebhookSig(rawBody, signatureHeader, secret) {
  if (!secret || !rawBody) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader || ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
