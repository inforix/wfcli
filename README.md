# wfcli

Workflow CLI for SHMTU InfoPlus.

## Stage 1

Implemented command:

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

## Setup

```bash
npm install
cp .env.example .env
```

## Automatic npm publish on push

This repo is configured to publish to npm on every push to `main` via GitHub Actions.

Required GitHub repository secret:

- `NPM_TOKEN`: npm automation token with publish permission for this package

The workflow automatically:

- bumps patch version (`npm version patch`)
- creates a git tag
- publishes to npm
- pushes commit and tag back to `main`

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

```bash
# Login once (opens browser, stores token in keyring)
npx wfcli auth login

# Refresh access token using stored refresh_token
npx wfcli auth refresh-token

# Show stored access token
npx wfcli auth show-token
npx wfcli auth show-token --json

# List current user's apps (from personal token)
npx wfcli apps list

# Get current user profile
npx wfcli user profile
npx wfcli user profile --json

# Get app definition (schema/fields) for building tasks start --data
npx wfcli apps definition BKQDJ > bkqdj-definition.json

# Override base url
npx wfcli apps list --base-url https://xjtu.shmtu.edu.cn

# Machine-readable output
npx wfcli apps list --json

# Version
npx wfcli version
npx wfcli --version

# File operations (InfoPlus FileAPI)
# API reference: https://github.com/infoplus/docs/wiki/InfoPlusAPI
npx wfcli file upload ./demo.txt --keep-name
npx wfcli file meta file-key-1
npx wfcli file download file-key-1 --output ./downloaded.txt
npx wfcli file update file-key-1 ./new-demo.txt --keep-name
npx wfcli file delete file-key-1

# Task commands
# todo output columns: taskId, process uri, name, source username, date
npx wfcli tasks todo
npx wfcli tasks doing
npx wfcli tasks done
npx wfcli tasks list
# start maps to [3.2] /process (auto tries v2 + v2d, header/query token, with debug trace)
npx wfcli tasks start --code BKQDJ --data '{"reason":"补考勤"}'
npx wfcli tasks start --code BKQ --api-version v2d --debug --data '{"groupBDJXX":[{"fieldXH":"1"}]}'
# by default, tasks start auto-submits the created start task via /task/{id}
npx wfcli tasks start --code BKQ --submit-action-code TJ --data '{"groupBDJXX":[{"fieldXH":"1"}]}'
# create draft only (do not submit)
npx wfcli tasks start --code BKQ --no-submit --data '{"groupBDJXX":[{"fieldXH":"1"}]}'

# Way 3: inspect field definitions first, then fill --data with field codes
npx wfcli apps definition BKQDJ | jq '.currentVersion.schema.fields'
# execute maps to [3.1] POST /task/{id}
npx wfcli tasks execute 123456 --username alice
npx wfcli tasks execute 123456 --action-code approve --remark "已确认"

# find taskId by name then execute
TASK_ID=$(npx wfcli tasks todo --json | jq -r '.[] | select(.name|contains("补考勤登记")) | .taskId' | head -n1)
npx wfcli tasks execute "$TASK_ID" --action-code approve --remark "已处理"
```

## OAuth2 flow

`wfcli auth login` uses Authorization Code flow:

- starts a local callback server with generated `redirect_uri` on `127.0.0.1`
- opens browser to `GET /infoplus/oauth2/authorize`
  - `response_type=code`
  - `scope=profile+data+openid+app+process+task+start+process_edit+app_edit` (or `.env` `WORKFLOW_AUTH_SCOPE` / `WORKFLOW_SCOPE`)
- receives `code` on callback, then exchanges it via:
- `POST /infoplus/oauth2/token`
- saves `access_token` into OS keyring
- `wfcli auth refresh-token` can refresh the stored token via `grant_type=refresh_token`

`wfcli apps`, `wfcli user`, and `wfcli tasks` then read this keyring token and call:

- `GET /infoplus/apis/v2/me/apps` (`apps list`, personal method)
- `GET /infoplus/apis/v2/me/profile` (`user profile`)
- `GET /infoplus/apis/v2/me/tasks/todo`
- `GET /infoplus/apis/v2/me/processes/doing`
- `GET /infoplus/apis/v2/me/processes/done`
- `GET /infoplus/apis/v2/me/processes/completed`
- `PUT /infoplus/apis/v2/process` and `PUT /infoplus/apis/v2d/process` (start, auto fallback)
- `POST /infoplus/apis/v2/task/{id}` (execute)
- `POST /infoplus/file` (upload)
- `GET /infoplus/file/{fileKey}/meta`
- `GET /infoplus/file/{fileKey}/download`
- `PUT /infoplus/file/{fileKey}`
- `DELETE /infoplus/file/{fileKey}`

If Basic client auth is rejected by the server during token exchange, it retries with
`client_id` and `client_secret` in the form body.

If API returns access-token errors (for example `ACCESS_TOKEN_SCOPE_INVALID`), wfcli prompts
you to run `wfcli auth login` again.
