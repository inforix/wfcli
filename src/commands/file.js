import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { resolveRuntimeConfig } from "../config.js";
import { loadValidAccessToken } from "../authSession.js";
import {
  deleteFile,
  downloadFile,
  fetchFileMeta,
  updateFile,
  uploadFile
} from "../infoplusClient.js";
import { getDefaultKeyring } from "../keyring.js";

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

function resolveFileCommandContext(options, deps = {}) {
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

function outputJsonOrText(options, writer, payload, message) {
  if (options.json) {
    writer.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  writer.write(`${message}\n`);
}

function filenameFromContentDisposition(value) {
  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(value || "");
  if (!match?.[1]) {
    return "";
  }
  return decodeURIComponent(match[1]).replace(/"/g, "");
}

export async function runFileUpload(filePath, options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveFileCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  const content = await readFile(filePath);
  const fileName = options.name || path.basename(filePath);

  try {
    const payload = await uploadFile(
      config,
      accessToken,
      { fileName, content, keepFileName: Boolean(options.keepName) },
      fetchImpl
    );
    outputJsonOrText(options, writer, payload, `Uploaded file "${fileName}" successfully.`);
    return payload;
  } catch (error) {
    throw toLoginHintError(error);
  }
}

export async function runFileUpdate(fileKey, filePath, options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveFileCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);
  const content = await readFile(filePath);
  const fileName = options.name || path.basename(filePath);

  try {
    const payload = await updateFile(
      config,
      fileKey,
      accessToken,
      { fileName, content, keepFileName: Boolean(options.keepName) },
      fetchImpl
    );
    outputJsonOrText(options, writer, payload, `Updated file "${fileKey}" successfully.`);
    return payload;
  } catch (error) {
    throw toLoginHintError(error);
  }
}

export async function runFileMeta(fileKey, options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveFileCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);

  try {
    const payload = await fetchFileMeta(config, fileKey, accessToken, fetchImpl);
    outputJsonOrText(options, writer, payload, JSON.stringify(payload, null, 2));
    return payload;
  } catch (error) {
    throw toLoginHintError(error);
  }
}

export async function runFileDelete(fileKey, options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveFileCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);

  try {
    const payload = await deleteFile(config, fileKey, accessToken, fetchImpl);
    outputJsonOrText(options, writer, payload, `Deleted file "${fileKey}" successfully.`);
    return payload;
  } catch (error) {
    throw toLoginHintError(error);
  }
}

export async function runFileDownload(fileKey, options, deps = {}) {
  const { fetchImpl, writer, keyring, config } = resolveFileCommandContext(options, deps);
  const accessToken = await fetchTokenForCommand(config, keyring);

  try {
    const payload = await downloadFile(config, fileKey, accessToken, fetchImpl);
    const headerName = filenameFromContentDisposition(payload.contentDisposition);
    const outputPath = options.output || headerName || `${fileKey.split("/").pop() || "download"}.bin`;
    await writeFile(outputPath, payload.data);
    const result = { path: outputPath, bytes: payload.data.length, contentType: payload.contentType };
    outputJsonOrText(options, writer, result, `Downloaded file to ${outputPath} (${payload.data.length} bytes).`);
    return result;
  } catch (error) {
    throw toLoginHintError(error);
  }
}

function addFileOptions(command) {
  return command
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option("--json", "output JSON response");
}

export function registerFileCommands(program) {
  const fileCommand = program.command("file").description("Manage InfoPlus file APIs");

  addFileOptions(fileCommand.command("upload <path>").description("Upload a local file"))
    .option("--name <filename>", "override upload filename")
    .option("--keep-name", "keep original filename on server")
    .action(async (filePath, options) => {
      await runFileUpload(filePath, options);
    });

  addFileOptions(fileCommand.command("update <fileKey> <path>").description("Update a file by key"))
    .option("--name <filename>", "override upload filename")
    .option("--keep-name", "keep original filename on server")
    .action(async (fileKey, filePath, options) => {
      await runFileUpdate(fileKey, filePath, options);
    });

  addFileOptions(fileCommand.command("meta <fileKey>").description("Get file metadata")).action(
    async (fileKey, options) => {
      await runFileMeta(fileKey, options);
    }
  );

  addFileOptions(fileCommand.command("delete <fileKey>").description("Delete a file by key")).action(
    async (fileKey, options) => {
      await runFileDelete(fileKey, options);
    }
  );

  addFileOptions(fileCommand.command("download <fileKey>").description("Download a file by key"))
    .option("--output <path>", "save location (defaults from filename header)")
    .action(async (fileKey, options) => {
      await runFileDownload(fileKey, options);
    });
}
