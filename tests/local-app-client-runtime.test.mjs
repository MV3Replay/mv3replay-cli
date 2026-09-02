import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.tagName = "DIV";
    this._textContent = "";
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.checked = false;
    this.files = [];
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.focused = false;
  }

  set textContent(value) {
    this._textContent = String(value);
    if (value === "") this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
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
    const handler = this.listeners.get("click");
    if (handler) return handler();
  }

  focus() {
    this.focused = true;
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
  const documentListeners = new Map();
  const documentElement = new FakeElement("html");
  const document = {
    body: new FakeElement("body"),
    documentElement,
    listeners: documentListeners,
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
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
  const printCalls = [];

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
    window: {
      print: () => { printCalls.push(true); },
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
    },
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
  return { elements, requests, createdElements, createdBlobs, documentListeners, printCalls, documentElement };
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

test("display preferences default to memory-only root attributes and update on change", async () => {
  const { elements, documentElement } = await createClientHarness();

  assert.equal(documentElement.getAttribute("data-theme"), "system");
  assert.equal(documentElement.getAttribute("data-density"), "comfortable");
  assert.equal(documentElement.getAttribute("data-text-size"), "normal");
  assert.equal(documentElement.getAttribute("data-reduced-motion"), "false");
  assert.equal(documentElement.getAttribute("data-high-contrast"), "false");

  const themeSelect = elements.get("preference-theme");
  themeSelect.value = "dark";
  themeSelect.listeners.get("change")();
  assert.equal(documentElement.getAttribute("data-theme"), "dark");

  const densitySelect = elements.get("preference-density");
  densitySelect.value = "compact";
  densitySelect.listeners.get("change")();
  assert.equal(documentElement.getAttribute("data-density"), "compact");

  const textSizeSelect = elements.get("preference-text-size");
  textSizeSelect.value = "large";
  textSizeSelect.listeners.get("change")();
  assert.equal(documentElement.getAttribute("data-text-size"), "large");

  const reducedMotionCheckbox = elements.get("preference-reduced-motion");
  reducedMotionCheckbox.checked = true;
  reducedMotionCheckbox.listeners.get("change")();
  assert.equal(documentElement.getAttribute("data-reduced-motion"), "true");

  const highContrastCheckbox = elements.get("preference-high-contrast");
  highContrastCheckbox.checked = true;
  highContrastCheckbox.listeners.get("change")();
  assert.equal(documentElement.getAttribute("data-high-contrast"), "true");

  assert.match(elements.get("display-preferences-status").textContent, /applied for this tab only/);
});

test("clear workspace resets display preferences to defaults", async () => {
  const { elements, documentElement } = await createClientHarness();

  const themeSelect = elements.get("preference-theme");
  themeSelect.value = "dark";
  themeSelect.listeners.get("change")();
  const highContrastCheckbox = elements.get("preference-high-contrast");
  highContrastCheckbox.checked = true;
  highContrastCheckbox.listeners.get("change")();

  elements.get("clear-workspace-button").listeners.get("click")();

  assert.equal(documentElement.getAttribute("data-theme"), "system");
  assert.equal(documentElement.getAttribute("data-high-contrast"), "false");
  assert.equal(themeSelect.value, "system");
  assert.equal(highContrastCheckbox.checked, false);
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

  const keyChangesContent = elements.get("compare-report-details").children[3].children[1];
  const sections = keyChangesContent.children
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
  const keyChangesContent = elements.get("compare-report-details").children[3].children[1];
  const sections = keyChangesContent.children
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

  const findingsSection = elements.get("report-details").children[4];
  const findings = findingsSection.children[1].children.filter(child => child.className === "finding");
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

test("dropping multiple files on the inspect drop zone fails locally with fixed accessible text", async () => {
  const { elements } = await createClientHarness();
  const zone = elements.get("manifest-file-field");
  const statusEl = elements.get("manifest-file-status");
  const event = {
    preventDefault() {},
    dataTransfer: { files: [{ name: "a.json", type: "application/json" }, { name: "b.json", type: "application/json" }] }
  };
  zone.listeners.get("drop")(event);
  assert.equal(statusEl.textContent, "Drop exactly one manifest.json file.");
  assert.equal(statusEl.attributes.get("data-status"), "invalid");
});

test("dropping a non-JSON file on a compare drop target fails locally with fixed accessible text", async () => {
  const { elements } = await createClientHarness();
  const zone = elements.get("previous-manifest-file-field");
  const statusEl = elements.get("previous-manifest-file-status");
  const event = {
    preventDefault() {},
    dataTransfer: { files: [{ name: "notes.txt", type: "text/plain" }] }
  };
  zone.listeners.get("drop")(event);
  assert.equal(statusEl.textContent, "Only a .json file can be dropped here.");
  assert.equal(statusEl.attributes.get("data-status"), "invalid");
});

test("dropping one manifest.json onto inspect or a compare target marks that input ready", async () => {
  const { elements } = await createClientHarness();
  const inspectZone = elements.get("manifest-file-field");
  const inspectStatus = elements.get("manifest-file-status");
  const inspectFile = { name: "manifest.json", type: "application/json" };
  inspectZone.listeners.get("drop")({ preventDefault() {}, dataTransfer: { files: [inspectFile] } });
  assert.equal(elements.get("manifest-file").files[0], inspectFile);
  assert.equal(inspectStatus.attributes.get("data-status"), "ready");

  const candidateZone = elements.get("candidate-manifest-file-field");
  const candidateStatus = elements.get("candidate-manifest-file-status");
  const candidateFile = { name: "manifest.json", type: "application/json" };
  candidateZone.listeners.get("drop")({ preventDefault() {}, dataTransfer: { files: [candidateFile] } });
  assert.equal(elements.get("candidate-manifest-file").files[0], candidateFile);
  assert.equal(candidateStatus.attributes.get("data-status"), "ready");
});

test("per-input status reflects empty, invalid, and ready selection states without any filename", async () => {
  const { elements } = await createClientHarness();
  const input = elements.get("manifest-file");
  const statusEl = elements.get("manifest-file-status");

  input.files = [];
  input.listeners.get("change")();
  assert.equal(statusEl.textContent, "No file selected.");
  assert.equal(statusEl.attributes.get("data-status"), "empty");

  input.files = [{ name: "secret-extension.txt", type: "text/plain" }];
  input.listeners.get("change")();
  assert.doesNotMatch(statusEl.textContent, /secret-extension/);
  assert.equal(statusEl.attributes.get("data-status"), "invalid");

  input.files = [{ name: "manifest.json", type: "application/json" }];
  input.listeners.get("change")();
  assert.doesNotMatch(statusEl.textContent, /manifest\.json/);
  assert.equal(statusEl.attributes.get("data-status"), "ready");
});

test("pasting JSON imports a manifest into inspect, clears the textarea, and never redisplays raw JSON", async () => {
  const { elements, requests } = await createClientHarness();
  elements.get("analyze-paste-button").listeners.get("click")();
  assert.equal(elements.get("paste-json-panel").hidden, false);

  const pasted = { manifest_version: 3, name: "n", version: "1", permissions: [] };
  elements.get("paste-json-textarea").value = JSON.stringify(pasted);
  await elements.get("paste-json-confirm").listeners.get("click")();

  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), pasted);
  assert.equal(elements.get("paste-json-textarea").value, "");
  assert.equal(elements.get("paste-json-panel").hidden, true);
  assert.equal(elements.get("report").hidden, false);
});

test("pasting invalid JSON fails locally with fixed accessible text and issues no request", async () => {
  const { elements, requests } = await createClientHarness();
  elements.get("analyze-paste-button").listeners.get("click")();
  elements.get("paste-json-textarea").value = "{not json";
  await elements.get("paste-json-confirm").listeners.get("click")();

  assert.equal(elements.get("paste-json-status").textContent, "The pasted text is not valid JSON.");
  assert.equal(requests.length, 0);
  assert.equal(elements.get("paste-json-panel").hidden, false);
});

test("pasting JSON into compare sides and swapping recomputes the comparison with sides reversed", async () => {
  const { elements, requests } = await createClientHarness();

  const previousManifest = { manifest_version: 3, name: "p", version: "1", permissions: [] };
  const candidateManifest = { manifest_version: 3, name: "c", version: "2", permissions: ["tabCapture"] };

  elements.get("analyze-paste-button").listeners.get("click")();
  elements.get("paste-json-target").value = "previous";
  elements.get("paste-json-textarea").value = JSON.stringify(previousManifest);
  await elements.get("paste-json-confirm").listeners.get("click")();
  assert.equal(elements.get("previous-manifest-file-status").attributes.get("data-status"), "ready");

  elements.get("analyze-paste-button").listeners.get("click")();
  elements.get("paste-json-target").value = "current";
  elements.get("paste-json-textarea").value = JSON.stringify(candidateManifest);
  await elements.get("paste-json-confirm").listeners.get("click")();
  assert.equal(elements.get("candidate-manifest-file-status").attributes.get("data-status"), "ready");

  await elements.get("compare-form").listeners.get("submit")({ preventDefault() {} });
  assert.equal(requests.length, 1);
  const firstPayload = JSON.parse(requests[0].options.body);
  assert.deepEqual(firstPayload.previous, previousManifest);
  assert.deepEqual(firstPayload.current, candidateManifest);
  assert.equal(elements.get("compare-report").hidden, false);

  await elements.get("swap-compare-button").listeners.get("click")();
  assert.equal(requests.length, 2);
  const secondPayload = JSON.parse(requests[1].options.body);
  assert.deepEqual(secondPayload.previous, candidateManifest);
  assert.deepEqual(secondPayload.current, previousManifest);
  assert.match(elements.get("compare-status").textContent, /Swapped/);
});

test("clear workspace removes selections, results, checklists, and transient status without reload", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();
  assert.equal(elements.get("report").hidden, false);
  assert.match(elements.get("checklist-progress").textContent, /completed/);

  elements.get("manifest-file").files = [{ name: "manifest.json", type: "application/json" }];
  elements.get("manifest-file").listeners.get("change")();

  elements.get("clear-workspace-button").listeners.get("click")();

  assert.equal(elements.get("report").hidden, true);
  assert.equal(elements.get("checklist-list").textContent, "");
  assert.equal(elements.get("checklist-progress").textContent, "");
  assert.equal(elements.get("checklist").hidden, true);
  assert.equal(elements.get("status").textContent, "");
  assert.equal(elements.get("manifest-file-status").textContent, "No file selected.");
  assert.equal(elements.get("manifest-file-status").attributes.get("data-status"), "empty");
  assert.match(elements.get("clear-workspace-status").textContent, /cleared/i);
});

test("finding search filters inspect and comparison findings by rendered text without mutating the report", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const findingsSection = elements.get("report-details").children[4];
  const search = elements.get("analysis-finding-search");
  search.value = "notification";
  search.listeners.get("input")();

  const findingNodes = findingsSection.children[1].children.filter(child => child.className === "finding");
  assert.equal(findingNodes.length, 2);
  assert.equal(findingNodes.filter(node => node.hidden).length, 1);
  assert.match(elements.get("analysis-filter-status").textContent, /1 finding shown \(all severities\)/);

  search.value = "";
  search.listeners.get("input")();
  assert.equal(findingNodes.filter(node => node.hidden).length, 0);
  assert.match(elements.get("analysis-filter-status").textContent, /2 findings shown \(all severities\)/);

  await elements.get("compare-example-button").listeners.get("click")();
  const compareSearch = elements.get("comparison-finding-search");
  compareSearch.value = "powerful";
  compareSearch.listeners.get("input")();
  assert.match(elements.get("comparison-filter-status").textContent, /1 finding shown \(all severities\)/);
});

