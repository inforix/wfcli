# wfcli

Workflow CLI for SHMTU InfoPlus.

## Commands

Implemented command set:

- `wfcli auth login`
- `wfcli auth refresh-token`
- `wfcli version`
- `wfcli apps list`
- `wfcli apps definition <idc>`
- `wfcli file upload <path>`
- `wfcli file update <fileKey> <path>`
- `wfcli file meta <fileKey>`
- `wfcli file delete <fileKey>`
- `wfcli file download <fileKey>`
- `wfcli tasks todo`
- `wfcli tasks start`
- `wfcli tasks execute <taskId>`
- `wfcli tasks doing`
- `wfcli tasks done`
- `wfcli tasks list`
- `wfcli user profile`
- `wfcli user positions`
- `wfcli user department`

## Setup

```bash
npm install
cp .env.example .env
```

## Rust CLI Source

The CLI logic has been migrated to Rust source under `crates/wfcli`.

Run directly from source:

```bash
npm run rust:run -- --help
npm run rust:run -- auth show-token --json
```

Build release binary:

```bash
npm run rust:build
./target/release/wfcli --help
```

## Rust Distribution (cargo-dist)

This repo uses `cargo-dist` for release automation and npm publishing.

- Distribution config: `dist-workspace.toml`
- Generated CI workflow: `.github/workflows/release.yml`
- Local planning command: `npm run dist:plan`
- Regenerate CI from dist config: `npm run dist:generate`
- Full guide: `doc/rust-npm-platform-distribution.md`

## Release and npm publish

Release is tag-driven (not push-to-main driven):

1. Create and push a semver tag like `v0.1.0`.
2. GitHub Actions `Release` workflow builds artifacts for configured targets.
3. `cargo-dist` uploads release artifacts to GitHub Releases.
4. Workflow publishes generated npm installer package(s).

GitHub Actions npm publish is configured for npm Trusted Publishing (OIDC).
No `NPM_TOKEN` secret is required.

Set these values in `.env`:

- `WORKFLOW_CLIENT_ID`
- `WORKFLOW_BASE_URL`

Required for `wfcli auth login`:

- `WORKFLOW_CLIENT_SECRET`

Optional:

- `WORKFLOW_AUTH_SCOPE` (optional; overrides login scope)
- `WORKFLOW_SCOPE` (optional; used as login scope fallback and runtime scope)
  - default when neither is set: `profile data openid app process task start process_edit app_edit`
- `WORKFLOW_USERNAME` (optional default `userId` for `wfcli tasks execute`)

## Usage

Commands below assume `wfcli` is available on your `PATH`.
For local development without installing it, use:

```bash
npm run rust:run -- <command>
```

```bash
# Login once (opens browser, stores token in keyring)
wfcli auth login

# Refresh access token using stored refresh_token
wfcli auth refresh-token

# Show stored access token
wfcli auth show-token
wfcli auth show-token --json

# List current user's apps (from personal token)
wfcli apps list

# Get current user profile
wfcli user profile
wfcli user profile --json
# Get current user positions / departments (requires scope `triple`)
wfcli user positions
wfcli user positions --json
wfcli user department
wfcli user department --json

# Get app definition (schema/fields) for building tasks start --data
wfcli apps definition BKQDJ > bkqdj-definition.json

# Override base url
wfcli apps list --base-url https://xjtu.shmtu.edu.cn

# Machine-readable output
wfcli apps list --json

# Version
wfcli version
wfcli --version

# File operations (InfoPlus FileAPI)
# API reference: https://github.com/infoplus/docs/wiki/InfoPlusAPI
wfcli file upload ./demo.txt --keep-name
wfcli file meta file-key-1
wfcli file download file-key-1 --output ./downloaded.txt
wfcli file update file-key-1 ./new-demo.txt --keep-name
wfcli file delete file-key-1

# Task commands
# todo output columns: taskId, process uri, name, source username, date
wfcli tasks todo
wfcli tasks doing
wfcli tasks done
wfcli tasks list
# start maps to [3.2] /process (auto tries v2 + v2d, header/query token, with debug trace)
wfcli tasks start --code BKQDJ --data '{"reason":"补考勤"}'
wfcli tasks start --code BKQ --api-version v2d --debug --data '{"groupBDJXX":[{"fieldXH":"1"}]}'
# by default, tasks start auto-submits the created start task via /task/{id}
wfcli tasks start --code BKQ --submit-action-code TJ --data '{"groupBDJXX":[{"fieldXH":"1"}]}'
# create draft only (do not submit)
wfcli tasks start --code BKQ --no-submit --data '{"groupBDJXX":[{"fieldXH":"1"}]}'

# Way 3: inspect field definitions first, then fill --data with field codes
wfcli apps definition BKQDJ | jq '.currentVersion.schema.fields'
# execute maps to [3.1] POST /task/{id}
wfcli tasks execute 123456 --username alice
wfcli tasks execute 123456 --action-code approve --remark "已确认"

# find taskId by name then execute
TASK_ID=$(wfcli tasks todo --json | jq -r '.[] | select(.name|contains("补考勤登记")) | .taskId' | head -n1)
wfcli tasks execute "$TASK_ID" --action-code approve --remark "已处理"
```
