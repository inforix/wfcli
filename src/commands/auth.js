import crypto from "node:crypto";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAuthLoginConfig } from "../config.js";
import {
  buildAuthorizationCodeUrl,
  exchangeAuthorizationCode,
  refreshAccessToken
} from "../infoplusClient.js";
import { loadOAuthSession, saveOAuthSession } from "../authSession.js";
import { getDefaultKeyring } from "../keyring.js";

const execFileAsync = promisify(execFile);

function respondHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

async function openSystemBrowser(url) {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }
  await execFileAsync("xdg-open", [url]);
}

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function waitForAuthorizationCode(options) {
  const host = options.host || "127.0.0.1";
  const callbackPath = options.callbackPath || "/oauth/callback";
  const timeoutMs = options.timeoutMs || 180_000;
  const expectedState = options.state;
  const server = http.createServer();

  let timer;
  let settled = false;

  const authorizationCode = await new Promise(async (resolve, reject) => {
    function finish(err, code) {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      closeServer(server)
        .then(() => {
          if (err) {
            reject(err);
            return;
          }
          resolve(code);
        })
        .catch(reject);
    }

    timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for OAuth callback after ${Math.floor(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    server.on("request", (req, res) => {
      const requestUrl = new URL(req.url, `http://${host}`);
      if (requestUrl.pathname !== callbackPath) {
        respondHtml(res, 404, "<h1>Not Found</h1>");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        respondHtml(res, 400, `<h1>Authorization failed</h1><p>${error}</p>`);
        finish(new Error(`Authorization failed: ${error}`));
        return;
      }

      const receivedState = requestUrl.searchParams.get("state");
      if (!receivedState || receivedState !== expectedState) {
        respondHtml(res, 400, "<h1>Invalid state</h1>");
        finish(new Error("OAuth state mismatch in callback."));
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        respondHtml(res, 400, "<h1>Missing code</h1>");
        finish(new Error("OAuth callback missing authorization code."));
        return;
      }

      respondHtml(res, 200, "<h1>Login successful</h1><p>You can close this tab and return to wfcli.</p>");
      finish(null, code);
    });

    try {
      const port = await listen(server, host);
      const redirectUri = `http://${host}:${port}${callbackPath}`;
      options.onReady(redirectUri);
    } catch (error) {
      finish(error);
    }
  });

  return authorizationCode;
}

function formatExpiry(expiresAt) {
  if (!expiresAt) {
    return "unknown";
  }
  return new Date(expiresAt).toISOString();
}

export async function runAuthLogin(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const env = deps.env || process.env;
  const keyring = deps.keyring || getDefaultKeyring();
  const openBrowser = deps.openBrowser || openSystemBrowser;

  const config = resolveAuthLoginConfig(options, env);
  const state = crypto.randomBytes(16).toString("hex");

  let redirectUri = null;
  const codePromise = waitForAuthorizationCode({
    state,
    host: options.callbackHost || "127.0.0.1",
    callbackPath: options.callbackPath || "/oauth/callback",
    timeoutMs: options.timeoutMs || 180_000,
    onReady(value) {
      redirectUri = value;
    }
  });

  while (!redirectUri) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const authorizeUrl = buildAuthorizationCodeUrl(config, redirectUri, state);
  writer.write(`Opening browser for OAuth login...\n`);
  writer.write(`If browser does not open, visit:\n${authorizeUrl}\n`);

  try {
    await openBrowser(authorizeUrl);
  } catch (error) {
    writer.write(`Browser open failed: ${error.message}\n`);
    writer.write("Continue manually with the URL above.\n");
  }

  const code = await codePromise;
  const tokenPayload = await exchangeAuthorizationCode(config, code, redirectUri, fetchImpl);
  const session = await saveOAuthSession(config, keyring, tokenPayload);
  writer.write(`Login successful. Token saved to keyring (expires: ${formatExpiry(session.expiresAt)}).\n`);
  return session;
}

export async function runAuthRefreshToken(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const writer = deps.writer || process.stdout;
  const env = deps.env || process.env;
  const keyring = deps.keyring || getDefaultKeyring();

  const config = resolveAuthLoginConfig(options, env);
  const existingSession = await loadOAuthSession(config, keyring);

  if (!existingSession) {
    throw new Error('No OAuth session found in keyring. Run "wfcli auth login" first.');
  }

  if (!existingSession.refreshToken) {
    throw new Error('Current OAuth session has no refresh_token. Run "wfcli auth login" first.');
  }

  const tokenPayload = await refreshAccessToken(config, existingSession.refreshToken, fetchImpl);
  if (!tokenPayload.refresh_token) {
    tokenPayload.refresh_token = existingSession.refreshToken;
  }

  const session = await saveOAuthSession(config, keyring, tokenPayload);
  writer.write(
    `Token refreshed successfully. Token saved to keyring (expires: ${formatExpiry(session.expiresAt)}).\n`
  );
  return session;
}

export function registerAuthCommands(program) {
  const authCommand = program.command("auth").description("Authentication commands");

  authCommand
    .command("login")
    .description("Sign in via OAuth2 Authorization Code flow and save token to keyring")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .option(
      "--scope <scope>",
      "override OAuth scope (default: app+task+process+data+openid+profile)"
    )
    .action(async (options) => {
      await runAuthLogin(options);
    });

  authCommand
    .command("refresh-token")
    .description("Refresh access token via stored refresh_token and save token to keyring")
    .option("--base-url <url>", "override WORKFLOW_BASE_URL")
    .action(async (options) => {
      await runAuthRefreshToken(options);
    });
}
