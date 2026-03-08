mod api;
mod config;
mod errors;
mod output;
mod session;

use api::{
    build_authorization_code_url, delete_file, download_file, execute_task, exchange_authorization_code,
    fetch_app_meta, fetch_file_meta, fetch_my_apps, fetch_my_completed_processes, fetch_my_doing_processes,
    fetch_my_done_processes, fetch_my_positions, fetch_my_profile, fetch_my_todo_tasks, refresh_access_token,
    start_process, update_file, upload_file, ExecuteTaskInput, FileUploadInput, StartProcessInput,
};
use clap::{ArgAction, Args, Parser, Subcommand};
use config::{resolve_auth_login_config, resolve_runtime_config, RuntimeConfig};
use errors::{to_login_hint_error, WfError, WfResult};
use output::{first_defined, render_table, value_at_path};
use rand::RngCore;
use serde_json::{json, Value};
use session::{format_expiry, load_oauth_session, load_valid_access_token, save_oauth_session};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Response, Server, StatusCode};
use url::Url;

#[derive(Parser, Debug)]
#[command(name = "wfcli", version = env!("CARGO_PKG_VERSION"), about = "Workflow CLI for SHMTU InfoPlus")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Apps(AppsCommand),
    Tasks(TasksCommand),
    Auth(AuthCommand),
    File(FileCommand),
    User(UserCommand),
    Version,
}

#[derive(Subcommand, Debug)]
enum AppsSubcommand {
    List(CommonArgs),
    Definition(AppDefinitionArgs),
}

#[derive(Args, Debug)]
struct AppsCommand {
    #[command(subcommand)]
    command: AppsSubcommand,
}

#[derive(Args, Debug)]
struct CommonArgs {
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
}

#[derive(Args, Debug)]
struct AppDefinitionArgs {
    idc: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long)]
    version: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    include_forms: bool,
    #[arg(long, action = ArgAction::SetTrue)]
    include_versions: bool,
    #[arg(long, action = ArgAction::SetTrue)]
    include_definition: bool,
}

#[derive(Subcommand, Debug)]
enum AuthSubcommand {
    Login(AuthLoginArgs),
    RefreshToken(AuthRefreshArgs),
    ShowToken(AuthShowTokenArgs),
}

#[derive(Args, Debug)]
struct AuthCommand {
    #[command(subcommand)]
    command: AuthSubcommand,
}

#[derive(Args, Debug)]
struct AuthLoginArgs {
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long)]
    scope: Option<String>,
}

#[derive(Args, Debug)]
struct AuthRefreshArgs {
    #[arg(long)]
    base_url: Option<String>,
}

#[derive(Args, Debug)]
struct AuthShowTokenArgs {
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
}

#[derive(Subcommand, Debug)]
enum TasksSubcommand {
    Todo(CommonArgs),
    Doing(CommonArgs),
    Done(CommonArgs),
    List(CommonArgs),
    Execute(TaskExecuteArgs),
    Start(TaskStartArgs),
}

#[derive(Args, Debug)]
struct TasksCommand {
    #[command(subcommand)]
    command: TasksSubcommand,
}

#[derive(Args, Debug)]
struct TaskExecuteArgs {
    task_id: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
    #[arg(long)]
    username: Option<String>,
    #[arg(long)]
    action_id: Option<String>,
    #[arg(long)]
    action_code: Option<String>,
    #[arg(long)]
    remark: Option<String>,
    #[arg(long)]
    thing: Option<String>,
    #[arg(long)]
    pickup: Option<String>,
}

#[derive(Args, Debug)]
struct TaskStartArgs {
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
    #[arg(long)]
    user_id: Option<String>,
    #[arg(long)]
    assign_to: Option<String>,
    #[arg(long)]
    secure_uri_expire: Option<String>,
    #[arg(long)]
    code: Option<String>,
    #[arg(long)]
    entrance: Option<String>,
    #[arg(long)]
    business_id: Option<String>,
    #[arg(long, default_value = "auto")]
    api_version: String,
    #[arg(long)]
    data: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    no_submit: bool,
    #[arg(long)]
    submit_task_id: Option<String>,
    #[arg(long)]
    submit_action_code: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    debug: bool,
}

#[derive(Subcommand, Debug)]
enum FileSubcommand {
    Upload(FileUploadArgs),
    Update(FileUpdateArgs),
    Meta(FileMetaArgs),
    Delete(FileDeleteArgs),
    Download(FileDownloadArgs),
}

