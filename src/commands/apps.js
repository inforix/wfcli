import { resolveRuntimeConfig } from "../config.js";
import { loadValidAccessToken } from "../authSession.js";
import { fetchMyApps } from "../infoplusClient.js";
import { getDefaultKeyring } from "../keyring.js";
import { renderAppsTable } from "../output.js";

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

export async function runAppsList(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const env = deps.env || process.env;
  const keyring = deps.keyring || getDefaultKeyring();

  const config = resolveRuntimeConfig(options, env);

  const accessToken = await loadValidAccessToken(config, keyring);
  if (!accessToken) {
    throw new Error('No valid OAuth token found in keyring. Run "wfcli auth login" first.');
  }
  let apps;
  try {
    apps = await fetchMyApps(config, accessToken, fetchImpl);
  } catch (error) {
    throw toLoginHintError(error);
  }

  if (options.json) {
    writer.write(`${JSON.stringify(apps, null, 2)}\n`);
    return apps;
  }

  renderAppsTable(apps, writer);
  return apps;
}

export function registerAppsCommands(program) {
  const appsCommand = program.command("apps").description("Manage workflow apps");

  appsCommand
    .command("list")
    .description("List current user's apps (personal API)")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--json", "output raw JSON entities")
    .action(async (options) => {
      await runAppsList(options);
    });
}
