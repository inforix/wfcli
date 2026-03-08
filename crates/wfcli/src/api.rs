use crate::config::{AuthLoginConfig, RuntimeConfig};
use crate::errors::{ApiError, WfError, WfResult};
use crate::session::TokenResponse;
use base64::Engine;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::HashMap;
use url::form_urlencoded::Serializer;

#[derive(Debug, Clone)]
pub struct ExecuteTaskInput {
    pub user_id: Option<String>,
    pub action_id: Option<String>,
    pub action_code: Option<String>,
    pub remark: Option<String>,
    pub thing: Option<String>,
    pub pickup: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StartProcessInput {
    pub user_id: Option<String>,
    pub assign_to: Option<String>,
    pub secure_uri_expire: Option<String>,
    pub code: Option<String>,
    pub entrance: Option<String>,
    pub business_id: Option<String>,
    pub data: Option<Value>,
    pub api_version: String,
    pub debug: bool,
}

#[derive(Debug, Clone)]
pub struct FileUploadInput {
    pub file_name: String,
    pub content: Vec<u8>,
    pub keep_file_name: bool,
}

#[derive(Debug, Clone)]
pub struct FileDownloadResult {
    pub data: Vec<u8>,
    pub content_type: String,
    pub content_disposition: String,
}

fn token_url(base_url: &str) -> String {
    format!("{base_url}/infoplus/oauth2/token")
}

fn authorization_url(base_url: &str) -> String {
    format!("{base_url}/infoplus/oauth2/authorize")
}

fn my_apps_url(base_url: &str) -> String {
    format!("{base_url}/infoplus/apis/v2/me/apps")
}

fn me_scoped_api_url(base_url: &str, path: &str) -> String {
    format!("{base_url}/infoplus/apis/v2/me/{path}")
}

fn versioned_api_url(base_url: &str, api_version: &str, path: &str, trailing_slash: bool) -> String {
    let normalized = path.trim_start_matches('/');
    let suffix = if trailing_slash { "/" } else { "" };
    format!("{base_url}/infoplus/apis/{api_version}/{normalized}{suffix}")
}

fn api_url(base_url: &str, path: &str) -> String {
    versioned_api_url(base_url, "v2", path, false)
}

fn file_api_url(base_url: &str, path: Option<&str>) -> String {
    match path {
        Some(value) if !value.is_empty() => format!("{base_url}/infoplus/file/{value}"),
        _ => format!("{base_url}/infoplus/file"),
    }
}

fn encode_file_key(file_key: &str) -> String {
    file_key
        .split('/')
        .map(|segment| urlencoding::encode(segment).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_oauth_scope(scope: &str) -> String {
    scope
        .replace('+', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn to_basic_auth(client_id: &str, client_secret: &str) -> String {
    let credential = format!("{client_id}:{client_secret}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(credential);
    format!("Basic {encoded}")
}

async fn parse_json_response(response: reqwest::Response) -> WfResult<Value> {
    let body = response
        .text()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;
    if body.is_empty() {
        return Ok(json!({}));
    }

    serde_json::from_str(&body)
        .map_err(|_| WfError::Message(format!("Expected JSON response, received: {}", &body[..body.len().min(200)])))
}

async fn parse_response_payload(response: reqwest::Response) -> WfResult<Value> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    let body = response
        .text()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;
    if body.is_empty() {
        return Ok(json!({}));
    }

    if content_type.contains("application/json") {
        serde_json::from_str(&body)
            .map_err(|_| WfError::Message(format!("Expected JSON response, received: {}", &body[..body.len().min(200)])))
    } else {
        Ok(Value::String(body))
    }
}

fn is_access_token_issue(status: Option<u16>, payload: &Value) -> bool {
    let mut fields = Vec::new();
    if let Some(value) = payload.get("ecode").and_then(|value| value.as_str()) {
        fields.push(value.to_ascii_uppercase());
    }
    if let Some(value) = payload.get("error").and_then(|value| value.as_str()) {
        fields.push(value.to_ascii_uppercase());
    }
    if fields
        .iter()
        .any(|value| value.contains("ACCESS_TOKEN") || value.contains("TOKEN_EXPIRED"))
    {
        return true;
    }
    status == Some(401)
}

fn api_error(message: String, status: Option<u16>, payload: Option<Value>) -> WfError {
    let requires_login = payload
        .as_ref()
        .map(|value| is_access_token_issue(status, value))
        .unwrap_or(false);
    WfError::Api(ApiError {
        message,
        payload,
        requires_login,
    })
}

fn expect_errno_zero(payload: &Value, status: u16) -> WfResult<Vec<Value>> {
    let Some(errno) = payload.get("errno").and_then(|value| value.as_i64()) else {
        return Err(WfError::Message(format!("Invalid InfoPlus response: {payload}")));
    };

    if errno != 0 {
        return Err(api_error(
            format!(
                "InfoPlus API error: errno={}, ecode={}, error={}",
                errno,
                payload.get("ecode").and_then(|value| value.as_str()).unwrap_or(""),
                payload
                    .get("error")
                    .and_then(|value| value.as_str())
                    .unwrap_or("unknown")
            ),
            Some(status),
            Some(payload.clone()),
        ));
    }

    let Some(entities) = payload.get("entities").and_then(|value| value.as_array()) else {
        return Err(WfError::Message("Invalid InfoPlus response: entities is not an array".to_string()));
    };

    Ok(entities.clone())
}

fn form_encode(params: &[(String, String)]) -> String {
    let mut serializer = Serializer::new(String::new());
    for (key, value) in params {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

pub fn build_authorization_code_url(config: &AuthLoginConfig, redirect_uri: &str, state: &str) -> String {
    let mut serializer = Serializer::new(String::new());
    serializer.append_pair("response_type", "code");
    serializer.append_pair("client_id", &config.client_id);
    serializer.append_pair("redirect_uri", redirect_uri);
    serializer.append_pair("scope", &normalize_oauth_scope(&config.scope));
    serializer.append_pair("state", state);
    format!("{}?{}", authorization_url(&config.base_url), serializer.finish())
}

pub async fn exchange_authorization_code(client: &reqwest::Client, config: &AuthLoginConfig, code: &str, redirect_uri: &str) -> WfResult<TokenResponse> {
    let basic_params = vec![
        ("grant_type".to_string(), "authorization_code".to_string()),
        ("code".to_string(), code.to_string()),
        ("redirect_uri".to_string(), redirect_uri.to_string()),
    ];
    let basic_response = client
        .post(token_url(&config.base_url))
        .header(AUTHORIZATION, to_basic_auth(&config.client_id, &config.client_secret))
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .body(form_encode(&basic_params))
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let basic_status = basic_response.status();
    let basic_payload = parse_json_response(basic_response).await?;
    if basic_status.is_success() && basic_payload.get("access_token").is_some() {
        return serde_json::from_value(basic_payload).map_err(|error| WfError::Message(error.to_string()));
    }

    let body_params = vec![
        ("grant_type".to_string(), "authorization_code".to_string()),
        ("code".to_string(), code.to_string()),
        ("redirect_uri".to_string(), redirect_uri.to_string()),
        ("client_id".to_string(), config.client_id.clone()),
        ("client_secret".to_string(), config.client_secret.clone()),
    ];

    let body_response = client
        .post(token_url(&config.base_url))
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .body(form_encode(&body_params))
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let body_status = body_response.status();
    let body_payload = parse_json_response(body_response).await?;
    if !body_status.is_success() || body_payload.get("access_token").is_none() {
        return Err(WfError::Message(format!(
            "Failed to exchange authorization code. BasicAuth status={}, BodyAuth status={}, payload={}",
            basic_status.as_u16(),
            body_status.as_u16(),
            body_payload
        )));
    }

    serde_json::from_value(body_payload).map_err(|error| WfError::Message(error.to_string()))
}

pub async fn refresh_access_token(client: &reqwest::Client, config: &AuthLoginConfig, refresh_token: &str) -> WfResult<TokenResponse> {
    let basic_params = vec![
        ("grant_type".to_string(), "refresh_token".to_string()),
        ("refresh_token".to_string(), refresh_token.to_string()),
    ];
    let basic_response = client
        .post(token_url(&config.base_url))
        .header(AUTHORIZATION, to_basic_auth(&config.client_id, &config.client_secret))
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .body(form_encode(&basic_params))
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let basic_status = basic_response.status();
    let basic_payload = parse_json_response(basic_response).await?;
    if basic_status.is_success() && basic_payload.get("access_token").is_some() {
        return serde_json::from_value(basic_payload).map_err(|error| WfError::Message(error.to_string()));
    }

    let body_params = vec![
        ("grant_type".to_string(), "refresh_token".to_string()),
        ("refresh_token".to_string(), refresh_token.to_string()),
        ("client_id".to_string(), config.client_id.clone()),
        ("client_secret".to_string(), config.client_secret.clone()),
    ];

    let body_response = client
        .post(token_url(&config.base_url))
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .body(form_encode(&body_params))
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let body_status = body_response.status();
    let body_payload = parse_json_response(body_response).await?;
    if !body_status.is_success() || body_payload.get("access_token").is_none() {
        return Err(WfError::Message(format!(
            "Failed to refresh access token. BasicAuth status={}, BodyAuth status={}, payload={}",
            basic_status.as_u16(),
            body_status.as_u16(),
            body_payload
        )));
    }

    serde_json::from_value(body_payload).map_err(|error| WfError::Message(error.to_string()))
}

async fn request_info_plus_entities(
    client: &reqwest::Client,
    method: Method,
    url: String,
    access_token: &str,
    body: Option<String>,
    error_context: &str,
) -> WfResult<Vec<Value>> {
    let mut request = client
        .request(method, &url)
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json");

    if let Some(form) = body {
        request = request
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(form);
    }

    let response = request
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;
    let status = response.status();
    let payload = parse_json_response(response).await?;

    if !status.is_success() {
        return Err(api_error(
            format!("{error_context} (status={}, payload={})", status.as_u16(), payload),
            Some(status.as_u16()),
            Some(payload),
        ));
    }

    expect_errno_zero(&payload, status.as_u16())
}

pub async fn fetch_my_apps(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Vec<Value>> {
    let response = client
        .get(my_apps_url(&config.base_url))
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let status = response.status();
    let payload = parse_json_response(response).await?;
    if !status.is_success() {
        return Err(api_error(
            format!("Failed to fetch apps (status={}, payload={})", status.as_u16(), payload),
            Some(status.as_u16()),
            Some(payload),
        ));
    }

    expect_errno_zero(&payload, status.as_u16())
}

pub async fn fetch_my_profile(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Option<Value>> {
    let entities = request_info_plus_entities(
        client,
        Method::GET,
        me_scoped_api_url(&config.base_url, "profile"),
        access_token,
        None,
        "Failed to fetch current user profile",
    )
    .await?;
    Ok(entities.into_iter().next())
}

pub async fn fetch_my_positions(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Vec<Value>> {
    request_info_plus_entities(
        client,
        Method::GET,
        me_scoped_api_url(&config.base_url, "positions"),
        access_token,
        None,
        "Failed to fetch current user positions",
    )
    .await
}

pub async fn fetch_app_meta(
    client: &reqwest::Client,
    config: &RuntimeConfig,
    idc: &str,
    access_token: &str,
    version: Option<&str>,
    include_forms: bool,
    include_versions: bool,
    include_definition: bool,
) -> WfResult<Option<Value>> {
    let mut query = Vec::new();
    if let Some(version) = version {
        query.push(("version".to_string(), version.to_string()));
    }
    if include_forms {
        query.push(("includeForms".to_string(), "true".to_string()));
    }
    if include_versions {
        query.push(("includeVersions".to_string(), "true".to_string()));
    }
    if include_definition {
        query.push(("includeDefinition".to_string(), "true".to_string()));
    }

    let suffix = if query.is_empty() {
        String::new()
    } else {
        format!("?{}", form_encode(&query))
    };
    let encoded_idc = urlencoding::encode(idc);

    let response = client
        .get(format!("{}{}", api_url(&config.base_url, &format!("app/{encoded_idc}")), suffix))
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let status = response.status();
    let payload = parse_json_response(response).await?;
    if !status.is_success() {
        return Err(api_error(
            format!(
                "Failed to fetch app \"{idc}\" (status={}, payload={})",
                status.as_u16(),
                payload
            ),
            Some(status.as_u16()),
            Some(payload),
        ));
    }

    let entities = expect_errno_zero(&payload, status.as_u16())?;
    Ok(entities.into_iter().next())
}

pub async fn fetch_my_todo_tasks(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Vec<Value>> {
    request_info_plus_entities(
        client,
        Method::GET,
        me_scoped_api_url(&config.base_url, "tasks/todo"),
        access_token,
        None,
        "Failed to fetch todo tasks",
    )
    .await
}

pub async fn fetch_my_doing_processes(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Vec<Value>> {
    request_info_plus_entities(
        client,
        Method::GET,
        me_scoped_api_url(&config.base_url, "processes/doing"),
        access_token,
        None,
        "Failed to fetch doing processes",
    )
    .await
}

pub async fn fetch_my_done_processes(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Vec<Value>> {
    request_info_plus_entities(
        client,
        Method::GET,
        me_scoped_api_url(&config.base_url, "processes/done"),
        access_token,
        None,
        "Failed to fetch done processes",
    )
    .await
}

pub async fn fetch_my_completed_processes(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str) -> WfResult<Vec<Value>> {
    request_info_plus_entities(
        client,
        Method::GET,
        me_scoped_api_url(&config.base_url, "processes/completed"),
        access_token,
        None,
        "Failed to fetch completed processes",
    )
    .await
}

pub async fn execute_task(
    client: &reqwest::Client,
    config: &RuntimeConfig,
    task_id: &str,
    access_token: &str,
    input: &ExecuteTaskInput,
) -> WfResult<Vec<Value>> {
    let encoded_task_id = urlencoding::encode(task_id);
    let mut params = Vec::new();
    if let Some(value) = &input.user_id {
        if !value.is_empty() {
            params.push(("userId".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.action_id {
        if !value.is_empty() {
            params.push(("actionId".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.action_code {
        if !value.is_empty() {
            params.push(("actionCode".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.remark {
        if !value.is_empty() {
            params.push(("remark".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.thing {
        if !value.is_empty() {
            params.push(("thing".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.pickup {
        if !value.is_empty() {
            params.push(("pickup".to_string(), value.clone()));
        }
    }

    request_info_plus_entities(
        client,
        Method::POST,
        api_url(&config.base_url, &format!("task/{encoded_task_id}")),
        access_token,
        Some(form_encode(&params)),
        &format!("Failed to execute task \"{task_id}\" via /task/{encoded_task_id}"),
    )
    .await
}

pub async fn start_process(
    client: &reqwest::Client,
    config: &RuntimeConfig,
    access_token: &str,
    input: &StartProcessInput,
) -> WfResult<Vec<Value>> {
    let normalized_api_version = input.api_version.to_ascii_lowercase();
    if !["auto", "v2", "v2d"].contains(&normalized_api_version.as_str()) {
        return Err(WfError::Message(format!(
            "Invalid apiVersion \"{}\". Expected one of: auto, v2, v2d.",
            input.api_version
        )));
    }

    let mut params = Vec::new();
    if let Some(value) = &input.user_id {
        if !value.is_empty() {
            params.push(("userId".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.assign_to {
        if !value.is_empty() {
            params.push(("assignTo".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.secure_uri_expire {
        if !value.is_empty() {
            params.push(("secureURIExpire".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.code {
        if !value.is_empty() {
            params.push(("code".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.entrance {
        if !value.is_empty() {
            params.push(("entrance".to_string(), value.clone()));
        }
    }
    if let Some(value) = &input.business_id {
        if !value.is_empty() {
            params.push(("businessId".to_string(), value.clone()));
        }
    }
    if let Some(data) = &input.data {
        if !data.is_null() {
            params.push(("data".to_string(), data.to_string()));
        }
    }
    let form_body = form_encode(&params);

    let api_versions: Vec<&str> = if normalized_api_version == "auto" {
        vec!["v2", "v2d"]
    } else {
        vec![normalized_api_version.as_str()]
    };

    #[derive(Clone)]
    struct Attempt {
        method: Method,
        query_token: bool,
        trailing_slash: bool,
        version: String,
    }

    let mut attempts = Vec::new();
    for version in api_versions {
        for method in [Method::PUT, Method::POST] {
            for query_token in [false, true] {
                for trailing_slash in [false, true] {
                    attempts.push(Attempt {
                        method: method.clone(),
                        query_token,
                        trailing_slash,
                        version: version.to_string(),
                    });
                }
            }
        }
    }

    let mut errors = Vec::new();

    for attempt in attempts {
        let path = versioned_api_url(&config.base_url, &attempt.version, "process", attempt.trailing_slash);
        let request_url = if attempt.query_token {
            format!("{}?access_token={}", path, urlencoding::encode(access_token))
        } else {
            path
        };

        if input.debug {
            let encoded_token = urlencoding::encode(access_token);
            let redacted = request_url.replace(encoded_token.as_ref(), "<redacted>");
            eprintln!(
                "[debug] tasks.start attempt: method={} version={} authMode={} trailingSlash={} url={}",
                attempt.method,
                attempt.version,
                if attempt.query_token { "query" } else { "header" },
                attempt.trailing_slash,
                redacted
            );
        }

        let mut request = client
            .request(attempt.method.clone(), &request_url)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(form_body.clone());

        if !attempt.query_token {
            request = request.header(AUTHORIZATION, format!("Bearer {access_token}"));
        }

        let response = match request.send().await {
            Ok(value) => value,
            Err(error) => {
                errors.push(WfError::Message(format!(
                    "[{}:{}{}{}] {}",
                    attempt.version,
                    attempt.method,
                    if attempt.query_token { "+queryToken" } else { "" },
                    if attempt.trailing_slash { "+slash" } else { "" },
                    error
                )));
                continue;
            }
        };

        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();

        let payload = parse_response_payload(response).await?;

        if input.debug {
            let preview = match &payload {
                Value::String(value) => value.chars().take(200).collect::<String>(),
                _ => payload.to_string().chars().take(200).collect::<String>(),
            };
            eprintln!(
                "[debug] tasks.start response: status={} contentType={} payloadPreview={}",
                status.as_u16(),
                content_type,
                preview
            );
        }

        if !status.is_success() {
            errors.push(api_error(
                format!(
                    "[{}:{}{}{}] Failed to start process via {} /{}/process{}{} (status={}, payload={})",
                    attempt.version,
                    attempt.method,
                    if attempt.query_token { "+queryToken" } else { "" },
                    if attempt.trailing_slash { "+slash" } else { "" },
                    attempt.method,
                    attempt.version,
                    if attempt.trailing_slash { "/" } else { "" },
                    if attempt.query_token { " (query token)" } else { "" },
                    status.as_u16(),
                    payload
                ),
                Some(status.as_u16()),
                Some(payload),
            ));
            continue;
        }

        if let Some(errno) = payload.get("errno").and_then(|value| value.as_i64()) {
            if errno != 0 {
                errors.push(api_error(
                    format!(
                        "[{}:{}{}{}] InfoPlus API error: errno={}, ecode={}, error={}",
                        attempt.version,
                        attempt.method,
                        if attempt.query_token { "+queryToken" } else { "" },
                        if attempt.trailing_slash { "+slash" } else { "" },
                        errno,
                        payload.get("ecode").and_then(|value| value.as_str()).unwrap_or(""),
                        payload
                            .get("error")
                            .and_then(|value| value.as_str())
                            .unwrap_or("unknown")
                    ),
                    Some(status.as_u16()),
                    Some(payload),
                ));
                continue;
            }

            if let Some(entities) = payload.get("entities").and_then(|value| value.as_array()) {
                return Ok(entities.clone());
            }
        }

        if payload.is_null() || payload == json!({}) {
            if content_type.contains("text/html") {
                errors.push(WfError::Message(format!(
                    "[{}:{}{}{}] Received empty HTML response from process start endpoint",
                    attempt.version,
                    attempt.method,
                    if attempt.query_token { "+queryToken" } else { "" },
                    if attempt.trailing_slash { "+slash" } else { "" }
                )));
                continue;
            }
            return Ok(Vec::new());
        }

        if let Value::String(value) = payload {
            if content_type.contains("text/html") {
                errors.push(WfError::Message(format!(
                    "[{}:{}{}{}] Received HTML response from process start endpoint: {}",
                    attempt.version,
                    attempt.method,
                    if attempt.query_token { "+queryToken" } else { "" },
                    if attempt.trailing_slash { "+slash" } else { "" },
                    value.chars().take(200).collect::<String>()
                )));
                continue;
            }
            return Ok(vec![Value::String(value)]);
        }

        errors.push(WfError::Message(format!(
            "[{}:{}{}{}] Invalid InfoPlus response: {}",
            attempt.version,
            attempt.method,
            if attempt.query_token { "+queryToken" } else { "" },
            if attempt.trailing_slash { "+slash" } else { "" },
            payload
        )));
    }

    if errors
        .iter()
        .any(|error| matches!(error, WfError::Api(api_error) if api_error.requires_login))
    {
        return Err(WfError::Api(ApiError {
            message: "Access token is invalid or expired.".to_string(),
            payload: None,
            requires_login: true,
        }));
    }

    let details = errors
        .into_iter()
        .map(|error| error.to_string())
        .collect::<Vec<_>>()
        .join(" | ");

    Err(WfError::Message(format!(
        "Failed to start process via /process. {details}"
    )))
}

async fn request_file_api(
    client: &reqwest::Client,
    method: Method,
    url: String,
    access_token: &str,
    headers: HashMap<String, String>,
    body: Option<reqwest::multipart::Form>,
    error_context: &str,
) -> WfResult<Value> {
    let mut request = client
        .request(method, &url)
        .header(AUTHORIZATION, format!("Bearer {access_token}"));
    for (key, value) in headers {
        request = request.header(key, value);
    }
    if let Some(form) = body {
        request = request.multipart(form);
    }

    let response = request
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;
    let status = response.status();
    let payload = parse_response_payload(response).await?;
    if !status.is_success() {
        return Err(api_error(
            format!("{error_context} (status={}, payload={})", status.as_u16(), payload),
            Some(status.as_u16()),
            Some(payload),
        ));
    }

    Ok(payload)
}

pub async fn upload_file(client: &reqwest::Client, config: &RuntimeConfig, access_token: &str, input: FileUploadInput) -> WfResult<Value> {
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(input.content).file_name(input.file_name.clone()),
    );
    let query = if input.keep_file_name {
        "?keepFileName=true"
    } else {
        ""
    };

    request_file_api(
        client,
        Method::POST,
        format!("{}{}", file_api_url(&config.base_url, None), query),
        access_token,
        HashMap::new(),
        Some(form),
        &format!("Failed to upload file \"{}\"", input.file_name),
    )
    .await
}

pub async fn update_file(
    client: &reqwest::Client,
    config: &RuntimeConfig,
    file_key: &str,
    access_token: &str,
    input: FileUploadInput,
) -> WfResult<Value> {
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(input.content).file_name(input.file_name.clone()),
    );
    let query = if input.keep_file_name {
        "?keepFileName=true"
    } else {
        ""
    };

    request_file_api(
        client,
        Method::PUT,
        format!(
            "{}{}",
            file_api_url(&config.base_url, Some(&encode_file_key(file_key))),
            query
        ),
        access_token,
        HashMap::new(),
        Some(form),
        &format!("Failed to update file \"{}\"", file_key),
    )
    .await
}

pub async fn fetch_file_meta(client: &reqwest::Client, config: &RuntimeConfig, file_key: &str, access_token: &str) -> WfResult<Value> {
    request_file_api(
        client,
        Method::GET,
        file_api_url(&config.base_url, Some(&format!("{}/meta", encode_file_key(file_key)))),
        access_token,
        HashMap::new(),
        None,
        &format!("Failed to fetch file meta \"{}\"", file_key),
    )
    .await
}

pub async fn delete_file(client: &reqwest::Client, config: &RuntimeConfig, file_key: &str, access_token: &str) -> WfResult<Value> {
    request_file_api(
        client,
        Method::DELETE,
        file_api_url(&config.base_url, Some(&encode_file_key(file_key))),
        access_token,
        HashMap::new(),
        None,
        &format!("Failed to delete file \"{}\"", file_key),
    )
    .await
}

pub async fn download_file(client: &reqwest::Client, config: &RuntimeConfig, file_key: &str, access_token: &str) -> WfResult<FileDownloadResult> {
    let response = client
        .get(file_api_url(
            &config.base_url,
            Some(&format!("{}/download", encode_file_key(file_key))),
        ))
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let payload = parse_response_payload(response).await?;
        return Err(api_error(
            format!(
                "Failed to download file \"{}\" (status={}, payload={})",
                file_key,
                status.as_u16(),
                payload
            ),
            Some(status.as_u16()),
            Some(payload),
        ));
    }

    let headers = response.headers().clone();
    let data = response
        .bytes()
        .await
        .map_err(|error| WfError::Message(error.to_string()))?
        .to_vec();

    Ok(FileDownloadResult {
        data,
        content_type: headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string(),
        content_disposition: headers
            .get("content-disposition")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string(),
    })
}
