import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { runAppsDefinition, runAppsList } from "../src/commands/apps.js";
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

test("runAppsList renders table output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/apps": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          ecode: "OK",
          error: "",
          total: 1,
          entities: [
            {
              code: "leave",
              name: "Leave Request",
              ready: true,
              visible: true,
              release: true,
              tags: "hr,leave"
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  const keyring = createMemoryKeyring();
  try {
    await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
    const apps = await runAppsList(
      {},
      {
        writer,
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_BASE_URL: baseUrl
        }
      }
    );

    assert.equal(apps.length, 1);
    const output = writer.read();
    assert.match(output, /CODE/);
    assert.match(output, /Leave Request/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAppsList supports --json output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/apps": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ code: "c1", name: "A1", ready: true, visible: false, release: true, tags: "" }]
        })
      );
    }
  });

  const writer = createWriter();
  const keyring = createMemoryKeyring();
  try {
    await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token-json");
    await runAppsList(
      { json: true },
      {
        writer,
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_BASE_URL: baseUrl
        }
      }
    );
    const parsed = JSON.parse(writer.read());
    assert.equal(parsed[0].code, "c1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAppsList surfaces InfoPlus errno failures", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/apps": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 101, ecode: "NO_ACCESS", error: "forbidden", entities: [] }));
    }
  });

  try {
    const keyring = createMemoryKeyring();
    await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
    await assert.rejects(
      runAppsList(
        {},
        {
          writer: createWriter(),
          keyring,
          env: {
            WORKFLOW_CLIENT_ID: "cid",
            WORKFLOW_BASE_URL: baseUrl
          }
        }
      ),
      /InfoPlus API error/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAppsList prompts login when access token is invalid", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/apps": (_req, res) => {
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
    const keyring = createMemoryKeyring();
    await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
    await assert.rejects(
      runAppsList(
        {},
        {
          writer: createWriter(),
          keyring,
          env: {
            WORKFLOW_CLIENT_ID: "cid",
            WORKFLOW_BASE_URL: baseUrl
          }
        }
      ),
      /scope is invalid/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAppsDefinition fetches app schema with includeDefinition=true by default", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/app/BKQDJ?includeDefinition=true": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            {
              code: "BKQDJ",
              name: "补考勤登记",
              currentVersion: {
                schema: {
                  fields: [{ code: "reason", name: "补签原因", type: "string" }]
                }
              }
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  const keyring = createMemoryKeyring();
  try {
    await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
    const app = await runAppsDefinition(
      "BKQDJ",
      {},
      {
        writer,
        keyring,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_BASE_URL: baseUrl
        }
      }
    );

    assert.equal(app.code, "BKQDJ");
    const parsed = JSON.parse(writer.read());
    assert.equal(parsed.currentVersion.schema.fields[0].code, "reason");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runAppsDefinition prompts login when access token is invalid", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/app/BKQDJ?includeDefinition=true": (_req, res) => {
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
    const keyring = createMemoryKeyring();
    await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
    await assert.rejects(
      runAppsDefinition(
        "BKQDJ",
        {},
        {
          writer: createWriter(),
          keyring,
          env: {
            WORKFLOW_CLIENT_ID: "cid",
            WORKFLOW_BASE_URL: baseUrl
          }
        }
      ),
      /scope is invalid/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
