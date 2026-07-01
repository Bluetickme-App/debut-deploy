// node --test server/test_github_app.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createGithubApp, mintJwt } from "./github-app.js";

// Generate a real RSA key pair for tests (avoids needing real creds).
const { privateKey, publicKey: _pk } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TEST_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const TEST_APP_ID = "999";

// --- JWT structure tests -----------------------------------------------------

test("mintJwt produces RS256 header and correct iss claim", () => {
  const token = mintJwt(TEST_APP_ID, TEST_PEM);
  const [rawHeader, rawPayload] = token.split(".");

  const header  = JSON.parse(Buffer.from(rawHeader,  "base64url").toString());
  const payload = JSON.parse(Buffer.from(rawPayload, "base64url").toString());

  assert.equal(header.alg, "RS256");
  assert.equal(header.typ, "JWT");
  assert.equal(payload.iss, TEST_APP_ID);
  assert.ok(payload.exp > payload.iat, "exp > iat");
});

// --- HTTP mock keyed by installation token -----------------------------------
// Each installation gets a distinct access token; the mock verifies isolation.

const INST_A = 1001;
const INST_B = 1002;
const INST_C = 1003;
const TOKEN_A = "tok-A";
const TOKEN_B = "tok-B";
const TOKEN_C = "tok-C";

// Mock repo data per installation token. C has 150 repos to exercise pagination.
const REPOS = {
  [TOKEN_A]: [{ full_name: "alice/app", private: true, default_branch: "main" }],
  [TOKEN_B]: [{ full_name: "bob/thing", private: false, default_branch: "dev"  }],
  [TOKEN_C]: Array.from({ length: 150 }, (_, i) => ({ full_name: `carol/repo${i}`, private: false, default_branch: "main" })),
};

const BRANCHES = {
  [TOKEN_A]: [{ name: "main" }, { name: "staging" }],
  [TOKEN_B]: [{ name: "dev"  }],
};

function mockFetch(installationTokenMap) {
  // installationTokenMap: { [installationId]: accessToken }
  return async (url, opts = {}) => {
    const auth = (opts.headers?.Authorization || "").replace("Bearer ", "");

    // POST /app/installations/{id}/access_tokens → mint token
    const installMatch = url.match(/\/app\/installations\/(\d+)\/access_tokens$/);
    if (installMatch) {
      // The auth here is the App JWT — we don't verify the signature in the mock.
      const id = parseInt(installMatch[1]);
      const tok = installationTokenMap[id];
      if (!tok) return { ok: false, status: 404, text: async () => "not found" };
      return { ok: true, status: 200, json: async () => ({ token: tok }) };
    }

    // GET /installation/repositories?per_page&page — paginated like the real API
    if (url.includes("/installation/repositories")) {
      const all = REPOS[auth];
      if (!all) return { ok: false, status: 401, text: async () => "bad token" };
      const q = new URL(url).searchParams;
      const per = parseInt(q.get("per_page") || "30");
      const page = parseInt(q.get("page") || "1");
      const slice = all.slice((page - 1) * per, page * per);
      return { ok: true, status: 200, json: async () => ({ total_count: all.length, repositories: slice }) };
    }

    // GET /repos/{owner}/{repo}/branches
    const branchMatch = url.match(/\/repos\/[^/]+\/[^/]+\/branches(\?|$)/);
    if (branchMatch) {
      const branches = BRANCHES[auth];
      if (!branches) return { ok: false, status: 401, text: async () => "bad token" };
      return { ok: true, status: 200, json: async () => branches };
    }

    return { ok: false, status: 404, text: async () => "not found" };
  };
}

const tokenMap = { [INST_A]: TOKEN_A, [INST_B]: TOKEN_B, [INST_C]: TOKEN_C };
const app = createGithubApp({ appId: TEST_APP_ID, pem: TEST_PEM, slug: "test-app", httpClient: mockFetch(tokenMap) });

// --- isolation tests ---------------------------------------------------------

test("listRepos(A) returns only A's repos, not B's", async () => {
  const repos = await app.listRepos(INST_A);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].full_name, "alice/app");
  assert.equal(repos[0].private, true);
  assert.equal(repos[0].default_branch, "main");
});

test("listRepos(B) returns only B's repos, not A's", async () => {
  const repos = await app.listRepos(INST_B);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].full_name, "bob/thing");
});

test("listRepos pages through >100 repos (no silent truncation)", async () => {
  const repos = await app.listRepos(INST_C);
  assert.equal(repos.length, 150, "should aggregate both pages, not cap at 100");
  assert.equal(repos[0].full_name, "carol/repo0");
  assert.equal(repos[149].full_name, "carol/repo149");
});

test("listBranches(A) returns only A's branches", async () => {
  const branches = await app.listBranches(INST_A, "alice", "app");
  assert.deepEqual(branches, ["main", "staging"]);
});

test("listBranches(B) returns only B's branches", async () => {
  const branches = await app.listBranches(INST_B, "bob", "thing");
  assert.deepEqual(branches, ["dev"]);
});

test("installUrl includes slug and state", () => {
  const url = app.installUrl("abc123");
  assert.equal(url, "https://github.com/apps/test-app/installations/new?state=abc123");
});

test("non-2xx from GitHub throws error with .status", async () => {
  const badApp = createGithubApp({
    appId: TEST_APP_ID,
    pem: TEST_PEM,
    slug: "test-app",
    httpClient: async () => ({ ok: false, status: 422, text: async () => "unprocessable" }),
  });
  await assert.rejects(() => badApp.installationToken(INST_A), (err) => {
    assert.equal(err.status, 422);
    return true;
  });
});
