import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationCodeUrl } from "../src/infoplusClient.js";

test("buildAuthorizationCodeUrl encodes space-delimited scope as +", () => {
  const url = buildAuthorizationCodeUrl(
    {
      baseUrl: "https://wf.shmtu.edu.cn",
      clientId: "cid",
      scope: "data openid profile"
    },
    "http://127.0.0.1:65071/oauth/callback",
    "state123"
  );

  assert.match(url, /(?:\?|&)scope=data\+openid\+profile(?:&|$)/);
});

test("buildAuthorizationCodeUrl keeps + as separator instead of encoding it as %2B", () => {
  const url = buildAuthorizationCodeUrl(
    {
      baseUrl: "https://wf.shmtu.edu.cn",
      clientId: "cid",
      scope: "data+openid+profile"
    },
    "http://127.0.0.1:65071/oauth/callback",
    "state123"
  );

  assert.match(url, /(?:\?|&)scope=data\+openid\+profile(?:&|$)/);
  assert.doesNotMatch(url, /scope=data%2Bopenid%2Bprofile/);
});
