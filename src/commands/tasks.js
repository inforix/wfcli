import { resolveRuntimeConfig } from "../config.js";
import { loadValidAccessToken } from "../authSession.js";
import {
  executeTask,
  fetchMyCompletedProcesses,
  fetchMyDoingProcesses,
  fetchMyDoneProcesses,
  fetchMyTodoTasks
} from "../infoplusClient.js";
import { getDefaultKeyring } from "../keyring.js";
import { renderTable } from "../output.js";

const TODO_COLUMNS = [
  { key: "taskId", title: "TASK_ID" },
  { key: "processUri", title: "PROCESS_URI" },
  { key: "name", title: "NAME" },
  { key: "sourceUsername", title: "SOURCE_USERNAME" },
  { key: "date", title: "DATE" }
];

const PROCESS_COLUMNS = [
  { key: "id", title: "PROCESS_ID" },
  { key: "name", title: "PROCESS_NAME" },
  { key: "status", title: "STATUS" },
  { key: "entry", title: "ENTRY" },
  { key: "app.code", title: "APP" },
  { key: "update", title: "UPDATE" }
];

const MIXED_LIST_COLUMNS = [
  { key: "type", title: "TYPE" },
  { key: "id", title: "ID" },
  { key: "name", title: "NAME" },
  { key: "status", title: "STATUS" },
  { key: "entry", title: "ENTRY" },
  { key: "app", title: "APP" },
  { key: "update", title: "UPDATE" }
];

function toLoginHintError(error) {
  if (error?.requiresLogin) {
    const ecode = `${error?.payload?.ecode || error?.payload?.error || ""}`.toUpperCase();
    if (ecode.includes("SCOPE")) {
      return new Error(
        'Access token scope is invalid. Run "wfcli auth login --scope app+task+process+data+openid+profile" and retry.'
      );
    }
    return new Error('Access token is invalid or expired. Run "wfcli auth login" and retry.');
  }
  return error;
}

function resolveTaskCommandContext(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const env = deps.env || process.env;
  const keyring = deps.keyring || getDefaultKeyring();
  const config = resolveRuntimeConfig(options, env);

  return { fetchImpl, writer, keyring, config };
}

async function fetchTokenForCommand(config, keyring) {
  const accessToken = await loadValidAccessToken(config, keyring);
  if (!accessToken) {
    throw new Error('No valid OAuth token found in keyring. Run "wfcli auth login" first.');
  }
  return accessToken;
}

function renderOrPrintJson(options, writer, entities, columns, emptyMessage) {
  if (options.json) {
    writer.write(`${JSON.stringify(entities, null, 2)}\n`);
    return;
  }
  renderTable(entities, columns, writer, emptyMessage);
}

function toUnifiedList(todoTasks, completedProcesses) {
  const todoRows = todoTasks.map((task) => ({
    type: "task",
    id: task.id,
    name: task.name,
    status: task.status,
    entry: task.process?.entry,
    app: task.process?.app?.code || task.process?.app?.name,
    update: task.update
  }));
  const completedRows = completedProcesses.map((process) => ({
    type: "process",
    id: process.id,
    name: process.name,
    status: process.status,
    entry: process.entry,
    app: process.app?.code || process.app?.name,
    update: process.update
  }));

  return [...todoRows, ...completedRows];
}

function getByPath(value, path) {
  return path.split(".").reduce((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return current[key];
  }, value);
}

function firstDefined(value, paths) {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (candidate !== null && candidate !== undefined && candidate !== "") {
      return candidate;
    }
  }
  return "";
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    return new Date(ms).toISOString();
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    return String(value);
  }
  return new Date(parsed).toISOString();
}

