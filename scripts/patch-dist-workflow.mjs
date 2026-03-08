#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const workflowPath = path.resolve(".github/workflows/release.yml");
const original = readFileSync(workflowPath, "utf8");

let updated = original;

updated = updated.replace(
  /(  publish-npm:\n[\s\S]*?    runs-on: "ubuntu-22\.04"\n)(?!    permissions:\n)/,
  `$1    permissions:\n      "id-token": "write"\n      "contents": "read"\n`
);

updated = updated.replace(
  'npm publish --access public "./npm/${pkg}"',
  'npm publish --provenance --access public "./npm/${pkg}"'
);

updated = updated.replace(
  /\n        env:\n          NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}\n/,
  "\n"
);

if (updated === original) {
  process.exit(0);
}

writeFileSync(workflowPath, updated, "utf8");
