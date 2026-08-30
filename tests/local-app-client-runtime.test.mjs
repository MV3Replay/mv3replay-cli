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

  click() {
    this.clicked = true;
  }
}

function collectText(node) {
  return [node.textContent, ...node.children.flatMap(collectText)].filter(Boolean).join(" ");
}

async function createClientHarness() {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const elements = new Map();
  const createdElements = [];
  const document = {
    body: new FakeElement("body"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    createElement() {
      const element = new FakeElement();
      createdElements.push(element);
      return element;
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
      version: { previous: "1.0.0", current: "2.0.0", relation: "newer" },
      requiredPermissions: { added: ["tabCapture"], removed: [] },
      optionalPermissions: { added: [], removed: [] },
      requiredHosts: { added: ["<all_urls>"], removed: [] },
      optionalHosts: { added: [], removed: [] },
      oauthScopes: { added: ["profile"], removed: [] },
      contentScriptMatches: { added: [], removed: [] },
      contentScripts: {
        added: [{
          matches: ["https://example.test/*"], excludeMatches: [], files: ["new-content.js"],
          runAt: "document_start", allFrames: true, world: "MAIN",
          matchAboutBlank: false, matchOriginAsFallback: false
        }],
        removed: []
      },
      commands: { added: [], removed: [] },
      surfaces: { added: ["native-messaging"], removed: [] },
      staticRulesets: { added: ["privacy"], removed: [], changed: ["base"] },
      externalMessaging: {
        matches: { added: ["https://caller.example/*"], removed: [] },
        ids: { added: [], removed: [] }
      },
      webAccessibleResources: {
        added: [{
          resources: ["injected.js"], matches: ["https://example.test/*"],
          extensionIds: [], useDynamicUrl: true
        }],
        removed: []
      },
      declarations: [
        { field: "omnibox.keyword", previous: null, current: "mv3" },
        { field: "sandbox.pages", previous: [], current: ["sandbox.html"] }
      ]
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
  return { elements, requests, createdElements };
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
  assert.match(collectText(elements.get("compare-report-details")), /omnibox\.keyword: not declared → mv3/);
  assert.match(collectText(elements.get("compare-report-details")), /Extension surfaces Added: native-messaging/);
  assert.match(collectText(elements.get("compare-report-details")), /Added: files=new-content\.js; matches=https:\/\/example\.test\/\*/);
  assert.match(collectText(elements.get("compare-report-details")), /Static DNR rulesets Added: privacy Removed: none Changed: base/);
  assert.match(collectText(elements.get("compare-report-details")), /External messaging matches Added: https:\/\/caller\.example\/\*/);
  assert.match(collectText(elements.get("compare-report-details")), /Web-accessible resources Added: resources=injected\.js/);
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

test("feedback template downloads only after the tester clicks the local control", async () => {
  const { elements, requests, createdElements } = await createClientHarness();
  elements.get("download-feedback-template").listeners.get("click")();

  const link = createdElements.find(element => element.download === "mv3-replay-private-tester-notes.md");
  assert.ok(link);
  assert.equal(link.clicked, true);
  assert.equal(requests.length, 0);
  assert.match(elements.get("feedback-template-status").textContent, /downloaded locally/);
});

test("checklist completion filters and reset execute against in-memory state", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const checklistItem = elements.get("checklist-list").children[0];
  const checkbox = checklistItem.children[0];
  checkbox.checked = true;
  checkbox.listeners.get("change")();

  const filter = elements.get("checklist-filter");
  filter.value = "done";
  filter.listeners.get("change")();
  assert.equal(checklistItem.hidden, false);
  assert.match(elements.get("checklist-filter-status").textContent, /1 of 1 checks shown \(completed\)/);

  elements.get("reset-checklist").listeners.get("click")();
  assert.equal(checkbox.checked, false);
  assert.equal(filter.value, "all");
  assert.match(elements.get("checklist-progress").textContent, /0 of 1 checklist items completed/);
});

