#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const IS_WINDOWS = process.platform === "win32";

function detectLibc() {
  if (process.platform !== "linux") {
    return null;
  }
  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

function resolveSuffix() {
  const libc = detectLibc();
  const key = [process.platform, process.arch, libc].filter(Boolean).join("-");

  const mapping = {
    "darwin-x64": "darwin-x64",
    "darwin-arm64": "darwin-arm64",
    "linux-x64-glibc": "linux-x64-gnu",
    "linux-x64-musl": "linux-x64-musl",
    "linux-arm64-glibc": "linux-arm64-gnu",
    "linux-arm64-musl": "linux-arm64-musl",
    "win32-x64": "win32-x64-msvc",
    "win32-arm64": "win32-arm64-msvc"
  };

  return mapping[key] || mapping[[process.platform, process.arch].join("-")] || null;
}

function platformPackageName(baseName, suffix) {
  if (baseName.startsWith("@")) {
    const slashIndex = baseName.indexOf("/");
    const scope = baseName.slice(0, slashIndex);
    const bare = baseName.slice(slashIndex + 1);
    return `${scope}/${bare}-${suffix}`;
  }
  return `${baseName}-${suffix}`;
}

function resolveFromPlatformPackage() {
  const suffix = resolveSuffix();
  if (!suffix) {
    return null;
  }

  const packageJson = require("../package.json");
  const packageName = platformPackageName(packageJson.name, suffix);

  try {
    const pkgJsonPath = require.resolve(`${packageName}/package.json`);
    const pkgDir = dirname(pkgJsonPath);
    const binName = IS_WINDOWS ? "wfcli.exe" : "wfcli";
    const candidate = join(pkgDir, "bin", binName);
    if (existsSync(candidate)) {
      return candidate;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveDevBinary() {
  const binary = IS_WINDOWS ? "target/release/wfcli.exe" : "target/release/wfcli";
  const candidate = resolve(process.cwd(), binary);
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

const binaryPath = resolveFromPlatformPackage() || resolveDevBinary();

if (!binaryPath) {
  console.error(
    "Error: no wfcli binary found. Install matching platform package or run `npm run rust:build` first."
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
if (typeof result.status === "number") {
  process.exit(result.status);
}
process.exit(1);
