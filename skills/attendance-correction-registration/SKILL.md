---
name: attendance-correction-registration
description: Handle SHMTU InfoPlus attendance correction registration (考勤补登记) with `wfcli`, including login, app field discovery, process start/submit, and troubleshooting for scope/token/data issues.
---

# Attendance Correction Registration

## Overview
Use this skill when users ask to submit or troubleshoot **attendance correction registration** (补考勤登记) in SHMTU InfoPlus.

## Workflow
1. Verify prerequisites
- Ensure project root is `wfcli`.
- Ensure env has `WORKFLOW_CLIENT_ID`, `WORKFLOW_BASE_URL`, `WORKFLOW_CLIENT_SECRET`.

2. Authenticate
- First-time or expired token:
```bash
npx wfcli auth login --scope "profile data openid app process task start process_edit app_edit"
```
- If token exists but expired:
```bash
npx wfcli auth refresh-token
```

3. Confirm app and fields
- Check available apps:
```bash
npx wfcli apps list --json
```
- Inspect attendance correction app schema (commonly `BKQ`):
```bash
npx wfcli apps definition BKQ | jq '.currentVersion.schema.fields'
```
- Build `--data` using **field codes** from schema output.

4. Start attendance correction process

<reason>: if user doesn't specify the reason, then set a default value like "正常上班，漏考勤" to ensure the process can be started without validation errors.

<correction_date>: user must speicify the correction date, it's a unixtime long value (not milliseconds).

<location>: if user doesn't specify the location, then set a default value like "临港校区" to ensure the process can be started without validation errors.

<bm>: 部门代码
<bm_name>: 部门名称
<gh>: 申请人工号
<xm>: 申请人姓名
<sqrq>: 申请日期（unixtime long, in seconds, not milliseconds）

```bash
npx wfcli tasks start --code BKQ --submit-action-code "Submit" --data '{"fieldBM": "<bm>", "fieldBM_Name": "<bm_name>", "fieldGH": "<gh>", "fieldXM": "<xm>", "fieldSQRQ": <sqrq>, "fieldXH":["1"], "fieldBDJRQ": [<correction_date>], "fieldBDJRGZQK":["<reason>"], "fieldKQQY":["<location>"], "fieldKQQY_Name":["<location>"]}'
```


5. Validate result
- Check running/completed process:
```bash
npx wfcli tasks doing
npx wfcli tasks done
```

## Intent Mapping
- "补考勤登记" / "attendance correction" / "missed punch fix" -> `tasks start --code BKQ --data ...`
- "先保存草稿" / "draft first" -> `tasks start --no-submit ...`
- "提交这个补考勤" / "submit this request" -> `tasks execute <taskId> --action-code TJ`
- "查我填了什么" / "check status" -> `tasks doing` / `tasks done`

## Troubleshooting
- `No valid OAuth token found in keyring`:
  run `npx wfcli auth login`.
- `Access token scope is invalid`:
  re-login with explicit scope string above.
- `Invalid --data JSON`:
  re-check app definition and rebuild payload with field codes.
- `Failed to call process start API` or `fetch failed`:
  verify `WORKFLOW_BASE_URL`, campus VPN/network reachability.

## References
- Load [references/command-cheatsheet.md](references/command-cheatsheet.md) for copy-ready commands.
- Source-of-truth code:
  - `src/commands/tasks.js`
  - `src/commands/apps.js`
  - `src/commands/auth.js`