test("collapsible result sections toggle individually and via expand/collapse-all with correct aria-expanded state", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const sections = elements.get("report-details").children;
  const [toggle, content] = sections[4].children;
  assert.equal(toggle.attributes.get("aria-expanded"), "true");
  assert.equal(content.hidden, false);

  toggle.listeners.get("click")();
  assert.equal(toggle.attributes.get("aria-expanded"), "false");
  assert.equal(content.hidden, true);

  elements.get("report-expand-all").listeners.get("click")();
  assert.equal(toggle.attributes.get("aria-expanded"), "true");
  assert.equal(content.hidden, false);

  elements.get("report-collapse-all").listeners.get("click")();
  for (const section of sections) {
    assert.equal(section.children[0].attributes.get("aria-expanded"), "false");
    assert.equal(section.children[1].hidden, true);
  }
});

test("comparison collapsible sections expand and collapse together", async () => {
  const { elements } = await createClientHarness();
  await elements.get("compare-example-button").listeners.get("click")();

  const sections = elements.get("compare-report-details").children;
  elements.get("compare-report-collapse-all").listeners.get("click")();
  for (const section of sections) {
    assert.equal(section.children[0].attributes.get("aria-expanded"), "false");
    assert.equal(section.children[1].hidden, true);
  }
  elements.get("compare-report-expand-all").listeners.get("click")();
  for (const section of sections) {
    assert.equal(section.children[0].attributes.get("aria-expanded"), "true");
    assert.equal(section.children[1].hidden, false);
  }
});

