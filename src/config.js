function normalizeBaseUrl(baseUrl) {
  return baseUrl ? baseUrl.replace(/\/+$/, "") : "";
}

export function resolveRuntimeConfig(options = {}, env = process.env) {
  const clientId = env.WORKFLOW_CLIENT_ID;
  const clientSecret = env.WORKFLOW_CLIENT_SECRET;
  const baseUrl = normalizeBaseUrl(options.baseUrl || env.WORKFLOW_BASE_URL);
  const scope = options.scope || env.WORKFLOW_SCOPE || "sys_app";
  const username = options.username || env.WORKFLOW_USERNAME;

  const missing = [];
  if (!clientId) {
    missing.push("WORKFLOW_CLIENT_ID");
  }
  if (!clientSecret) {
    missing.push("WORKFLOW_CLIENT_SECRET");
  }
  if (!baseUrl) {
    missing.push("WORKFLOW_BASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    clientId,
    clientSecret,
    baseUrl,
    scope,
    username
  };
}
