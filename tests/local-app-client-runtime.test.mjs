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

async function createClientHarness({ identicalComparison = false, unmodeledCoverage = false, sensitiveValues = false } = {}) {
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  const elements = new Map();
  const createdElements = [];
  const createdBlobs = [];
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
    counts: { permissions: 2, hostPermissions: 1, unmodeledTopLevelKeys: 0 },
    coverage: { unmodeledTopLevelKeys: [] },
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
      ],
      extensionKey: { previousDeclared: false, currentDeclared: false, changed: false },
      unmodeledTopLevelKeys: { added: [], removed: [], changed: [] }
    }
  };
  if (unmodeledCoverage) {
    analysisReport.coverage.unmodeledTopLevelKeys = ["future_settings"];
    analysisReport.counts = { unmodeledTopLevelKeys: 1 };
    analysisReport.riskFlags.push({
      id: "unmodeled-manifest-keys",
      level: "high",
      message: "Coverage gap: future_settings is not interpreted"
    });
    comparisonReport.changes.unmodeledTopLevelKeys.changed = ["future_settings"];
    comparisonReport.findings.push({
      id: "unmodeled-manifest-key-change",
      level: "high",
      message: "Unmodeled top-level manifest key changed: future_settings"
    });
  }
  if (sensitiveValues) {
    analysisReport.identity = { name: "PRIVATE_EXTENSION_NAME", version: "PRIVATE_VERSION", manifestVersion: 3 };
    analysisReport.coverage.unmodeledTopLevelKeys = ["PRIVATE_CUSTOM_KEY"];
    analysisReport.lanes[0].checks = ["PRIVATE_CHECKLIST_TEXT"];
    analysisReport.riskFlags[0].message = "PRIVATE_FINDING_MESSAGE";
    comparisonReport.from = { name: "PRIVATE_OLD_NAME", version: "PRIVATE_OLD_VERSION" };
    comparisonReport.to = { name: "PRIVATE_NEW_NAME", version: "PRIVATE_NEW_VERSION" };
    comparisonReport.findings[0].message = "PRIVATE_COMPARISON_MESSAGE";
    comparisonReport.changes.requiredHosts.added = ["https://private.example/*"];
    comparisonReport.changes.contentScripts.added[0].files = ["private-script.js"];
    comparisonReport.changes.declarations[0] = {
      field: "PRIVATE_DECLARATION_FIELD",
      previous: "PRIVATE_PREVIOUS_VALUE",
      current: "PRIVATE_CURRENT_VALUE"
    };
  }
  if (identicalComparison) {
    comparisonReport.to.version = comparisonReport.from.version;
    comparisonReport.findings = [];
    comparisonReport.requiresManualUpdateValidation = false;
    comparisonReport.changes.version = {
      previous: comparisonReport.from.version,
      current: comparisonReport.from.version,
      relation: "same"
    };
    for (const key of [
      "requiredPermissions", "optionalPermissions", "requiredHosts", "optionalHosts",
      "oauthScopes", "contentScriptMatches", "contentScripts", "commands", "surfaces",
      "webAccessibleResources"
    ]) {
      comparisonReport.changes[key] = { added: [], removed: [] };
    }
    comparisonReport.changes.staticRulesets = { added: [], removed: [], changed: [] };
    comparisonReport.changes.externalMessaging = {
      matches: { added: [], removed: [] },
      ids: { added: [], removed: [] }
    };
    comparisonReport.changes.declarations = [];
    comparisonReport.changes.unmodeledTopLevelKeys = { added: [], removed: [], changed: [] };
  }

  const context = vm.createContext({
    document,
    Blob,
    console,
    URL: {
      createObjectURL: blob => {
        createdBlobs.push(blob);
        return "blob:local";
      },
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
  return { elements, requests, createdElements, createdBlobs };
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
  assert.match(collectText(elements.get("compare-report-summary")), /12 structured change records/);
  assert.match(
    collectText(elements.get("compare-report-summary")),
    /Breakdown: version 1; access 3; scripts 1; rules 2; external boundaries 2; surfaces 1; declarations 2\./
  );
  assert.match(collectText(elements.get("comparison-readiness")), /Update-path validation required/);
  assert.match(collectText(elements.get("compare-report-details")), /omnibox\.keyword: not declared → mv3/);
  assert.match(collectText(elements.get("compare-report-details")), /Extension surfaces Added: native-messaging/);
  assert.match(collectText(elements.get("compare-report-details")), /Added: files=new-content\.js; matches=https:\/\/example\.test\/\*/);
  assert.match(collectText(elements.get("compare-report-details")), /Static DNR rulesets Added: privacy Removed: none Changed: base/);
  assert.match(collectText(elements.get("compare-report-details")), /External messaging matches Added: https:\/\/caller\.example\/\*/);
  assert.match(collectText(elements.get("compare-report-details")), /Web-accessible resources Added: resources=injected\.js/);
  assert.match(collectText(elements.get("candidate-checklist-list")), /comparison-permission-added: New powerful permission/);
  assert.equal(elements.get("compare-report").hidden, false);
  assert.equal(elements.get("compare-submit").disabled, false);
  assert.equal(elements.get("compare-example-button").attributes.get("aria-busy"), "false");
});

test("an identical comparison renders zero structured changes without comparison findings", async () => {
  const { elements } = await createClientHarness({ identicalComparison: true });
  await elements.get("compare-example-button").listeners.get("click")();

  const summary = collectText(elements.get("compare-report-summary"));
  assert.match(summary, /0 structured change records/);
  assert.match(summary, /Breakdown: no structured changes\./);
  assert.match(collectText(elements.get("compare-report-details")), /No comparison findings were detected/);
  assert.doesNotMatch(collectText(elements.get("candidate-checklist-list")), /comparison-/);
});

test("coverage gaps render in analysis and comparison summaries", async () => {
  const { elements } = await createClientHarness({ unmodeledCoverage: true });
  await elements.get("analyze-example-button").listeners.get("click")();
  assert.match(collectText(elements.get("report-details")), /not interpreted by this analyzer: future_settings/);
  assert.match(collectText(elements.get("report-details")), /unmodeled-manifest-keys/);

  await elements.get("compare-example-button").listeners.get("click")();
  assert.match(collectText(elements.get("compare-report-summary")), /coverage gaps 1/);
  assert.match(collectText(elements.get("compare-report-details")), /Changed: future_settings/);
  assert.match(collectText(elements.get("candidate-checklist-list")), /comparison-unmodeled-manifest-key-change/);
});

test("comparison change categories filter rendered sections without changing the report", async () => {
  const { elements, requests } = await createClientHarness();
  await elements.get("compare-example-button").listeners.get("click")();

  const filter = elements.get("comparison-change-filter");
  filter.value = "access";
  filter.listeners.get("change")();

  const sections = elements.get("compare-report-details").children
    .filter(child => child.className.includes("change-section"));
  assert.equal(sections.length, 16);
  assert.equal(sections.filter(section => !section.hidden).length, 5);
  assert.ok(sections.filter(section => !section.hidden)
    .every(section => section.attributes.get("data-change-category") === "access"));
  assert.match(elements.get("comparison-change-filter-status").textContent, /5 of 16 change sections shown \(access\)/);

  const changedOnly = elements.get("comparison-changed-only");
  changedOnly.checked = true;
  changedOnly.listeners.get("change")();
  assert.equal(sections.filter(section => !section.hidden).length, 3);
  assert.ok(sections.filter(section => !section.hidden)
    .every(section => section.attributes.get("data-has-changes") === "true"));
  assert.match(elements.get("comparison-change-filter-status").textContent, /3 of 16 change sections shown \(access; changed only\)/);
  assert.equal(requests.length, 1);
});

test("changed-only mode shows zero sections for identical manifests", async () => {
  const { elements } = await createClientHarness({ identicalComparison: true });
  await elements.get("compare-example-button").listeners.get("click")();

  const changedOnly = elements.get("comparison-changed-only");
  changedOnly.checked = true;
  changedOnly.listeners.get("change")();
  const sections = elements.get("compare-report-details").children
    .filter(child => child.className.includes("change-section"));
  assert.equal(sections.filter(section => !section.hidden).length, 0);
  assert.match(elements.get("comparison-change-filter-status").textContent, /0 of 16 change sections shown \(all categories; changed only\)/);
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

test("share-safe summaries exclude every manifest-controlled value", async () => {
  const { elements, createdElements, createdBlobs } = await createClientHarness({ sensitiveValues: true });
  await elements.get("analyze-example-button").listeners.get("click")();
  elements.get("export-analysis-safe-summary").listeners.get("click")();
  await elements.get("compare-example-button").listeners.get("click")();
  elements.get("export-comparison-safe-summary").listeners.get("click")();

  assert.equal(createdBlobs.length, 2);
  const [analysisText, comparisonText] = await Promise.all(createdBlobs.map(blob => blob.text()));
  const combined = `${analysisText}\n${comparisonText}`;
  for (const secret of [
    "PRIVATE_EXTENSION_NAME", "PRIVATE_VERSION", "PRIVATE_CUSTOM_KEY", "PRIVATE_CHECKLIST_TEXT",
    "PRIVATE_FINDING_MESSAGE", "PRIVATE_OLD_NAME", "PRIVATE_OLD_VERSION", "PRIVATE_NEW_NAME",
    "PRIVATE_NEW_VERSION", "PRIVATE_COMPARISON_MESSAGE", "private.example", "private-script.js",
    "PRIVATE_DECLARATION_FIELD", "PRIVATE_PREVIOUS_VALUE", "PRIVATE_CURRENT_VALUE"
  ]) {
    assert.doesNotMatch(combined, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(analysisText, /Finding severity counts/);
  assert.match(comparisonText, /Structured change counts/);
  assert.ok(createdElements.some(element => element.download === "mv3-replay-share-safe-analysis-summary.md"));
  assert.ok(createdElements.some(element => element.download === "mv3-replay-share-safe-comparison-summary.md"));
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