#[derive(Args, Debug)]
struct FileCommand {
    #[command(subcommand)]
    command: FileSubcommand,
}

#[derive(Args, Debug)]
struct FileUploadArgs {
    path: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
    #[arg(long)]
    name: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    keep_name: bool,
}

#[derive(Args, Debug)]
struct FileUpdateArgs {
    file_key: String,
    path: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
    #[arg(long)]
    name: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    keep_name: bool,
}

#[derive(Args, Debug)]
struct FileMetaArgs {
    file_key: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
}

#[derive(Args, Debug)]
struct FileDeleteArgs {
    file_key: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
}

#[derive(Args, Debug)]
struct FileDownloadArgs {
    file_key: String,
    #[arg(long)]
    base_url: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    json: bool,
    #[arg(long)]
    output: Option<String>,
}

#[derive(Subcommand, Debug)]
enum UserSubcommand {
    Profile(CommonArgs),
    Positions(CommonArgs),
    Department(CommonArgs),
}

#[derive(Args, Debug)]
struct UserCommand {
    #[command(subcommand)]
    command: UserSubcommand,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as i64
}

fn print_json(value: &Value) {
    match serde_json::to_string_pretty(value) {
        Ok(rendered) => println!("{rendered}"),
        Err(_) => println!("{value}"),
    }
}

fn runtime_from_auth_config(auth_config: &config::AuthLoginConfig) -> RuntimeConfig {
    RuntimeConfig {
        client_id: auth_config.client_id.clone(),
        base_url: auth_config.base_url.clone(),
        username: None,
    }
}

fn require_access_token(config: &RuntimeConfig) -> WfResult<String> {
    match load_valid_access_token(config, now_ms(), 30_000)? {
        Some(token) => Ok(token),
        None => Err(WfError::Message(
            "No valid OAuth token found in keyring. Run \"wfcli auth login\" first.".to_string(),
        )),
    }
}

fn normalize_date(value: &Value) -> String {
    if value.is_null() {
        return String::new();
    }

    if let Some(number) = value.as_i64() {
        let ms = if number < 1_000_000_000_000 {
            number * 1000
        } else {
            number
        };
        if let Some(dt) = chrono::DateTime::from_timestamp_millis(ms) {
            return dt.to_rfc3339();
        }
    }

    if let Some(number) = value.as_f64() {
        let raw = number as i64;
        let ms = if raw < 1_000_000_000_000 { raw * 1000 } else { raw };
        if let Some(dt) = chrono::DateTime::from_timestamp_millis(ms) {
            return dt.to_rfc3339();
        }
    }

    if let Some(text) = value.as_str() {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(text) {
            return parsed.to_rfc3339();
        }
        if let Ok(parsed) = chrono::DateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
            return parsed.to_rfc3339();
        }
        return text.to_string();
    }

    value.to_string()
}

fn todo_rows(tasks: &[Value]) -> Vec<Value> {
    tasks
        .iter()
        .map(|task| {
            json!({
                "taskId": first_defined(task, &["id", "taskId"]),
                "processUri": first_defined(task, &["process.uri", "process.url", "uri", "url", "process.entry"]),
                "name": first_defined(task, &["process.name", "name"]),
                "sourceUsername": first_defined(task, &[
                    "process.owner.account",
                    "process.owner.name",
                    "source.username",
                    "source.userName",
                    "sourceUsername",
                    "sourceUserName",
                    "username",
                    "userName",
                    "assignUser.account",
                    "assignUser.name",
                    "process.source.username",
                    "process.source.userName"
                ]),
                "date": normalize_date(&value_at_path(task, "assignTime").or_else(|| value_at_path(task, "process.update")).or_else(|| value_at_path(task, "process.create")).or_else(|| value_at_path(task, "update")).or_else(|| value_at_path(task, "createdAt")).or_else(|| value_at_path(task, "createTime")).or_else(|| value_at_path(task, "createDate")).or_else(|| value_at_path(task, "date")).unwrap_or(Value::Null))
            })
        })
        .collect()
}

fn parse_start_detail(entities: &[Value]) -> Option<Value> {
    if entities.len() < 4 {
        return None;
    }
    let raw = entities.get(3)?;
    if raw.is_object() {
        return Some(raw.clone());
    }
    if let Some(text) = raw.as_str() {
        if text.is_empty() {
            return None;
        }
        return serde_json::from_str(text).ok();
    }
    None
}

