# InfoPlus wfcli Command Cheatsheet

## 1. Setup
```bash
npm install
cp .env.example .env
wfcli version
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
wfcli auth login
wfcli auth login --scope "profile data openid app process task start process_edit app_edit"
wfcli auth refresh-token
wfcli auth show-token
wfcli auth show-token --json
```

## 3. Apps
```bash
wfcli apps list
wfcli apps list --json
wfcli apps definition BKQDJ
wfcli apps definition BKQDJ --include-forms --include-versions
```

## 4. Tasks and Processes
```bash
wfcli tasks todo
wfcli tasks doing
wfcli tasks done
wfcli tasks list

wfcli tasks start --code BKQDJ --data '{"reason":"补考勤"}'
wfcli tasks start --code BKQ --no-submit --data '{"groupBDJXX":[{"fieldXH":"1"}]}'
wfcli tasks start --code BKQ --submit-action-code Submit --data '{"groupBDJXX":[{"fieldXH":"1"}]}'

wfcli tasks execute 123456 --action-code approve --remark "已确认"
wfcli tasks execute 123456 --username alice
```

## 5. File API
```bash
wfcli file upload ./demo.txt --keep-name
wfcli file meta file-key-1
wfcli file download file-key-1 --output ./downloaded.txt
wfcli file update file-key-1 ./new-demo.txt --keep-name
wfcli file delete file-key-1
```

## 6. Troubleshooting Patterns
- `No valid OAuth token found in keyring` -> run `wfcli auth login`
- `Access token scope is invalid` -> re-login with explicit default scope string
- `Invalid --data JSON` -> validate JSON and rebuild from `apps definition <idc>`
- `fetch failed` on start -> verify base URL, VPN, network reachability

## 7. Release/Publish (cargo-dist)
```bash
npm run dist:plan
npm run dist:generate
```

Notes:
- `dist:generate` regenerates `.github/workflows/release.yml` and applies local Trusted Publishing patch.
- npm publish in CI uses OIDC Trusted Publishing (`npm publish --provenance`), not `NPM_TOKEN`.