test("keyboard shortcuts focus inspect, compare, and search but never override a typing field, and Escape clears the workspace", async () => {
  const { elements, documentListeners } = await createClientHarness();
  const keydown = documentListeners.get("keydown");

  elements.get("manifest-file").focused = false;
  keydown({ key: "i", target: { tagName: "INPUT" } });
  assert.equal(elements.get("manifest-file").focused, false);

  keydown({ key: "i", target: { tagName: "BODY" } });
  assert.equal(elements.get("manifest-file").focused, true);

  keydown({ key: "c", target: { tagName: "BODY" } });
  assert.equal(elements.get("previous-manifest-file").focused, true);

  await elements.get("analyze-example-button").listeners.get("click")();
  keydown({ key: "/", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(elements.get("analysis-finding-search").focused, true);

  keydown({ key: "Escape", target: { tagName: "BODY" } });
  assert.equal(elements.get("report").hidden, true);
  assert.match(elements.get("clear-workspace-status").textContent, /cleared/i);
});

test("the print action only triggers the browser print flow, never a network request", async () => {
  const { elements, printCalls, requests } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();
  elements.get("print-report-button").listeners.get("click")();
  assert.equal(printCalls.length, 1);
  assert.equal(requests.length, 1);
});

test("keeps at most five in-memory recent run summaries, reruns from an already-held manifest, and clears on workspace clear", async () => {
  const { elements, requests } = await createClientHarness();
  for (let i = 0; i < 6; i += 1) {
    await elements.get("analyze-example-button").listeners.get("click")();
  }
  assert.equal(requests.length, 6);
  const items = elements.get("recent-runs-list").children;
  assert.equal(items.length, 5);
  assert.match(collectText(items[0]), /Inspect — lanes: 1, findings: 2/);
  assert.equal(elements.get("recent-runs").hidden, false);

  const rerunButton = items[0].children[1];
  await rerunButton.listeners.get("click")();
  assert.equal(requests.length, 7);

  elements.get("clear-workspace-button").listeners.get("click")();
  assert.equal(elements.get("recent-runs-list").children.length, 0);
  assert.equal(elements.get("recent-runs").hidden, true);
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

test("adding a custom checklist item enforces fixed length limits with accessible validation and stays memory-only", async () => {
  const { elements, requests } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const input = elements.get("checklist-add-input");
  const button = elements.get("checklist-add-button");
  const status = elements.get("checklist-add-status");

  input.value = "ab";
  button.listeners.get("click")();
  assert.match(status.textContent, /at least 3 characters/);
  assert.equal(elements.get("checklist-list").children.length, 1);

  input.value = "a".repeat(201);
  button.listeners.get("click")();
  assert.match(status.textContent, /200 characters or fewer/);
  assert.equal(elements.get("checklist-list").children.length, 1);

  input.value = "Verify custom permission dialog";
  button.listeners.get("click")();
  assert.match(status.textContent, /Custom check added/);
  assert.equal(elements.get("checklist-list").children.length, 2);
  assert.match(collectText(elements.get("checklist-list")), /Custom check: Verify custom permission dialog/);
  assert.equal(input.value, "");
  // Nothing about a custom item is ever sent over the network.
  assert.equal(requests.length, 1);
});

test("only custom checklist items expose edit and delete controls; built-in text stays immutable", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const input = elements.get("checklist-add-input");
  input.value = "Custom check about storage quota";
  elements.get("checklist-add-button").listeners.get("click")();

  const list = elements.get("checklist-list");
  const builtInItem = list.children[0];
  const customItem = list.children[1];

  const builtInControls = builtInItem.children[2];
  assert.ok(!builtInControls.children.some(child => child.textContent === "Edit"));
  assert.ok(!builtInControls.children.some(child => child.textContent === "Delete"));

  const customControls = customItem.children[2];
  const editButton = customControls.children.find(child => child.textContent === "Edit");
  const deleteButton = customControls.children.find(child => child.textContent === "Delete");
  assert.ok(editButton);
  assert.ok(deleteButton);

  editButton.listeners.get("click")();
  const inlineInput = customItem.children.find(child => child.tagName === undefined || child.value === "Custom check about storage quota");
  assert.ok(inlineInput);
  inlineInput.value = "Updated custom check text";
  const saveButton = customItem.children.find(child => child.textContent === "Save");
  saveButton.listeners.get("click")();
  assert.match(collectText(customItem), /Custom check: Updated custom check text/);
});

test("deleting a custom checklist item requires a local confirm step and never calls a browser dialog", async () => {
  const { elements } = await createClientHarness();
  const source = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.confirm|[^.]confirm\(/);

  await elements.get("analyze-example-button").listeners.get("click")();
  const input = elements.get("checklist-add-input");
  input.value = "Custom check to delete";
  elements.get("checklist-add-button").listeners.get("click")();

  const list = elements.get("checklist-list");
  assert.equal(list.children.length, 2);
  const customItem = list.children[1];
  const controls = customItem.children[2];
  const deleteButton = controls.children.find(child => child.textContent === "Delete");
  const confirmWrap = controls.children.find(child => child.className === "checklist-delete-confirm");

  deleteButton.listeners.get("click")();
  assert.equal(confirmWrap.hidden, false);
  assert.equal(list.children.length, 2);

  const cancelButton = confirmWrap.children.find(child => child.textContent === "Cancel");
  cancelButton.listeners.get("click")();
  assert.equal(list.children.length, 2);

  deleteButton.listeners.get("click")();
  const confirmButton = confirmWrap.children.find(child => child.textContent === "Confirm delete");
  confirmButton.listeners.get("click")();
  assert.equal(elements.get("checklist-list").children.length, 1);
});

test("checklist items move up and down with disabled boundary controls and a stable completion state", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const input = elements.get("checklist-add-input");
  input.value = "Second custom check for ordering";
  elements.get("checklist-add-button").listeners.get("click")();

  const list = elements.get("checklist-list");
  const first = list.children[0];
  const second = list.children[1];

  const firstControls = first.children[2];
  const secondControls = second.children[2];
  const firstUp = firstControls.children.find(child => child.textContent === "Move up");
  const firstDown = firstControls.children.find(child => child.textContent === "Move down");
  const secondUp = secondControls.children.find(child => child.textContent === "Move up");
  const secondDown = secondControls.children.find(child => child.textContent === "Move down");

  assert.equal(firstUp.disabled, true);
  assert.equal(secondDown.disabled, true);

  const secondCheckbox = second.children[0];
  secondCheckbox.checked = true;
  secondCheckbox.listeners.get("change")();

  secondUp.listeners.get("click")();

  const reordered = elements.get("checklist-list").children;
  assert.equal(reordered[0], second);
  assert.equal(reordered[1], first);
  assert.equal(reordered[0].children[0].checked, true);
  assert.equal(reordered[0].children[2].children.find(child => child.textContent === "Move up").disabled, true);
  assert.equal(reordered[1].children[2].children.find(child => child.textContent === "Move down").disabled, true);
  void firstDown; void secondDown;
});

test("private local notes appear in private exports but never in share-safe summaries, and clear with the workspace", async () => {
  const { elements, createdBlobs } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const item = elements.get("checklist-list").children[0];
  const controls = item.children[2];
  const noteToggle = controls.children.find(child => child.textContent === "Add private note");
  noteToggle.listeners.get("click")();
  const noteWrap = item.children[item.children.length - 1];
  const noteTextarea = noteWrap.children.find(child => child.tagName === "TEXTAREA" || typeof child.value === "string" && child.id && child.id.endsWith("-note"));
  noteTextarea.value = "PRIVATE_LOCAL_NOTE";
  noteTextarea.listeners.get("input")();

  elements.get("export-checklist").listeners.get("click")();
  elements.get("export-analysis-safe-summary").listeners.get("click")();

  assert.equal(createdBlobs.length, 2);
  const [jsonExport, safeSummary] = await Promise.all(createdBlobs.map(blob => blob.text()));
  assert.match(jsonExport, /PRIVATE_LOCAL_NOTE/);
  assert.doesNotMatch(safeSummary, /PRIVATE_LOCAL_NOTE/);

  elements.get("clear-workspace-button").listeners.get("click")();
  assert.equal(elements.get("checklist-list").textContent, "");
});

test("the candidate comparison checklist supports the same add, move, and note interactions", async () => {
  const { elements } = await createClientHarness();
  await elements.get("compare-example-button").listeners.get("click")();

  const input = elements.get("candidate-checklist-add-input");
  input.value = "Candidate-only custom regression check";
  elements.get("candidate-checklist-add-button").listeners.get("click")();
  assert.match(elements.get("candidate-checklist-add-status").textContent, /Custom check added/);

  const list = elements.get("candidate-checklist-list");
  const addedIndex = list.children.length - 1;
  const customItem = list.children[addedIndex];
  const customControls = customItem.children[2];
  assert.ok(customControls.children.some(child => child.textContent === "Edit"));
  assert.ok(customControls.children.some(child => child.textContent === "Delete"));

  const up = customControls.children.find(child => child.textContent === "Move up");
  up.listeners.get("click")();
  assert.notEqual(elements.get("candidate-checklist-list").children[addedIndex], customItem);
});

test("pinning an inspect finding sorts it first, keeps accessible state, and never mutates report order", async () => {
  const { elements, createdBlobs } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const findingsContent = elements.get("report-details").children[4].children[1];
  const [broadHost, notification] = findingsContent.children;
  const notificationPin = notification.children[2].children[0];

  assert.equal(notificationPin.getAttribute("aria-pressed"), "false");
  notificationPin.listeners.get("click")();
  assert.equal(notificationPin.getAttribute("aria-pressed"), "true");
  assert.equal(notificationPin.textContent, "Unpin");
  assert.equal(findingsContent.children[0], notification);
  assert.equal(findingsContent.children[1], broadHost);

  elements.get("export-checklist").listeners.get("click")();
  const [jsonExport] = await Promise.all(createdBlobs.map(blob => blob.text()));
  const payload = JSON.parse(jsonExport);
  assert.deepEqual(payload.report.riskFlags.map(flag => flag.id), ["broad-host", "notification"]);

  notificationPin.listeners.get("click")();
  assert.equal(notificationPin.textContent, "Pin");
});

test("acknowledging every critical inspect finding distinguishes acknowledged from resolved readiness", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const findingsContent = elements.get("report-details").children[4].children[1];
  const broadHost = findingsContent.children[0];
  const ackButton = broadHost.children[2].children[1];

  assert.match(collectText(elements.get("analysis-readiness")), /Review required/);
  ackButton.listeners.get("click")();
  assert.equal(ackButton.getAttribute("aria-pressed"), "true");
  assert.match(collectText(elements.get("analysis-readiness")), /Critical findings acknowledged/);
  assert.doesNotMatch(collectText(elements.get("analysis-readiness")), /Ready for manual browser testing/);

  ackButton.listeners.get("click")();
  assert.match(collectText(elements.get("analysis-readiness")), /Review required/);
});

test("a private finding note appears only in private exports, never in share-safe summaries", async () => {
  const { elements, createdBlobs } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const findingsContent = elements.get("report-details").children[4].children[1];
  const broadHost = findingsContent.children[0];
  const noteToggle = broadHost.children[2].children[2];
  noteToggle.listeners.get("click")();
  const noteTextarea = broadHost.children[3].children[1];
  noteTextarea.value = "PRIVATE_FINDING_TRIAGE_NOTE";
  noteTextarea.listeners.get("input")();

  elements.get("export-checklist-markdown").listeners.get("click")();
  elements.get("export-analysis-safe-summary").listeners.get("click")();
  assert.equal(createdBlobs.length, 2);
  const [markdownExport, safeSummary] = await Promise.all(createdBlobs.map(blob => blob.text()));
  assert.match(markdownExport, /PRIVATE\\_FINDING\\_TRIAGE\\_NOTE/);
  assert.doesNotMatch(safeSummary, /PRIVATE_FINDING_TRIAGE_NOTE/);
});

test("triage filters show fixed all/pinned/unacknowledged/acknowledged counts without changing report data", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const findingsContent = elements.get("report-details").children[4].children[1];
  const [broadHost, notification] = findingsContent.children;
  notification.children[2].children[0].listeners.get("click")(); // pin notification
  broadHost.children[2].children[1].listeners.get("click")(); // acknowledge broadHost

  const triageFilter = elements.get("analysis-triage-filter");
  const triageStatus = elements.get("analysis-triage-filter-status");

  triageFilter.value = "pinned";
  triageFilter.listeners.get("change")();
  assert.match(triageStatus.textContent, /1 of 2 findings shown \(pinned\)/);
  assert.equal(broadHost.hidden, true);
  assert.equal(notification.hidden, false);

  triageFilter.value = "acknowledged";
  triageFilter.listeners.get("change")();
  assert.match(triageStatus.textContent, /1 of 2 findings shown \(acknowledged\)/);

  triageFilter.value = "unacknowledged";
  triageFilter.listeners.get("change")();
  assert.match(triageStatus.textContent, /1 of 2 findings shown \(unacknowledged\)/);

  triageFilter.value = "all";
  triageFilter.listeners.get("change")();
  assert.match(triageStatus.textContent, /2 of 2 findings shown \(all\)/);
});

