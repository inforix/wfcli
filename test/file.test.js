import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  runFileDelete,
  runFileDownload,
  runFileMeta,
  runFileUpload
} from "../src/commands/file.js";
import { createMemoryKeyring, createWriter, seedAccessToken } from "../test-helpers.js";

function startMockServer(routes) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const handler = routes[`${req.method} ${req.url}`];
        if (!handler) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function makeDeps(baseUrl, writer = createWriter()) {
  const keyring = createMemoryKeyring();
  await seedAccessToken(keyring, { baseUrl, clientId: "cid" }, "token123");
  return {
    writer,
    keyring,
    env: {
      WORKFLOW_CLIENT_ID: "cid",
      WORKFLOW_BASE_URL: baseUrl
    }
  };
}

test("runFileUpload uploads file content using keyring token", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "wfcli-file-upload-"));
  const samplePath = path.join(tmpDir, "sample.txt");
  await writeFile(samplePath, "hello file api");

  const { server, baseUrl } = await startMockServer({
    "POST /infoplus/file?keepFileName=true": (req, res, body) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      const text = body.toString("utf8");
      assert.match(text, /name="file"/);
      assert.match(text, /filename="sample.txt"/);
      assert.match(text, /hello file api/);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ key: "k1", uri: "/infoplus/file/k1" }));
    }
  });

  const writer = createWriter();
  try {
    const payload = await runFileUpload(samplePath, { keepName: true }, await makeDeps(baseUrl, writer));
    assert.equal(payload.key, "k1");
    assert.match(writer.read(), /Uploaded file "sample.txt" successfully/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runFileMeta supports --json output", async () => {
  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/file/k1/meta": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ key: "k1", name: "demo.txt", size: 10 }));
    }
  });

  const writer = createWriter();
  try {
    const payload = await runFileMeta("k1", { json: true }, await makeDeps(baseUrl, writer));
    assert.equal(payload.name, "demo.txt");
    const parsed = JSON.parse(writer.read());
    assert.equal(parsed.key, "k1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runFileDownload saves data to output path", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "wfcli-file-download-"));
  const outputPath = path.join(tmpDir, "got.txt");

  const { server, baseUrl } = await startMockServer({
    "GET /infoplus/file/k1/download": (req, res) => {
      assert.equal(req.headers.authorization, "Bearer token123");
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("content-disposition", 'attachment; filename="server.txt"');
      res.end("download-content");
    }
  });

  const writer = createWriter();
  try {
    const result = await runFileDownload("k1", { output: outputPath }, await makeDeps(baseUrl, writer));
    const content = await readFile(outputPath, "utf8");
    assert.equal(content, "download-content");
    assert.equal(result.path, outputPath);
    assert.equal(result.bytes, Buffer.byteLength("download-content"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runFileDelete maps token failure to login hint", async () => {
  const { server, baseUrl } = await startMockServer({
    "DELETE /infoplus/file/k1": (_req, res) => {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ecode: "ACCESS_TOKEN_EXPIRED", error: "ACCESS_TOKEN_EXPIRED" }));
    }
  });

  try {
    await assert.rejects(
      runFileDelete("k1", {}, await makeDeps(baseUrl)),
      /Access token is invalid or expired/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
