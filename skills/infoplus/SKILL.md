---
name: infoplus
description: Introduce and operate the `wfcli` tool for SHMTU InfoPlus, including environment setup, OAuth login, app discovery, process/task actions, and FileAPI operations. Use when users ask how this tool works, request command examples, need end-to-end InfoPlus CLI execution, or need troubleshooting for token/scope/config/network errors in `wfcli`.
---

# InfoPlus CLI

## Overview
Use this skill to onboard users to `wfcli` and execute InfoPlus workflow operations with accurate command mapping and troubleshooting.

## Working Mode
Follow this sequence unless the user asks for a single command only.

1. Verify runtime and config
- Ensure the working directory is the `wfcli` project root.
- Ensure `npm install` has been run.
- Ensure required env vars are present: `WORKFLOW_CLIENT_ID`, `WORKFLOW_BASE_URL`.
- Ensure `WORKFLOW_CLIENT_SECRET` exists before `auth login` or `auth refresh-token`.

2. Introduce the tool quickly
- Explain `wfcli` in one line: InfoPlus OAuth + apps + tasks + file APIs.
- Give a minimal quickstart:
```bash
cp .env.example .env
npm install
npx wfcli auth login
npx wfcli apps list
npx wfcli tasks todo
```

3. Authenticate before protected commands
- Run `npx wfcli auth login` for first-time access.
- Run `npx wfcli auth refresh-token` when token expires.
- Run `npx wfcli auth show-token --json` when user asks to inspect token state.

4. Drive app and process workflows
- Use `apps list` to discover app codes.
- Use `apps definition <idc>` before building `tasks start --data` payloads.
- Use `tasks start` to create process instances; default behavior auto-submits the first task.
- Use `tasks execute <taskId>` for explicit one-click action submission.

5. Drive file workflows
- Use `file upload`, `file meta`, `file download`, `file update`, `file delete` for FileAPI lifecycle.

6. Prefer machine-readable output when automation is likely
- Add `--json` for commands whose output may be piped into scripts.

## Command Selection Rules
Use this mapping for user intent.

- "show my apps" -> `npx wfcli apps list`
- "show app schema/fields" -> `npx wfcli apps definition <idc>`
- "show my pending tasks" -> `npx wfcli tasks todo`
- "show in-progress processes" -> `npx wfcli tasks doing`
- "show completed work" -> `npx wfcli tasks done` or `npx wfcli tasks list`
- "start a process" -> `npx wfcli tasks start --code <code> --data '<json>'`
- "submit/approve a task" -> `npx wfcli tasks execute <taskId> --action-code <code>`
- "upload/download workflow file" -> `npx wfcli file upload ...` / `npx wfcli file download ...`

## Troubleshooting Playbook
Apply targeted fixes based on known error patterns.

- `Missing required environment variables`:
  Set the missing `WORKFLOW_*` values in `.env` or shell.
- `No valid OAuth token found in keyring`:
  Run `npx wfcli auth login`.
- `Access token scope is invalid`:
  Run `npx wfcli auth login --scope "profile data openid app process task start process_edit app_edit"`.
- `Failed to call process start API` or `fetch failed`:
  Verify `WORKFLOW_BASE_URL`, network, and VPN reachability.
- `Invalid --data JSON`:
  Rebuild payload from `apps definition <idc>` field codes, then retry.

## Data Safety
- Avoid logging or echoing sensitive tokens unless the user explicitly asks.
- Avoid modifying `.env` values without explicit user confirmation.
- Prefer read/list commands before state-changing commands when intent is ambiguous.

## References
Load [references/command-cheatsheet.md](references/command-cheatsheet.md) for compact command examples.
When behavior is unclear, read local source-of-truth files in this repo:
- `README.md`
- `src/commands/auth.js`
- `src/commands/apps.js`
- `src/commands/tasks.js`
- `src/commands/file.js`
