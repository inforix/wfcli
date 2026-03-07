import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeCommandError(command, error) {
  const stderr = (error?.stderr || error?.message || "").trim();
  return new Error(`${command} failed: ${stderr || "unknown error"}`);
}

function isSecurityNotFound(error) {
  if (error?.code === 44) {
    return true;
  }
  const stderr = `${error?.stderr || ""}`.toLowerCase();
  return stderr.includes("could not be found");
}

function createMacosKeyring(execImpl = execFileAsync) {
  return {
    async getPassword(service, account) {
      try {
        const { stdout } = await execImpl("security", [
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w"
        ]);
        const value = stdout.trim();
        return value ? value : null;
      } catch (error) {
        if (isSecurityNotFound(error)) {
          return null;
        }
        throw normalizeCommandError("security find-generic-password", error);
      }
    },
    async setPassword(service, account, password) {
      try {
        await execImpl("security", [
          "add-generic-password",
          "-U",
          "-s",
          service,
          "-a",
          account,
          "-w",
          password
        ]);
      } catch (error) {
        throw normalizeCommandError("security add-generic-password", error);
      }
    },
    async deletePassword(service, account) {
      try {
        await execImpl("security", ["delete-generic-password", "-s", service, "-a", account]);
        return true;
      } catch (error) {
        if (isSecurityNotFound(error)) {
          return false;
        }
        throw normalizeCommandError("security delete-generic-password", error);
      }
    }
  };
}

let cachedDefaultKeyring;

export function getDefaultKeyring() {
  if (cachedDefaultKeyring) {
    return cachedDefaultKeyring;
  }

  if (process.platform === "darwin") {
    cachedDefaultKeyring = createMacosKeyring();
    return cachedDefaultKeyring;
  }

  throw new Error(
    `No default keyring backend for platform "${process.platform}". Pass a custom keyring implementation.`
  );
}
