# InfoPlus wfcli Command Cheatsheet

## 1. Setup
```bash
npm install
cp .env.example .env
npx wfcli version
```

Required environment variables:
- `WORKFLOW_CLIENT_ID`
- `WORKFLOW_BASE_URL`
- `WORKFLOW_CLIENT_SECRET` (required for login/refresh)

Optional environment variables:
- `WORKFLOW_AUTH_SCOPE`
- `WORKFLOW_SCOPE`
- `WORKFLOW_USERNAME`

## 2. Authentication
```bash
npx wfcli auth login
npx wfcli auth login --scope "profile data openid app process task start process_edit app_edit"
npx wfcli auth refresh-token
npx wfcli auth show-token
npx wfcli auth show-token --json
```

## 3. Apps
```bash
npx wfcli apps list
npx wfcli apps list --json
npx wfcli apps definition BKQDJ
npx wfcli apps definition BKQDJ --include-forms --include-versions
```

## 4. Tasks and Processes
```bash
npx wfcli tasks todo
npx wfcli tasks doing
npx wfcli tasks done
npx wfcli tasks list

npx wfcli tasks start --code BKQDJ --data '{"reason":"补考勤"}'
npx wfcli tasks start --code BKQ --no-submit --data '{"groupBDJXX":[{"fieldXH":"1"}]}'
npx wfcli tasks start --code BKQ --submit-action-code TJ --data '{"groupBDJXX":[{"fieldXH":"1"}]}'

npx wfcli tasks execute 123456 --action-code approve --remark "已确认"
npx wfcli tasks execute 123456 --username alice
```

## 5. File API
```bash
npx wfcli file upload ./demo.txt --keep-name
npx wfcli file meta file-key-1
npx wfcli file download file-key-1 --output ./downloaded.txt
npx wfcli file update file-key-1 ./new-demo.txt --keep-name
npx wfcli file delete file-key-1
```

## 6. Troubleshooting Patterns
- `No valid OAuth token found in keyring` -> run `npx wfcli auth login`
- `Access token scope is invalid` -> re-login with explicit default scope string
- `Invalid --data JSON` -> validate JSON and rebuild from `apps definition <idc>`
- `fetch failed` on start -> verify base URL, VPN, network reachability