fn resolve_start_task_id(entities: &[Value], override_task_id: Option<&str>) -> Option<String> {
    if let Some(value) = override_task_id {
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    if let Some(detail) = parse_start_detail(entities) {
        if let Some(id) = value_at_path(&detail, "id").and_then(|value| value.as_str().map(ToOwned::to_owned)) {
            return Some(id);
        }
        if let Some(id) = value_at_path(&detail, "taskId").and_then(|value| value.as_str().map(ToOwned::to_owned)) {
            return Some(id);
        }
        if let Some(id) = value_at_path(&detail, "task.id").and_then(|value| value.as_str().map(ToOwned::to_owned)) {
            return Some(id);
        }
    }

    entities.get(1).map(|value| {
        value
            .as_str()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| value.to_string())
    })
}

fn extract_departments(positions: &[Value]) -> Vec<Value> {
    let rows: Vec<Value> = positions
        .iter()
        .map(|item| {
            json!({
                "code": first_defined(item, &[
                    "departmentCode",
                    "deptCode",
                    "dept.code",
                    "department.code",
                    "organizationCode",
                    "org.code",
                    "organization.code"
                ]),
                "name": first_defined(item, &[
                    "department",
                    "departmentName",
                    "deptName",
                    "dept.name",
                    "department.name",
                    "organization",
                    "organizationName",
                    "org.name",
                    "organization.name"
                ])
            })
        })
        .filter(|item| {
            let code = item.get("code").and_then(|value| value.as_str()).unwrap_or("");
            let name = item.get("name").and_then(|value| value.as_str()).unwrap_or("");
            !code.is_empty() || !name.is_empty()
        })
        .collect();

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for item in rows {
        let code = item.get("code").and_then(|value| value.as_str()).unwrap_or("");
        let name = item.get("name").and_then(|value| value.as_str()).unwrap_or("");
        let key = format!("{code}|{name}");
        if !seen.contains(&key) {
            seen.insert(key);
            deduped.push(item);
        }
    }

    deduped
}

fn render_profile(profile: &Value) {
    let fields = vec![
        ("ID", vec!["id"]),
        ("ACCOUNT", vec!["account", "username", "userName"]),
        ("NAME", vec!["name", "displayName"]),
        ("EMAIL", vec!["email"]),
        ("MOBILE", vec!["mobile", "phone"]),
        ("DEPARTMENT", vec!["department"]),
    ];

    let mut rows = Vec::new();
    for (label, paths) in fields {
        let value = first_defined(profile, &paths);
        if !value.is_empty() {
            rows.push((label.to_string(), value));
        }
    }

    if rows.is_empty() {
        print_json(profile);
        return;
    }

    let max_label = rows.iter().map(|(label, _)| label.len()).max().unwrap_or(0);
    for (label, value) in rows {
        println!("{label:width$}: {value}", width = max_label);
    }
}

fn filename_from_content_disposition(value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }

    if let Some(index) = value.find("filename*=UTF-8''") {
        let candidate = &value[index + "filename*=UTF-8''".len()..];
        let part = candidate.split(';').next().unwrap_or_default();
        if let Ok(decoded) = urlencoding::decode(part) {
            let rendered = decoded.replace('"', "");
            if !rendered.is_empty() {
                return Some(rendered);
            }
        }
    }

    if let Some(index) = value.find("filename=") {
        let candidate = &value[index + "filename=".len()..];
        let part = candidate.split(';').next().unwrap_or_default().trim_matches('"');
        if !part.is_empty() {
            return Some(part.to_string());
        }
    }

    None
}

