use crate::config::RuntimeConfig;
use crate::errors::{WfError, WfResult};
use chrono::{DateTime, Local};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::env;
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSession {
    pub access_token: String,
    pub token_type: String,
    pub scope: Option<String>,
    pub refresh_token: Option<String>,
    pub obtained_at: Option<i64>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
}

fn safe_origin(base_url: &str) -> String {
    Url::parse(base_url)
        .map(|url| format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default()))
        .unwrap_or_else(|_| base_url.to_string())
}

fn keyring_entry(config: &RuntimeConfig) -> WfResult<Entry> {
    let account = format!("{}|{}", safe_origin(&config.base_url), config.client_id);
    Entry::new("wfcli.infoplus.oauth2", &account).map_err(|error| {
        WfError::Message(format!("Failed to initialize keyring entry: {error}"))
    })
}

fn normalize_epoch_ms(value: Option<i64>) -> Option<i64> {
    let timestamp = value?;
    if timestamp <= 0 {
        return None;
    }
    if timestamp < 1_000_000_000_000 {
        Some(timestamp * 1000)
    } else {
        Some(timestamp)
    }
}

pub fn save_oauth_session(config: &RuntimeConfig, token_response: &TokenResponse, now_ms: i64) -> WfResult<OAuthSession> {
    let expires_at = token_response
        .expires_in
        .filter(|expires_in| *expires_in > 0)
        .map(|expires_in| now_ms + expires_in * 1000);

    let session = OAuthSession {
        access_token: token_response.access_token.clone(),
        token_type: token_response
            .token_type
            .clone()
            .unwrap_or_else(|| "bearer".to_string()),
        scope: token_response.scope.clone(),
        refresh_token: token_response.refresh_token.clone(),
        obtained_at: Some(now_ms),
        expires_at,
    };

    let entry = keyring_entry(config)?;
    let raw = serde_json::to_string(&session).map_err(|error| WfError::Message(error.to_string()))?;
    entry
        .set_password(&raw)
        .map_err(|error| WfError::Message(format!("Failed to save OAuth session to keyring: {error}")))?;

    Ok(session)
}

pub fn load_oauth_session(config: &RuntimeConfig) -> WfResult<Option<OAuthSession>> {
    let entry = keyring_entry(config)?;
    let raw = match entry.get_password() {
        Ok(value) => value,
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("no entry") || message.contains("not found") {
                return Ok(None);
            }
            return Err(WfError::Message(format!(
                "Failed to load OAuth session from keyring: {error}"
            )));
        }
    };

    let mut session: OAuthSession = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    if session.access_token.is_empty() {
        return Ok(None);
    }

    session.obtained_at = normalize_epoch_ms(session.obtained_at);
    session.expires_at = normalize_epoch_ms(session.expires_at);
    if session.token_type.is_empty() {
        session.token_type = "bearer".to_string();
    }

    Ok(Some(session))
}

pub fn load_valid_access_token(config: &RuntimeConfig, now_ms: i64, skew_ms: i64) -> WfResult<Option<String>> {
    let session = match load_oauth_session(config)? {
        Some(value) => value,
        None => return Ok(None),
    };

    let disable_expire_check = env::var("DISABLE_EXPIRE_CHECK")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let disable_expire_check = matches!(disable_expire_check.as_str(), "1" | "true" | "yes" | "on");

    if !disable_expire_check {
        if let Some(expires_at) = session.expires_at {
            if expires_at <= now_ms + skew_ms {
                return Ok(None);
            }
        }
    }

    Ok(Some(session.access_token))
}

pub fn format_expiry(expires_at: Option<i64>) -> String {
    let Some(epoch_ms) = expires_at else {
        return "unknown".to_string();
    };
    let Some(dt_utc) = DateTime::from_timestamp_millis(epoch_ms) else {
        return "unknown".to_string();
    };
    let dt_local = dt_utc.with_timezone(&Local);
    dt_local.format("%Y-%m-%d %H:%M:%S %Z").to_string()
}
