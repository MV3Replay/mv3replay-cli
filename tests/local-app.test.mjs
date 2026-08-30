import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
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

function requestWithHost(baseUrl, host) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: target.hostname,
      port: target.port,
      path: "/",
      headers: { Host: host }
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
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

test("compare endpoint returns both the comparison report and the candidate analysis report", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous: richManifest, current: candidateManifest })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.report.to.version, "1.1.0");
    assert.equal(data.candidateAnalysis.identity.version, "1.1.0");
    assert.ok(Array.isArray(data.candidateAnalysis.lanes));
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

test("app.js does not use localStorage, cookies, IndexedDB, or telemetry", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /document\.cookie/);
  assert.doesNotMatch(source, /indexedDB/i);
  assert.doesNotMatch(source, /sendBeacon|analytics|telemetry/i);
});

test("app.js only requests the local analyze and compare endpoints", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const fetchCalls = [...source.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)].map(match => match[1]);
  assert.deepEqual(fetchCalls.sort(), ["/api/analyze", "/api/compare"]);
});

test("app.js renders checklist items as accessible checkboxes with labels", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /checkbox\.type = "checkbox"/);
  assert.match(source, /label\.htmlFor = id/);
  assert.match(source, /checklistProgressEl/);
});

test("app.js exports checklist state only via a user-triggered local download", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /exportButton\.addEventListener\("click"/);
  assert.match(source, /new Blob\(/);
  assert.match(source, /URL\.createObjectURL/);
  assert.doesNotMatch(source, /fetch\(\s*["'`]\/api\/export/);
});

test("app.js keeps checklist state in memory and resets it on each new analysis", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /let checklistState = \[\];/);
  assert.match(source, /checklistState = \[\];[\s\S]*let file = fileInput\.files\[0\]/);
});

test("index.html includes an accessible checklist section and export control", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /id="checklist"/);
  assert.match(html, /id="checklist-progress"/);
  assert.match(html, /id="export-checklist"/);
  assert.match(html, /aria-labelledby="checklist-heading"/);
});

test("index.html includes an accessible candidate-release checklist section and export control", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /id="candidate-checklist"/);
  assert.match(html, /id="candidate-checklist-progress"/);
  assert.match(html, /id="export-comparison"/);
  assert.match(html, /aria-labelledby="candidate-checklist-heading"/);
});

test("app.js renders the candidate-release checklist as accessible checkboxes with labels", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /renderCandidateChecklist/);
  assert.match(source, /candidateChecklistListEl/);
  assert.match(source, /candidateChecklistProgressEl/);
  assert.match(source, /comparisonReport\.findings\.forEach/);
  assert.match(source, /`comparison-\$\{finding\.id\}`/);
});

test("app.js resets candidate checklist state on each new comparison", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /let candidateChecklistState = \[\];/);
  assert.match(source, /candidateChecklistState = \[\];[\s\S]*let previousFile = previousFileInput\.files\[0\]/);
});

test("app.js exports the comparison and candidate checklist only via a user-triggered local download", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /exportComparisonButton\.addEventListener\("click"/);
  assert.doesNotMatch(source, /fetch\(\s*["'`]\/api\/export/);
});

test("index.html includes accessible Markdown export controls for analysis and comparison", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /id="export-checklist-markdown"/);
  assert.match(html, /id="export-comparison-markdown"/);
});

