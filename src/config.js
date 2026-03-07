export const DEFAULT_OAUTH_SCOPE =
  "profile data openid app process task start process_edit app_edit";

function normalizeBaseUrl(baseUrl) {
  return baseUrl ? baseUrl.replace(/\/+$/, "") : "";
}

function collectRuntimeBaseConfig(options = {}, env = process.env) {
  const clientId = env.WORKFLOW_CLIENT_ID;
  const baseUrl = normalizeBaseUrl(options.baseUrl || env.WORKFLOW_BASE_URL);

  const missing = [];
  if (!clientId) {
    missing.push("WORKFLOW_CLIENT_ID");
  }
  if (!baseUrl) {
    missing.push("WORKFLOW_BASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    clientId,
    baseUrl
  };
}

export function resolveRuntimeConfig(options = {}, env = process.env) {
  const { clientId, baseUrl } = collectRuntimeBaseConfig(options, env);
  const scope = options.scope || env.WORKFLOW_SCOPE || DEFAULT_OAUTH_SCOPE;
  const username = options.username || env.WORKFLOW_USERNAME;

  return {
    clientId,
    baseUrl,
    scope,
    username
  };
}

export function resolveAuthLoginConfig(options = {}, env = process.env) {
  const { clientId, baseUrl } = collectRuntimeBaseConfig(options, env);
  const clientSecret = env.WORKFLOW_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error("Missing required environment variables: WORKFLOW_CLIENT_SECRET");
  }
  const scope =
    options.scope ||
    env.WORKFLOW_AUTH_SCOPE ||
    env.WORKFLOW_SCOPE ||
    DEFAULT_OAUTH_SCOPE;

  return {
    clientId,
    clientSecret,
    baseUrl,
    scope
  };
}
