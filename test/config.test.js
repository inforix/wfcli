import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeConfig } from "../src/config.js";

test("resolveRuntimeConfig throws when required env vars are missing", () => {
  assert.throws(() => resolveRuntimeConfig({}, {}), /WORKFLOW_CLIENT_ID/);
});

test("resolveRuntimeConfig resolves values from env and options", () => {
  const config = resolveRuntimeConfig(
    { username: "alice", baseUrl: "https://example.com/", scope: "sys_app" },
    {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_CLIENT_SECRET: "csec",
      WORKFLOW_BASE_URL: "https://ignored.example",
      WORKFLOW_SCOPE: "ignored_scope",
      WORKFLOW_USERNAME: "ignored_user"
    }
  );

  assert.equal(config.clientId, "cid");
  assert.equal(config.clientSecret, "csec");
  assert.equal(config.baseUrl, "https://example.com");
  assert.equal(config.scope, "sys_app");
  assert.equal(config.username, "alice");
});
