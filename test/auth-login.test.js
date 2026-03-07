import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { runAuthLogin } from "../src/commands/auth.js";
import { loadValidAccessToken } from "../src/authSession.js";
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

test("runAuthLogin completes authorization code flow and stores keyring token", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/oauth2/authorize": (req, res) => {
      const url = new URL(req.url, baseUrl);
      assert.equal(url.searchParams.get("response_type"), "code");
      assert.match(req.url, /(?:\?|&)scope=app\+task\+process\+data\+openid\+profile(?:&|$)/);
      assert.equal(url.searchParams.get("scope"), "app task process data openid profile");
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      res.statusCode = 302;
      res.setHeader("location", `${redirectUri}?code=abc123&state=${state}`);
      res.end();
    },
    "POST /infoplus/oauth2/token": (req, res, body) => {
      assert.match(req.headers.authorization || "", /^Basic /);
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code=abc123/);
      assert.match(body, /redirect_uri=http/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "user-token-1",
          token_type: "bearer",
          expires_in: 3600
        })
      );
    }
  });

  const keyring = createMemoryKeyring();
  const writer = createWriter();
  try {
    await runAuthLogin(
      {},
      {
        writer,
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_CLIENT_SECRET: "secret",
          WORKFLOW_BASE_URL: baseUrl
        },
        openBrowser: async (url) => {
          await fetch(url);
        }
      }
    );

    const token = await loadValidAccessToken({ baseUrl, clientId: "cid" }, keyring);
    assert.equal(token, "user-token-1");
    assert.match(writer.read(), /Login successful/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
