// GitHub App client: mints installation tokens and wraps GitHub API calls.
// No DB; just creds from env + injectable httpClient for tests.
//
// ponytail: RS256 JWT via node:crypto — no new dependency (per spec decision).

import { createSign } from "node:crypto";

const APP_ID          = process.env.GITHUB_APP_ID             || "";
// Accept the PEM as real newlines (local .env) OR single-line with \n escapes —
// docker-compose .env files can't hold multi-line values, so hosted envs store
// it escaped. The replace is a no-op when the value already has real newlines.
const PEM             = (process.env.GITHUB_APP_PRIVATE_KEY    || "").replace(/\\n/g, "\n");
const APP_SLUG        = process.env.GITHUB_APP_SLUG           || "";
const GITHUB_CLIENT_ID     = process.env.GITHUB_APP_CLIENT_ID     || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET || "";

// --- JWT helpers (RS256) -----------------------------------------------------

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function mintJwt(appId, pem, now = Math.floor(Date.now() / 1000)) {
  const header  = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ iss: appId, iat: now - 60, exp: now + 540 })));
  const data    = `${header}.${payload}`;
  const signer  = createSign("RSA-SHA256");
  signer.update(data);
  const sig = b64url(signer.sign(pem));
  return `${data}.${sig}`;
}

// --- factory (injectable) ----------------------------------------------------

export function createGithubApp({ appId = APP_ID, pem = PEM, slug = APP_SLUG, clientId = GITHUB_CLIENT_ID, clientSecret = GITHUB_CLIENT_SECRET, httpClient = fetch } = {}) {

  async function gh(path, token, { method = "GET", body } = {}) {
    const res = await httpClient(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`GitHub ${method} ${path} → ${res.status}: ${text}`), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }

  async function installationToken(installationId) {
    const jwt = mintJwt(appId, pem);
    const data = await gh(`/app/installations/${installationId}/access_tokens`, jwt, { method: "POST" });
    return data.token;
  }

  async function listRepos(installationId) {
    const token = await installationToken(installationId);
    const data  = await gh("/installation/repositories", token);
    return data.repositories.map(r => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch }));
  }

  async function listBranches(installationId, owner, repo) {
    const token = await installationToken(installationId);
    const data  = await gh(`/repos/${owner}/${repo}/branches`, token);
    return data.map(b => b.name);
  }

  function installUrl(state) {
    return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
  }

  // Verifies an installation exists and reveals whose account it's on (used to
  // bind an installation to the signed-in user, not to a forged query param).
  async function getInstallationInfo(installationId) {
    const jwt = mintJwt(appId, pem);
    const data = await gh(`/app/installations/${installationId}`, jwt);
    return {
      account_login: data.account?.login || null,
      account_id: data.account?.id ?? null,
      account_type: data.account?.type || null,
    };
  }

  // List every installation of this App, so we can auto-discover the one that
  // belongs to a signed-in user (no reliance on GitHub's Setup-URL callback).
  async function listInstallations() {
    const jwt = mintJwt(appId, pem);
    const data = await gh(`/app/installations`, jwt);
    return (Array.isArray(data) ? data : []).map((i) => ({
      id: i.id,
      account_login: i.account?.login || null,
      account_id: i.account?.id ?? null,
      account_type: i.account?.type || null,
    }));
  }

  // VERIFY LIVE — exchanges the OAuth callback code for a user access token.
  async function exchangeUserCode(code) {
    const res = await httpClient("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data.access_token;
  }

  // Lists GitHub App installations visible to the signed-in user (user-token endpoint).
  // Distinct from listInstallations() which uses a JWT and hits /app/installations.
  async function listUserInstallations(userToken) {
    const res = await httpClient("https://api.github.com/user/installations", {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`GitHub GET /user/installations → ${res.status}: ${text}`), { status: res.status });
    }
    const data = await res.json();
    return data.installations.map(i => ({
      id: i.id,
      account_login: i.account?.login || null,
      account_id: i.account?.id ?? null,
      account_type: i.account?.type || null,
    }));
  }

  return { installationToken, listRepos, listBranches, installUrl, getInstallationInfo, listInstallations, exchangeUserCode, listUserInstallations };
}

// --- default singleton (env-backed) -----------------------------------------
// ponytail: lazy-exported so tests that never call these never fail on missing env keys.
export const githubApp = createGithubApp();
