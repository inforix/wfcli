# wfcli

Workflow CLI for SHMTU InfoPlus.

## Stage 1

Implemented command:

- `wfcli apps list`

## Setup

```bash
npm install
cp .env.example .env
```

Set these required values in `.env`:

- `WORKFLOW_CLIENT_ID`
- `WORKFLOW_CLIENT_SECRET`
- `WORKFLOW_BASE_URL`

Optional:

- `WORKFLOW_SCOPE` (default: `sys_app`)
- `WORKFLOW_USERNAME`

## Usage

```bash
# Use WORKFLOW_USERNAME from .env
npx wfcli apps list

# Or pass username explicitly
npx wfcli apps list --username alice

# Override base url
npx wfcli apps list --username alice --base-url https://xjtu.shmtu.edu.cn

# Machine-readable output
npx wfcli apps list --username alice --json
```

## OAuth2 flow

`wfcli` requests a system token with `client_credentials`:

- `POST /infoplus/oauth2/token`
- then calls:
  - `GET /infoplus/apis/v2/user/{username}/apps`

If Basic client auth is rejected by the server, it retries with `client_id` and `client_secret` in the form body.
