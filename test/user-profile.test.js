import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { runUserProfile } from "../src/commands/user.js";
import { createMemoryKeyring, createWriter, seedAccessToken } from "../test-helpers.js";

function startMockServer(routes) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const handler = routes[`${req.method} ${req.url}`];
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

async function makeDeps(baseUrl, writer = createWriter()) {
  const keyring = createMemoryKeyring();
  await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
  return {
    writer,
    keyring,
    env: {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_BASE_URL: baseUrl
    }
  };
}

test("runUserProfile fetches /me/profile and renders readable output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/profile": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            {
              id: "u001",
              account: "alice",
              name: "Alice",
              email: "alice@example.edu.cn",
              mobile: "13800138000",
              department: "Information Office"
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const profile = await runUserProfile({}, await makeDeps(baseUrl, writer));
    assert.equal(profile.account, "alice");
    const output = writer.read();
    assert.match(output, /ACCOUNT\s*: alice/);
    assert.match(output, /NAME\s*: Alice/);
    assert.match(output, /EMAIL\s*: alice@example.edu.cn/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserProfile supports --json output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/profile": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "u002", account: "bob", name: "Bob" }]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const profile = await runUserProfile({ json: true }, await makeDeps(baseUrl, writer));
    assert.equal(profile.name, "Bob");
    const payload = JSON.parse(writer.read());
    assert.equal(payload.account, "bob");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserProfile prompts login when access token scope is invalid", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/profile": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 10010,
          ecode: "ACCESS_TOKEN_SCOPE_INVALID",
          error: "ACCESS_TOKEN_SCOPE_INVALID",
          entities: []
        })
      );
    }
  });

  try {
    await assert.rejects(
      runUserProfile({}, await makeDeps(baseUrl)),
      /scope is invalid/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