test("resetting triage clears pins, acknowledgements, and notes for the current inspect result", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();

  const findingsContent = elements.get("report-details").children[4].children[1];
  const broadHost = findingsContent.children[0];
  const pinButton = broadHost.children[2].children[0];
  const ackButton = broadHost.children[2].children[1];
  const noteToggle = broadHost.children[2].children[2];
  pinButton.listeners.get("click")();
  ackButton.listeners.get("click")();
  noteToggle.listeners.get("click")();
  const noteTextarea = broadHost.children[3].children[1];
  noteTextarea.value = "temporary note";
  noteTextarea.listeners.get("input")();

  elements.get("reset-analysis-triage").listeners.get("click")();

  assert.equal(pinButton.textContent, "Pin");
  assert.equal(pinButton.getAttribute("aria-pressed"), "false");
  assert.equal(ackButton.textContent, "Acknowledge");
  assert.equal(ackButton.getAttribute("aria-pressed"), "false");
  assert.equal(noteTextarea.value, "");
  assert.equal(elements.get("analysis-triage-filter").value, "all");
  assert.match(collectText(elements.get("analysis-readiness")), /Review required/);
});

test("running a new analysis and clearing the workspace both clear inspect finding triage state", async () => {
  const { elements } = await createClientHarness();
  await elements.get("analyze-example-button").listeners.get("click")();
  let findingsContent = elements.get("report-details").children[4].children[1];
  findingsContent.children[0].children[2].children[0].listeners.get("click")(); // pin

  await elements.get("analyze-example-button").listeners.get("click")();
  findingsContent = elements.get("report-details").children[4].children[1];
  assert.equal(findingsContent.children[0].children[2].children[0].textContent, "Pin");

  findingsContent.children[0].children[2].children[0].listeners.get("click")(); // pin again
  elements.get("clear-workspace-button").listeners.get("click")();
  assert.equal(elements.get("report").hidden, true);

  await elements.get("analyze-example-button").listeners.get("click")();
  findingsContent = elements.get("report-details").children[4].children[1];
  assert.equal(findingsContent.children[0].children[2].children[0].textContent, "Pin");
});

