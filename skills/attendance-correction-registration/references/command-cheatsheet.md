# Attendance Correction (补考勤登记) Cheatsheet

## 1. Token First
```bash
wfcli auth show-token --json
```

## 2. Login/Refresh If Needed
```bash
wfcli auth login --scope "profile data openid app process task start process_edit app_edit triple"
```
Note: `auth login` is only required when there is no valid token.

## 3. Fetch user fields (for payload)
```bash
wfcli user profile --json
wfcli user department --json
```

## 4. Known Working BKQ Payload (sample)
```bash
DATA='{"fieldBM":"200300","fieldBM_Name":"教务处","fieldGH":"993333","fieldXM":"王玉平","fieldSQRQ":1772874290,"fieldXH":["1"],"fieldBDJRQ":[1772596800],"fieldBDJRGZQK":["正常上班，漏考勤"],"fieldKQQY":["临港校区"],"fieldKQQY_Name":["临港校区"]}'
```

User must provide:
- `fieldBDJRQ` (补登记日期, unix seconds, array)
- `fieldBDJRGZQK` (工作情况/原因, array)
- `fieldKQQY` (考勤区域, array; also copied to `fieldKQQY_Name`)

Auto-filled via `wfcli`:
- `fieldBM`, `fieldBM_Name` from `wfcli user department --json`
- `fieldGH`, `fieldXM` from `wfcli user profile --json`
- `fieldSQRQ` as current unix seconds
- `fieldXH` as `["1"]`

Location constraints:
- `fieldKQQY` and `fieldKQQY_Name` must be identical.
- Allowed values (from current select options):
  - `临港校区`
  - `上海国际航运研究中心`
  - `上海海大资产经营有限公司`
  - `上海港湾学校（继续教育学院）`
  - `高恒大厦`

## 5. Pre-submit checklist (must pass)
- Token exists; if missing, run `wfcli auth login`.
- `fieldBDJRQ` present and uses unix seconds (array).
- `fieldBDJRGZQK` present and non-empty (array).
- `fieldKQQY` present and in allowed values.
- `fieldKQQY_Name` equals `fieldKQQY`.
- Auto-fill fields from `wfcli user profile/department`.

## 6. Direct Start + Submit (default)
```bash
wfcli tasks start --code BKQ --submit-action-code Submit --data "$DATA"
```
Note: `--submit-action-code` is fixed to `Submit` for this skill.

## 7. Status checks
```bash
wfcli tasks doing --json
wfcli tasks done --json
```

## 8. Fallback (only if direct flow fails)
```bash
wfcli apps definition BKQ | jq '.currentVersion.schema.fields'
wfcli tasks start --code BKQ --no-submit --data "$DATA"
wfcli tasks execute <taskId> --action-code Submit
```