fn start_oauth_callback_server(state: String) -> WfResult<(String, Receiver<WfResult<String>>)> {
    let host = "127.0.0.1";
    let callback_path = "/oauth/callback";
    let listener = std::net::TcpListener::bind((host, 0))
        .map_err(|error| WfError::Message(format!("Failed to bind callback server: {error}")))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| WfError::Message(format!("Failed to configure callback server: {error}")))?;

    let port = listener
        .local_addr()
        .map_err(|error| WfError::Message(format!("Failed to read callback server address: {error}")))?
        .port();

    let server = Server::from_listener(listener, None)
        .map_err(|error| WfError::Message(format!("Failed to start callback server: {error}")))?;

    let redirect_uri = format!("http://{host}:{port}{callback_path}");
    let (tx, rx) = channel::<WfResult<String>>();

    std::thread::spawn(move || {
        let timeout = Duration::from_secs(180);
        let started = std::time::Instant::now();

        loop {
            if started.elapsed() > timeout {
                let _ = tx.send(Err(WfError::Message(
                    "Timed out waiting for OAuth callback after 180s.".to_string(),
                )));
                return;
            }

            match server.recv_timeout(Duration::from_millis(200)) {
                Ok(Some(request)) => {
                    let request_url = format!("http://{host}{}", request.url());
                    let parsed = match Url::parse(&request_url) {
                        Ok(value) => value,
                        Err(error) => {
                            let _ = tx.send(Err(WfError::Message(format!(
                                "Invalid callback URL: {error}"
                            ))));
                            return;
                        }
                    };

                    if parsed.path() != callback_path {
                        let _ = request.respond(
                            Response::from_string("<h1>Not Found</h1>")
                                .with_status_code(StatusCode(404)),
                        );
                        continue;
                    }

                    if let Some(error) = parsed.query_pairs().find(|(key, _)| key == "error") {
                        let _ = request.respond(
                            Response::from_string(format!(
                                "<h1>Authorization failed</h1><p>{}</p>",
                                error.1
                            ))
                            .with_status_code(StatusCode(400)),
                        );
                        let _ = tx.send(Err(WfError::Message(format!(
                            "Authorization failed: {}",
                            error.1
                        ))));
                        return;
                    }

                    let received_state = parsed
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .map(|(_, value)| value.to_string())
                        .unwrap_or_default();
                    if received_state != state {
                        let _ = request.respond(
                            Response::from_string("<h1>Invalid state</h1>")
                                .with_status_code(StatusCode(400)),
                        );
                        let _ =
                            tx.send(Err(WfError::Message("OAuth state mismatch in callback.".to_string())));
                        return;
                    }

                    let code = parsed
                        .query_pairs()
                        .find(|(key, _)| key == "code")
                        .map(|(_, value)| value.to_string())
                        .unwrap_or_default();

                    if code.is_empty() {
                        let _ = request.respond(
                            Response::from_string("<h1>Missing code</h1>")
                                .with_status_code(StatusCode(400)),
                        );
                        let _ = tx.send(Err(WfError::Message(
                            "OAuth callback missing authorization code.".to_string(),
                        )));
                        return;
                    }

                    let _ = request.respond(
                        Response::from_string(
                            "<h1>Login successful</h1><p>You can close this tab and return to wfcli.</p>",
                        )
                        .with_status_code(StatusCode(200)),
                    );

                    let _ = tx.send(Ok(code));
                    return;
                }
                Ok(None) => continue,
                Err(_) => continue,
            }
        }
    });

    Ok((redirect_uri, rx))
}

async fn run_auth_login(client: &reqwest::Client, args: &AuthLoginArgs) -> WfResult<()> {
    let config = resolve_auth_login_config(args.base_url.as_deref(), args.scope.as_deref())?;
    let runtime_config = runtime_from_auth_config(&config);

    let mut random_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut random_bytes);
    let state = random_bytes.iter().map(|value| format!("{:02x}", value)).collect::<String>();

    let (redirect_uri, code_rx) = start_oauth_callback_server(state.clone())?;

    let authorize_url = build_authorization_code_url(&config, &redirect_uri, &state);
    println!("Opening browser for OAuth login...");
    println!("If browser does not open, visit:\n{authorize_url}");

    if let Err(error) = webbrowser::open(&authorize_url) {
        println!("Browser open failed: {error}");
        println!("Continue manually with the URL above.");
    }

    let code = code_rx
        .recv()
        .map_err(|error| WfError::Message(format!("Failed to receive OAuth callback: {error}")))??;
    let token_response = exchange_authorization_code(client, &config, &code, &redirect_uri).await?;
    let session = save_oauth_session(&runtime_config, &token_response, now_ms())?;

    println!(
        "Login successful. Token saved to keyring (expires: {}).",
        format_expiry(session.expires_at)
    );
    Ok(())
}