test("compare findings support the same pin, acknowledge, private note, filter, and reset interactions", async () => {
  const { elements, createdBlobs } = await createClientHarness();
  await elements.get("compare-example-button").listeners.get("click")();

  const findingsContent = elements.get("compare-report-details").children[2].children[1];
  const finding = findingsContent.children[0];
  const pinButton = finding.children[2].children[0];
  const ackButton = finding.children[2].children[1];
  const noteToggle = finding.children[2].children[2];

  pinButton.listeners.get("click")();
  assert.equal(pinButton.textContent, "Unpin");
  assert.match(collectText(elements.get("comparison-readiness")), /Update-path validation required/);

  ackButton.listeners.get("click")();
  assert.match(collectText(elements.get("comparison-readiness")), /Critical comparison findings acknowledged/);

  noteToggle.listeners.get("click")();
  const noteTextarea = finding.children[3].children[1];
  noteTextarea.value = "PRIVATE_COMPARISON_TRIAGE_NOTE";
  noteTextarea.listeners.get("input")();

  elements.get("export-comparison").listeners.get("click")();
  elements.get("export-comparison-safe-summary").listeners.get("click")();
  const [jsonExport, safeSummary] = await Promise.all(createdBlobs.map(blob => blob.text()));
  assert.match(jsonExport, /PRIVATE_COMPARISON_TRIAGE_NOTE/);
  assert.doesNotMatch(safeSummary, /PRIVATE_COMPARISON_TRIAGE_NOTE/);

  const triageFilter = elements.get("comparison-triage-filter");
  triageFilter.value = "pinned";
  triageFilter.listeners.get("change")();
  assert.match(elements.get("comparison-triage-filter-status").textContent, /1 of 1 finding shown \(pinned\)/);

  elements.get("reset-comparison-triage").listeners.get("click")();
  assert.equal(pinButton.textContent, "Pin");
  assert.equal(ackButton.textContent, "Acknowledge");
  assert.equal(noteTextarea.value, "");
  assert.match(collectText(elements.get("comparison-readiness")), /Update-path validation required/);
});

