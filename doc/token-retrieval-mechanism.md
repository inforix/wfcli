# Token Retrieval Mechanism

## Scope

This document describes how `wfcli` retrieves, stores, validates, and uses OAuth tokens.
It focuses on the main runtime path used by `auth login`, `apps list`, and `tasks` commands.

## 1. Login-Time Token Retrieval (`Authorization Code`)

Entry point: `src/commands/auth.js` -> `runAuthLogin()`

Flow:

1. Resolve login config from environment/options:
   - `WORKFLOW_CLIENT_ID`
   - `WORKFLOW_CLIENT_SECRET`
   - `WORKFLOW_BASE_URL`
   - `WORKFLOW_AUTH_SCOPE` (optional)
2. Start local callback HTTP server on `127.0.0.1:<random-port>/oauth/callback`.
3. Build authorize URL with:
   - `response_type=code`
   - `client_id`
   - `redirect_uri`
   - `scope`
   - `state`
4. Open browser for user sign-in.
5. Receive OAuth callback, verify `state`, and read `code`.
6. Exchange `code` for token by calling `/infoplus/oauth2/token`:
   - First attempt: Basic auth (`Authorization: Basic ...`)
   - Fallback attempt: `client_id` + `client_secret` in request body
7. Persist token payload to keyring.

## 2. Token Persistence Model

File: `src/authSession.js`

Keyring identity:

- `service`: `wfcli.infoplus.oauth2`
- `account`: `<origin(baseUrl)>|<clientId>`

Stored JSON fields:

- `accessToken`
- `tokenType`
- `scope`
- `refreshToken`
- `obtainedAt`
- `expiresAt`

`expiresAt` is derived from `expires_in` when present.

## 3. Runtime Token Retrieval (`apps` / `tasks`)

Entry points:

- `src/commands/apps.js`
- `src/commands/tasks.js`

Flow:

1. Resolve runtime config (`clientId`, `baseUrl`, optional `username`).
2. Call `loadValidAccessToken(config, keyring)`.
3. `loadValidAccessToken` returns `null` when:
   - no keyring entry exists
   - token is expired (with 30s skew safety window)
4. If token is valid, commands call InfoPlus APIs with `Authorization: Bearer <token>`.
   - Read-style task APIs use `/infoplus/apis/v2/me/...` and do not require `--username`.
   - `tasks execute` maps to `POST /infoplus/apis/v2/task/{id}`; `userId` is optional (can come from `--username` or `WORKFLOW_USERNAME`).
5. If API returns token-related errors (e.g. access token invalid/expired/scope mismatch), command maps it to a login hint error.

Important: runtime commands do not auto-refresh token. You can refresh manually with:

`wfcli auth refresh-token`

## 4. System Token Path (`client_credentials`)

File: `src/infoplusClient.js` -> `fetchSystemToken(config)`

This path requests token with `grant_type=client_credentials`, also with:

- Basic auth first
- body credentials fallback

This function exists in the client layer for service-to-service use, but current CLI user commands primarily rely on user OAuth session from `auth login`.

## 5. Error and Recovery Behavior

Common outcomes:

- Missing keyring token:
  - Error: `No valid OAuth token found in keyring. Run "wfcli auth login" first.`
- Token expired or invalid:
  - Error suggests `wfcli auth login` (or run `wfcli auth refresh-token` first if a refresh token is stored).
- Scope mismatch from server:
  - Error suggests re-login with broader scope.

## 6. Operational Notes

- Keyring backend currently defaults to macOS (`security` command).
- Tokens are partitioned by `<baseUrl-origin>|<clientId>`, so different environments/clients do not overwrite each other.
- Callback is bound to loopback (`127.0.0.1`) and random port to avoid hardcoded port conflicts.
