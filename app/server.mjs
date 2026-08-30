#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeManifest, compareManifests } from "../src/manifest-analyzer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_REQUEST_BYTES = 1024 * 1024;

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" }
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function setSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function serveAsset(res, route) {
  const asset = ASSETS[route];
  if (!asset) {
    setSecurityHeaders(res);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const filePath = path.join(__dirname, asset.file);
    const contents = await readFile(filePath);
    setSecurityHeaders(res);
    res.writeHead(200, { "Content-Type": asset.type, "Content-Length": contents.length });
    res.end(contents);
  } catch {
    setSecurityHeaders(res);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Unable to serve asset");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let rejected = false;
    const chunks = [];
    req.on("data", chunk => {
      if (rejected) return;
      received += chunk.length;
      if (received > MAX_REQUEST_BYTES) {
        rejected = true;
        reject(Object.assign(new Error("Request body is too large."), { code: "OVERSIZE" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", error => {
      if (!rejected) reject(error);
    });
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonBody(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    setSecurityHeaders(res);
    if (error.code === "OVERSIZE") {
      sendJson(res, 413, { error: "Request body is too large." });
    } else {
      sendJson(res, 400, { error: "Request body could not be read." });
    }
    return { error: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    setSecurityHeaders(res);
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return { error: true };
  }

  return { value: parsed };
}

async function handleAnalyze(req, res) {
  if (req.method !== "POST") {
    setSecurityHeaders(res);
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "This endpoint accepts POST only." });
    return;
  }

  const { value: manifest, error } = await readJsonBody(req, res);
  if (error) return;

  if (!isPlainObject(manifest)) {
    setSecurityHeaders(res);
    sendJson(res, 400, { error: "Request body must be a JSON object." });
    return;
  }

  try {
    const report = analyzeManifest(manifest);
    setSecurityHeaders(res);
    sendJson(res, 200, { report });
  } catch (error) {
    setSecurityHeaders(res);
    if (error.code === "UNSUPPORTED_MANIFEST_VERSION") {
      sendJson(res, 422, { error: "MV3 Replay currently supports Manifest V3 only." });
    } else {
      sendJson(res, 400, { error: "The manifest could not be analyzed." });
    }
  }
}

async function handleCompare(req, res) {
  if (req.method !== "POST") {
    setSecurityHeaders(res);
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "This endpoint accepts POST only." });
    return;
  }

  const { value: payload, error } = await readJsonBody(req, res);
  if (error) return;

  if (!isPlainObject(payload)) {
    setSecurityHeaders(res);
    sendJson(res, 400, { error: "Request body must be a JSON object." });
    return;
  }

  const { previous, current } = payload;
  if (!isPlainObject(previous) || !isPlainObject(current)) {
    setSecurityHeaders(res);
    sendJson(res, 400, { error: "Request body must include previous and current manifest objects." });
    return;
  }

  try {
    const report = compareManifests(previous, current);
    const candidateAnalysis = analyzeManifest(current);
    setSecurityHeaders(res);
    sendJson(res, 200, { report, candidateAnalysis });
  } catch (error) {
    setSecurityHeaders(res);
    if (error.code === "UNSUPPORTED_MANIFEST_VERSION") {
      sendJson(res, 422, { error: "MV3 Replay currently supports Manifest V3 only." });
    } else {
      sendJson(res, 400, { error: "The manifests could not be compared." });
    }
  }
}

export function createServer() {
  return createHttpServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      setSecurityHeaders(res);
      sendJson(res, 400, { error: "The request path is invalid." });
      return;
    }

    if (url.pathname === "/api/analyze") {
      handleAnalyze(req, res).catch(() => {
        if (!res.headersSent) {
          setSecurityHeaders(res);
          sendJson(res, 500, { error: "Internal error." });
        }
      });
      return;
    }

    if (url.pathname === "/api/compare") {
      handleCompare(req, res).catch(() => {
        if (!res.headersSent) {
          setSecurityHeaders(res);
          sendJson(res, 500, { error: "Internal error." });
        }
      });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      setSecurityHeaders(res);
      res.setHeader("Allow", "GET, HEAD");
      sendJson(res, 405, { error: "This endpoint accepts GET only." });
      return;
    }

    serveAsset(res, url.pathname).catch(() => {
      if (!res.headersSent) {
        setSecurityHeaders(res);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Unable to serve asset");
      }
    });
  });
}

export function startServer(port = 0, host = "127.0.0.1") {
  if (host !== "127.0.0.1") {
    return Promise.reject(new Error("The local interface may bind only to 127.0.0.1."));
  }
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer(0, "127.0.0.1")
    .then(server => {
      const address = server.address();
      process.stdout.write(`MV3 Replay local interface running at http://127.0.0.1:${address.port}/\n`);
      process.stdout.write("Local only. No external requests, telemetry, or persistence.\n");
    })
    .catch(error => {
      process.stderr.write(`Failed to start local interface: ${error.message}\n`);
      process.exitCode = 1;
    });
}
