const APPS_TABLE_COLUMNS = [
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

function getValueByPath(item, keyPath) {
  return keyPath.split(".").reduce((value, key) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    return value[key];
  }, item);
}

export function renderTable(items, columns, writer = process.stdout, emptyMessage = "No data found.") {
  if (items.length === 0) {
    writer.write(`${emptyMessage}\n`);
    return;
  }

  const rows = items.map((item) =>
    columns.map((column) => stringValue(getValueByPath(item, column.key)))
  );
  const widths = columns.map((column, columnIndex) => {
    const maxCellWidth = rows.reduce((maxWidth, row) => {
      return Math.max(maxWidth, row[columnIndex].length);
    }, 0);
    return Math.max(column.title.length, maxCellWidth);
  });

  const header = columns.map((column, i) => column.title.padEnd(widths[i])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  writer.write(`${header}\n`);
  writer.write(`${separator}\n`);

  for (const row of rows) {
    writer.write(`${row.map((cell, i) => cell.padEnd(widths[i])).join("  ")}\n`);
  }
}

export function renderAppsTable(apps, writer = process.stdout) {
  renderTable(apps, APPS_TABLE_COLUMNS, writer, "No apps found.");
}
