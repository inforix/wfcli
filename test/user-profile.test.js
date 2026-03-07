import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { runUserDepartment, runUserPositions, runUserProfile } from "../src/commands/user.js";
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

test("runUserPositions fetches /me/positions and renders table output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            {
              departmentName: "信息办",
              organizationName: "上海海事大学",
              positionName: "工程师",
              isMain: true
            },
            {
              deptName: "网络中心",
              org: { name: "上海海事大学" },
              roleName: "兼职管理员",
              isMain: false
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const positions = await runUserPositions({}, await makeDeps(baseUrl, writer));
    assert.equal(positions.length, 2);
    const output = writer.read();
    assert.match(output, /DEPARTMENT/);
    assert.match(output, /信息办/);
    assert.match(output, /工程师/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserPositions reads nested dept/post payload structure", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            {
              post: { name: "部门副职领导", formal: true },
              dept: { name: "教务处" },
              code: "993333",
              source: "PULL"
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const positions = await runUserPositions({}, await makeDeps(baseUrl, writer));
    assert.equal(positions.length, 1);
    const output = writer.read();
    assert.match(output, /教务处/);
    assert.match(output, /部门副职领导/);
    assert.match(output, /true/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserDepartment returns unique department list", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            { dept: { code: "1001", name: "信息办" } },
            { dept: { code: "1002", name: "网络中心" } },
            { dept: { code: "1001", name: "信息办" } }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const departments = await runUserDepartment({}, await makeDeps(baseUrl, writer));
    assert.deepEqual(departments, [
      { code: "1001", name: "信息办" },
      { code: "1002", name: "网络中心" }
    ]);
    const output = writer.read();
    assert.match(output, /CODE/);
    assert.match(output, /NAME/);
    assert.match(output, /1001/);
    assert.match(output, /信息办/);
    assert.match(output, /1002/);
    assert.match(output, /网络中心/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserDepartment ignores object values and resolves nested names", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            { organization: { code: "1001", name: "信息办" } },
            { org: { code: "1002", name: "网络中心" } }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const departments = await runUserDepartment({ json: true }, await makeDeps(baseUrl, writer));
    assert.deepEqual(departments, [
      { code: "1001", name: "信息办" },
      { code: "1002", name: "网络中心" }
    ]);
    const payload = JSON.parse(writer.read());
    assert.deepEqual(payload, [
      { code: "1001", name: "信息办" },
      { code: "1002", name: "网络中心" }
    ]);
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

test("runUserPositions supports --json output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ departmentName: "信息办", positionName: "工程师" }]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const positions = await runUserPositions({ json: true }, await makeDeps(baseUrl, writer));
    assert.equal(positions[0].departmentName, "信息办");
    const payload = JSON.parse(writer.read());
    assert.equal(payload[0].positionName, "工程师");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserDepartment supports --json output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            { dept: { code: "1001", name: "信息办" } },
            { dept: { code: "1002", name: "网络中心" } }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const departments = await runUserDepartment({ json: true }, await makeDeps(baseUrl, writer));
    assert.deepEqual(departments, [
      { code: "1001", name: "信息办" },
      { code: "1002", name: "网络中心" }
    ]);
    const payload = JSON.parse(writer.read());
    assert.deepEqual(payload, [
      { code: "1001", name: "信息办" },
      { code: "1002", name: "网络中心" }
    ]);
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
    await assert.rejects(runUserProfile({}, await makeDeps(baseUrl)), /scope is invalid/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runUserPositions suggests triple scope when token scope is invalid", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/positions": (_req, res) => {
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
    await assert.rejects(runUserPositions({}, await makeDeps(baseUrl)), /triple/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