async fn run_auth_refresh_token(client: &reqwest::Client, args: &AuthRefreshArgs) -> WfResult<()> {
    let config = resolve_auth_login_config(args.base_url.as_deref(), None)?;
    let runtime_config = runtime_from_auth_config(&config);
    let existing_session = load_oauth_session(&runtime_config)?
        .ok_or_else(|| WfError::Message("No OAuth session found in keyring. Run \"wfcli auth login\" first.".to_string()))?;

    let refresh_token = existing_session
        .refresh_token
        .clone()
        .ok_or_else(|| WfError::Message("Current OAuth session has no refresh_token. Run \"wfcli auth login\" first.".to_string()))?;

    let mut token_response = refresh_access_token(client, &config, &refresh_token).await?;
    if token_response.refresh_token.is_none() {
        token_response.refresh_token = Some(refresh_token);
    }

    let session = save_oauth_session(&runtime_config, &token_response, now_ms())?;
    println!(
        "Token refreshed successfully. Token saved to keyring (expires: {}).",
        format_expiry(session.expires_at)
    );

    Ok(())
}

fn run_auth_show_token(args: &AuthShowTokenArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let session = load_oauth_session(&config)?
        .ok_or_else(|| WfError::Message("No OAuth session found in keyring. Run \"wfcli auth login\" first.".to_string()))?;

    if args.json {
        print_json(&json!({
            "accessToken": session.access_token,
            "tokenType": session.token_type,
            "scope": session.scope,
            "obtainedAt": session.obtained_at,
            "expiresAt": session.expires_at,
            "expired": session.expires_at.map(|value| value <= now_ms()).unwrap_or(false)
        }));
    } else {
        println!("{}", session.access_token);
    }
    Ok(())
}

