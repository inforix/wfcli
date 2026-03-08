#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const ROOT_PACKAGE_JSON = JSON.parse(readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));

const MAIN_PACKAGE_NAME = process.env.NPM_MAIN_PACKAGE_NAME || ROOT_PACKAGE_JSON.name || "wfcli";
const PACKAGE_VERSION = process.env.NPM_PACKAGE_VERSION || ROOT_PACKAGE_JSON.version || "0.0.0";
const BINARY_BASENAME = process.env.BINARY_BASENAME || "wfcli";
const BINARIES_ROOT = path.resolve(process.env.BINARIES_ROOT || "dist/binaries");
const OUT_ROOT = path.resolve(process.env.OUT_ROOT || "dist/npm");
const ALLOW_MISSING_BINARIES = process.env.ALLOW_MISSING_BINARIES === "1";

const TARGETS = [
  { triple: "x86_64-apple-darwin", suffix: "darwin-x64", os: ["darwin"], cpu: ["x64"] },
  { triple: "aarch64-apple-darwin", suffix: "darwin-arm64", os: ["darwin"], cpu: ["arm64"] },
  { triple: "x86_64-unknown-linux-gnu", suffix: "linux-x64-gnu", os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
  { triple: "x86_64-unknown-linux-musl", suffix: "linux-x64-musl", os: ["linux"], cpu: ["x64"], libc: ["musl"] },
  { triple: "aarch64-unknown-linux-gnu", suffix: "linux-arm64-gnu", os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
  { triple: "aarch64-unknown-linux-musl", suffix: "linux-arm64-musl", os: ["linux"], cpu: ["arm64"], libc: ["musl"] },
  { triple: "x86_64-pc-windows-msvc", suffix: "win32-x64-msvc", os: ["win32"], cpu: ["x64"] },
  { triple: "aarch64-pc-windows-msvc", suffix: "win32-arm64-msvc", os: ["win32"], cpu: ["arm64"] }
];

function splitScopedName(name) {
  if (name.startsWith("@")) {
    const slashIndex = name.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid scoped npm package name: ${name}`);
    }
    return { scope: name.slice(0, slashIndex), bare: name.slice(slashIndex + 1) };
  }
  return { scope: "", bare: name };
}

function platformPackageName(mainName, suffix) {
  const { scope, bare } = splitScopedName(mainName);
  if (scope) {
    return `${scope}/${bare}-${suffix}`;
  }
  return `${bare}-${suffix}`;
}

function jsLauncherSource(mainName, targets) {
  const targetMap = Object.fromEntries(
    targets.map((target) => [target.suffix, platformPackageName(mainName, target.suffix)])
  );
  const binaryName = `${BINARY_BASENAME}`;

  return `#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

function resolveBinaryPath() {
  const suffix = resolveSuffix();
  if (!suffix) {
    throw new Error(
      "Unsupported platform/arch: " + process.platform + "/" + process.arch + ". Please install from source."
    );
  }

  const packageMap = ${JSON.stringify(targetMap, null, 2)};
  const packageName = packageMap[suffix];
  if (!packageName) {
    throw new Error("No package mapping for target suffix: " + suffix);
  }

  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(packageName + "/package.json");
  } catch {
    throw new Error(
      "Missing platform package " + packageName + ". Reinstall dependencies to fetch optionalDependencies."
    );
  }

  const packageDir = dirname(packageJsonPath);
  const binName = IS_WINDOWS ? "${binaryName}.exe" : "${binaryName}";
  const binaryPath = join(packageDir, "bin", binName);

  if (!existsSync(binaryPath)) {
    throw new Error("Platform binary not found: " + binaryPath);
  }

  return binaryPath;
}

const binaryPath = resolveBinaryPath();
const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
`;
}

function packageReadme(name) {
  return `# ${name}\n\nPlatform-specific binary package for ${MAIN_PACKAGE_NAME}.\n`;
}

function writeJson(filePath, payload) {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function binaryFileNameForTarget(target) {
  return target.os.includes("win32") ? `${BINARY_BASENAME}.exe` : BINARY_BASENAME;
}

function sourceBinaryPath(target) {
  return path.join(BINARIES_ROOT, target.triple, binaryFileNameForTarget(target));
}

function generateMainPackage(outRoot, targets) {
  const mainDir = path.join(outRoot, "main");
  const binDir = path.join(mainDir, "bin");
  ensureDir(binDir);

  const optionalDependencies = Object.fromEntries(
    targets.map((target) => [platformPackageName(MAIN_PACKAGE_NAME, target.suffix), PACKAGE_VERSION])
  );

  writeJson(path.join(mainDir, "package.json"), {
    name: MAIN_PACKAGE_NAME,
    version: PACKAGE_VERSION,
    description: ROOT_PACKAGE_JSON.description || "Workflow CLI",
    license: ROOT_PACKAGE_JSON.license || "ISC",
    type: "module",
    bin: {
      [BINARY_BASENAME]: "bin/wfcli.js"
    },
    files: ["bin", "README.md"],
    optionalDependencies
  });

  writeFileSync(path.join(binDir, "wfcli.js"), jsLauncherSource(MAIN_PACKAGE_NAME, targets), "utf8");
  chmodSync(path.join(binDir, "wfcli.js"), 0o755);
  writeFileSync(path.join(mainDir, "README.md"), packageReadme(MAIN_PACKAGE_NAME), "utf8");
}

function generatePlatformPackage(outRoot, target) {
  const pkgName = platformPackageName(MAIN_PACKAGE_NAME, target.suffix);
  const packageDir = path.join(outRoot, target.suffix);
  const binDir = path.join(packageDir, "bin");
  ensureDir(binDir);

  const srcBinary = sourceBinaryPath(target);
  if (!existsSync(srcBinary)) {
    if (ALLOW_MISSING_BINARIES) {
      return false;
    }
    throw new Error(
      `Missing binary for target ${target.triple}: expected ${srcBinary}. Build binaries first.`
    );
  }

  const outBinaryName = binaryFileNameForTarget(target);
  const outBinaryPath = path.join(binDir, outBinaryName);
  copyFileSync(srcBinary, outBinaryPath);

  if (!target.os.includes("win32")) {
    chmodSync(outBinaryPath, 0o755);
  }

  writeJson(path.join(packageDir, "package.json"), {
    name: pkgName,
    version: PACKAGE_VERSION,
    description: `${MAIN_PACKAGE_NAME} binary for ${target.suffix}`,
    license: ROOT_PACKAGE_JSON.license || "ISC",
    os: target.os,
    cpu: target.cpu,
    ...(target.libc ? { libc: target.libc } : {}),
    files: ["bin", "README.md"]
  });

  writeFileSync(path.join(packageDir, "README.md"), packageReadme(pkgName), "utf8");
  return true;
}

function main() {
  rmSync(OUT_ROOT, { recursive: true, force: true });
  ensureDir(OUT_ROOT);

  const generatedTargets = [];
  for (const target of TARGETS) {
    const generated = generatePlatformPackage(OUT_ROOT, target);
    if (generated) {
      generatedTargets.push(target.suffix);
    }
  }
  const publishTargets = TARGETS.filter((target) => generatedTargets.includes(target.suffix));
  generateMainPackage(OUT_ROOT, publishTargets);

  process.stdout.write(`Generated npm packages at ${OUT_ROOT}\n`);
  process.stdout.write(`Main package: ${MAIN_PACKAGE_NAME}@${PACKAGE_VERSION}\n`);
  process.stdout.write(`Platform packages: ${generatedTargets.join(", ")}\n`);
}

main();
