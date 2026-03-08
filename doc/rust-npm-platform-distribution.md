# Rust + npm Distribution via cargo-dist

This repository ships `wfcli` as a Rust CLI and uses `cargo-dist` to build artifacts,
create GitHub releases, and publish npm installer packages.

## Core Files

- `crates/wfcli`: Rust binary crate (`wfcli`)
- `dist-workspace.toml`: dist release/publish configuration
- `.github/workflows/release.yml`: generated release workflow (do not hand-edit)

## Local Commands

```bash
# Regenerate CI workflow from dist config
npm run dist:generate

# Inspect planned artifacts/jobs
npm run dist:plan

# Build release binary locally
npm run rust:build
```

## Release Flow

1. Create and push a semver tag, for example: `v0.1.0`.
2. GitHub Actions `Release` workflow runs `dist plan/build/host`.
3. Artifacts are uploaded to GitHub Releases.
4. npm installer package tarballs are published to npm (via `NPM_TOKEN`).

## Required Secret

- `NPM_TOKEN`: npm automation token with publish permissions.

## Notes

- Targets are configured in `dist-workspace.toml` (`[dist].targets`).
- npm publishing is enabled by `[dist].publish-jobs = ["npm"]`.
- If you change dist settings, run `npm run dist:generate` and commit the updated workflow.
