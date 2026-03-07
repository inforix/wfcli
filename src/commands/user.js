import { resolveRuntimeConfig } from "../config.js";
import { loadValidAccessToken } from "../authSession.js";
import { fetchMyProfile } from "../infoplusClient.js";
import { getDefaultKeyring } from "../keyring.js";

const PROFILE_FIELDS = [
  { label: "ID", paths: ["id"] },
  { label: "ACCOUNT", paths: ["account", "username", "userName"] },
  { label: "NAME", paths: ["name", "displayName"] },
  { label: "EMAIL", paths: ["email"] },
  { label: "MOBILE", paths: ["mobile", "phone"] },
  { label: "DEPARTMENT", paths: ["department"] }
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
    if (candidate !== null && candidate !== undefined && candidate !== "") {
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
        'Access token scope is invalid. Run `wfcli auth login --scope "profile data openid app process task start process_edit app_edit"` and retry.'
      );
    }
    return new Error('Access token is invalid or expired. Run "wfcli auth login" and retry.');
  }
  return error;
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

export async function runUserProfile(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const env = deps.env || process.env;
  const keyring = deps.keyring || getDefaultKeyring();

  const config = resolveRuntimeConfig(options, env);

  const accessToken = await loadValidAccessToken(config, keyring);
  if (!accessToken) {
    throw new Error('No valid OAuth token found in keyring. Run "wfcli auth login" first.');
  }

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
}
