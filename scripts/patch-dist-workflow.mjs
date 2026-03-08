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
  "|| 'plan' }} --output-format=json > plan-dist-manifest.json",
  "|| 'plan --allow-dirty' }} --output-format=json > plan-dist-manifest.json"
);

updated = updated.replace(
  "dist build ${{ needs.plan.outputs.tag-flag }} --print=linkage --output-format=json ${{ matrix.dist_args }} > dist-manifest.json",
  "dist build --allow-dirty ${{ needs.plan.outputs.tag-flag }} --print=linkage --output-format=json ${{ matrix.dist_args }} > dist-manifest.json"
);

updated = updated.replace(
  "dist build ${{ needs.plan.outputs.tag-flag }} --output-format=json \"--artifacts=global\" > dist-manifest.json",
  "dist build --allow-dirty ${{ needs.plan.outputs.tag-flag }} --output-format=json \"--artifacts=global\" > dist-manifest.json"
);

updated = updated.replace(
  "dist host ${{ needs.plan.outputs.tag-flag }} --steps=upload --steps=release --output-format=json > dist-manifest.json",
  "dist host --allow-dirty ${{ needs.plan.outputs.tag-flag }} --steps=upload --steps=release --output-format=json > dist-manifest.json"
);

updated = updated.replace(
  /(  publish-npm:\n[\s\S]*?    runs-on: "ubuntu-22\.04"\n)(?!    permissions:\n)/,
  `$1    permissions:\n      "id-token": "write"\n      "contents": "read"\n`
);

updated = updated.replace(
  /npm publish(?: --provenance)? --access public "\.\/npm\/\$\{pkg\}"/,
  [
    'publish_path="$(find ./npm -type f -name "$pkg" | head -n 1)"',
    'if [ -z "$publish_path" ]; then',
    '  echo "unable to locate npm package artifact: $pkg"',
    '  find ./npm -maxdepth 5 -type f -print',
    '  exit 1',
    'fi',
    'tmpdir="$(mktemp -d)"',
    'tar -xzf "$publish_path" -C "$tmpdir"',
    'pkg_name="$(jq -r \'.name\' \"$tmpdir/package/package.json\")"',
    'if [ "$pkg_name" != "infopluscli" ]; then',
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
