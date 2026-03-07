import test from "node:test";
import assert from "node:assert/strict";
import { resolveAuthLoginConfig, resolveRuntimeConfig } from "../src/config.js";

test("resolveRuntimeConfig throws when required env vars are missing", () => {
  assert.throws(() => resolveRuntimeConfig({}, {}), /WORKFLOW_CLIENT_ID/);
});

test("resolveRuntimeConfig resolves values from env and options", () => {
  const config = resolveRuntimeConfig(
    { username: "alice", baseUrl: "https://example.com/", scope: "sys_app" },
    {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_BASE_URL: "https://ignored.example",
      WORKFLOW_SCOPE: "ignored_scope",
      WORKFLOW_USERNAME: "ignored_user"
    }
  );

  assert.equal(config.clientId, "cid");
  assert.equal(config.baseUrl, "https://example.com");
  assert.equal(config.scope, "sys_app");
  assert.equal(config.username, "alice");
});

test("resolveAuthLoginConfig reads scope from WORKFLOW_SCOPE in env", () => {
  const config = resolveAuthLoginConfig(
    {},
    {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_CLIENT_SECRET: "csec",
      WORKFLOW_BASE_URL: "https://example.com",
      WORKFLOW_SCOPE: "profile data openid app process task start process_edit app_edit"
    }
  );

  assert.equal(config.scope, "profile data openid app process task start process_edit app_edit");
});

test("resolveAuthLoginConfig prefers WORKFLOW_AUTH_SCOPE over WORKFLOW_SCOPE", () => {
  const config = resolveAuthLoginConfig(
    {},
    {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_CLIENT_SECRET: "csec",
      WORKFLOW_BASE_URL: "https://example.com",
      WORKFLOW_SCOPE: "scope-a",
      WORKFLOW_AUTH_SCOPE: "scope-b"
    }
  );

  assert.equal(config.scope, "scope-b");
});

test("resolveAuthLoginConfig uses default scope when env scope is missing", () => {
  const config = resolveAuthLoginConfig(
    {},
    {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_CLIENT_SECRET: "csec",
      WORKFLOW_BASE_URL: "https://example.com"
    }
  );

  assert.equal(config.scope, "profile data openid app process task start process_edit app_edit");
});

test("resolveAuthLoginConfig requires client secret", () => {
  assert.throws(
    () =>
      resolveAuthLoginConfig({}, {
        WORKFLOW_CLIENT_ID: "cid",
        WORKFLOW_BASE_URL: "https://example.com"
      }),
    /WORKFLOW_CLIENT_SECRET/
  );
});
