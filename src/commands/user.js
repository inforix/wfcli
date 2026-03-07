import { resolveRuntimeConfig } from "../config.js";
import { loadValidAccessToken } from "../authSession.js";
import { fetchMyPositions, fetchMyProfile } from "../infoplusClient.js";
import { getDefaultKeyring } from "../keyring.js";
import { renderTable } from "../output.js";

const PROFILE_FIELDS = [
  { label: "ID", paths: ["id"] },
  { label: "ACCOUNT", paths: ["account", "username", "userName"] },
  { label: "NAME", paths: ["name", "displayName"] },
  { label: "EMAIL", paths: ["email"] },
  { label: "MOBILE", paths: ["mobile", "phone"] },
  { label: "DEPARTMENT", paths: ["department"] }
];

const POSITION_COLUMNS = [
  { key: "department", title: "DEPARTMENT" },
  { key: "organization", title: "ORGANIZATION" },
  { key: "job", title: "JOB" },
  { key: "primary", title: "PRIMARY" }
];

const DEPARTMENT_COLUMNS = [
  { key: "code", title: "CODE" },
  { key: "name", title: "NAME" }
];

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
    if (candidate === null || candidate === undefined || candidate === "") {
      continue;
    }
    if (typeof candidate === "string") {
      return candidate;
    }
    if (typeof candidate === "number" || typeof candidate === "boolean" || typeof candidate === "bigint") {
      return `${candidate}`;
    }
  }
  return "";
}

function toLoginHintError(error) {
  if (error?.requiresLogin) {
    const ecode = `${error?.payload?.ecode || error?.payload?.error || ""}`.toUpperCase();
    if (ecode.includes("SCOPE")) {
      return new Error(
        'Access token scope is invalid. Run `wfcli auth login --scope "profile data openid app process task start process_edit app_edit triple"` and retry.'
      );
    }
    return new Error('Access token is invalid or expired. Run "wfcli auth login" and retry.');
  }
  return error;
}

function normalizePosition(item) {
  return {
    department: firstDefined(item, [
      "department",
      "departmentName",
      "dept",
      "deptName",
      "dept.name",
      "department.name",
      "org.name",
      "organization.name",
      "group.name"
    ]),
    organization: firstDefined(item, [
      "organization",
      "organizationName",
      "org.name",
      "organization.name",
      "orgPath",
      "path",
      "dept.name"
    ]),
    job: firstDefined(item, [
      "title",
      "position",
      "positionName",
      "post",
      "post.name",
      "job",
      "roleName",
      "role.name"
    ]),
    primary: firstDefined(item, ["primary", "isPrimary", "main", "isMain", "default", "post.formal"])
  };
}

function extractDepartments(positions) {
  const rows = positions
    .map((item) => ({
      code: firstDefined(item, [
        "departmentCode",
        "deptCode",
        "dept.code",
        "department.code",
        "organizationCode",
        "org.code",
        "organization.code"
      ]),
      name: firstDefined(item, [
        "department",
        "departmentName",
        "deptName",
        "dept.name",
        "department.name",
        "organization",
        "organizationName",
        "org.name",
        "organization.name"
      ])
    }))
    .filter((item) => item.code || item.name);

  const deduped = [];
  const seen = new Set();
  for (const item of rows) {
    const key = `${item.code}|${item.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function renderProfile(profile, writer) {
  const rows = PROFILE_FIELDS.map((field) => ({
    label: field.label,
    value: firstDefined(profile, field.paths)
  })).filter((row) => row.value);

  if (rows.length === 0) {
    writer.write(`${JSON.stringify(profile, null, 2)}\n`);
    return;
  }

  const maxLabelLength = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  for (const row of rows) {
    writer.write(`${row.label.padEnd(maxLabelLength)}: ${row.value}\n`);
  }
}

async function fetchTokenAndConfig(options, deps) {
  const env = deps.env || process.env;
  const keyring = deps.keyring || getDefaultKeyring();
  const config = resolveRuntimeConfig(options, env);
  const accessToken = await loadValidAccessToken(config, keyring);
  if (!accessToken) {
    throw new Error('No valid OAuth token found in keyring. Run "wfcli auth login" first.');
  }
  return { config, accessToken };
}

export async function runUserProfile(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const { config, accessToken } = await fetchTokenAndConfig(options, deps);

  let profile;
  try {
    profile = await fetchMyProfile(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }

  if (options.json) {
    writer.write(`${JSON.stringify(profile, null, 2)}\n`);
  } else {
    renderProfile(profile, writer);
  }

  return profile;
}

export async function runUserPositions(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const { config, accessToken } = await fetchTokenAndConfig(options, deps);

  let positions;
  try {
    positions = await fetchMyPositions(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }

  if (options.json) {
    writer.write(`${JSON.stringify(positions, null, 2)}\n`);
    return positions;
  }

  const rows = positions.map(normalizePosition);
  renderTable(rows, POSITION_COLUMNS, writer, "No positions found.");
  return positions;
}

export async function runUserDepartment(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const { config, accessToken } = await fetchTokenAndConfig(options, deps);

  let positions;
  try {
    positions = await fetchMyPositions(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }

  const departments = extractDepartments(positions);
  if (options.json) {
    writer.write(`${JSON.stringify(departments, null, 2)}\n`);
  } else if (departments.length === 0) {
    writer.write("No departments found.\n");
  } else {
    renderTable(departments, DEPARTMENT_COLUMNS, writer, "No departments found.");
  }

  return departments;
}

export function registerUserCommands(program) {
  const userCommand = program.command("user").description("Current user information");

  userCommand
    .command("profile")
    .description("Get current user profile")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--json", "output raw JSON profile")
    .action(async (options) => {
      await runUserProfile(options);
    });

  userCommand
    .command("positions")
    .description("Get current user positions (requires triple scope)")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--json", "output raw JSON positions")
    .action(async (options) => {
      await runUserPositions(options);
    });

  userCommand
    .command("department")
    .description("Get current user's department(s) from positions")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--json", "output JSON departments (code + name)")
    .action(async (options) => {
      await runUserDepartment(options);
    });
}