async fn run_apps_list(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let apps = fetch_my_apps(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    if args.json {
        print_json(&Value::Array(apps));
        return Ok(());
    }

    let columns = [
        ("code", "CODE"),
        ("name", "NAME"),
        ("ready", "READY"),
        ("visible", "VISIBLE"),
        ("release", "RELEASE"),
        ("tags", "TAGS"),
    ];
    render_table(&apps, &columns, "No apps found.");

    Ok(())
}

async fn run_apps_definition(client: &reqwest::Client, args: &AppDefinitionArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let app = fetch_app_meta(
        client,
        &config,
        &args.idc,
        &access_token,
        args.version.as_deref(),
        args.include_forms,
        args.include_versions,
        args.include_definition,
    )
    .await
    .map_err(|error| to_login_hint_error(error, false))?
    .unwrap_or(Value::Null);

    print_json(&app);
    Ok(())
}

async fn run_tasks_todo(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let tasks = fetch_my_todo_tasks(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;
    let rows = todo_rows(&tasks);

    if args.json {
        print_json(&Value::Array(rows));
    } else {
        let columns = [
            ("taskId", "TASK_ID"),
            ("processUri", "PROCESS_URI"),
            ("name", "NAME"),
            ("sourceUsername", "SOURCE_USERNAME"),
            ("date", "DATE"),
        ];
        render_table(&rows, &columns, "No todo tasks found.");
    }

    Ok(())
}

async fn run_tasks_doing(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let entities = fetch_my_doing_processes(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    if args.json {
        print_json(&Value::Array(entities));
    } else {
        let columns = [
            ("id", "PROCESS_ID"),
            ("name", "PROCESS_NAME"),
            ("status", "STATUS"),
            ("entry", "ENTRY"),
            ("app.code", "APP"),
            ("update", "UPDATE"),
        ];
        render_table(&entities, &columns, "No doing processes found.");
    }

    Ok(())
}

async fn run_tasks_done(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let entities = fetch_my_done_processes(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    if args.json {
        print_json(&Value::Array(entities));
    } else {
        let columns = [
            ("id", "PROCESS_ID"),
            ("name", "PROCESS_NAME"),
            ("status", "STATUS"),
            ("entry", "ENTRY"),
            ("app.code", "APP"),
            ("update", "UPDATE"),
        ];
        render_table(&entities, &columns, "No done processes found.");
    }

    Ok(())
}

async fn run_tasks_list(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let todo = fetch_my_todo_tasks(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;
    let completed = fetch_my_completed_processes(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    let mut entities = Vec::new();
    for task in todo {
        entities.push(json!({
            "type": "task",
            "id": task.get("id").cloned().unwrap_or(Value::Null),
            "name": task.get("name").cloned().unwrap_or(Value::Null),
            "status": task.get("status").cloned().unwrap_or(Value::Null),
            "entry": value_at_path(&task, "process.entry").unwrap_or(Value::Null),
            "app": value_at_path(&task, "process.app.code").or_else(|| value_at_path(&task, "process.app.name")).unwrap_or(Value::Null),
            "update": task.get("update").cloned().unwrap_or(Value::Null)
        }));
    }
    for process in completed {
        entities.push(json!({
            "type": "process",
            "id": process.get("id").cloned().unwrap_or(Value::Null),
            "name": process.get("name").cloned().unwrap_or(Value::Null),
            "status": process.get("status").cloned().unwrap_or(Value::Null),
            "entry": process.get("entry").cloned().unwrap_or(Value::Null),
            "app": value_at_path(&process, "app.code").or_else(|| value_at_path(&process, "app.name")).unwrap_or(Value::Null),
            "update": process.get("update").cloned().unwrap_or(Value::Null)
        }));
    }

    if args.json {
        print_json(&Value::Array(entities));
    } else {
        let columns = [
            ("type", "TYPE"),
            ("id", "ID"),
            ("name", "NAME"),
            ("status", "STATUS"),
            ("entry", "ENTRY"),
            ("app", "APP"),
            ("update", "UPDATE"),
        ];
        render_table(&entities, &columns, "No tasks or completed processes found.");
    }

    Ok(())
}

async fn run_tasks_execute(client: &reqwest::Client, args: &TaskExecuteArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, args.username.as_deref())?;
    let access_token = require_access_token(&config)?;

    let input = ExecuteTaskInput {
        user_id: args.username.clone().or_else(|| config.username.clone()),
        action_id: args.action_id.clone(),
        action_code: args.action_code.clone(),
        remark: args.remark.clone(),
        thing: args.thing.clone(),
        pickup: args.pickup.clone(),
    };

    let entities = execute_task(client, &config, &args.task_id, &access_token, &input)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    if args.json {
        print_json(&Value::Array(entities));
    } else {
        println!("Task {} execute request submitted.", args.task_id);
    }

    Ok(())
}

async fn run_tasks_start(client: &reqwest::Client, args: &TaskStartArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, args.user_id.as_deref())?;
    let access_token = require_access_token(&config)?;

    let data = if let Some(raw) = &args.data {
        Some(serde_json::from_str(raw).map_err(|_| {
            WfError::Message("Invalid --data JSON. Example: --data '{\"field\":\"value\"}'".to_string())
        })?)
    } else {
        None
    };

    let input = StartProcessInput {
        user_id: args.user_id.clone().or_else(|| config.username.clone()),
        assign_to: args.assign_to.clone(),
        secure_uri_expire: args.secure_uri_expire.clone(),
        code: args.code.clone(),
        entrance: args.entrance.clone(),
        business_id: args.business_id.clone(),
        data,
        api_version: args.api_version.clone(),
        debug: args.debug,
    };

    if args.debug {
        eprintln!(
            "[debug] tasks.start input: {}",
            serde_json::to_string(&json!({
                "userId": input.user_id,
                "assignTo": input.assign_to,
                "secureURIExpire": input.secure_uri_expire,
                "code": input.code,
                "entrance": input.entrance,
                "businessId": input.business_id,
                "data": input.data,
                "apiVersion": input.api_version
            }))
            .unwrap_or_else(|_| "{}".to_string())
        );
    }

    let entities = start_process(client, &config, &access_token, &input)
        .await
        .map_err(|error| {
            if !args.debug && error.to_string().contains("fetch failed") {
                WfError::Message(
                    "Failed to call process start API. Check WORKFLOW_BASE_URL/network/VPN and retry."
                        .to_string(),
                )
            } else {
                to_login_hint_error(error, false)
            }
        })?;

    let should_submit = !args.no_submit;
    let mut submit_task_id = None;
    let mut submit_entities = None;

    if should_submit {
        let resolved = resolve_start_task_id(&entities, args.submit_task_id.as_deref()).ok_or_else(|| {
            WfError::Message(
                "Process started but cannot resolve task id from start response. Retry with --submit-task-id <id>."
                    .to_string(),
            )
        })?;

        submit_task_id = Some(resolved.clone());
        let submit_input = ExecuteTaskInput {
            user_id: args.user_id.clone().or_else(|| config.username.clone()),
            action_id: None,
            action_code: args.submit_action_code.clone(),
            remark: None,
            thing: None,
            pickup: None,
        };

        let result = execute_task(client, &config, &resolved, &access_token, &submit_input)
            .await
            .map_err(|error| to_login_hint_error(error, false))?;
        submit_entities = Some(result);
    }

    if args.json {
        if should_submit {
            print_json(&json!({
                "start": entities,
                "submitTaskId": submit_task_id,
                "submit": submit_entities
            }));
        } else {
            print_json(&Value::Array(entities.clone()));
        }
        return Ok(());
    }

    if entities.is_empty() {
        println!(
            "Process start request sent successfully, but API returned empty response. Please run `wfcli tasks doing` to verify the new process."
        );
        return Ok(());
    }

    let entry = entities
        .first()
        .map(|value| value.as_str().map(ToOwned::to_owned).unwrap_or_else(|| value.to_string()))
        .unwrap_or_else(|| "unknown".to_string());
    let first_task_url = entities
        .get(2)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);

    if let Some(url) = first_task_url {
        println!("Process started successfully. entry={} url={}", entry, url);
    } else {
        println!("Process started successfully. entry={}", entry);
    }

    let hinted_task_id = resolve_start_task_id(&entities, None);
    if should_submit {
        if let Some(task_id) = submit_task_id {
            if let Some(action_code) = &args.submit_action_code {
                println!(
                    "Start task submitted successfully. taskId={} actionCode={}",
                    task_id, action_code
                );
            } else {
                println!("Start task submitted successfully. taskId={}", task_id);
            }
        }
    } else if let Some(task_id) = hinted_task_id {
        println!("Next: wfcli tasks execute {} --action-code TJ", task_id);
    }

    Ok(())
}

async fn run_user_profile(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let profile = fetch_my_profile(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, true))?
        .unwrap_or(Value::Null);

    if args.json {
        print_json(&profile);
    } else {
        render_profile(&profile);
    }

    Ok(())
}

fn normalize_position(item: &Value) -> Value {
    json!({
        "department": first_defined(item, &[
            "department",
            "departmentName",
            "dept",
            "deptName",
            "dept.name",
            "department.name",
            "org.name",
            "organization.name",
            "group.name"
        ]),
        "organization": first_defined(item, &[
            "organization",
            "organizationName",
            "org.name",
            "organization.name",
            "orgPath",
            "path",
            "dept.name"
        ]),
        "job": first_defined(item, &[
            "title",
            "position",
            "positionName",
            "post",
            "post.name",
            "job",
            "roleName",
            "role.name"
        ]),
        "primary": first_defined(item, &["primary", "isPrimary", "main", "isMain", "default", "post.formal"])
    })
}

async fn run_user_positions(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let positions = fetch_my_positions(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, true))?;

    if args.json {
        print_json(&Value::Array(positions));
        return Ok(());
    }

    let rows = positions.iter().map(normalize_position).collect::<Vec<_>>();
    let columns = [
        ("department", "DEPARTMENT"),
        ("organization", "ORGANIZATION"),
        ("job", "JOB"),
        ("primary", "PRIMARY"),
    ];
    render_table(&rows, &columns, "No positions found.");
    Ok(())
}

async fn run_user_department(client: &reqwest::Client, args: &CommonArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let positions = fetch_my_positions(client, &config, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, true))?;

    let departments = extract_departments(&positions);
    if args.json {
        print_json(&Value::Array(departments));
    } else if departments.is_empty() {
        println!("No departments found.");
    } else {
        let columns = [("code", "CODE"), ("name", "NAME")];
        render_table(&departments, &columns, "No departments found.");
    }

    Ok(())
}