test("app.js builds deterministic Markdown sections for the analysis checklist export", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function buildAnalysisMarkdown/);
  assert.match(source, /## Identity/);
  assert.match(source, /## Findings/);
  assert.match(source, /## Test checklist/);
  assert.match(source, /## Limitations/);
  assert.match(source, /\[\$\{item\.done \? "x" : " "\}\]/);
});

test("app.js builds deterministic Markdown sections for the comparison checklist export", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function buildComparisonMarkdown/);
  assert.match(source, /## Release identity/);
  assert.match(source, /## Manual update validation/);
  assert.match(source, /## Key changes/);
  assert.match(source, /## Candidate-release checklist/);
});

test("app.js exports Markdown only via a user-triggered local download and disables buttons until a result exists", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /exportMarkdownButton\.addEventListener\("click"/);
  assert.match(source, /exportComparisonMarkdownButton\.addEventListener\("click"/);
  assert.match(source, /exportMarkdownButton\.disabled = checklistState\.length === 0;/);
  assert.match(source, /exportComparisonMarkdownButton\.disabled = candidateChecklistState\.length === 0;/);
  assert.match(source, /exportMarkdownButton\.disabled = true;/);
  assert.match(source, /exportComparisonMarkdownButton\.disabled = true;/);
  assert.doesNotMatch(source, /fetch\(\s*["'`]\/api\/export/);
});

test("app.js does not use clipboard access for exports", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /navigator\.clipboard/);
  assert.doesNotMatch(source, /execCommand\(\s*["'`]copy["'`]/);
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

test("rejects requests with a Host header that does not match the loopback origin", async () => {
  await withServer(async baseUrl => {
    const response = await requestWithHost(baseUrl, "example.com");
    assert.equal(response.status, 400);
    const data = JSON.parse(response.body);
    assert.equal(data.error, "Request host is not permitted.");
  });
});

test("rejects analyze requests with a foreign Origin header", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify(richManifest)
    });
    assert.equal(response.status, 403);
    const data = await response.json();
    assert.equal(data.error, "Request origin is not permitted.");
  });
});

test("allows analyze requests whose Origin matches the loopback server", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify(richManifest)
    });
    assert.equal(response.status, 200);
  });
});

test("allows analyze requests with no Origin header for local non-browser clients", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(richManifest)
    });
    assert.equal(response.status, 200);
  });
});

test("rejects compare requests with a foreign Origin header", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ previous: richManifest, current: candidateManifest })
    });
    assert.equal(response.status, 403);
    const data = await response.json();
    assert.equal(data.error, "Request origin is not permitted.");
  });
});

test("rejects analyze and compare requests without a JSON content type", async () => {
  await withServer(async baseUrl => {
    const analyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(richManifest)
    });
    assert.equal(analyzeResponse.status, 415);
    const analyzeData = await analyzeResponse.json();
    assert.equal(analyzeData.error, "Request content type must be application/json.");

    const compareResponse = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ previous: richManifest, current: candidateManifest })
    });
    assert.equal(compareResponse.status, 415);
    const compareData = await compareResponse.json();
    assert.equal(compareData.error, "Request content type must be application/json.");
  });
});

test("adds no-store caching and same-origin resource protections to responses", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  });
});

test("index.html adds optional folder inputs alongside the existing file inputs", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /id="manifest-file"/);
  assert.match(html, /id="manifest-folder"[\s\S]*webkitdirectory/);
  assert.match(html, /id="previous-manifest-file"/);
  assert.match(html, /id="previous-manifest-folder"[\s\S]*webkitdirectory/);
  assert.match(html, /id="candidate-manifest-file"/);
  assert.match(html, /id="candidate-manifest-folder"[\s\S]*webkitdirectory/);
  assert.doesNotMatch(html, /id="manifest-file"[^>]*required/);
  assert.doesNotMatch(html, /id="previous-manifest-file"[^>]*required/);
  assert.doesNotMatch(html, /id="candidate-manifest-file"[^>]*required/);
});

test("index.html accurately explains folder selection privacy", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /only its root/);
  assert.match(html, /manifest\.json.{0,80}content is read/s);
  assert.match(html, /Relative paths are checked only to find it/);
  assert.match(html, /no\s+other file content or path is sent\s+anywhere/);
});

test("app.js locates exactly one root manifest.json using webkitRelativePath", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function findRootManifestInFolder/);
  assert.match(source, /webkitRelativePath/);
  assert.match(source, /segments\.length === 2 && segments\[1\] === "manifest\.json"/);
});

test("app.js rejects folder selections with a missing or ambiguous root manifest.json", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /must contain a root manifest\.json file/);
  assert.match(source, /more than one root manifest\.json file; the selection is ambiguous/);
});

test("findRootManifestInFolder only ever selects the single root manifest.json file object", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const match = source.match(/function findRootManifestInFolder\([\s\S]*?\r?\n}\r?\n/);
  assert.ok(match, "findRootManifestInFolder function body should be present");
  const body = match[0];
  assert.match(body, /rootManifests\[0\]/);
  assert.doesNotMatch(body, /readFileAsText/);
});

