import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { runAppsList } from "../src/commands/apps.js";

function createWriter() {
  let data = "";
  return {
    write(chunk) {
      data += chunk;
      return true;
    },
    read() {
      return data;
    }
  };
}

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
    "POST /infoplus/oauth2/token": (req, res, body) => {
      assert.match(req.headers.authorization || "", /^Basic /);
      assert.match(body, /grant_type=client_credentials/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "token123", token_type: "bearer", expires_in: 3600 }));
    },
    "GET /infoplus/apis/v2/user/alice/apps": (req, res) => {
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
  try {
    const apps = await runAppsList(
      { username: "alice" },
      {
        writer,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_CLIENT_SECRET: "secret",
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
    "POST /infoplus/oauth2/token": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "token-json" }));
    },
    "GET /infoplus/apis/v2/user/alice/apps": (_req, res) => {
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
  try {
    await runAppsList(
      { username: "alice", json: true },
      {
        writer,
        env: {
          WORKFLOW_CLIENT_ID: "cid",
          WORKFLOW_CLIENT_SECRET: "secret",
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
    "POST /infoplus/oauth2/token": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "token123" }));
    },
    "GET /infoplus/apis/v2/user/alice/apps": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 101, ecode: "NO_ACCESS", error: "forbidden", entities: [] }));
    }
  });

  try {
    await assert.rejects(
      runAppsList(
        { username: "alice" },
        {
          writer: createWriter(),
          env: {
            WORKFLOW_CLIENT_ID: "cid",
            WORKFLOW_CLIENT_SECRET: "secret",
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
