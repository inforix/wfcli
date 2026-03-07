#!/usr/bin/env node

import dotenv from "dotenv";
import { createRequire } from "node:module";
import { Command } from "commander";
import { registerAppsCommands } from "./commands/apps.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerFileCommands } from "./commands/file.js";
import { registerTasksCommands } from "./commands/tasks.js";
import { registerVersionCommands } from "./commands/version.js";

dotenv.config({ quiet: true });

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("wfcli")
  .description("Workflow CLI for SHMTU InfoPlus")
  .version(version);

registerAppsCommands(program);
registerTasksCommands(program);
registerAuthCommands(program);
registerFileCommands(program);
registerVersionCommands(program, version);

program.parseAsync(process.argv).catch((error) => {
  const message = error?.message ?? "Unknown error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