test("app.js still only requests the local analyze and compare endpoints after folder support", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const fetchCalls = [...source.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)].map(match => match[1]);
  assert.deepEqual(fetchCalls.sort(), ["/api/analyze", "/api/compare"]);
});

test("Markdown export escaping neutralizes adversarial dynamic text", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const match = source.match(/function escapeMarkdownText\(value\) \{[\s\S]*?\r?\n\}/);
  assert.ok(match, "escapeMarkdownText function should be present");
  const escapeMarkdownText = Function(`${match[0]}; return escapeMarkdownText;`)();
  const escaped = escapeMarkdownText("# title\n[link](https://example.test) ![image](x) <b>html</b>\n- [ ] extra\u0000");

  assert.doesNotMatch(escaped, /\r|\n|\u0000/);
  assert.doesNotMatch(escaped, /(^|\s)#\s/);
  assert.doesNotMatch(escaped, /(?<!\\)\[[^\]]+\]\(/);
  assert.doesNotMatch(escaped, /(?<!\\)!\[/);
  assert.doesNotMatch(escaped, /(?<!\\)<[^>]+(?<!\\)>/);
  assert.doesNotMatch(escaped, /(^|\s)- \[ \]/);
});

test("both Markdown builders escape every dynamic report and checklist field", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  for (const expression of [
    "report.identity.name", "report.identity.version", "report.identity.manifestVersion",
    "flag.id", "flag.level", "flag.message", "item.laneId", "item.check",
    "report.from.name", "report.from.version", "report.to.name", "report.to.version", "report.changes.version.relation",
    "finding.id", "finding.level", "finding.message"
  ]) {
    assert.match(source, new RegExp(`escapeMarkdownText\\(${expression.replaceAll(".", "\\.")}\\)`));
  }
  assert.match(source, /diff\.added\.map\(escapeMarkdownText\)/);
  assert.match(source, /diff\.removed\.map\(escapeMarkdownText\)/);
});

test("local app exposes accessible summaries and busy submit controls", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /id="report-summary"/);
  assert.match(html, /id="compare-report-summary"/);
  assert.match(html, /id="analyze-submit"[^>]*aria-busy="false"/);
  assert.match(html, /id="compare-submit"[^>]*aria-busy="false"/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test("local app links every matching file and folder input exclusively", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  for (const pair of [
    "fileInput, folderInput", "folderInput, fileInput",
    "previousFileInput, previousFolderInput", "previousFolderInput, previousFileInput",
    "candidateFileInput, candidateFolderInput", "candidateFolderInput, candidateFileInput"
  ]) {
    assert.match(source, new RegExp(`linkMutuallyExclusiveInputs\\(${pair}\\)`));
  }
  assert.match(source, /otherInput\.value = ""/);
});

test("analysis and comparison restore loading controls in finally blocks", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /finally \{\s*setActionGroupLoading\(analyzeSubmitButton, analyzeExampleButton, form, false/);
  assert.match(source, /finally \{\s*setActionGroupLoading\(compareSubmitButton, compareExampleButton, compareForm, false/);
  assert.match(source, /renderAnalysisSummary\(data\.report\)/);
  assert.match(source, /renderComparisonSummary\(data\.report\)/);
});

test("technical interface styles summaries, badges, focus, and responsive forms", async () => {
  const css = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.summary/);
  assert.match(css, /\.badge-critical/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /form\.card \{ grid-template-columns: 1fr; \}/);
});

test("local app offers accessible built-in analysis and comparison examples", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /id="analyze-example-button"[^>]*aria-busy="false"/);
  assert.match(html, /id="compare-example-button"[^>]*aria-busy="false"/);
  assert.match(html, /Try built-in example/);
  assert.match(html, /Try built-in release comparison/);
});

