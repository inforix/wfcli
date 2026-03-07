# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project Summary
- Project: `wfcli` (InfoPlus CLI for SHMTU workflows)
- Runtime: Node.js (ESM, `"type": "module"`)
- Test command: `npm test` (uses `node --test`)

## External API Reference
- InfoPlus API wiki:
  `https://github.com/infoplus/docs/wiki/InfoPlusAPI`

## Key Commands
- Auth:
  - `node src/cli.js auth login`
  - `node src/cli.js auth refresh-token`
  - `node src/cli.js auth show-token --json`
- Apps:
  - `node src/cli.js apps list --json`
  - `node src/cli.js apps definition <CODE>`
- Tasks:
  - `node src/cli.js tasks start ...`
  - `node src/cli.js tasks execute <taskId> --action-code <code>`
  - `node src/cli.js tasks todo --json`
  - `node src/cli.js tasks doing --json`
  - `node src/cli.js tasks done --json`
- User:
  - `node src/cli.js user profile --json`
  - `node src/cli.js user positions --json`
  - `node src/cli.js user department --json`

## Repository Conventions
- Keep behavior aligned with existing command patterns under `src/commands/`.
- For `tasks start`, preserve current submit option name:
  - use `--submit-action-code` (do not rename/remove unless explicitly requested).
- Keep payload examples valid JSON strings (single-line shell-safe format preferred).
- Update tests when changing command behavior (`test/*.test.js`).
- Run `npm test` after code changes.

## Auth/Token Handling
- If a valid token already exists, do not force `auth login`.
- Prefer existing token flow and only use `auth refresh-token` when needed.
- Use `auth login` only when token/session is missing or user explicitly requests login.

## Files of Interest
- CLI entry: `src/cli.js`
- API client: `src/infoplusClient.js`
- Task commands: `src/commands/tasks.js`
- User commands: `src/commands/user.js`
- Auth session/token logic: `src/authSession.js`
