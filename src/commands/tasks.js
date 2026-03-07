import { resolveRuntimeConfig } from "../config.js";
import { loadValidAccessToken } from "../authSession.js";
import {
  executeTask,
  fetchUserCompletedProcesses,
  fetchUserDoingProcesses,
  fetchUserDoneProcesses,
  fetchUserTodoTasks
} from "../infoplusClient.js";
import { getDefaultKeyring } from "../keyring.js";
import { renderTable } from "../output.js";

const TODO_COLUMNS = [
  { key: "id", title: "TASK_ID" },
  { key: "name", title: "TASK_NAME" },
  { key: "status", title: "STATUS" },
  { key: "process.entry", title: "ENTRY" },
  { key: "process.app.code", title: "APP" },
  { key: "update", title: "UPDATE" }
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
  if (!config.username) {
    throw new Error("Missing username. Provide --username or set WORKFLOW_USERNAME.");
  }

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

export async function runTasksTodo(options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let entities;
  try {
    entities = await fetchUserTodoTasks(config, config.username, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }
  renderOrPrintJson(options, writer, entities, TODO_COLUMNS, "No todo tasks found.");
  return entities;
}

export async function runTasksDoing(options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveTaskCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  let entities;
  try {
    entities = await fetchUserDoingProcesses(config, config.username, accessToken, fetchImpl);
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
    entities = await fetchUserDoneProcesses(config, config.username, accessToken, fetchImpl);
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
      fetchUserTodoTasks(config, config.username, accessToken, fetchImpl),
      fetchUserCompletedProcesses(config, config.username, accessToken, fetchImpl)
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
    entities = await executeTask(config, config.username, taskId, accessToken, fetchImpl);
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
    .option("--username <username>", "target username (defaults to WORKFLOW_USERNAME)")
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

  addCommonOptions(tasksCommand.command("execute <taskId>").description("Execute a task by id")).action(
    async (taskId, options) => {
      await runTasksExecute(taskId, options);
    }
  );
}
