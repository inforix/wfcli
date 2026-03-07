import test from "node:test";
import assert from "node:assert/strict";
import { saveOAuthSession } from "../src/authSession.js";
import { runAuthShowToken } from "../src/commands/auth.js";
import { createMemoryKeyring, createWriter } from "../test-helpers.js";

test("runAuthShowToken prints raw token by default", async () => {
  const keyring = createMemoryKeyring();
  const writer = createWriter();
  const nowMs = 1_700_000_000_000;
  const baseUrl = "https://wf.example.edu.cn";
  const config = { baseUrl, clientId: "cid" };

  await saveOAuthSession(
    config,
    keyring,
    {
      access_token: "token-abc",
      token_type: "bearer",
      expires_in: 3600
    },
    nowMs
  );

  const token = await runAuthShowToken(
    {},
    {
      writer,
      keyring,
      nowMs,
      env: {
        WORKFLOW_CLIENT_ID: "cid",
        WORKFLOW_BASE_URL: baseUrl
      }
    }
  );

  assert.equal(token, "token-abc");
  assert.equal(writer.read(), "token-abc\n");
});

test("runAuthShowToken supports --json output", async () => {
  const keyring = createMemoryKeyring();
  const writer = createWriter();
  const nowMs = 1_700_000_000_000;
  const baseUrl = "https://wf.example.edu.cn";
  const config = { baseUrl, clientId: "cid" };

  await saveOAuthSession(
    config,
    keyring,
    {
      access_token: "token-json",
      token_type: "bearer",
      expires_in: 3600,
      scope: "task process"
    },
    nowMs
  );

  await runAuthShowToken(
    { json: true },
    {
      writer,
      keyring,
      nowMs,
      env: {
        WORKFLOW_CLIENT_ID: "cid",
        WORKFLOW_BASE_URL: baseUrl
      }
    }
  );

  const payload = JSON.parse(writer.read());
  assert.equal(payload.accessToken, "token-json");
  assert.equal(payload.tokenType, "bearer");
  assert.equal(payload.scope, "task process");
  assert.equal(payload.expired, false);
});

test("runAuthShowToken fails when no session exists", async () => {
  const keyring = createMemoryKeyring();

  await assert.rejects(
    () =>
      runAuthShowToken({}, {
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_BASE_URL: "https://wf.example.edu.cn"
        }
      }),
    /No OAuth session found/
  );
});
