# Auth Login Troubleshooting

## 1. No Token Found

Symptom:

`No valid OAuth token found in keyring. Run "wfcli auth login" first.`

Action:

1. Run `wfcli auth login`.
2. Retry the command (`wfcli apps list` or `wfcli tasks ...`).

## 2. Browser Did Not Open

Symptom:

CLI prints authorize URL but browser is not launched.

Action:

1. Copy and open the printed URL manually.
2. Finish login in browser.
3. Wait for callback page: `Login successful`.

## 3. OAuth State Mismatch

Symptom:

`OAuth state mismatch in callback.`

Cause:

The callback request did not carry the expected `state` value.

Action:

1. Start a new login (`wfcli auth login`).
2. Use only the latest printed URL.
3. Avoid reusing old callback tabs.

## 4. Callback Timeout

Symptom:

`Timed out waiting for OAuth callback ...`

Action:

1. Re-run `wfcli auth login`.
2. Complete authorization promptly in browser.
3. Ensure local machine can receive `127.0.0.1` callback traffic.

## 5. Scope Invalid

Symptom:

Server returns scope errors such as `ACCESS_TOKEN_SCOPE_INVALID`.

Action:

1. Re-login with required scope, for example:
   - `wfcli auth login --scope app+task+process+data+openid+profile`
2. Confirm your environment scope if needed:
   - `.env` -> `WORKFLOW_AUTH_SCOPE`

Note:

`wfcli` accepts both `data openid profile` and `data+openid+profile` style input and emits proper query encoding (`+` separators).

## 6. Keyring Backend Issues

Symptom:

Keyring operations fail on unsupported platform.

Cause:

Default keyring backend currently targets macOS Keychain (`security` CLI).

Action:

1. Run on macOS, or
2. Provide a custom keyring implementation in integration/runtime context.

## 7. Token Expired

Symptom:

Command fails and suggests re-login.

Cause:

Stored token reached `expiresAt` (30s safety skew applied).

Action:

1. Try `wfcli auth refresh-token`.
2. If refresh fails, run `wfcli auth login` again.

Current behavior:

No automatic refresh-token flow is implemented in runtime commands yet.
