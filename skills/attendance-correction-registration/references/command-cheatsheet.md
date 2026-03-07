# Attendance Correction (补考勤登记) Cheatsheet

## 1. Login
```bash
npx wfcli auth login --scope "profile data openid app process task start process_edit app_edit"
```

## 2. Discover app and fields
```bash
npx wfcli apps list --json | jq '.[] | {code,name}'
npx wfcli apps definition BKQDJ | jq '.currentVersion.schema.fields'
```

## 3. Start request
```bash
# auto-submit
npx wfcli tasks start --code BKQDJ --data '{"reason":"missing clock"}'

# draft only
npx wfcli tasks start --code BKQDJ --no-submit --data '{"reason":"missing clock"}'
```

## 4. Submit draft
```bash
npx wfcli tasks todo --json
npx wfcli tasks execute <taskId> --action-code TJ
```

## 5. Status checks
```bash
npx wfcli tasks doing
npx wfcli tasks done
```
