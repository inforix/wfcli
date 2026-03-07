import test from "node:test";
import assert from "node:assert/strict";
import { loadOAuthSession, loadValidAccessToken } from "../src/authSession.js";
import { createMemoryKeyring } from "../test-helpers.js";

function sessionAddress(config) {
  return {
    service: "wfcli.infoplus.oauth2",
    account: `${new URL(config.baseUrl).origin}|${config.clientId}`
  };
}

test("loadOAuthSession normalizes second-based timestamps to milliseconds", async () => {
  const config = { baseUrl: "https://wf.example.edu.cn", clientId: "cid" };
  const keyring = createMemoryKeyring();
  const nowSec = Math.floor(Date.now() / 1000);
  const { service, account } = sessionAddress(config);

  await keyring.setPassword(
    service,
    account,
    JSON.stringify({
      accessToken: "token-seconds",
      tokenType: "bearer",
      obtainedAt: nowSec,
      expiresAt: nowSec + 3600
    })
  );

  const session = await loadOAuthSession(config, keyring);
  assert.ok(session);
  assert.equal(session.obtainedAt, nowSec * 1000);
  assert.equal(session.expiresAt, (nowSec + 3600) * 1000);
});

test("loadValidAccessToken accepts non-expired second-based expiresAt", async () => {
  const config = { baseUrl: "https://wf.example.edu.cn", clientId: "cid" };
  const keyring = createMemoryKeyring();
  const nowSec = Math.floor(Date.now() / 1000);
  const { service, account } = sessionAddress(config);

  await keyring.setPassword(
    service,
    account,
    JSON.stringify({
      accessToken: "token-seconds-valid",
      tokenType: "bearer",
      obtainedAt: nowSec,
      expiresAt: nowSec + 3600
    })
  );

  const token = await loadValidAccessToken(config, keyring, nowSec * 1000);
  assert.equal(token, "token-seconds-valid");
});

test("loadValidAccessToken can bypass expiration when DISABLE_EXPIRE_CHECK=1", async () => {
  const config = { baseUrl: "https://wf.example.edu.cn", clientId: "cid" };
  const keyring = createMemoryKeyring();
  const nowSec = Math.floor(Date.now() / 1000);
  const { service, account } = sessionAddress(config);

  await keyring.setPassword(
    service,
    account,
    JSON.stringify({
      accessToken: "token-expired",
      tokenType: "bearer",
      obtainedAt: nowSec - 7200,
      expiresAt: nowSec - 3600
    })
  );

  const previous = process.env.DISABLE_EXPIRE_CHECK;
  process.env.DISABLE_EXPIRE_CHECK = "1";
  try {
    const token = await loadValidAccessToken(config, keyring, nowSec * 1000);
    assert.equal(token, "token-expired");
  } finally {
    if (previous === undefined) {
      delete process.env.DISABLE_EXPIRE_CHECK;
    } else {
      process.env.DISABLE_EXPIRE_CHECK = previous;
    }
  }
});
