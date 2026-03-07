# wfcli

Workflow CLI for SHMTU InfoPlus.

## Stage 1

Implemented command:

- `wfcli auth login`
- `wfcli apps list`
- `wfcli tasks todo`
- `wfcli tasks execute <taskId>`
- `wfcli tasks doing`
- `wfcli tasks done`
- `wfcli tasks list`

## Setup

```bash
npm install
cp .env.example .env
```

Set these values in `.env`:

- `WORKFLOW_CLIENT_ID`
- `WORKFLOW_BASE_URL`

Required for `wfcli auth login`:

- `WORKFLOW_CLIENT_SECRET`

Optional:

- `WORKFLOW_AUTH_SCOPE` (default: `app+task+process+data+openid+profile`)
- `WORKFLOW_USERNAME`

## Usage

```bash
# Login once (opens browser, stores token in keyring)
npx wfcli auth login

# List current user's apps (from personal token)
npx wfcli apps list

# Override base url
npx wfcli apps list --base-url https://xjtu.shmtu.edu.cn

# Machine-readable output
npx wfcli apps list --json

# Task commands
npx wfcli tasks todo --username alice
npx wfcli tasks doing --username alice
npx wfcli tasks done --username alice
npx wfcli tasks list --username alice
npx wfcli tasks execute 123456 --username alice
```

## OAuth2 flow

`wfcli auth login` uses Authorization Code flow:

- starts a local callback server with generated `redirect_uri` on `127.0.0.1`
- opens browser to `GET /infoplus/oauth2/authorize`
  - `response_type=code`
  - `scope=app+task+process+data+openid+profile` (or `WORKFLOW_AUTH_SCOPE`)
- receives `code` on callback, then exchanges it via:
- `POST /infoplus/oauth2/token`
- saves `access_token` into OS keyring

`wfcli apps` and `wfcli tasks` then read this keyring token and call:

- `GET /infoplus/apis/v2/me/apps` (`apps list`, personal method)
- `GET /infoplus/apis/v2/user/{username}/tasks/todo`
- `GET /infoplus/apis/v2/user/{username}/processes/doing`
- `GET /infoplus/apis/v2/user/{username}/processes/done`
- `GET /infoplus/apis/v2/user/{username}/processes/completed`
- `POST /infoplus/apis/v2/tasks/{id}` (fallback: `/task/{id}`)

If Basic client auth is rejected by the server during token exchange, it retries with
`client_id` and `client_secret` in the form body.

If API returns access-token errors (for example `ACCESS_TOKEN_SCOPE_INVALID`), wfcli prompts
you to run `wfcli auth login` again.
