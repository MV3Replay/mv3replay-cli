import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.files = [];
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  prepend(child) {
    this.children.unshift(child);
  }

  removeChild(child) {
    this.children = this.children.filter(candidate => candidate !== child);
  }
}

function collectText(node) {
  return [node.textContent, ...node.children.flatMap(collectText)].filter(Boolean).join(" ");
}

async function createClientHarness() {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const elements = new Map();
  const document = {
    body: new FakeElement("body"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    createElement() {
      return new FakeElement();
    }
  };

  const requests = [];
  const analysisReport = {
    identity: { name: "Built-in example extension", version: "1.0.0", manifestVersion: 3 },
    surfaces: { serviceWorker: true, popup: true },
    lanes: [{ id: "startup", priority: "high", reason: "Worker startup", checks: ["Restart the worker"] }],
    riskFlags: [
      { id: "broad-host", level: "critical", message: "Broad host access" },
      { id: "notification", level: "low", message: "Notification permission" }
    ],
    privacy: { localOnly: true, browserConnected: false }
  };
  const comparisonReport = {
    from: { name: "Built-in example extension", version: "1.0.0" },
    to: { name: "Built-in example extension", version: "2.0.0" },
    findings: [{ id: "permission-added", level: "critical", message: "New powerful permission" }],
    requiresManualUpdateValidation: true,
    changes: {
      requiredPermissions: { added: ["tabCapture"], removed: [] },
      optionalPermissions: { added: [], removed: [] },
      requiredHosts: { added: ["<all_urls>"], removed: [] },
      optionalHosts: { added: [], removed: [] },
      contentScriptMatches: { added: [], removed: [] },
      commands: { added: [], removed: [] }
    }
  };

  const context = vm.createContext({
    document,
    Blob,
    console,
    URL: {
      createObjectURL: () => "blob:local",
      revokeObjectURL: () => {}
    },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === "/api/analyze") {
        return { ok: true, json: async () => ({ report: analysisReport }) };
      }
      if (path === "/api/compare") {
        return { ok: true, json: async () => ({ report: comparisonReport, candidateAnalysis: analysisReport }) };
      }
      throw new Error("Unexpected request");
    }
  });
  vm.runInContext(source, context, { filename: "app/app.js" });
  return { elements, requests };
}

test("built-in analysis example executes the real client request and rendering path", async () => {
  const { elements, requests } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/analyze");
  assert.equal(JSON.parse(requests[0].options.body).manifest_version, 3);
  assert.match(elements.get("status").textContent, /sample data/);
  assert.match(collectText(elements.get("report-summary")), /not your extension/);
  assert.equal(elements.get("report").hidden, false);
  assert.equal(elements.get("analyze-submit").disabled, false);
  assert.equal(elements.get("analyze-example-button").attributes.get("aria-busy"), "false");
});

test("built-in comparison example renders an explicit manual-validation gate", async () => {
  const { elements, requests } = await createClientHarness();
  await elements.get("compare-example-button").listeners.get("click")();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/compare");
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.previous.manifest_version, 3);
  assert.equal(payload.current.host_permissions.includes("<all_urls>"), true);
  assert.match(elements.get("compare-status").textContent, /sample data/);
  assert.match(collectText(elements.get("comparison-readiness")), /Update-path validation required/);
  assert.equal(elements.get("compare-report").hidden, false);
  assert.equal(elements.get("compare-submit").disabled, false);
  assert.equal(elements.get("compare-example-button").attributes.get("aria-busy"), "false");
});

test("severity filters execute and hide non-matching rendered findings", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const filter = elements.get("analysis-severity-filter");
  filter.value = "critical";
  filter.listeners.get("change")();

  const findings = elements.get("report-details").children.filter(child => child.className === "finding");
  assert.equal(findings.length, 2);
  assert.equal(findings.filter(node => node.hidden).length, 1);
  assert.match(elements.get("analysis-filter-status").textContent, /1 finding shown \(critical\)/);
});

