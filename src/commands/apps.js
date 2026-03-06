import { resolveRuntimeConfig } from "../config.js";
import { fetchSystemToken, fetchUserApps } from "../infoplusClient.js";
import { renderAppsTable } from "../output.js";

export async function runAppsList(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const env = deps.env || process.env;

  const config = resolveRuntimeConfig(options, env);
  if (!config.username) {
    throw new Error("Missing username. Provide --username or set WORKFLOW_USERNAME.");
  }

  const token = await fetchSystemToken(config, fetchImpl);
  const apps = await fetchUserApps(config, config.username, token.accessToken, fetchImpl);

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
    .description("List apps available to a user")
    .option("--username <username>", "target username (defaults to WORKFLOW_USERNAME)")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--scope <scope>", "override WORKFLOW_SCOPE")
    .option("--json", "output raw JSON entities")
    .action(async (options) => {
      await runAppsList(options);
    });
}