fn output_json_or_text(json_mode: bool, payload: Value, message: String) {
    if json_mode {
        print_json(&payload);
    } else {
        println!("{message}");
    }
}

async fn run_file_upload(client: &reqwest::Client, args: &FileUploadArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let content = fs::read(&args.path)
        .map_err(|error| WfError::Message(format!("Failed to read file {}: {error}", args.path)))?;
    let file_name = args
        .name
        .clone()
        .unwrap_or_else(|| Path::new(&args.path).file_name().and_then(|s| s.to_str()).unwrap_or("upload.bin").to_string());

    let payload = upload_file(
        client,
        &config,
        &access_token,
        FileUploadInput {
            file_name: file_name.clone(),
            content,
            keep_file_name: args.keep_name,
        },
    )
    .await
    .map_err(|error| to_login_hint_error(error, false))?;

    output_json_or_text(args.json, payload, format!("Uploaded file \"{}\" successfully.", file_name));
    Ok(())
}

async fn run_file_update(client: &reqwest::Client, args: &FileUpdateArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let content = fs::read(&args.path)
        .map_err(|error| WfError::Message(format!("Failed to read file {}: {error}", args.path)))?;
    let file_name = args
        .name
        .clone()
        .unwrap_or_else(|| Path::new(&args.path).file_name().and_then(|s| s.to_str()).unwrap_or("upload.bin").to_string());

    let payload = update_file(
        client,
        &config,
        &args.file_key,
        &access_token,
        FileUploadInput {
            file_name,
            content,
            keep_file_name: args.keep_name,
        },
    )
    .await
    .map_err(|error| to_login_hint_error(error, false))?;

    output_json_or_text(
        args.json,
        payload,
        format!("Updated file \"{}\" successfully.", args.file_key),
    );
    Ok(())
}