test("built-in examples are valid MV3 shapes and clearly remain sample data", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /const EXAMPLE_ANALYSIS_MANIFEST = \{[\s\S]*?manifest_version: 3/);
  assert.match(source, /optional_permissions: \["nativeMessaging", "userScripts"\]/);
  assert.match(source, /omnibox: \{ keyword: "mv3" \}/);
  assert.match(source, /sandbox: \{ pages: \["sandbox\.html"\] \}/);
  assert.match(source, /const EXAMPLE_PREVIOUS_MANIFEST = \{[\s\S]*?manifest_version: 3/);
  assert.match(source, /const EXAMPLE_CANDIDATE_MANIFEST = \{[\s\S]*?manifest_version: 3/);
  assert.match(source, /permissions: \["storage", "tabCapture"\]/);
  assert.match(source, /host_permissions: \["https:\/\/example\.com\/\*", "<all_urls>"\]/);
  assert.match(source, /Built-in example — not your extension/);
  assert.match(source, /this is sample data/);
});

test("examples and real files share the same local execution paths", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.equal((source.match(/fetch\("\/api\/analyze"/g) || []).length, 1);
  assert.equal((source.match(/fetch\("\/api\/compare"/g) || []).length, 1);
  assert.match(source, /runAnalysis\(EXAMPLE_ANALYSIS_MANIFEST, true\)/);
  assert.match(source, /runComparison\(EXAMPLE_PREVIOUS_MANIFEST, EXAMPLE_CANDIDATE_MANIFEST, true\)/);
  assert.match(source, /setActionGroupLoading/);
});

test("analysis and comparison expose honest live readiness gates", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(html, /id="analysis-readiness"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="comparison-readiness"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(source, /function updateAnalysisReadiness/);
  assert.match(source, /function updateComparisonReadiness/);
  assert.match(source, /Ready for manual browser testing/);
  assert.match(source, /does not mean the extension has passed runtime testing/);
  assert.match(source, /Runtime and update behavior are still unverified/);
  assert.match(source, /requiresManualUpdateValidation/);
});

test("readiness gates refresh whenever a checklist checkbox changes", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function updateChecklistProgress\(\)[\s\S]*?updateAnalysisReadiness\(\)/);
  assert.match(source, /function updateCandidateChecklistProgress\(\)[\s\S]*?updateComparisonReadiness\(\)/);
  const css = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.readiness-ready/);
  assert.match(css, /\.readiness-pending/);
  assert.match(css, /\.readiness-blocked/);
});

test("analysis and comparison provide accessible finding severity filters", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(html, /id="analysis-severity-filter"/);
  assert.match(html, /id="comparison-severity-filter"/);
  assert.match(html, /id="analysis-filter-status" role="status" aria-live="polite"/);
  assert.match(html, /id="comparison-filter-status" role="status" aria-live="polite"/);
  assert.match(source, /function applyFindingFilter/);
  assert.match(source, /entry\.node\.hidden = !matches/);
  assert.match(source, /analysisSeverityFilterEl\.addEventListener\("change"/);
  assert.match(source, /comparisonSeverityFilterEl\.addEventListener\("change"/);
});

test("finding filters reset for every new result and do not alter exports", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /analysisSeverityFilterEl\.value = "all"/);
  assert.match(source, /comparisonSeverityFilterEl\.value = "all"/);
  assert.match(source, /analysisFilterControlsEl\.hidden = report\.riskFlags\.length === 0/);
  assert.match(source, /comparisonFilterControlsEl\.hidden = report\.findings\.length === 0/);
  assert.doesNotMatch(source, /filter\([^\n]*buildAnalysisMarkdown/);
  assert.doesNotMatch(source, /filter\([^\n]*buildComparisonMarkdown/);
});

test("the app includes a private, self-guided tester session", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /10-minute tester session/);
  assert.match(html, /id="tester-guide-heading"/);
  assert.match(html, /id="download-feedback-template"/);
  assert.match(html, /id="feedback-template-status" role="status" aria-live="polite"/);
  assert.match(html, /Do not include source code, account details, extension names, private URLs, or personal/);
});

test("feedback template is a user-triggered local Markdown download with privacy reminders", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function buildFeedbackTemplate/);
  assert.match(source, /mv3-replay-private-tester-notes\.md/);
  assert.match(source, /Remove extension names, private URLs, source code, account details, and personal information/);
  assert.match(source, /Do not add contact details or identifying information/);
  assert.match(source, /feedbackTemplateButton\.addEventListener\("click"/);
  assert.doesNotMatch(source, /fetch\([^\n]*feedback/);
});

