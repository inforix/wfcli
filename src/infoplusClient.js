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

function versionedApiUrl(baseUrl, apiVersion, path, { trailingSlash = false } = {}) {
  const normalizedPath = `${path}`.replace(/^\/+/, "");
  const suffix = trailingSlash ? "/" : "";
  return `${baseUrl}/infoplus/apis/${apiVersion}/${normalizedPath}${suffix}`;
}

function apiUrl(baseUrl, path) {
  return versionedApiUrl(baseUrl, "v2", path);
}

function fileApiUrl(baseUrl, path = "") {
  const normalized = path ? `/${path}` : "";
  return `${baseUrl}/infoplus/file${normalized}`;
}

function encodeFileKey(fileKey) {
  return `${fileKey}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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

async function parseResponsePayload(response) {
  const contentType = `${response.headers.get("content-type") || ""}`.toLowerCase();
  const body = await response.text();
  if (!body) {
    return {};
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`Expected JSON response, received: ${body.slice(0, 200)}`);
    }
  }

  return body;
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

export async function fetchAppMeta(
  config,
  idc,
  accessToken,
  { version, includeForms = false, includeVersions = false, includeDefinition = false } = {},
  fetchImpl = fetch
) {
  const query = new URLSearchParams();
  if (version) {
    query.set("version", version);
  }
  if (includeForms) {
    query.set("includeForms", "true");
  }
  if (includeVersions) {
    query.set("includeVersions", "true");
  }
  if (includeDefinition) {
    query.set("includeDefinition", "true");
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const encodedIdc = encodeURIComponent(idc);
  const response = await fetchImpl(`${apiUrl(config.baseUrl, `app/${encodedIdc}`)}${suffix}`, {
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
        `Failed to fetch app "${idc}" (status=${response.status}, payload=${JSON.stringify(payload)})`,
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

  return payload.entities[0] || null;
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

export async function executeTask(
  config,
  taskId,
  accessToken,
  { userId, actionId, actionCode, remark, thing, pickup } = {},
  fetchImpl = fetch
) {
  const encodedTaskId = encodeURIComponent(taskId);
  const form = new URLSearchParams();
  if (userId) {
    form.set("userId", userId);
  }
  if (actionId !== undefined && actionId !== null && actionId !== "") {
    form.set("actionId", `${actionId}`);
  }
  if (actionCode) {
    form.set("actionCode", actionCode);
  }
  if (remark) {
    form.set("remark", remark);
  }
  if (thing) {
    form.set("thing", thing);
  }
  if (pickup) {
    form.set("pickup", pickup);
  }

  return requestInfoPlusEntities(
    {
      url: apiUrl(config.baseUrl, `task/${encodedTaskId}`),
      method: "POST",
      accessToken,
      body: form,
      errorContext: `Failed to execute task "${taskId}" via /task/${encodedTaskId}`
    },
    fetchImpl
  );
}

export async function startProcess(
  config,
  accessToken,
  { userId, assignTo, secureURIExpire, code, entrance, businessId, data, apiVersion = "auto", onAttempt } = {},
  fetchImpl = fetch
) {
  const normalizedApiVersion = `${apiVersion || "auto"}`.toLowerCase();
  if (!["auto", "v2", "v2d"].includes(normalizedApiVersion)) {
    throw new Error(`Invalid apiVersion "${apiVersion}". Expected one of: auto, v2, v2d.`);
  }
  const form = new URLSearchParams();
  if (userId) {
    form.set("userId", userId);
  }
  if (assignTo) {
    form.set("assignTo", assignTo);
  }
  if (secureURIExpire !== undefined && secureURIExpire !== null && secureURIExpire !== "") {
    form.set("secureURIExpire", `${secureURIExpire}`);
  }
  if (code) {
    form.set("code", code);
  }
  if (entrance) {
    form.set("entrance", entrance);
  }
  if (businessId) {
    form.set("businessId", businessId);
  }
  if (data !== undefined && data !== null && data !== "") {
    form.set("data", typeof data === "string" ? data : JSON.stringify(data));
  }

  const apiVersions = normalizedApiVersion === "auto" ? ["v2", "v2d"] : [normalizedApiVersion];
  const attempts = [];
  for (const version of apiVersions) {
    for (const method of ["PUT", "POST"]) {
      for (const queryToken of [false, true]) {
        for (const trailingSlash of [false, true]) {
          attempts.push({ method, queryToken, trailingSlash, version });
        }
      }
    }
  }
  const errors = [];

  for (const attempt of attempts) {
    const { method, queryToken, trailingSlash, version } = attempt;
    try {
      const path = versionedApiUrl(config.baseUrl, version, "process", { trailingSlash });
      const requestUrl = queryToken
        ? `${path}?access_token=${encodeURIComponent(accessToken)}`
        : path;
      if (typeof onAttempt === "function") {
        onAttempt({
          phase: "request",
          method,
          version,
          authMode: queryToken ? "query" : "header",
          trailingSlash,
          url: requestUrl.replace(/(access_token=)[^&]+/i, "$1<redacted>")
        });
      }
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      };
      if (!queryToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const response = await fetchImpl(requestUrl, {
        method,
        headers,
        body: form
      });

      const payload = await parseResponsePayload(response);
      const contentType = `${response.headers.get("content-type") || ""}`.toLowerCase();
      if (typeof onAttempt === "function") {
        onAttempt({
          phase: "response",
          method,
          version,
          authMode: queryToken ? "query" : "header",
          trailingSlash,
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          payloadPreview:
            typeof payload === "string" ? payload.slice(0, 200) : JSON.stringify(payload).slice(0, 200)
        });
      }
      if (!response.ok) {
        throw markLoginRequiredIfNeeded(
          createRequestError(
            `Failed to start process via ${method} /${version}/process${trailingSlash ? "/" : ""}${queryToken ? " (query token)" : ""} (status=${response.status}, payload=${JSON.stringify(payload)})`,
            response.status,
            payload
          )
        );
      }

      if (payload && typeof payload === "object" && typeof payload.errno === "number") {
        if (payload.errno !== 0) {
          throw markLoginRequiredIfNeeded(
            createRequestError(
              `InfoPlus API error: errno=${payload.errno}, ecode=${payload.ecode || ""}, error=${payload.error || "unknown"}`,
              response.status,
              payload
            )
          );
        }
        if (Array.isArray(payload.entities)) {
          return payload.entities;
        }
      }

      // Compatibility: some gateways return 2xx with empty body.
      if (
        payload === null ||
        payload === undefined ||
        payload === "" ||
        (typeof payload === "object" && Object.keys(payload).length === 0)
      ) {
        if (contentType.includes("text/html")) {
          throw new Error("Received empty HTML response from process start endpoint");
        }
        return [];
      }

      if (typeof payload === "string") {
        if (contentType.includes("text/html")) {
          throw new Error(`Received HTML response from process start endpoint: ${payload.slice(0, 200)}`);
        }
        return [payload];
      }

      throw new Error(`Invalid InfoPlus response: ${JSON.stringify(payload)}`);
    } catch (error) {
      const causeSuffix = error?.cause?.message ? `; cause=${error.cause.message}` : "";
      const wrapped = new Error(
        `[${version}:${method}${queryToken ? "+queryToken" : ""}${trailingSlash ? "+slash" : ""}] ${error.message}${causeSuffix}`
      );
      wrapped.status = error?.status;
      wrapped.payload = error?.payload;
      wrapped.requiresLogin = Boolean(error?.requiresLogin);
      errors.push(wrapped);
      if (typeof onAttempt === "function") {
        onAttempt({
          phase: "error",
          method,
          version,
          authMode: queryToken ? "query" : "header",
          trailingSlash,
          error: wrapped.message
        });
      }
    }
  }

  if (errors.some((error) => error?.requiresLogin)) {
    const loginError = new Error("Access token is invalid or expired.");
    loginError.requiresLogin = true;
    throw loginError;
  }

  const details = errors.map((error) => error.message).join(" | ");
  throw new Error(`Failed to start process via /process. ${details}`);
}

async function requestFileApi(requestOptions, fetchImpl) {
  const { url, method, accessToken, body, headers = {}, errorContext } = requestOptions;
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers
    },
    body
  });

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw markLoginRequiredIfNeeded(
      createRequestError(
        `${errorContext} (status=${response.status}, payload=${JSON.stringify(payload)})`,
        response.status,
        payload
      )
    );
  }

  return payload;
}

export async function uploadFile(
  config,
  accessToken,
  { fileName, content, keepFileName = false },
  fetchImpl = fetch
) {
  const form = new FormData();
  form.append("file", new Blob([content]), fileName);
  const query = keepFileName ? "?keepFileName=true" : "";
  return requestFileApi(
    {
      url: `${fileApiUrl(config.baseUrl)}${query}`,
      method: "POST",
      accessToken,
      body: form,
      errorContext: `Failed to upload file "${fileName}"`
    },
    fetchImpl
  );
}

export async function updateFile(
  config,
  fileKey,
  accessToken,
  { fileName, content, keepFileName = false },
  fetchImpl = fetch
) {
  const form = new FormData();
  form.append("file", new Blob([content]), fileName);
  const query = keepFileName ? "?keepFileName=true" : "";
  return requestFileApi(
    {
      url: `${fileApiUrl(config.baseUrl, encodeFileKey(fileKey))}${query}`,
      method: "PUT",
      accessToken,
      body: form,
      errorContext: `Failed to update file "${fileKey}"`
    },
    fetchImpl
  );
}

export async function fetchFileMeta(config, fileKey, accessToken, fetchImpl = fetch) {
  return requestFileApi(
    {
      url: fileApiUrl(config.baseUrl, `${encodeFileKey(fileKey)}/meta`),
      method: "GET",
      accessToken,
      errorContext: `Failed to fetch file meta "${fileKey}"`
    },
    fetchImpl
  );
}

export async function deleteFile(config, fileKey, accessToken, fetchImpl = fetch) {
  return requestFileApi(
    {
      url: fileApiUrl(config.baseUrl, encodeFileKey(fileKey)),
      method: "DELETE",
      accessToken,
      errorContext: `Failed to delete file "${fileKey}"`
    },
    fetchImpl
  );
}

export async function downloadFile(config, fileKey, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(fileApiUrl(config.baseUrl, `${encodeFileKey(fileKey)}/download`), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = await parseResponsePayload(response);
    throw markLoginRequiredIfNeeded(
      createRequestError(
        `Failed to download file "${fileKey}" (status=${response.status}, payload=${JSON.stringify(payload)})`,
        response.status,
        payload
      )
    );
  }

  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    contentDisposition: response.headers.get("content-disposition") || ""
  };
}
