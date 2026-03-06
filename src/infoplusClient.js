function tokenUrl(baseUrl) {
  return `${baseUrl}/infoplus/oauth2/token`;
}

function appsUrl(baseUrl, username) {
  return `${baseUrl}/infoplus/apis/v2/user/${encodeURIComponent(username)}/apps`;
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

export async function fetchUserApps(config, username, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(appsUrl(config.baseUrl, username), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch apps for user "${username}" (status=${response.status}, payload=${JSON.stringify(payload)})`
    );
  }

  if (typeof payload.errno !== "number") {
    throw new Error(`Invalid InfoPlus response: ${JSON.stringify(payload)}`);
  }

  if (payload.errno !== 0) {
    throw new Error(
      `InfoPlus API error: errno=${payload.errno}, ecode=${payload.ecode || ""}, error=${payload.error || "unknown"}`
    );
  }

  if (!Array.isArray(payload.entities)) {
    throw new Error(`Invalid InfoPlus response: entities is not an array`);
  }

  return payload.entities;
}
