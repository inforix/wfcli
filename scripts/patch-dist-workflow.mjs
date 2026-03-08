#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const workflowPath = path.resolve(".github/workflows/release.yml");
const original = readFileSync(workflowPath, "utf8");

let updated = original;

updated = updated.replace(
  "host --steps=create --tag={0}",
  "host --allow-dirty --steps=create --tag={0}"
);

updated = updated.replace(
  /(  publish-npm:\n[\s\S]*?    runs-on: "ubuntu-22\.04"\n)(?!    permissions:\n)/,
  `$1    permissions:\n      "id-token": "write"\n      "contents": "read"\n`
);

updated = updated.replace(
  /npm publish(?: --provenance)? --access public "\.\/npm\/\$\{pkg\}"/,
  [
    'publish_path="./npm/${pkg}"',
    'if [ "$pkg" = "wfcli-npm-package.tar.gz" ]; then',
    '  tmpdir="$(mktemp -d)"',
    '  tar -xzf "$publish_path" -C "$tmpdir"',
    '  jq \'.name = "infopluscli"\' "$tmpdir/package/package.json" > "$tmpdir/package/package.json.tmp"',
    '  mv "$tmpdir/package/package.json.tmp" "$tmpdir/package/package.json"',
    '  (cd "$tmpdir" && tar -czf "$publish_path" package)',
    'fi',
    'npm publish --provenance --access public "$publish_path"'
  ]
    .map((line, idx) => (idx === 0 ? line : `            ${line}`))
    .join("\n")
);

updated = updated.replace(
  /\n        env:\n          NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}\n/,
  "\n"
);

if (updated === original) {
  process.exit(0);
}

writeFileSync(workflowPath, updated, "utf8");
