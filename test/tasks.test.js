import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import {
  runTasksDoing,
  runTasksDone,
  runTasksExecute,
  runTasksList,
  runTasksTodo
} from "../src/commands/tasks.js";
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

function makeEnv(baseUrl) {
  return {
    WORKFLOW_CLIENT_ID: "cid",
    WORKFLOW_BASE_URL: baseUrl
  };
}

async function makeDeps(baseUrl, writer = createWriter()) {
  const keyring = createMemoryKeyring();
  await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "shared-token");
  return {
    writer,
    keyring,
    env: makeEnv(baseUrl)
  };
}

test("runTasksTodo renders todo tasks from me-scoped endpoint", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/tasks/todo": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer shared-token");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            {
              id: "task-1",
              name: "Department Review",
              status: 1,
              assignTime: 1700000500,
              assignUser: { account: "993333" },
              process: {
                uri: "/process/1001",
                entry: "1001",
                name: "Process A",
                app: { code: "leave" },
                owner: { account: "155212" }
              }
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const tasks = await runTasksTodo({}, await makeDeps(baseUrl, writer));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].taskId, "task-1");
    assert.equal(tasks[0].processUri, "/process/1001");
    assert.equal(tasks[0].name, "Process A");
    assert.equal(tasks[0].sourceUsername, "155212");
    assert.equal(tasks[0].date, "2023-11-14T22:21:40.000Z");
    const output = writer.read();
    assert.match(output, /TASK_ID/);
    assert.match(output, /task-1/);
    assert.match(output, /PROCESS_URI/);
    assert.match(output, /SOURCE_USERNAME/);
    assert.match(output, /2023-11-14T22:21:40.000Z/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksDoing and runTasksDone call process endpoints", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/processes/doing": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "p-doing", name: "Process Doing", status: "doing", entry: "2001", app: { code: "p1" } }]
        })
      );
    },
    "GET /infoplus/apis/v2/me/processes/done": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "p-done", name: "Process Done", status: "done", entry: "2002", app: { code: "p2" } }]
        })
      );
    }
  });

  try {
    const doingWriter = createWriter();
    const doneWriter = createWriter();
    const doing = await runTasksDoing({}, await makeDeps(baseUrl, doingWriter));
    const done = await runTasksDone({}, await makeDeps(baseUrl, doneWriter));
    assert.equal(doing[0].id, "p-doing");
    assert.equal(done[0].id, "p-done");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksList returns todo + completed mixed rows", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/tasks/todo": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "t1", name: "Todo Task", status: 1, process: { entry: "3001", app: { code: "A1" } } }]
        })
      );
    },
    "GET /infoplus/apis/v2/me/processes/completed": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "p1", name: "Completed Proc", status: "done", entry: "3002", app: { code: "A2" } }]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const rows = await runTasksList({}, await makeDeps(baseUrl, writer));

    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, "task");
    assert.equal(rows[1].type, "process");
    const output = writer.read();
    assert.match(output, /TYPE/);
    assert.match(output, /Completed Proc/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksExecute calls /task/{id} and forwards submit params", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/apis/v2/task/task-42": (_req, res, body) => {
      assert.match(body, /userId=alice/);
      assert.match(body, /actionId=7/);
      assert.match(body, /actionCode=approve/);
      assert.match(body, /remark=ok/);
      assert.match(body, /thing=thing-1/);
      assert.match(body, /pickup=pickup-1/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 0, entities: [{ id: "task-42", ok: true }] }));
    }
  });

  const writer = createWriter();
  try {
    const entities = await runTasksExecute(
      "task-42",
      {
        username: "alice",
        actionId: "7",
        actionCode: "approve",
        remark: "ok",
        thing: "thing-1",
        pickup: "pickup-1"
      },
      await makeDeps(baseUrl, writer)
    );

    assert.equal(entities.length, 1);
    assert.match(writer.read(), /Task task-42 execute request submitted/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksExecute works without username", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/apis/v2/task/task-42": (_req, res, body) => {
      assert.doesNotMatch(body, /userId=/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 0, entities: [{ id: "task-42", ok: true }] }));
    }
  });

  try {
    const result = await runTasksExecute("task-42", {}, await makeDeps(baseUrl));
    assert.equal(result[0].id, "task-42");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksTodo prompts login when token is invalid", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/apis/v2/me/tasks/todo": (_req, res) => {
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
    await assert.rejects(runTasksTodo({}, await makeDeps(baseUrl)), /scope is invalid/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
