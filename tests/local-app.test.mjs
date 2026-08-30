import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer, startServer } from "../app/server.mjs";

const richManifest = {
  manifest_version: 3,
  name: "Fixture extension",
  version: "1.0.0",
  permissions: ["storage"],
  background: { service_worker: "worker.js" },
  action: { default_popup: "popup.html" }
};

const candidateManifest = {
  manifest_version: 3,
  name: "Fixture extension",
  version: "1.1.0",
  permissions: ["storage", "tabCapture"],
  host_permissions: ["https://example.com/*"],
  background: { service_worker: "worker.js" },
  action: { default_popup: "popup.html" }
};

async function withServer(run) {
  const server = await startServer(0, "127.0.0.1");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("the npm start:app script launches the local server entry point", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["start:app"], "node app/server.mjs");
  assert.equal(packageJson.scripts.inspect, "node src/cli.mjs inspect");
});

test("binds only to the local loopback address", async () => {
  await withServer(async baseUrl => {
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
  });
});

test("does not accept a wildcard host", async () => {
  await assert.rejects(
    startServer(0, "0.0.0.0"),
    /only to 127\.0\.0\.1/
  );
});

test("analyzes a valid MV3 manifest via POST", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(richManifest)
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.report.identity.name, "Fixture extension");
    assert.equal(data.report.surfaces.serviceWorker, true);
    assert.equal(data.report.privacy.localOnly, true);
    assert.equal(data.report.privacy.browserConnected, false);
  });
});

test("rejects non-POST requests to the analyze endpoint", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, { method: "GET" });
    assert.equal(response.status, 405);
    const data = await response.json();
    assert.equal(data.error, "This endpoint accepts POST only.");
  });
});

test("rejects malformed JSON with a generic error", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.error, "Request body must be valid JSON.");
  });
});

test("rejects non-object JSON input", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"])
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.error, "Request body must be a JSON object.");
  });
});

test("rejects oversized requests", async () => {
  await withServer(async baseUrl => {
    const oversized = "a".repeat(1024 * 1024 + 1);
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized
    });
    assert.equal(response.status, 413);
    const data = await response.json();
    assert.equal(data.error, "Request body is too large.");
  });
});

test("rejects non-MV3 manifests with a generic error", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest_version: 2 })
    });
    assert.equal(response.status, 422);
    const data = await response.json();
    assert.equal(data.error, "MV3 Replay currently supports Manifest V3 only.");
  });
});

test("compares a previous and candidate MV3 manifest via POST", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous: richManifest, current: candidateManifest })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.report.from.version, "1.0.0");
    assert.equal(data.report.to.version, "1.1.0");
    assert.equal(data.report.requiresManualUpdateValidation, true);
    assert.deepEqual(data.report.changes.requiredPermissions.added, ["tabCapture"]);
    assert.equal(data.report.privacy.localOnly, true);
    assert.equal(data.report.privacy.browserConnected, false);
  });
});

test("rejects non-POST requests to the compare endpoint", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, { method: "GET" });
    assert.equal(response.status, 405);
    const data = await response.json();
    assert.equal(data.error, "This endpoint accepts POST only.");
  });
});

test("rejects malformed JSON on the compare endpoint", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.error, "Request body must be valid JSON.");
  });
});

test("rejects a compare payload missing previous or current manifests", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous: richManifest })
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.error, "Request body must include previous and current manifest objects.");
  });
});

test("rejects oversized compare requests", async () => {
  await withServer(async baseUrl => {
    const oversized = "a".repeat(1024 * 1024 + 1);
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized
    });
    assert.equal(response.status, 413);
    const data = await response.json();
    assert.equal(data.error, "Request body is too large.");
  });
});

test("rejects non-MV3 manifests on the compare endpoint", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous: { manifest_version: 2 }, current: candidateManifest })
    });
    assert.equal(response.status, 422);
    const data = await response.json();
    assert.equal(data.error, "MV3 Replay currently supports Manifest V3 only.");
  });
});

test("existing single-manifest inspection still works alongside comparison", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(richManifest)
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.report.identity.name, "Fixture extension");
  });
});

test("serves only the three allowlisted assets", async () => {
  await withServer(async baseUrl => {
    const index = await fetch(`${baseUrl}/index.html`);
    const app = await fetch(`${baseUrl}/app.js`);
    const styles = await fetch(`${baseUrl}/styles.css`);
    const missing = await fetch(`${baseUrl}/does-not-exist.js`);

    assert.equal(index.status, 200);
    assert.equal(app.status, 200);
    assert.equal(styles.status, 200);
    assert.equal(missing.status, 404);
  });
});

test("applies a restrictive local Content-Security-Policy", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/`);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.doesNotMatch(csp, /https?:/);
  });
});

test("report privacy metadata declares no outbound networking", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(richManifest)
    });
    const data = await response.json();
    assert.deepEqual(data.report.privacy, {
      localOnly: true,
      sourceFilesRead: false,
      browserConnected: false,
      dataUploaded: false
    });
  });
});
