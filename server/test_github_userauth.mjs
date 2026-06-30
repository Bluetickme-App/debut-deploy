import { test } from "node:test";
import assert from "node:assert/strict";
import { createGithubApp } from "./github-app.js";

function makeFetch(responseBody) {
  return async (_url, _opts) => ({
    ok: true,
    status: 200,
    json: async () => responseBody,
    text: async () => "",
  });
}

test("exchangeUserCode + listUserInstallations are exported (route wiring reachable)", () => {
  const app = createGithubApp({ clientId: "x", clientSecret: "y", httpClient: makeFetch({}) });
  assert.equal(typeof app.exchangeUserCode, "function");
  assert.equal(typeof app.listUserInstallations, "function");
});

test("exchangeUserCode returns access_token", async () => {
  const app = createGithubApp({
    clientId: "x",
    clientSecret: "y",
    httpClient: makeFetch({ access_token: "ghu_abc123" }),
  });
  const token = await app.exchangeUserCode("some-code");
  assert.equal(token, "ghu_abc123");
});

test("exchangeUserCode throws on error response", async () => {
  const app = createGithubApp({
    clientId: "x",
    clientSecret: "y",
    httpClient: makeFetch({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }),
  });
  await assert.rejects(
    () => app.exchangeUserCode("bad-code"),
    /incorrect or expired/,
  );
});

test("listUserInstallations maps response correctly", async () => {
  const mockInstallations = {
    installations: [
      { id: 42, account: { login: "acme", id: 7, type: "Organization" } },
    ],
  };
  const app = createGithubApp({
    clientId: "x",
    clientSecret: "y",
    httpClient: makeFetch(mockInstallations),
  });
  const result = await app.listUserInstallations("ghu_usertoken");
  assert.deepEqual(result, [
    { id: 42, account_login: "acme", account_id: 7, account_type: "Organization" },
  ]);
});
