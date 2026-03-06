const TABLE_COLUMNS = [
  { key: "code", title: "CODE" },
  { key: "name", title: "NAME" },
  { key: "ready", title: "READY" },
  { key: "visible", title: "VISIBLE" },
  { key: "release", title: "RELEASE" },
  { key: "tags", title: "TAGS" }
];

function stringValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function renderAppsTable(apps, writer = process.stdout) {
  if (apps.length === 0) {
    writer.write("No apps found.\n");
    return;
  }

  const rows = apps.map((app) => TABLE_COLUMNS.map((column) => stringValue(app[column.key])));
  const widths = TABLE_COLUMNS.map((column, columnIndex) => {
    const maxCellWidth = rows.reduce((maxWidth, row) => {
      return Math.max(maxWidth, row[columnIndex].length);
    }, 0);
    return Math.max(column.title.length, maxCellWidth);
  });

  const header = TABLE_COLUMNS.map((column, i) => column.title.padEnd(widths[i])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  writer.write(`${header}\n`);
  writer.write(`${separator}\n`);

  for (const row of rows) {
    writer.write(`${row.map((cell, i) => cell.padEnd(widths[i])).join("  ")}\n`);
  }
}
