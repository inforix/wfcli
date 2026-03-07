import { saveOAuthSession } from "./src/authSession.js";

export function createWriter() {
  let data = "";
  return {
    write(chunk) {
      data += chunk;
      return true;
    },
    read() {
      return data;
    }
  };
}

export function createMemoryKeyring() {
  const storage = new Map();
  const key = (service, account) => `${service}::${account}`;

  return {
    async getPassword(service, account) {
      return storage.get(key(service, account)) || null;
    },
    async setPassword(service, account, password) {
      storage.set(key(service, account), password);
    },
    async deletePassword(service, account) {
      return storage.delete(key(service, account));
    }
  };
}

export async function seedAccessToken(keyring, config, accessToken, nowMs = Date.now()) {
  await saveOAuthSession(
    config,
    keyring,
    {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600
    },
    nowMs
  );
}