function toTodoRows(tasks) {
  return tasks.map((task) => ({
    taskId: firstDefined(task, ["id", "taskId"]),
    processUri: firstDefined(task, ["process.uri", "process.url", "uri", "url", "process.entry"]),
    name: firstDefined(task, ["process.name", "name"]),
    sourceUsername: firstDefined(task, [
      "process.owner.account",
      "process.owner.name",
      "source.username",
      "source.userName",
      "sourceUsername",
      "sourceUserName",
      "username",
      "userName",
      "assignUser.account",
      "assignUser.name",
      "process.source.username",
      "process.source.userName"
    ]),
    date: normalizeDate(
      firstDefined(task, [
        "assignTime",
        "process.update",
        "process.create",
        "update",
        "createdAt",
        "createTime",
        "createDate",
        "date"
      ])
    )
  }));
}

export async function runTasksTodo(options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let entities;
  try {
    entities = await fetchMyTodoTasks(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }
  const rows = toTodoRows(entities);
  renderOrPrintJson(options, writer, rows, TODO_COLUMNS, "No todo tasks found.");
  return rows;
}

export async function runTasksDoing(options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let entities;
  try {
    entities = await fetchMyDoingProcesses(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }
  renderOrPrintJson(options, writer, entities, PROCESS_COLUMNS, "No doing processes found.");
  return entities;
}

export async function runTasksDone(options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let entities;
  try {
    entities = await fetchMyDoneProcesses(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }
  renderOrPrintJson(options, writer, entities, PROCESS_COLUMNS, "No done processes found.");
  return entities;
}

export async function runTasksList(options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let todoTasks;
  let completedProcesses;
  try {
    [todoTasks, completedProcesses] = await Promise.all([
      fetchMyTodoTasks(config, accessToken, fetchImpl),
      fetchMyCompletedProcesses(config, accessToken, fetchImpl)
    ]);
  } catch (error) {
    throw toLoginHintError(error);
  }
  const entities = toUnifiedList(todoTasks, completedProcesses);
  renderOrPrintJson(options, writer, entities, MIXED_LIST_COLUMNS, "No tasks or completed processes found.");
  return entities;
}

export async function runTasksExecute(taskId, options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let entities;
  try {
    entities = await executeTask(
      config,
      taskId,
      accessToken,
      {
        userId: options.username || config.username,
        actionId: options.actionId,
        actionCode: options.actionCode,
        remark: options.remark,
        thing: options.thing,
        pickup: options.pickup
      },
      fetchImpl
    );
  } catch (error) {
    throw toLoginHintError(error);
  }

  if (options.json) {
    writer.write(`${JSON.stringify(entities, null, 2)}\n`);
  } else {
    writer.write(`Task ${taskId} execute request submitted.\n`);
  }

  return entities;
}

function addCommonOptions(command) {
  return command
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--json", "output raw JSON entities");
}

export function registerTasksCommands(program) {
  const tasksCommand = program.command("tasks").description("Manage user tasks and processes");

  addCommonOptions(tasksCommand.command("todo").description("Get todo tasks")).action(async (options) => {
    await runTasksTodo(options);
  });

  addCommonOptions(tasksCommand.command("doing").description("Get doing processes")).action(
    async (options) => {
      await runTasksDoing(options);
    }
  );

  addCommonOptions(tasksCommand.command("done").description("Get done processes")).action(async (options) => {
    await runTasksDone(options);
  });

  addCommonOptions(
    tasksCommand
      .command("list")
      .description("Get mixed list: todo tasks + completed processes")
  ).action(async (options) => {
    await runTasksList(options);
  });

  addCommonOptions(tasksCommand.command("execute <taskId>").description("Execute a task by id"))
    .option("--username <username>", "optional userId for task submit (defaults to WORKFLOW_USERNAME)")
    .option("--action-id <id>", "optional actionId for one-click action")
    .option("--action-code <code>", "optional actionCode for one-click action")
    .option("--remark <text>", "optional remark text")
    .option("--thing <code>", "optional thing code")
    .option("--pickup <code>", "optional pickup code")
    .action(async (taskId, options) => {
      await runTasksExecute(taskId, options);
    });
}
