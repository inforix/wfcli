import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("wfcli --version prints package version", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--version"]);
  assert.equal(stdout.trim(), version);
});

test("wfcli version command prints package version", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "version"]);
  assert.equal(stdout.trim(), version);
});
