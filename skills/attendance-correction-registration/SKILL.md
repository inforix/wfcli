---
name: attendance-correction-registration
description: Directly submit SHMTU InfoPlus attendance correction registration (考勤补登记) with `wfcli` by auto-fetching user fields and starting + submitting in one pass.
---

# Attendance Correction Registration

## Overview
Use this skill when users ask to submit or troubleshoot **attendance correction registration** (考勤补登记) in SHMTU InfoPlus.
Prefer **direct mode**: one start command + immediate submit. Only use draft/extra discovery when required.

## Direct Mode (Default)
1. Verify runtime and token status
- Ensure project root is `wfcli`.
- Ensure env has `WORKFLOW_CLIENT_ID`, `WORKFLOW_BASE_URL`.
- Check token first:
```bash
wfcli auth show-token --json
```
- If token exists and valid, continue.
- If no token/session, login with required scopes:
```bash
wfcli auth login --scope "profile data openid app process task start process_edit app_edit triple"
```

2. Collect required user fields automatically
- Fetch profile and first department:
```bash
wfcli user profile --json
wfcli user department --json
```
- Map values:
`<bm>`: department code (`department[0].code`)
`<bm_name>`: department name (`department[0].name`)
`<gh>`: account/username from profile (`account | username | userName`)
`<xm>`: name from profile (`name | displayName`)

3. Build payload
- Required from user:
  - `<correction_date>` -> `fieldBDJRQ` (unix timestamp in seconds, sent as single-item array)
  - `<reason>` -> `fieldBDJRGZQK` (sent as single-item array)
  - `<location>` -> `fieldKQQY` and `fieldKQQY_Name` (same value, each sent as single-item array)
- `<sqrq>`: current unix timestamp (seconds).
- Location rule (strict):
  - `fieldKQQY` and `fieldKQQY_Name` must be the same value.
  - Value must be one of:
    - `临港校区`
    - `上海国际航运研究中心`
    - `上海海大资产经营有限公司`
    - `上海港湾学校（继续教育学院）`
    - `高恒大厦`

4. Pre-submit validation checklist (must pass before calling `tasks start`)
- Token check passed; if missing token, `auth login` completed.
- `fieldBDJRQ` provided and is unix seconds (not milliseconds), wrapped as single-item array.
- `fieldBDJRGZQK` provided and non-empty, wrapped as single-item array.
- `fieldKQQY` provided and value is in allowed options.
- `fieldKQQY_Name` exactly equals `fieldKQQY`.
- Auto-filled fields resolved:
  - `fieldBM`, `fieldBM_Name`
  - `fieldGH`, `fieldXM`
  - `fieldSQRQ` (current unix seconds)
  - `fieldXH` (`["1"]`)

5. Start and submit directly (no draft)
```bash
wfcli tasks start --code BKQ --submit-action-code Submit --data '{"fieldBM":"<bm>","fieldBM_Name":"<bm_name>","fieldGH":"<gh>","fieldXM":"<xm>","fieldSQRQ":<sqrq>,"fieldXH":["1"],"fieldBDJRQ":[<correction_date>],"fieldBDJRGZQK":["<reason>"],"fieldKQQY":["<location>"],"fieldKQQY_Name":["<location>"]}'
```

Known sample (provided by user):
```bash
wfcli tasks start --code BKQ --submit-action-code Submit --data '{"fieldBM":"200300","fieldBM_Name":"教务处","fieldGH":"993333","fieldXM":"王玉平","fieldSQRQ":1772874290,"fieldXH":["1"],"fieldBDJRQ":[1772596800],"fieldBDJRGZQK":["正常上班，漏考勤"],"fieldKQQY":["临港校区"],"fieldKQQY_Name":["临港校区"]}'
```

6. Validate outcome
```bash
wfcli tasks doing --json
wfcli tasks done --json
```

## Fallback Workflow (Only When Needed)
Use this only if direct submission fails due to field mismatch/tenant customization.

1. Discover app/schema:
```bash
wfcli apps list --json | jq '.[] | {code,name}'
wfcli apps definition BKQ | jq '.currentVersion.schema.fields'
wfcli apps definition BKQDJ | jq '.currentVersion.schema.fields'
```

2. If user explicitly asks to save draft first:
```bash
wfcli tasks start --code BKQ --no-submit --data '<data-json>'
wfcli tasks execute <taskId> --action-code Submit
```

## Intent Mapping
- "补考勤登记" / "attendance correction" / "missed punch fix" -> direct start+submit (`tasks start --submit-action-code Submit`)
- "先保存草稿" / "draft first" -> `tasks start --no-submit ...`
- "提交这个补考勤" / "submit this request" -> `tasks execute <taskId> --action-code Submit`
- "查我填了什么" / "check status" -> `tasks doing` / `tasks done`

## Troubleshooting
- `No valid OAuth token found in keyring`:
  run `wfcli auth login` (only needed when token is missing).
- `ACCESS_TOKEN_SCOPE_INVALID` for department/profile:
  re-login with `triple` scope included.
- `Invalid --data JSON`:
  rebuild payload as valid JSON string and retry.
- `InfoPlus API error` with unknown field codes:
  run fallback schema discovery and rebuild payload using real field codes.
- `Failed to call process start API` or `fetch failed`:
  verify `WORKFLOW_BASE_URL`, campus VPN/network reachability.

## References
- Load [references/command-cheatsheet.md](references/command-cheatsheet.md) for copy-ready commands.
- Source-of-truth code:
  - `crates/wfcli/src/main.rs`
  - `crates/wfcli/src/errors.rs`
  - `crates/wfcli/src/config.rs`
