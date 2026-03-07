import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { loadOAuthSession, saveOAuthSession } from "../src/authSession.js";
import { runAuthRefreshToken } from "../src/commands/auth.js";
import { createMemoryKeyring, createWriter } from "../test-helpers.js";

function startMockServer(routes) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const handler = routes[`${req.method} ${req.url.split("?")[0]}`];
        if (!handler) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

test("runAuthRefreshToken refreshes access token and preserves existing refresh token", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/oauth2/token": (req, res, body) => {
      assert.match(req.headers.authorization || "", /^Basic /);
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=old-refresh-token/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "new-access-token",
          token_type: "bearer",
          expires_in: 7200
        })
      );
    }
  });

  const keyring = createMemoryKeyring();
  const writer = createWriter();
  const config = { baseUrl, clientId: "cid" };

  try {
    await saveOAuthSession(
      config,
      keyring,
      {
        access_token: "old-access-token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "old-refresh-token"
      },
      Date.now() - 3_600_000
    );

    await runAuthRefreshToken(
      {},
      {
        writer,
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_CLIENT_SECRET: "secret",
          WORKFLOW_BASE_URL: baseUrl
        }
      }
    );

    const session = await loadOAuthSession(config, keyring);
    assert.equal(session.accessToken, "new-access-token");
    assert.equal(session.refreshToken, "old-refresh-token");
    assert.match(writer.read(), /Token refreshed successfully/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAuthRefreshToken falls back to body client credentials when basic auth refresh fails", async () => {
  let requestCount = 0;
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/oauth2/token": (req, res, body) => {
      requestCount += 1;
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=old-refresh-token/);

      if (requestCount === 1) {
        assert.match(req.headers.authorization || "", /^Basic /);
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "invalid_client" }));
        return;
      }

      assert.equal(req.headers.authorization, undefined);
      assert.match(body, /client_id=cid/);
      assert.match(body, /client_secret=secret/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "refreshed-by-body",
          token_type: "bearer",
          expires_in: 7200,
          refresh_token: "new-refresh-token"
        })
      );
    }
  });

  const keyring = createMemoryKeyring();
  const config = { baseUrl, clientId: "cid" };

  try {
    await saveOAuthSession(config, keyring, {
      access_token: "old-access-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "old-refresh-token"
    });

    await runAuthRefreshToken(
      {},
      {
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_CLIENT_SECRET: "secret",
          WORKFLOW_BASE_URL: baseUrl
        }
      }
    );

    const session = await loadOAuthSession(config, keyring);
    assert.equal(session.accessToken, "refreshed-by-body");
    assert.equal(session.refreshToken, "new-refresh-token");
    assert.equal(requestCount, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAuthRefreshToken throws when stored session has no refresh token", async () => {
  const keyring = createMemoryKeyring();
  const config = { baseUrl: "https://example.com", clientId: "cid" };

  await saveOAuthSession(config, keyring, {
    access_token: "old-access-token",
    token_type: "bearer",
    expires_in: 3600
  });

  await assert.rejects(
    () =>
      runAuthRefreshToken(
        {},
        {
          keyring,
          env: {
            WORKFLOW_CLIENT_ID: "cid",
            WORKFLOW_CLIENT_SECRET: "secret",
            WORKFLOW_BASE_URL: "https://example.com"
          }
        }
      ),
    /no refresh_token/i
  );
});
