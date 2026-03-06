#!/usr/bin/env node

import dotenv from "dotenv";
import { Command } from "commander";
import { registerAppsCommands } from "./commands/apps.js";

dotenv.config({ quiet: true });

const program = new Command();

program
  .name("wfcli")
  .description("Workflow CLI for SHMTU InfoPlus")
  .version("0.1.0");

registerAppsCommands(program);

program.parseAsync(process.argv).catch((error) => {
  const message = error?.message ?? "Unknown error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
