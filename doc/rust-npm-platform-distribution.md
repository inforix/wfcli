# Rust + npm Platform Package Distribution

This document describes how to distribute `wfcli` as an npm package using a Rust binary,
with platform-specific npm packages in the same style as `esbuild`.

## Goal

- Develop CLI in Rust.
- Publish one main npm package (JS launcher only).
- Publish multiple platform npm packages (native binaries).
- Let npm install only the matching platform package via `optionalDependencies` + `os/cpu/libc`.
- Keep command surface compatible with existing `wfcli` commands:
  `auth/apps/tasks/file/user/version`.

## Layout

- `crates/wfcli`: Rust binary crate (`wfcli`).
- `scripts/generate-platform-npm-packages.mjs`: generates npm publish directories.
- `dist/binaries/<target-triple>/wfcli(.exe)`: input binaries.
- `dist/npm/main`: main npm package.
- `dist/npm/<suffix>`: platform npm packages.

## Supported Targets

- `x86_64-apple-darwin` -> `darwin-x64`
- `aarch64-apple-darwin` -> `darwin-arm64`
- `x86_64-unknown-linux-gnu` -> `linux-x64-gnu`
- `x86_64-unknown-linux-musl` -> `linux-x64-musl`
- `aarch64-unknown-linux-gnu` -> `linux-arm64-gnu`
- `aarch64-unknown-linux-musl` -> `linux-arm64-musl`
- `x86_64-pc-windows-msvc` -> `win32-x64-msvc`
- `aarch64-pc-windows-msvc` -> `win32-arm64-msvc`

## Build Flow

1. Build Rust binaries for each target and put outputs under:

- `dist/binaries/<target-triple>/wfcli`
- `dist/binaries/<target-triple>/wfcli.exe` (Windows)

2. Generate npm package directories:

```bash
npm run pkg:generate-platform
```

Optional environment overrides:

- `NPM_MAIN_PACKAGE_NAME` (default: root `package.json` `name`)
- `NPM_PACKAGE_VERSION` (default: root `package.json` `version`)
- `BINARIES_ROOT` (default: `dist/binaries`)
- `OUT_ROOT` (default: `dist/npm`)
- `ALLOW_MISSING_BINARIES=1` (skip missing targets)

3. Publish in this order:

- Publish all platform packages first (`dist/npm/<suffix>`).
- Publish main package last (`dist/npm/main`).

## Why This Works

- Main package declares platform packages in `optionalDependencies`.
- Platform packages are filtered by `os/cpu/libc` metadata.
- Main package runtime launcher resolves the installed platform package and executes its binary.

## CI Recommendation

- Build each target on matrix runners.
- Upload binaries as artifacts.
- Assemble + generate `dist/npm/*` in a release job.
- Publish platform packages first, then main package.
