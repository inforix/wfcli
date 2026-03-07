function tokenUrl(baseUrl) {
  return `${baseUrl}/infoplus/oauth2/token`;
}

function authorizationUrl(baseUrl) {
  return `${baseUrl}/infoplus/oauth2/authorize`;
}

function myAppsUrl(baseUrl) {
  return `${baseUrl}/infoplus/apis/v2/me/apps`;
}

function meScopedApiUrl(baseUrl, path) {
  return `${baseUrl}/infoplus/apis/v2/me/${path}`;
}

function apiUrl(baseUrl, path) {
  return `${baseUrl}/infoplus/apis/v2/${path}`;
}

function normalizeOAuthScope(scope) {
  return `${scope || ""}`
    .trim()
    .split(/[+\s]+/)
    .filter(Boolean)
    .join(" ");
}

function toBasicAuth(clientId, clientSecret) {
  const credential = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${credential}`;
}

async function parseJsonResponse(response) {
  const body = await response.text();
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Expected JSON response, received: ${body.slice(0, 200)}`);
  }
}

function createRequestError(message, status, payload) {
  const error = new Error(message);
  error.status = status;
  error.payload = payload;
  return error;
}

function isAccessTokenIssue(status, payload) {
  const fields = [payload?.ecode, payload?.error]
    .filter(Boolean)
    .map((value) => `${value}`.toUpperCase());
  if (fields.some((value) => value.includes("ACCESS_TOKEN") || value.includes("TOKEN_EXPIRED"))) {
    return true;
  }
  return status === 401;
}

function markLoginRequiredIfNeeded(error) {
  if (isAccessTokenIssue(error.status, error.payload)) {
    error.requiresLogin = true;
  }
  return error;
}

async function requestTokenWithBasicAuth(config, fetchImpl) {
  const response = await fetchImpl(tokenUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: toBasicAuth(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: config.scope
    })
  });

  return {
    status: response.status,
    ok: response.ok,
    payload: await parseJsonResponse(response)
  };
}

async function requestTokenByAuthorizationCodeBasicAuth(config, code, redirectUri, fetchImpl) {
  const response = await fetchImpl(tokenUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: toBasicAuth(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  });

  return {
    status: response.status,
    ok: response.ok,
    payload: await parseJsonResponse(response)
  };
}

async function requestTokenByAuthorizationCodeBodyClient(config, code, redirectUri, fetchImpl) {
  const response = await fetchImpl(tokenUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });

  return {
    status: response.status,
    ok: response.ok,
    payload: await parseJsonResponse(response)
  };
}

async function requestTokenWithBodyClient(config, fetchImpl) {
  const response = await fetchImpl(tokenUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: config.scope,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });

  return {
    status: response.status,
    ok: response.ok,
    payload: await parseJsonResponse(response)
  };
}

async function requestRefreshTokenWithBasicAuth(config, refreshToken, fetchImpl) {
  const response = await fetchImpl(tokenUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: toBasicAuth(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  return {
    status: response.status,
    ok: response.ok,
    payload: await parseJsonResponse(response)
  };
}

async function requestRefreshTokenWithBodyClient(config, refreshToken, fetchImpl) {
  const response = await fetchImpl(tokenUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });

  return {
    status: response.status,
    ok: response.ok,
    payload: await parseJsonResponse(response)
  };
}

function extractAccessToken(result) {
  if (!result.payload?.access_token) {
    throw new Error(
      `OAuth2 token response missing access_token (status=${result.status}, payload=${JSON.stringify(result.payload)})`
    );
  }

  return {
    accessToken: result.payload.access_token,
    tokenType: result.payload.token_type || "bearer",
    expiresIn: result.payload.expires_in
  };
}

export async function fetchSystemToken(config, fetchImpl = fetch) {
  const basicResult = await requestTokenWithBasicAuth(config, fetchImpl);
  if (basicResult.ok && basicResult.payload?.access_token) {
    return extractAccessToken(basicResult);
  }

  const bodyResult = await requestTokenWithBodyClient(config, fetchImpl);
  if (!bodyResult.ok) {
    throw new Error(
      `Failed to get OAuth2 token. BasicAuth status=${basicResult.status}, BodyAuth status=${bodyResult.status}, payload=${JSON.stringify(bodyResult.payload)}`
    );
  }

  return extractAccessToken(bodyResult);
}

export function buildAuthorizationCodeUrl(config, redirectUri, state) {
  const normalizedScope = normalizeOAuthScope(config.scope);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: normalizedScope,
    state
  });
  return `${authorizationUrl(config.baseUrl)}?${query.toString()}`;
}

export async function exchangeAuthorizationCode(config, code, redirectUri, fetchImpl = fetch) {
  const basicResult = await requestTokenByAuthorizationCodeBasicAuth(
    config,
    code,
    redirectUri,
    fetchImpl
  );
  if (basicResult.ok && basicResult.payload?.access_token) {
    return basicResult.payload;
  }

  const bodyResult = await requestTokenByAuthorizationCodeBodyClient(
    config,
    code,
    redirectUri,
    fetchImpl
  );
  if (!bodyResult.ok || !bodyResult.payload?.access_token) {
    throw new Error(
      `Failed to exchange authorization code. BasicAuth status=${basicResult.status}, BodyAuth status=${bodyResult.status}, payload=${JSON.stringify(bodyResult.payload)}`
    );
  }

  return bodyResult.payload;
}