async fn run_file_meta(client: &reqwest::Client, args: &FileMetaArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let payload = fetch_file_meta(client, &config, &args.file_key, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    if args.json {
        print_json(&payload);
    } else {
        print_json(&payload);
    }

    Ok(())
}

async fn run_file_delete(client: &reqwest::Client, args: &FileDeleteArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let payload = delete_file(client, &config, &args.file_key, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    output_json_or_text(
        args.json,
        payload,
        format!("Deleted file \"{}\" successfully.", args.file_key),
    );

    Ok(())
}

async fn run_file_download(client: &reqwest::Client, args: &FileDownloadArgs) -> WfResult<()> {
    let config = resolve_runtime_config(args.base_url.as_deref(), None, None)?;
    let access_token = require_access_token(&config)?;

    let payload = download_file(client, &config, &args.file_key, &access_token)
        .await
        .map_err(|error| to_login_hint_error(error, false))?;

    let header_name = filename_from_content_disposition(&payload.content_disposition);
    let output_path = args.output.clone().or(header_name).unwrap_or_else(|| {
        args.file_key
            .split('/')
            .next_back()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "download.bin".to_string())
    });

    let mut file = fs::File::create(&output_path)
        .map_err(|error| WfError::Message(format!("Failed to create output file {output_path}: {error}")))?;
    file.write_all(&payload.data)
        .map_err(|error| WfError::Message(format!("Failed to write output file {output_path}: {error}")))?;

    let result = json!({
        "path": output_path.clone(),
        "bytes": payload.data.len(),
        "contentType": payload.content_type
    });

    output_json_or_text(
        args.json,
        result,
        format!("Downloaded file to {} ({} bytes).", output_path, payload.data.len()),
    );

    Ok(())
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();

    let client = reqwest::Client::builder()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let result = match cli.command {
        Commands::Apps(command) => match command.command {
            AppsSubcommand::List(args) => run_apps_list(&client, &args).await,
            AppsSubcommand::Definition(args) => run_apps_definition(&client, &args).await,
        },
        Commands::Tasks(command) => match command.command {
            TasksSubcommand::Todo(args) => run_tasks_todo(&client, &args).await,
            TasksSubcommand::Doing(args) => run_tasks_doing(&client, &args).await,
            TasksSubcommand::Done(args) => run_tasks_done(&client, &args).await,
            TasksSubcommand::List(args) => run_tasks_list(&client, &args).await,
            TasksSubcommand::Execute(args) => run_tasks_execute(&client, &args).await,
            TasksSubcommand::Start(args) => run_tasks_start(&client, &args).await,
        },
        Commands::Auth(command) => match command.command {
            AuthSubcommand::Login(args) => run_auth_login(&client, &args).await,
            AuthSubcommand::RefreshToken(args) => run_auth_refresh_token(&client, &args).await,
            AuthSubcommand::ShowToken(args) => run_auth_show_token(&args),
        },
        Commands::File(command) => match command.command {
            FileSubcommand::Upload(args) => run_file_upload(&client, &args).await,
            FileSubcommand::Update(args) => run_file_update(&client, &args).await,
            FileSubcommand::Meta(args) => run_file_meta(&client, &args).await,
            FileSubcommand::Delete(args) => run_file_delete(&client, &args).await,
            FileSubcommand::Download(args) => run_file_download(&client, &args).await,
        },
        Commands::User(command) => match command.command {
            UserSubcommand::Profile(args) => run_user_profile(&client, &args).await,
            UserSubcommand::Positions(args) => run_user_positions(&client, &args).await,
            UserSubcommand::Department(args) => run_user_department(&client, &args).await,
        },
        Commands::Version => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    };

    if let Err(error) = result {
        eprintln!("Error: {}", error);
        std::process::exit(1);
    }
}
