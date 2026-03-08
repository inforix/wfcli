use serde_json::Value;

pub fn value_at_path(value: &Value, path: &str) -> Option<Value> {
    let mut current = value;
    for part in path.split('.') {
        match current {
            Value::Object(map) => current = map.get(part)?,
            _ => return None,
        }
    }
    Some(current.clone())
}

pub fn first_defined(value: &Value, paths: &[&str]) -> String {
    for path in paths {
        if let Some(candidate) = value_at_path(value, path) {
            let rendered = value_to_string(&candidate);
            if !rendered.is_empty() {
                return rendered;
            }
        }
    }
    String::new()
}

pub fn value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => {
            if *value {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(value) => value.to_string(),
        _ => value.to_string(),
    }
}

pub fn render_table(items: &[Value], columns: &[(&str, &str)], empty_message: &str) {
    if items.is_empty() {
        println!("{empty_message}");
        return;
    }

    let rows: Vec<Vec<String>> = items
        .iter()
        .map(|item| {
            columns
                .iter()
                .map(|(key, _)| value_to_string(&value_at_path(item, key).unwrap_or(Value::Null)))
                .collect()
        })
        .collect();

    let mut widths: Vec<usize> = columns.iter().map(|(_, title)| title.len()).collect();
    for row in &rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(cell.len());
        }
    }

    let header = columns
        .iter()
        .enumerate()
        .map(|(i, (_, title))| format!("{title:<width$}", width = widths[i]))
        .collect::<Vec<_>>()
        .join("  ");
    println!("{header}");

    let separator = widths
        .iter()
        .map(|width| "-".repeat(*width))
        .collect::<Vec<_>>()
        .join("  ");
    println!("{separator}");

    for row in rows {
        let line = row
            .iter()
            .enumerate()
            .map(|(i, cell)| format!("{cell:<width$}", width = widths[i]))
            .collect::<Vec<_>>()
            .join("  ");
        println!("{line}");
    }
}
