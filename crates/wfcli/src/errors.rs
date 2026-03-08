use serde_json::Value;
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone)]
pub struct ApiError {
    pub message: String,
    pub payload: Option<Value>,
    pub requires_login: bool,
}

#[derive(Debug)]
pub enum WfError {
    Message(String),
    Api(ApiError),
    Other(anyhow::Error),
}

impl Display for WfError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Message(message) => write!(f, "{message}"),
            Self::Api(error) => write!(f, "{}", error.message),
            Self::Other(error) => write!(f, "{error}"),
        }
    }
}

impl Error for WfError {}

impl From<anyhow::Error> for WfError {
    fn from(value: anyhow::Error) -> Self {
        Self::Other(value)
    }
}

impl From<&str> for WfError {
    fn from(value: &str) -> Self {
        Self::Message(value.to_string())
    }
}

impl From<String> for WfError {
    fn from(value: String) -> Self {
        Self::Message(value)
    }
}

pub type WfResult<T> = Result<T, WfError>;

pub fn to_login_hint_error(error: WfError, include_triple: bool) -> WfError {
    match error {
        WfError::Api(api_error) if api_error.requires_login => {
            let ecode = api_error
                .payload
                .as_ref()
                .and_then(|payload| payload.get("ecode").or_else(|| payload.get("error")))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_ascii_uppercase();

            if ecode.contains("SCOPE") {
                if include_triple {
                    return WfError::Message(
                        "Access token scope is invalid. Run `wfcli auth login --scope \"profile data openid app process task start process_edit app_edit triple\"` and retry.".to_string(),
                    );
                }
                return WfError::Message(
                    "Access token scope is invalid. Run `wfcli auth login --scope \"profile data openid app process task start process_edit app_edit\"` and retry.".to_string(),
                );
            }

            WfError::Message("Access token is invalid or expired. Run \"wfcli auth login\" and retry.".to_string())
        }
        other => other,
    }
}
