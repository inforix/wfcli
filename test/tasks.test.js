import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import {
  runTasksDoing,
  runTasksDone,
  runTasksExecute,
  runTasksList,
  runTasksStart,
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

test("runTasksStart calls PUT /process with start params", async () => {
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res, body) => {
      const params = new URLSearchParams(body);
      assert.equal(params.get("userId"), "alice");
      assert.equal(params.get("assignTo"), "bob");
      assert.equal(params.get("secureURIExpire"), "86400");
      assert.equal(params.get("code"), "BKQDJ");
      assert.equal(params.get("entrance"), "apply");
      assert.equal(params.get("businessId"), "att-2026");
      assert.equal(params.get("data"), '{"reason":"missing clock"}');
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: ["5017842", "8538510", "https://wf.example/form/8538510/render"]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    const entities = await runTasksStart(
      {
        userId: "alice",
        assignTo: "bob",
        secureUriExpire: "86400",
        code: "BKQDJ",
        entrance: "apply",
        businessId: "att-2026",
        data: '{"reason":"missing clock"}',
        submit: false
      },
      await makeDeps(baseUrl, writer)
    );

    assert.equal(entities[0], "5017842");
    assert.match(writer.read(), /Process started successfully\. entry=5017842/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksStart prints next execute hint with task id from start response detail", async () => {
  const taskDetail = {
    code: "SQR",
    id: "bf99236d-ee61-4b0d-a7e4-926f9c8e50ab",
    stepId: 8539959
  };
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            "5018725",
            "8539959",
            "https://wf.example/form/8539959/render",
            JSON.stringify(taskDetail)
          ]
        })
      );
    }
  });

  const writer = createWriter();
  try {
    await runTasksStart({ code: "BKQ", submit: false }, await makeDeps(baseUrl, writer));
    assert.match(writer.read(), /Next: wfcli tasks execute bf99236d-ee61-4b0d-a7e4-926f9c8e50ab --action-code TJ/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksStart can auto-submit started task by id from response detail", async () => {
  let submitted = false;
  const taskDetail = {
    code: "SQR",
    id: "bf99236d-ee61-4b0d-a7e4-926f9c8e50ab",
    stepId: 8539959
  };
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          errno: 0,
          entities: [
            "5018725",
            "8539959",
            "https://wf.example/form/8539959/render",
            JSON.stringify(taskDetail)
          ]
        })
      );
    },
    "POST /infoplus/apis/v2/task/bf99236d-ee61-4b0d-a7e4-926f9c8e50ab": (_req, res, body) => {
      submitted = true;
      const params = new URLSearchParams(body);
      assert.equal(params.get("userId"), "993333");
      assert.equal(params.get("actionCode"), "TJ");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 0, entities: [{ ok: true }] }));
    }
  });

  const writer = createWriter();
  try {
    await runTasksStart({ code: "BKQ", userId: "993333", submit: true, submitActionCode: "TJ" }, await makeDeps(baseUrl, writer));
    assert.equal(submitted, true);
    assert.match(writer.read(), /Start task submitted successfully\./);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksStart falls back to POST /process when PUT fails", async () => {
  let count = 0;
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res) => {
      count += 1;
      res.statusCode = 405;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 405, ecode: "METHOD_NOT_ALLOWED", error: "METHOD_NOT_ALLOWED" }));
    },
    "POST /infoplus/apis/v2/process": (_req, res, body) => {
      count += 1;
      const params = new URLSearchParams(body);
      assert.equal(params.get("code"), "BKQ");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 0, entities: ["5017999", "9001", "https://wf.example/form/9001/render"] }));
    }
  });

  try {
    const entities = await runTasksStart({ code: "BKQ", submit: false }, await makeDeps(baseUrl));
    assert.equal(entities[0], "5017999");
    assert.equal(count, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksStart accepts empty 2xx response as compatibility success", async () => {
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res) => {
      res.statusCode = 200;
      res.end("");
    }
  });

  const writer = createWriter();
  try {
    const entities = await runTasksStart({ code: "BKQ", submit: false }, await makeDeps(baseUrl, writer));
    assert.deepEqual(entities, []);
    assert.match(writer.read(), /API returned empty response/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksStart falls back to query access_token when auth header path fails", async () => {
  let count = 0;
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res) => {
      count += 1;
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 401, ecode: "UNAUTHORIZED", error: "UNAUTHORIZED" }));
    },
    "POST /infoplus/apis/v2/process": (_req, res) => {
      count += 1;
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 401, ecode: "UNAUTHORIZED", error: "UNAUTHORIZED" }));
    },
    "PUT /infoplus/apis/v2/process?access_token=shared-token": (_req, res) => {
      count += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errno: 0, entities: ["5020001", "9002", "https://wf.example/form/9002/render"] }));
    }
  });

  try {
    const entities = await runTasksStart({ code: "BKQ", submit: false }, await makeDeps(baseUrl));
    assert.equal(entities[0], "5020001");
    assert.equal(count, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runTasksStart prompts login when token is invalid", async () => {
  const { server, baseUrl } = await startMockServer({
    "PUT /infoplus/apis/v2/process": (_req, res) => {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ecode: "ACCESS_TOKEN_EXPIRED", error: "ACCESS_TOKEN_EXPIRED" }));
    }
  });

  try {
    await assert.rejects(
      runTasksStart({ submit: false }, await makeDeps(baseUrl)),
      /Access token is invalid or expired/
    );
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