export async function refreshAccessToken(config, refreshToken, fetchImpl = fetch) {
  const basicResult = await requestRefreshTokenWithBasicAuth(config, refreshToken, fetchImpl);
  if (basicResult.ok && basicResult.payload?.access_token) {
    return basicResult.payload;
  }

  const bodyResult = await requestRefreshTokenWithBodyClient(config, refreshToken, fetchImpl);
  if (!bodyResult.ok || !bodyResult.payload?.access_token) {
    throw new Error(
      `Failed to refresh access token. BasicAuth status=${basicResult.status}, BodyAuth status=${bodyResult.status}, payload=${JSON.stringify(bodyResult.payload)}`
    );
  }

  return bodyResult.payload;
}

export async function fetchMyApps(config, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(myAppsUrl(config.baseUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw markLoginRequiredIfNeeded(
      createRequestError(
        `Failed to fetch apps (status=${response.status}, payload=${JSON.stringify(payload)})`,
        response.status,
        payload
      )
    );
  }

  if (typeof payload.errno !== "number") {
    throw new Error(`Invalid InfoPlus response: ${JSON.stringify(payload)}`);
  }

  if (payload.errno !== 0) {
    throw markLoginRequiredIfNeeded(
      createRequestError(
        `InfoPlus API error: errno=${payload.errno}, ecode=${payload.ecode || ""}, error=${payload.error || "unknown"}`,
        response.status,
        payload
      )
    );
  }

  if (!Array.isArray(payload.entities)) {
    throw new Error(`Invalid InfoPlus response: entities is not an array`);
  }

  return payload.entities;
}

async function requestInfoPlusEntities(requestOptions, fetchImpl) {
  const { url, method, accessToken, body, errorContext } = requestOptions;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetchImpl(url, {
    method,
    headers,
    body
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw markLoginRequiredIfNeeded(
      createRequestError(
        `${errorContext} (status=${response.status}, payload=${JSON.stringify(payload)})`,
        response.status,
        payload
      )
    );
  }

  if (typeof payload.errno !== "number") {
    throw new Error(`Invalid InfoPlus response: ${JSON.stringify(payload)}`);
  }

  if (payload.errno !== 0) {
    throw markLoginRequiredIfNeeded(
      createRequestError(
        `InfoPlus API error: errno=${payload.errno}, ecode=${payload.ecode || ""}, error=${payload.error || "unknown"}`,
        response.status,
        payload
      )
    );
  }

  if (!Array.isArray(payload.entities)) {
    throw new Error(`Invalid InfoPlus response: entities is not an array`);
  }

  return payload.entities;
}

export async function fetchMyTodoTasks(config, accessToken, fetchImpl = fetch) {
  return requestInfoPlusEntities(
    {
      url: meScopedApiUrl(config.baseUrl, "tasks/todo"),
      method: "GET",
      accessToken,
      errorContext: "Failed to fetch todo tasks"
    },
    fetchImpl
  );
}

export async function fetchMyDoingProcesses(config, accessToken, fetchImpl = fetch) {
  return requestInfoPlusEntities(
    {
      url: meScopedApiUrl(config.baseUrl, "processes/doing"),
      method: "GET",
      accessToken,
      errorContext: "Failed to fetch doing processes"
    },
    fetchImpl
  );
}

export async function fetchMyDoneProcesses(config, accessToken, fetchImpl = fetch) {
  return requestInfoPlusEntities(
    {
      url: meScopedApiUrl(config.baseUrl, "processes/done"),
      method: "GET",
      accessToken,
      errorContext: "Failed to fetch done processes"
    },
    fetchImpl
  );
}

export async function fetchMyCompletedProcesses(config, accessToken, fetchImpl = fetch) {
  return requestInfoPlusEntities(
    {
      url: meScopedApiUrl(config.baseUrl, "processes/completed"),
      method: "GET",
      accessToken,
      errorContext: "Failed to fetch completed processes"
    },
    fetchImpl
  );
}

export async function executeTask(config, username, taskId, accessToken, fetchImpl = fetch) {
  const encodedTaskId = encodeURIComponent(taskId);
  const candidates = [`tasks/${encodedTaskId}`, `task/${encodedTaskId}`];
  const errors = [];

  for (const candidatePath of candidates) {
    try {
      return await requestInfoPlusEntities(
        {
          url: apiUrl(config.baseUrl, candidatePath),
          method: "POST",
          accessToken,
          body: new URLSearchParams({ userId: username }),
          errorContext: `Failed to execute task "${taskId}" via /${candidatePath}`
        },
        fetchImpl
      );
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.some((error) => error?.requiresLogin)) {
    const loginError = new Error("Access token is invalid or expired.");
    loginError.requiresLogin = true;
    throw loginError;
  }

  const details = errors.map((error) => error.message).join(" | ");
  throw new Error(`Failed to execute task "${taskId}". ${details}`);
}
