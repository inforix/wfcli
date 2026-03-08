use crate::errors::{WfError, WfResult};
use std::env;

pub const DEFAULT_OAUTH_SCOPE: &str = "profile data openid app process task start process_edit app_edit";

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub client_id: String,
    pub base_url: String,
    pub username: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthLoginConfig {
    pub client_id: String,
    pub client_secret: String,
    pub base_url: String,
    pub scope: String,
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn collect_runtime_base_config(base_url_override: Option<&str>) -> WfResult<(String, String)> {
    let client_id = env::var("WORKFLOW_CLIENT_ID").unwrap_or_default();
    let base_url = base_url_override
        .map(ToOwned::to_owned)
        .or_else(|| env::var("WORKFLOW_BASE_URL").ok())
        .unwrap_or_default();

    let mut missing = Vec::new();
    if client_id.is_empty() {
        missing.push("WORKFLOW_CLIENT_ID");
    }
    if base_url.is_empty() {
        missing.push("WORKFLOW_BASE_URL");
    }

    if !missing.is_empty() {
        return Err(WfError::Message(format!(
            "Missing required environment variables: {}",
            missing.join(", ")
        )));
    }

    Ok((client_id, normalize_base_url(&base_url)))
}

pub fn resolve_runtime_config(base_url_override: Option<&str>, scope_override: Option<&str>, username_override: Option<&str>) -> WfResult<RuntimeConfig> {
    let (client_id, base_url) = collect_runtime_base_config(base_url_override)?;
    let _scope = scope_override
        .map(ToOwned::to_owned)
        .or_else(|| env::var("WORKFLOW_SCOPE").ok())
        .unwrap_or_else(|| DEFAULT_OAUTH_SCOPE.to_string());
    let username = username_override
        .map(ToOwned::to_owned)
        .or_else(|| env::var("WORKFLOW_USERNAME").ok())
        .filter(|value| !value.is_empty());

    Ok(RuntimeConfig {
        client_id,
        base_url,
        username,
    })
}

pub fn resolve_auth_login_config(base_url_override: Option<&str>, scope_override: Option<&str>) -> WfResult<AuthLoginConfig> {
    let (client_id, base_url) = collect_runtime_base_config(base_url_override)?;
    let client_secret = env::var("WORKFLOW_CLIENT_SECRET").unwrap_or_default();
    if client_secret.is_empty() {
        return Err(WfError::Message(
            "Missing required environment variables: WORKFLOW_CLIENT_SECRET".to_string(),
        ));
    }

    let scope = scope_override
        .map(ToOwned::to_owned)
        .or_else(|| env::var("WORKFLOW_AUTH_SCOPE").ok())
        .or_else(|| env::var("WORKFLOW_SCOPE").ok())
        .unwrap_or_else(|| DEFAULT_OAUTH_SCOPE.to_string());

    Ok(AuthLoginConfig {
        client_id,
        client_secret,
        base_url,
        scope,
    })
}
