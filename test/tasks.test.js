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

function makeEnv(baseUrl) {
  return {
    WORKFLOW_CLIENT_ID: "cid",
    WORKFLOW_CLIENT_SECRET: "secret",
    WORKFLOW_BASE_URL: baseUrl
  };
}

test("runTasksTodo renders todo tasks from user-scoped endpoint", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/oauth2/token": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "t1" }));
    },
    "GET /infoplus/apis/v2/user/alice/tasks/todo": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer t1");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            {
              id: "task-1",
              name: "Approve",
              status: 1,
              update: 1700000000,
              process: {
                entry: "1001",
                app: { code: "leave" }
              }
            }
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const tasks = await runTasksTodo(
      { username: "alice" },
      {
        writer,
        env: makeEnv(baseUrl)
      }
    );
    assert.equal(tasks.length, 1);
    const output = writer.read();
    assert.match(output, /TASK_ID/);
    assert.match(output, /task-1/);
    assert.match(output, /leave/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksDoing and runTasksDone call process endpoints", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/oauth2/token": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "t2" }));
    },
    "GET /infoplus/apis/v2/user/alice/processes/doing": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "p-doing", name: "Process Doing", status: "doing", entry: "2001", app: { code: "p1" } }]
        })
      );
    },
    "GET /infoplus/apis/v2/user/alice/processes/done": (_req, res) => {
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
    const doing = await runTasksDoing(
      { username: "alice" },
      { writer: doingWriter, env: makeEnv(baseUrl) }
    );
    const done = await runTasksDone(
      { username: "alice" },
      { writer: doneWriter, env: makeEnv(baseUrl) }
    );
    assert.equal(doing[0].id, "p-doing");
    assert.equal(done[0].id, "p-done");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksList returns todo + completed mixed rows", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/oauth2/token": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "t3" }));
    },
    "GET /infoplus/apis/v2/user/alice/tasks/todo": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [{ id: "t1", name: "Todo Task", status: 1, process: { entry: "3001", app: { code: "A1" } } }]
        })
      );
    },
    "GET /infoplus/apis/v2/user/alice/processes/completed": (_req, res) => {
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
    const rows = await runTasksList(
      { username: "alice" },
      {
        writer,
        env: makeEnv(baseUrl)
      }
    );

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

test("runTasksExecute falls back from /tasks/{id} to /task/{id}", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/oauth2/token": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "t4" }));
    },
    "POST /infoplus/apis/v2/tasks/task-42": (_req, res) => {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "not found" }));
    },
    "POST /infoplus/apis/v2/task/task-42": (_req, res, body) => {
      assert.match(body, /userId=alice/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 0, entities: [{ id: "task-42", ok: true }] }));
    }
  });

  const writer = createWriter();
  try {
    const entities = await runTasksExecute(
      "task-42",
      { username: "alice" },
      {
        writer,
        env: makeEnv(baseUrl)
      }
    );

    assert.equal(entities.length, 1);
    assert.match(writer.read(), /Task task-42 execute request submitted/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