test("comparison UI and Markdown expose surface and declaration changes", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /renderListDiff\("Extension surfaces", report\.changes\.surfaces\)/);
  assert.match(source, /renderListDiff\("OAuth scopes", report\.changes\.oauthScopes\)/);
  assert.match(source, /renderDeclarationChanges\(report\.changes\.declarations\)/);
  assert.match(source, /function formatDeclarationValue/);
  assert.match(source, /\["surfaces", "Extension surfaces"\]/);
  assert.match(source, /\["oauthScopes", "OAuth scopes"\]/);
  assert.match(source, /### Entry-point declarations/);
  assert.match(source, /escapeMarkdownText\(change\.field\)/);
});

test("analysis Markdown includes deterministic surfaces and manifest counts", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /## Detected surfaces/);
  assert.match(source, /Object\.entries\(report\.surfaces\)\.sort/);
  assert.match(source, /## Manifest counts/);
  assert.match(source, /Object\.entries\(report\.counts\)\.sort/);
  assert.match(source, /escapeMarkdownText\(key\)/);
  assert.match(source, /escapeMarkdownText\(value\)/);
});

test("comparison UI and Markdown expose content-script registration changes", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function renderContentScriptChanges\(diff\)/);
  assert.match(source, /renderContentScriptChanges\(report\.changes\.contentScripts\)/);
  assert.match(source, /### Content-script registrations/);
  assert.match(source, /escapeMarkdownText\(formatContentScriptRegistration\(registration\)\)/);
});

test("comparison UI and Markdown expose network and external-boundary changes", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /renderStaticRulesetChanges\(report\.changes\.staticRulesets\)/);
  assert.match(source, /External messaging matches/);
  assert.match(source, /renderWebAccessibleResourceChanges\(report\.changes\.webAccessibleResources\)/);
  assert.match(source, /### Static DNR rulesets/);
  assert.match(source, /### External messaging/);
  assert.match(source, /### Web-accessible resources/);
  assert.match(source, /escapeMarkdownText\(formatWebAccessibleResource\(declaration\)\)/);
});

test("comparison summary counts explicit change records without traversing nested payload fields", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /function countComparisonChanges\(changes\)/);
  assert.match(source, /function comparisonChangeBreakdown\(changes\)/);
  assert.match(source, /function countListDiff\(diff\)/);
  assert.match(source, /const changeCount = countComparisonChanges\(report\.changes\)/);
  assert.doesNotMatch(source, /function countChangeRecords/);
  assert.match(source, /changes\.declarations\?\.length \|\| 0/);
  assert.match(source, /Breakdown: \$\{breakdown\}/);
});

test("comparison Markdown exports the same structured change total and breakdown", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /## Structured change count/);
  assert.match(source, /Total: \$\{countComparisonChanges\(report\.changes\)\}/);
  assert.match(source, /comparisonChangeBreakdown\(report\.changes\)/);
  assert.match(source, /escapeMarkdownText\(label\)/);
});

test("both in-memory checklists have accessible completion filters and reset controls", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(html, /id="checklist-filter"/);
  assert.match(html, /id="candidate-checklist-filter"/);
  assert.match(html, /id="reset-checklist"/);
  assert.match(html, /id="reset-candidate-checklist"/);
  assert.match(html, /id="checklist-filter-status" role="status" aria-live="polite"/);
  assert.match(html, /id="candidate-checklist-filter-status" role="status" aria-live="polite"/);
  assert.match(source, /function applyChecklistFilter/);
  assert.match(source, /function resetChecklist/);
  assert.match(source, /entry\.node\.hidden = !matches/);
  assert.match(source, /entry\.checkbox\.checked = false/);
});

test("checklist filtering never removes items from exports", async () => {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(source, /buildAnalysisMarkdown\(currentReport, checklistState\)/);
  assert.match(source, /buildComparisonMarkdown\(currentCompareReport, candidateChecklistState\)/);
  assert.doesNotMatch(source, /buildAnalysisMarkdown\([^\n]*\.filter/);
  assert.doesNotMatch(source, /buildComparisonMarkdown\([^\n]*\.filter/);
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
