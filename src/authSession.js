function safeOrigin(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function keyringAddress(config) {
  return {
    service: "wfcli.infoplus.oauth2",
    account: `${safeOrigin(config.baseUrl)}|${config.clientId}`
  };
}

function normalizeStoredSession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (!value.accessToken || typeof value.accessToken !== "string") {
    return null;
  }
  function normalizeEpochMs(timestamp) {
    if (!timestamp) {
      return null;
    }
    const numeric = Number(timestamp);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    // Compatibility: older/manual entries may store epoch in seconds.
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  return {
    accessToken: value.accessToken,
    tokenType: value.tokenType || "bearer",
    scope: value.scope,
    refreshToken: value.refreshToken,
    obtainedAt: normalizeEpochMs(value.obtainedAt),
    expiresAt: normalizeEpochMs(value.expiresAt)
  };
}

function toStoredSession(tokenResponse, nowMs = Date.now()) {
  const expiresInSeconds = Number(tokenResponse.expires_in);
  const expiresAt =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? nowMs + expiresInSeconds * 1000
      : null;

  return {
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type || "bearer",
    scope: tokenResponse.scope,
    refreshToken: tokenResponse.refresh_token,
    obtainedAt: nowMs,
    expiresAt
  };
}

export async function saveOAuthSession(config, keyring, tokenResponse, nowMs = Date.now()) {
  const address = keyringAddress(config);
  const session = toStoredSession(tokenResponse, nowMs);
  await keyring.setPassword(address.service, address.account, JSON.stringify(session));
  return session;
}

export async function loadOAuthSession(config, keyring) {
  const address = keyringAddress(config);
  const raw = await keyring.getPassword(address.service, address.account);
  if (!raw) {
    return null;
  }

  try {
    return normalizeStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearOAuthSession(config, keyring) {
  const address = keyringAddress(config);
  return keyring.deletePassword(address.service, address.account);
}

export async function loadValidAccessToken(config, keyring, nowMs = Date.now(), skewMs = 30_000) {
  const session = await loadOAuthSession(config, keyring);
  if (!session) {
    return null;
  }
  if (session.expiresAt && session.expiresAt <= nowMs + skewMs) {
    return null;
  }
  return session.accessToken;
}
