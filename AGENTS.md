# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project Summary
- Project: `wfcli` (InfoPlus CLI for SHMTU workflows)
- Runtime: Rust (`crates/wfcli`)
- Test command: `npm test` (delegates to `cargo test -p wfcli`)

## External API Reference
- InfoPlus API wiki:
  `https://github.com/infoplus/docs/wiki/InfoPlusAPI`

## Key Commands
- Auth:
  - `npm run rust:run -- auth login`
  - `npm run rust:run -- auth refresh-token`
  - `npm run rust:run -- auth show-token --json`
- Apps:
  - `npm run rust:run -- apps list --json`
  - `npm run rust:run -- apps definition <CODE>`
- Tasks:
  - `npm run rust:run -- tasks start ...`
  - `npm run rust:run -- tasks execute <taskId> --action-code <code>`
  - `npm run rust:run -- tasks todo --json`
  - `npm run rust:run -- tasks doing --json`
  - `npm run rust:run -- tasks done --json`
- User:
  - `npm run rust:run -- user profile --json`
  - `npm run rust:run -- user positions --json`
  - `npm run rust:run -- user department --json`
- Distribution:
  - `npm run dist:plan`
  - `npm run dist:generate` (includes Trusted Publishing workflow patch)

## Repository Conventions
- Keep behavior aligned with existing command patterns in `crates/wfcli/src/main.rs`.
- For `tasks start`, preserve current submit option name:
  - use `--submit-action-code` (do not rename/remove unless explicitly requested).
- Keep payload examples valid JSON strings (single-line shell-safe format preferred).
- Add/update Rust tests when changing command behavior.
- Run `npm test` after code changes.

## Auth/Token Handling
- If a valid token already exists, do not force `auth login`.
- Prefer existing token flow and only use `auth refresh-token` when needed.
- Use `auth login` only when token/session is missing or user explicitly requests login.

## Files of Interest
- CLI entry: `crates/wfcli/src/main.rs`
- API client: `crates/wfcli/src/api.rs`
- Runtime config: `crates/wfcli/src/config.rs`
- Auth session/token logic: `crates/wfcli/src/session.rs`
- Errors and login hints: `crates/wfcli/src/errors.rs`
- Dist config: `dist-workspace.toml`
- Release workflow (generated): `.github/workflows/release.yml`
