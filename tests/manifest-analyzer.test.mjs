import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeManifest, compareManifests } from "../src/manifest-analyzer.mjs";

const CLI_PATH = path.resolve("src/cli.mjs");
const FIXTURE_ROOT = path.resolve("fixtures");
const MAX_MANIFEST_BYTES = 1024 * 1024;

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

async function readFixtureManifest(fixture) {
  const file = path.join(FIXTURE_ROOT, fixture, "manifest.json");
  return JSON.parse(await readFile(file, "utf8"));
}

const richManifest = {
  manifest_version: 3,
  name: "Fixture extension",
  version: "1.2.3",
  permissions: ["storage", "tabs"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "worker.js", type: "module" },
  action: { default_popup: "popup.html" },
  options_ui: { page: "options.html" },
  side_panel: { default_path: "side-panel.html" },
  chrome_url_overrides: { newtab: "newtab.html" },
  chrome_settings_overrides: { homepage: "https://example.test/home" },
  commands: { _execute_action: { suggested_key: { default: "Ctrl+Shift+Y" } } },
  declarative_net_request: { rule_resources: [{ id: "base", enabled: true, path: "rules.json" }] },
  web_accessible_resources: [{ resources: ["injected.js"], matches: ["<all_urls>"] }],
  externally_connectable: { matches: ["https://example.com/*"] },
  content_scripts: [{
    matches: ["https://example.com/*"],
    js: ["content.js"],
    all_frames: true,
    world: "MAIN"
  }]
};

test("builds a deterministic plan from MV3 surfaces", () => {
  const first = analyzeManifest(richManifest);
  const second = analyzeManifest(structuredClone(richManifest));

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.surfaces.action, true);
  assert.equal(first.surfaces.actionPopup, true);
  assert.equal(first.surfaces.optionsPage, true);
  assert.equal(first.surfaces.serviceWorker, true);
  assert.equal(first.surfaces.contentScripts, 1);
  assert.equal(first.surfaces.storage, true);
  assert.equal(first.surfaces.chromeUrlOverrides, true);
  assert.equal(first.surfaces.chromeSettingsOverrides, true);
  assert.deepEqual(first.privacy, {
    localOnly: true,
    sourceFilesRead: false,
    browserConnected: false,
    dataUploaded: false
  });

  const laneIds = first.lanes.map(lane => lane.id);
  assert.ok(laneIds.includes("host-page-safety"));
  assert.ok(laneIds.includes("service-worker-lifecycle"));
  assert.ok(laneIds.includes("storage-persistence"));
  assert.ok(laneIds.includes("permission-boundaries"));
  assert.ok(laneIds.includes("keyboard-commands"));
  assert.ok(laneIds.includes("network-rules"));
  assert.ok(laneIds.includes("web-accessible-resources"));
  assert.ok(laneIds.includes("external-messaging"));
  assert.ok(laneIds.includes("browser-page-override"));
  assert.ok(laneIds.includes("browser-settings-override"));

  const riskIds = first.riskFlags.map(flag => flag.id);
  assert.ok(riskIds.includes("broad-host-scope"));
  assert.ok(riskIds.includes("all-frames"));
  assert.ok(riskIds.includes("main-world"));
  assert.ok(riskIds.includes("ephemeral-worker"));
  assert.ok(riskIds.includes("broad-web-accessible-resources"));
  assert.ok(riskIds.includes("browser-page-override"));
  assert.ok(riskIds.includes("browser-settings-override"));
});

test("detects lifecycle and trust-boundary surfaces", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Boundaries",
    version: "1.0.0",
    permissions: ["offscreen", "notifications", "tabCapture"],
    optional_permissions: ["storage"],
    incognito: "split",
    externally_connectable: { matches: ["<all_urls>"] },
    content_scripts: [{
      matches: ["https://example.com/*"],
      js: ["content.js"],
      match_origin_as_fallback: true
    }]
  });

  const laneIds = report.lanes.map(lane => lane.id);
  assert.ok(laneIds.includes("offscreen-document"));
  assert.ok(laneIds.includes("notifications"));
  assert.ok(laneIds.includes("tab-capture"));
  assert.ok(laneIds.includes("optional-permissions"));
  assert.ok(laneIds.includes("incognito-boundary"));

  const riskIds = report.riskFlags.map(flag => flag.id);
  assert.ok(riskIds.includes("required-tab-capture"));
  assert.ok(riskIds.includes("externally-connectable-all-urls-invalid"));
  assert.ok(riskIds.includes("derived-frame-matching"));
});

test("compares release manifests and gates required-access expansion", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    permissions: ["storage"],
    host_permissions: ["https://example.com/*"],
    background: { service_worker: "old-worker.js" }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    permissions: ["storage", "tabCapture"],
    host_permissions: ["https://example.com/*", "https://app.example.net/*"],
    background: { service_worker: "new-worker.js" }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.requiredPermissions.added, ["tabCapture"]);
  assert.deepEqual(report.changes.requiredHosts.added, ["https://app.example.net/*"]);
  assert.equal(report.requiresManualUpdateValidation, true);
  assert.deepEqual(report.findings.map(item => item.id), [
    "required-permission-expansion",
    "required-host-expansion",
    "service-worker-entry-change"
  ]);
});

test("builds privacy-preserving lanes for browser data and request access", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Sensitive browser data",
    version: "1.0.0",
    permissions: [
      "cookies", "history", "bookmarks", "webRequest", "webRequestBlocking",
      "browsingData", "tabs", "topSites", "webNavigation"
    ],
    host_permissions: ["https://synthetic.example.test/*"]
  });

  assert.equal(report.surfaces.cookies, true);
  assert.equal(report.surfaces.historyAccess, true);
  assert.equal(report.surfaces.bookmarksAccess, true);
  assert.equal(report.surfaces.webRequestAccess, true);
  assert.equal(report.surfaces.browsingDataAccess, true);
  assert.equal(report.surfaces.navigationMetadataAccess, true);
  const laneIds = report.lanes.map(lane => lane.id);
  assert.ok(laneIds.includes("cookie-boundary"));
  assert.ok(laneIds.includes("history-boundary"));
  assert.ok(laneIds.includes("bookmarks-boundary"));
  assert.ok(laneIds.includes("web-request-boundary"));
  assert.ok(laneIds.includes("browsing-data-removal"));
  assert.ok(laneIds.includes("navigation-metadata"));
  const riskIds = report.riskFlags.map(flag => flag.id);
  assert.ok(riskIds.includes("required-cookie-access"));
  assert.ok(riskIds.includes("required-history-access"));
  assert.ok(riskIds.includes("required-bookmarks-access"));
  assert.ok(riskIds.includes("required-web-request-access"));
  assert.ok(riskIds.includes("mv3-web-request-blocking"));
  assert.ok(riskIds.includes("required-browsing-data-removal"));
  assert.ok(riskIds.includes("required-navigation-metadata"));
  assert.ok(report.lanes.every(lane => !lane.checks.some(check => /real|personal/i.test(check))));
});

test("builds a toolbar-action lane when no popup is declared", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Click action",
    version: "1.0.0",
    action: {
      default_title: "Run the extension",
      default_icon: { "16": "icon-16.png", "32": "icon-32.png" }
    }
  });

  assert.equal(report.surfaces.action, true);
  assert.equal(report.surfaces.actionPopup, false);
  assert.ok(report.lanes.some(lane => lane.id === "toolbar-action"));
  assert.ok(!report.lanes.some(lane => lane.id === "action-popup"));
});

function baseManifest(background) {
  return {
    manifest_version: 3,
    name: "Background validation",
    version: "1.0.0",
    ...(background === undefined ? {} : { background })
  };
}

test("treats an absent background key as valid", () => {
  const report = analyzeManifest(baseManifest());
  assert.equal(report.surfaces.serviceWorker, false);
  assert.ok(!report.riskFlags.some(flag => flag.id === "background-service-worker-invalid"));
});

test("accepts a valid classic MV3 service worker", () => {
  const report = analyzeManifest(baseManifest({ service_worker: "worker.js" }));
  assert.equal(report.surfaces.serviceWorker, true);
  assert.ok(report.lanes.some(lane => lane.id === "service-worker-lifecycle"));
  assert.ok(!report.riskFlags.some(flag => flag.id === "background-service-worker-invalid"));
});

test("accepts a valid module MV3 service worker", () => {
  const report = analyzeManifest(baseManifest({ service_worker: "worker.js", type: "module" }));
  assert.equal(report.surfaces.serviceWorker, true);
  assert.ok(!report.riskFlags.some(flag => flag.id === "background-service-worker-invalid"));
});

for (const [label, background] of [
  ["non-object background", "worker.js"],
  ["empty background object", {}],
  ["missing service_worker", { type: "module" }],
  ["empty service_worker string", { service_worker: "" }],
  ["non-string service_worker", { service_worker: 42 }],
  ["MV2 scripts field", { service_worker: "worker.js", scripts: ["bg.js"] }],
  ["MV2 persistent field", { service_worker: "worker.js", persistent: false }],
  ["absolute worker path", { service_worker: "/worker.js" }],
  ["parent-traversal worker path", { service_worker: "../worker.js" }],
  ["unsupported type value", { service_worker: "worker.js", type: "classic" }]
]) {
  test(`rejects malformed MV3 background declaration: ${label}`, () => {
    const report = analyzeManifest(baseManifest(background));
    assert.equal(report.surfaces.serviceWorker, false);
    assert.ok(!report.lanes.some(lane => lane.id === "service-worker-lifecycle"));
    const flag = report.riskFlags.find(item => item.id === "background-service-worker-invalid");
    assert.ok(flag);
    assert.equal(flag.level, "critical");
  });
}

test("validates action popup entry points", () => {
  const base = { manifest_version: 3, name: "UI fixture", version: "1.0.0" };
  for (const action of [undefined, {}, { default_title: "Open", default_popup: "ui/popup.html" }]) {
    const report = analyzeManifest(action === undefined ? base : { ...base, action });
    assert.ok(!report.riskFlags.some(flag => flag.id === "action-popup-invalid"));
  }
  for (const action of [
    "popup.html",
    { default_title: 42 },
    { default_popup: "" },
    { default_popup: "/popup.html" },
    { default_popup: ["..", "popup.html"].join("/") }
  ]) {
    const report = analyzeManifest({ ...base, action });
    assert.ok(report.riskFlags.some(flag => flag.id === "action-popup-invalid" && flag.level === "critical"));
  }
});

test("validates options page entry points", () => {
  const base = { manifest_version: 3, name: "Options fixture", version: "1.0.0" };
  for (const declaration of [
    { options_page: "ui/options.html" },
    { options_ui: { page: "ui/options.html" } },
    { options_ui: { page: "ui/options.html", open_in_tab: false } }
  ]) {
    const report = analyzeManifest({ ...base, ...declaration });
    assert.ok(report.surfaces.optionsPage);
    assert.ok(!report.riskFlags.some(flag => flag.id === "options-declaration-invalid"));
  }
  for (const declaration of [
    { options_page: "" },
    { options_page: "/options.html" },
    { options_page: ["..", "options.html"].join("/") },
    { options_ui: "options.html" },
    { options_ui: {} },
    { options_ui: { page: "/options.html" } },
    { options_ui: { page: "options.html", open_in_tab: "no" } }
  ]) {
    const report = analyzeManifest({ ...base, ...declaration });
    assert.ok(report.riskFlags.some(flag => flag.id === "options-declaration-invalid" && flag.level === "critical"));
  }
});

test("validates default side-panel entry points", () => {
  const base = { manifest_version: 3, name: "Panel fixture", version: "1.0.0" };
  const valid = analyzeManifest({ ...base, side_panel: { default_path: "ui/panel.html" } });
  assert.ok(valid.surfaces.sidePanel);
  assert.ok(valid.lanes.some(lane => lane.id === "side-panel"));
  assert.ok(!valid.riskFlags.some(flag => flag.id === "side-panel-invalid"));

  for (const side_panel of [
    "panel.html",
    {},
    { default_path: "" },
    { default_path: "/panel.html" },
    { default_path: ["..", "panel.html"].join("/") }
  ]) {
    const report = analyzeManifest({ ...base, side_panel });
    assert.ok(report.riskFlags.some(flag => flag.id === "side-panel-invalid" && flag.level === "critical"));
  }
});

test("validates devtools_page entry points without reading HTML files", () => {
  const base = { manifest_version: 3, name: "DevTools fixture", version: "1.0.0" };

  const absent = analyzeManifest(base);
  assert.ok(!absent.riskFlags.some(flag => flag.id === "devtools-page-invalid"));

  const valid = analyzeManifest({ ...base, devtools_page: "ui/devtools.html" });
  assert.ok(valid.surfaces.devtoolsPage);
  assert.ok(valid.lanes.some(lane => lane.id === "devtools"));
  assert.ok(!valid.riskFlags.some(flag => flag.id === "devtools-page-invalid"));

  for (const devtools_page of [
    "",
    "/devtools.html",
    ["..", "devtools.html"].join("/")
  ]) {
    const report = analyzeManifest({ ...base, devtools_page });
    assert.ok(report.riskFlags.some(flag => flag.id === "devtools-page-invalid" && flag.level === "critical"));
  }
});

test("validates omnibox keyword declarations", () => {
  const base = { manifest_version: 3, name: "Omnibox fixture", version: "1.0.0" };

  const absent = analyzeManifest(base);
  assert.ok(!absent.riskFlags.some(flag => flag.id === "omnibox-invalid"));

  const valid = analyzeManifest({ ...base, omnibox: { keyword: "go" } });
  assert.ok(valid.surfaces.omnibox);
  assert.ok(valid.lanes.some(lane => lane.id === "omnibox-input"));
  assert.ok(!valid.riskFlags.some(flag => flag.id === "omnibox-invalid"));

  for (const omnibox of [
    "go",
    [],
    {},
    { keyword: "" },
    { keyword: 42 },
    { keyword: "go", extra: true }
  ]) {
    const report = analyzeManifest({ ...base, omnibox });
    assert.ok(report.riskFlags.some(flag => flag.id === "omnibox-invalid" && flag.level === "critical"));
  }
});

test("validates chrome_url_overrides declarations without reading HTML files", () => {
  const base = { manifest_version: 3, name: "Override fixture", version: "1.0.0" };

  const absent = analyzeManifest(base);
  assert.ok(!absent.riskFlags.some(flag => flag.id === "browser-page-overrides-invalid"));

  for (const page of ["bookmarks", "history", "newtab"]) {
    const report = analyzeManifest({ ...base, chrome_url_overrides: { [page]: `${page}.html` } });
    assert.ok(!report.riskFlags.some(flag => flag.id === "browser-page-overrides-invalid"), page);
    assert.ok(report.surfaces.chromeUrlOverrides);
    assert.ok(report.lanes.some(lane => lane.id === "browser-page-override"));
  }

  for (const chrome_url_overrides of [
    "newtab.html",
    [],
    {},
    { bookmarks: "bookmarks.html", history: "history.html" },
    { unsupported: "custom.html" },
    { newtab: "" },
    { newtab: "/newtab.html" },
    { newtab: ["..", "newtab.html"].join("/") }
  ]) {
    const report = analyzeManifest({ ...base, chrome_url_overrides });
    assert.ok(report.riskFlags.some(flag => flag.id === "browser-page-overrides-invalid" && flag.level === "critical"), JSON.stringify(chrome_url_overrides));
  }
});

test("validates sandbox page declarations without reading page files", () => {
  const base = { manifest_version: 3, name: "Sandbox fixture", version: "1.0.0" };
  for (const sandbox of [
    { pages: ["sandbox/frame.html"] },
    { pages: ["one.html", "two.html"], content_security_policy: "sandbox allow-scripts" }
  ]) {
    const report = analyzeManifest({ ...base, sandbox });
    assert.ok(report.surfaces.sandboxPages);
    assert.ok(!report.riskFlags.some(flag => flag.id === "sandbox-invalid"));
  }
  for (const sandbox of [
    "sandbox.html", {}, { pages: [] }, { pages: [""] }, { pages: [42] },
    { pages: ["/sandbox.html"] },
    { pages: [["..", "sandbox.html"].join("/")] },
    { pages: ["same.html", "same.html"] },
    { pages: ["sandbox.html"], content_security_policy: "" },
    { pages: ["sandbox.html"], content_security_policy: 42 }
  ]) {
    const report = analyzeManifest({ ...base, sandbox });
    assert.ok(report.riskFlags.some(flag => flag.id === "sandbox-invalid" && flag.level === "critical"));
  }
});

test("validates default locale declarations without reading locale files", () => {
  const base = { manifest_version: 3, name: "Locale fixture", version: "1.0.0" };
  for (const default_locale of ["en", "en_US", "es_419", "pt_BR"]) {
    const report = analyzeManifest({ ...base, default_locale });
    assert.ok(!report.riskFlags.some(flag => flag.id === "default-locale-invalid"));
  }
  for (const default_locale of ["", 42, "english", "en-US", "e", "en_US_extra"]) {
    const report = analyzeManifest({ ...base, default_locale });
    assert.ok(report.riskFlags.some(flag => flag.id === "default-locale-invalid" && flag.level === "critical"));
  }
});

test("requires a valid default locale for localized manifest placeholders", () => {
  const localized = {
    manifest_version: 3,
    name: "__MSG_extension_name__",
    description: "__MSG_extension_description__",
    version: "1.0.0"
  };
  const missing = analyzeManifest(localized);
  assert.ok(missing.riskFlags.some(flag => flag.id === "localized-placeholders-without-default-locale"));
  const valid = analyzeManifest({ ...localized, default_locale: "en_US" });
  assert.ok(!valid.riskFlags.some(flag => flag.id === "localized-placeholders-without-default-locale"));
  assert.ok(!JSON.stringify(valid).includes("extension_description"));
});

test("validates oauth2 declarations without exposing client identifiers", () => {
  const marker = "private-client-marker.apps.example.invalid";
  const base = { manifest_version: 3, name: "Identity fixture", version: "1.0.0" };
  const valid = analyzeManifest({
    ...base,
    oauth2: { client_id: marker, scopes: ["openid", "profile"] }
  });
  assert.ok(valid.surfaces.identityAccess);
  assert.ok(!valid.riskFlags.some(flag => flag.id === "oauth2-declaration-invalid"));
  assert.ok(!JSON.stringify(valid).includes(marker));

  for (const oauth2 of [
    "client", {}, { client_id: "", scopes: ["openid"] },
    { client_id: marker }, { client_id: marker, scopes: [] },
    { client_id: marker, scopes: [""] },
    { client_id: marker, scopes: ["openid", 42] },
    { client_id: marker, scopes: ["openid", "openid"] }
  ]) {
    const report = analyzeManifest({ ...base, oauth2 });
    assert.ok(report.riskFlags.some(flag => flag.id === "oauth2-declaration-invalid" && flag.level === "critical"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
});

test("validates cross-origin policy declarations without exposing values", () => {
  const marker = "private-policy-marker";
  const base = { manifest_version: 3, name: "Isolation fixture", version: "1.0.0" };
  const absent = analyzeManifest(base);
  assert.ok(!absent.riskFlags.some(flag => flag.id.includes("cross-origin") && flag.id.endsWith("invalid")));

  for (const field of ["cross_origin_embedder_policy", "cross_origin_opener_policy"]) {
    const valid = analyzeManifest({ ...base, [field]: { value: marker } });
    assert.ok(!valid.riskFlags.some(flag => flag.id === `${field.replaceAll("_", "-")}-invalid`));
    assert.ok(!JSON.stringify(valid).includes(marker));

    for (const value of [marker, [], {}, { value: "" }, { value: 42 }, { value: marker, extra: true }]) {
      const report = analyzeManifest({ ...base, [field]: value });
      assert.ok(report.riskFlags.some(flag => flag.id === `${field.replaceAll("_", "-")}-invalid` && flag.level === "critical"));
      assert.ok(!JSON.stringify(report).includes(marker));
    }
  }
});

test("validates managed storage schema paths without reading or exposing them", () => {
  const marker = "private/schema-marker.json";
  const base = { manifest_version: 3, name: "Managed storage fixture", version: "1.0.0" };
  for (const storage of [{}, { managed_schema: marker }]) {
    const report = analyzeManifest({ ...base, storage });
    assert.ok(!report.riskFlags.some(flag => flag.id === "storage-declaration-invalid" || flag.id === "managed-storage-schema-path-invalid"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }

  for (const storage of ["schema.json", [], null]) {
    const report = analyzeManifest({ ...base, storage });
    assert.ok(report.riskFlags.some(flag => flag.id === "storage-declaration-invalid" && flag.level === "critical"));
  }
  for (const managed_schema of ["", 42, "/schema.json", ["..", "schema.json"].join("/")]) {
    const report = analyzeManifest({ ...base, storage: { managed_schema } });
    assert.ok(report.riskFlags.some(flag => flag.id === "managed-storage-schema-path-invalid" && flag.level === "critical"));
  }
});

test("validates graphics requirements without exposing feature values", () => {
  const base = { manifest_version: 3, name: "Requirements fixture", version: "1.0.0" };
  for (const requirements of [{}, { "3D": { features: ["webgl"] } }, { "3D": { features: ["css3d", "webgl"] } }]) {
    const report = analyzeManifest({ ...base, requirements });
    assert.ok(!report.riskFlags.some(flag => flag.id === "requirements-declaration-invalid"));
    assert.ok(report.lanes.some(lane => lane.id === "hardware-requirements"));
  }
  for (const requirements of [null, [], "webgl", { plugins: {} }, { "3D": null }, { "3D": {} },
    { "3D": { features: [] } }, { "3D": { features: ["webgl", "webgl"] } }, { "3D": { features: ["private-feature-marker"] } }]) {
    const report = analyzeManifest({ ...base, requirements });
    assert.ok(report.riskFlags.some(flag => flag.id === "requirements-declaration-invalid" && flag.level === "critical"));
    assert.ok(!JSON.stringify(report).includes("private-feature-marker"));
  }
});

test("validates text-to-speech engine declarations without exposing voice metadata", () => {
  const marker = "private-voice-marker";
  const base = { manifest_version: 3, name: "Speech fixture", version: "1.0.0", permissions: ["ttsEngine"] };
  for (const tts_engine of [{ voices: [] }, { voices: [{ voice_name: marker }] },
    { voices: [{ voice_name: marker, lang: "en-CA", event_types: ["start", "end"] }] }]) {
    const report = analyzeManifest({ ...base, tts_engine });
    assert.ok(!report.riskFlags.some(flag => flag.id === "tts-engine-declaration-invalid" || flag.id === "tts-engine-permission-missing"));
    assert.ok(report.lanes.some(lane => lane.id === "text-to-speech-engine"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
  for (const tts_engine of [null, [], {}, { voices: "voice" }, { voices: [null] },
    { voices: [{}] }, { voices: [{ voice_name: "" }] }, { voices: [{ voice_name: marker, lang: "" }] },
    { voices: [{ voice_name: marker, event_types: [] }] }, { voices: [{ voice_name: marker, event_types: ["end", "end"] }] }]) {
    const report = analyzeManifest({ ...base, tts_engine });
    assert.ok(report.riskFlags.some(flag => flag.id === "tts-engine-declaration-invalid" && flag.level === "critical"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
  const missingPermission = analyzeManifest({ ...base, permissions: [], tts_engine: { voices: [{ voice_name: marker }] } });
  assert.ok(missingPermission.riskFlags.some(flag => flag.id === "tts-engine-permission-missing" && flag.level === "high"));
  assert.ok(!JSON.stringify(missingPermission).includes(marker));
});

test("validates shared-module exports without exposing importer identifiers", () => {
  const marker = "abcdefghijklmnopabcdefghijklmnop";
  const base = { manifest_version: 3, name: "Export fixture", version: "1.0.0" };
  for (const declaration of [{}, { allowlist: [marker] }]) {
    const report = analyzeManifest({ ...base, export: declaration });
    assert.ok(!report.riskFlags.some(flag => flag.id === "shared-module-export-invalid"));
    assert.ok(report.riskFlags.some(flag => flag.id === "shared-module-store-incompatible" && flag.level === "high"));
    assert.ok(report.lanes.some(lane => lane.id === "shared-module-export"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
  for (const declaration of [null, [], "module", { allowlist: [] }, { allowlist: ["invalid"] }, { allowlist: [marker, marker] }]) {
    const report = analyzeManifest({ ...base, export: declaration });
    assert.ok(report.riskFlags.some(flag => flag.id === "shared-module-export-invalid" && flag.level === "critical"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
});

test("validates shared-module imports without exposing module identifiers", () => {
  const marker = "ponmlkjihgfedcbaponmlkjihgfedcba";
  const base = { manifest_version: 3, name: "Import fixture", version: "1.0.0" };
  for (const declaration of [[{ id: marker }], [{ id: marker, minimum_version: "1.2.3" }]]) {
    const report = analyzeManifest({ ...base, import: declaration });
    assert.ok(!report.riskFlags.some(flag => flag.id === "shared-module-import-invalid"));
    assert.ok(report.riskFlags.some(flag => flag.id === "shared-module-import-compatibility"));
    assert.ok(report.lanes.some(lane => lane.id === "shared-module-import"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
  for (const declaration of [null, {}, [], [null], [{ id: "invalid" }], [{ id: marker }, { id: marker }], [{ id: marker, minimum_version: "01" }]]) {
    const report = analyzeManifest({ ...base, import: declaration });
    assert.ok(report.riskFlags.some(flag => flag.id === "shared-module-import-invalid" && flag.level === "critical"));
    assert.ok(!JSON.stringify(report).includes(marker));
  }
});

test("validates named permission arrays without silently dropping values", () => {
  const base = { manifest_version: 3, name: "Permission fixture", version: "1.0.0" };
  const valid = analyzeManifest({
    ...base,
    permissions: ["storage", "tabs"],
    optional_permissions: ["bookmarks"]
  });
  assert.ok(!valid.riskFlags.some(flag => flag.id.endsWith("permissions-invalid")
    || flag.id.includes("host-pattern-misplaced")));

  for (const [field, value, riskId] of [
    ["permissions", "storage", "permissions-invalid"],
    ["permissions", ["storage", 42], "permissions-invalid"],
    ["optional_permissions", [""], "optional-permissions-invalid"],
    ["permissions", ["https://example.test/*"], "permissions-host-pattern-misplaced"],
    ["optional_permissions", ["<all_urls>"], "optional-permissions-host-pattern-misplaced"]
  ]) {
    const report = analyzeManifest({ ...base, [field]: value });
    assert.ok(report.riskFlags.some(flag => flag.id === riskId && flag.level === "critical"));
  }
});

test("validates required and optional host-permission match patterns", () => {
  const base = { manifest_version: 3, name: "Host fixture", version: "1.0.0" };
  const validPatterns = [
    "<all_urls>",
    "https://example.test/*",
    "http://*.example.test/path/*",
    "*://*/*",
    "file:///",
    "file:///*"
  ];
  const valid = analyzeManifest({
    ...base,
    host_permissions: validPatterns,
    optional_host_permissions: ["https://optional.test/"]
  });
  assert.ok(!valid.riskFlags.some(flag => flag.id === "host-permissions-invalid"
    || flag.id === "optional-host-permissions-invalid"));

  for (const [field, value, riskId] of [
    ["host_permissions", "https://example.test/*", "host-permissions-invalid"],
    ["host_permissions", [""], "host-permissions-invalid"],
    ["host_permissions", ["ftp://example.test/*"], "host-permissions-invalid"],
    ["host_permissions", ["https://example.test"], "host-permissions-invalid"],
    ["host_permissions", ["https://bad host/*"], "host-permissions-invalid"],
    ["optional_host_permissions", [42], "optional-host-permissions-invalid"],
    ["optional_host_permissions", ["about:blank"], "optional-host-permissions-invalid"]
  ]) {
    const report = analyzeManifest({ ...base, [field]: value });
    assert.ok(report.riskFlags.some(flag => flag.id === riskId && flag.level === "critical"));
  }
});

test("builds reversible lanes for browser setting controls", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Setting controls",
    version: "1.0.0",
    permissions: ["contentSettings", "privacy", "proxy"]
  });

  assert.equal(report.surfaces.contentSettingsAccess, true);
  assert.equal(report.surfaces.privacySettingsAccess, true);
  assert.equal(report.surfaces.proxyAccess, true);
  const laneIds = report.lanes.map(lane => lane.id);
  assert.ok(laneIds.includes("content-settings-control"));
  assert.ok(laneIds.includes("privacy-settings-control"));
  assert.ok(laneIds.includes("proxy-control"));
  const riskIds = report.riskFlags.map(flag => flag.id);
  assert.ok(riskIds.includes("required-content-settings-control"));
  assert.ok(riskIds.includes("required-privacy-settings-control"));
  assert.ok(riskIds.includes("required-proxy-control"));
  for (const laneId of ["content-settings-control", "privacy-settings-control", "proxy-control"]) {
    const lane = report.lanes.find(item => item.id === laneId);
    assert.ok(lane.checks.some(check => /restor/i.test(check)));
  }
});

test("builds zero-retention lanes for location and capture permissions", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Capture boundaries",
    version: "1.0.0",
    permissions: ["geolocation", "desktopCapture", "pageCapture"]
  });

  assert.equal(report.surfaces.geolocationAccess, true);
  assert.equal(report.surfaces.desktopCaptureAccess, true);
  assert.equal(report.surfaces.pageCaptureAccess, true);
  const laneIds = report.lanes.map(lane => lane.id);
  assert.ok(laneIds.includes("geolocation-boundary"));
  assert.ok(laneIds.includes("desktop-capture-boundary"));
  assert.ok(laneIds.includes("page-capture-boundary"));
  const riskIds = report.riskFlags.map(flag => flag.id);
  assert.ok(riskIds.includes("required-geolocation"));
  assert.ok(riskIds.includes("required-desktop-capture"));
  assert.ok(riskIds.includes("required-page-capture"));
  for (const laneId of laneIds.filter(id => id.endsWith("-boundary"))) {
    const lane = report.lanes.find(item => item.id === laneId);
    assert.ok(lane.checks.some(check => /synthetic/i.test(check)));
  }
});

test("builds gesture and revocation lanes for activeTab and scripting", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Temporary injection",
    version: "1.0.0",
    permissions: ["activeTab", "scripting"],
    action: { default_title: "Run on this tab" }
  });

  assert.equal(report.surfaces.activeTabAccess, true);
  assert.equal(report.surfaces.scriptingAccess, true);
  const activeTabLane = report.lanes.find(lane => lane.id === "active-tab-gesture");
  const scriptingLane = report.lanes.find(lane => lane.id === "programmatic-injection");
  assert.ok(activeTabLane);
  assert.ok(scriptingLane);
  assert.ok(activeTabLane.checks.some(check => /user gesture/i.test(check)));
  assert.ok(activeTabLane.checks.some(check => /revoked/i.test(check)));
  assert.ok(scriptingLane.checks.some(check => /without activeTab or host access/i.test(check)));
  assert.ok(report.riskFlags.some(flag => flag.id === "required-programmatic-injection"));
});

test("builds lifecycle lanes for context menus and alarms", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Lifecycle extension",
    version: "1.0.0",
    permissions: ["contextMenus", "alarms"]
  });

  assert.equal(report.surfaces.contextMenusAccess, true);
  assert.equal(report.surfaces.alarmsAccess, true);
  const contextMenuLane = report.lanes.find(lane => lane.id === "context-menu-registration");
  const alarmLane = report.lanes.find(lane => lane.id === "alarm-lifecycle");
  assert.ok(contextMenuLane);
  assert.ok(alarmLane);
  assert.ok(contextMenuLane.checks.some(check => /without creating duplicates/i.test(check)));
  assert.ok(contextMenuLane.checks.some(check => /synthetic page/i.test(check)));
  assert.ok(alarmLane.checks.some(check => /worker has stopped/i.test(check)));
  assert.ok(alarmLane.checks.some(check => /recreates any alarm/i.test(check)));
});

test("makes unmodeled top-level manifest keys explicit", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Coverage fixture",
    version: "1.0.0",
    icons: { "16": "icon.png" },
    custom_future_key: { enabled: true }
  });

  assert.deepEqual(report.coverage.unmodeledTopLevelKeys, ["custom_future_key"]);
  assert.equal(report.counts.unmodeledTopLevelKeys, 1);
  assert.equal(report.counts.manifestIcons, 1);
  assert.ok(report.lanes.some(lane => lane.id === "unmodeled-manifest-keys"));
  assert.ok(report.riskFlags.some(flag => flag.id === "unmodeled-manifest-keys"));
});

test("compares added, removed, and changed unmodeled manifest keys", () => {
  const previous = {
    manifest_version: 3,
    name: "Coverage fixture",
    version: "1.0.0",
    future_settings: { mode: "old" },
    removed_key: true
  };
  const current = {
    manifest_version: 3,
    name: "Coverage fixture",
    version: "1.0.0",
    future_settings: { mode: "new" },
    added_key: true
  };
  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.unmodeledTopLevelKeys, {
    added: ["added_key"],
    removed: ["removed_key"],
    changed: ["future_settings"]
  });
  assert.ok(report.findings.some(item => item.id === "unmodeled-manifest-key-change"));
  assert.ok(report.findings.some(item => item.id === "extension-version-not-increased"));
});

test("models presentation metadata, limits, icons, and localization", () => {
  const previous = {
    manifest_version: 3,
    name: "Presentation fixture",
    version: "1.0.0",
    description: "Old description",
    short_name: "Old",
    version_name: "1.0 stable",
    homepage_url: "https://example.test/old",
    default_locale: "en",
    icons: { "16": "old-16.png", "128": "old-128.png" }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    description: "New description",
    short_name: "A name longer than twelve characters",
    version_name: "2.0 beta",
    homepage_url: "https://example.test/new",
    default_locale: "fr_CA",
    icons: { "16": "new-16.png", "48": "new-48.png", "128": "new-128.png" }
  };

  const analysis = analyzeManifest(current);
  assert.deepEqual(analysis.coverage.unmodeledTopLevelKeys, []);
  assert.equal(analysis.counts.manifestIcons, 3);
  assert.ok(analysis.lanes.some(lane => lane.id === "extension-presentation"));
  assert.ok(analysis.riskFlags.some(flag => flag.id === "short-name-too-long"));

  const comparison = compareManifests(previous, current);
  const fields = comparison.changes.declarations.map(change => change.field);
  for (const field of ["default_locale", "description", "homepage_url", "icons", "short_name", "version_name"]) {
    assert.ok(fields.includes(field));
  }
  assert.ok(comparison.findings.some(finding => finding.id === "extension-presentation-change"));
  assert.ok(comparison.findings.some(finding => finding.id === "default-locale-change"));
  assert.ok(!comparison.findings.some(finding => finding.id === "unmodeled-manifest-key-change"));
});

test("counts and flags an extension name change as presentation metadata", () => {
  const previous = { manifest_version: 3, name: "Old public name", version: "1.0.0" };
  const current = { manifest_version: 3, name: "New public name", version: "2.0.0" };
  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.declarations.find(change => change.field === "name"), {
    field: "name",
    previous: "Old public name",
    current: "New public name"
  });
  const finding = report.findings.find(item => item.id === "extension-presentation-change");
  assert.ok(finding);
  assert.match(finding.message, /name/);
});

test("models ChromeOS file handlers and their compatibility boundary", () => {
  const manifest = {
    manifest_version: 3,
    name: "File fixture",
    version: "1.0.0",
    file_handlers: [{
      action: "/open-text.html",
      name: "Plain text",
      accept: { "text/plain": [".txt"] },
      launch_type: "single-client"
    }]
  };
  const report = analyzeManifest(manifest);

  assert.equal(report.surfaces.fileHandling, true);
  assert.equal(report.counts.fileHandlerDeclarations, 1);
  assert.ok(report.lanes.some(lane => lane.id === "chromeos-file-handling"));
  assert.ok(report.riskFlags.some(flag => flag.id === "file-handlers-minimum-version"));
  assert.ok(!report.coverage.unmodeledTopLevelKeys.includes("file_handlers"));

  const compatible = analyzeManifest({ ...manifest, minimum_chrome_version: "120" });
  assert.ok(!compatible.riskFlags.some(flag => flag.id === "file-handlers-minimum-version"));
});

test("compares ChromeOS file-handler declarations precisely", () => {
  const previous = {
    manifest_version: 3,
    name: "File fixture",
    version: "1.0.0",
    minimum_chrome_version: "120",
    file_handlers: [{ action: "/old.html", name: "Text", accept: { "text/plain": [".txt"] } }]
  };
  const current = {
    ...previous,
    version: "2.0.0",
    file_handlers: [{ action: "/new.html", name: "Images", accept: { "image/png": [".png"] } }]
  };
  const report = compareManifests(previous, current);
  const change = report.changes.declarations.find(item => item.field === "file_handlers");

  assert.ok(change);
  assert.deepEqual(change.previous, previous.file_handlers);
  assert.deepEqual(change.current, current.file_handlers);
  assert.ok(report.findings.some(finding => finding.id === "file-handlers-change"));
});

test("rejects malformed or empty file-handler declarations without hiding coverage", () => {
  const base = { manifest_version: 3, name: "File fixture", version: "1.0.0", minimum_chrome_version: "120" };
  const invalidValues = [
    {},
    [],
    [null],
    [{ name: "Missing action", accept: { "text/plain": [".txt"] } }],
    [{ action: "/open.html", name: "Empty accept", accept: {} }],
    [{ action: "/open.html", name: "Bad extension", accept: { "text/plain": ["txt"] } }],
    [{ action: "/open.html", name: "Bad launch", accept: { "text/plain": [".txt"] }, launch_type: "other" }]
  ];

  for (const file_handlers of invalidValues) {
    const report = analyzeManifest({ ...base, file_handlers });
    assert.ok(report.riskFlags.some(flag => flag.id === "file-handlers-invalid"), JSON.stringify(file_handlers));
    assert.ok(report.lanes.some(lane => lane.id === "chromeos-file-handling"));
    assert.ok(!report.coverage.unmodeledTopLevelKeys.includes("file_handlers"));
  }
});

test("models MIME document handling with version and privacy boundaries", () => {
  const manifest = {
    manifest_version: 3,
    name: "PDF fixture",
    version: "1.0.0",
    minimum_chrome_version: "151",
    mime_types_handler: {
      "application/pdf": { handler_url: "viewer.html", can_embed: true }
    }
  };
  const report = analyzeManifest(manifest);

  assert.equal(report.surfaces.mimeTypeHandling, true);
  assert.equal(report.counts.mimeTypeHandlers, 1);
  assert.ok(report.lanes.some(lane => lane.id === "mime-document-handling"));
  assert.ok(!report.coverage.unmodeledTopLevelKeys.includes("mime_types_handler"));
  assert.ok(!report.riskFlags.some(flag => flag.id.startsWith("mime-")));
  const lane = report.lanes.find(item => item.id === "mime-document-handling");
  assert.ok(lane.checks.some(check => /synthetic PDF/i.test(check)));
  assert.ok(lane.checks.some(check => /native handler/i.test(check)));
});

test("validates MIME handler declarations and browser support", () => {
  const base = { manifest_version: 3, name: "PDF fixture", version: "1.0.0" };
  for (const mime_types_handler of [null, [], {}, { "application/pdf": null }, { "application/pdf": {} }, { "application/pdf": { handler_url: "" } }, { "application/pdf": { handler_url: "viewer.html", can_embed: "yes" } }]) {
    const report = analyzeManifest({ ...base, minimum_chrome_version: "151", mime_types_handler });
    assert.ok(report.riskFlags.some(flag => flag.id === "mime-types-handler-invalid"), JSON.stringify(mime_types_handler));
  }

  const unsupported = analyzeManifest({
    ...base,
    minimum_chrome_version: "151",
    mime_types_handler: { "text/plain": { handler_url: "viewer.html" } }
  });
  assert.ok(unsupported.riskFlags.some(flag => flag.id === "mime-type-unsupported"));

  const oldBrowser = analyzeManifest({
    ...base,
    minimum_chrome_version: "150",
    mime_types_handler: { "application/pdf": { handler_url: "viewer.html" } }
  });
  assert.ok(oldBrowser.riskFlags.some(flag => flag.id === "mime-handler-minimum-version"));
});

test("validates web-accessible resource rule structure and match paths", () => {
  const base = { manifest_version: 3, name: "Resource fixture", version: "1.0.0" };
  const invalidRules = [
    null,
    {},
    [null],
    [{ matches: ["https://example.test/*"] }],
    [{ resources: [], matches: ["https://example.test/*"] }],
    [{ resources: ["asset.png"] }],
    [{ resources: ["asset.png"], matches: [] }],
    [{ resources: ["asset.png"], matches: ["https://example.test/*"], use_dynamic_url: "yes" }]
  ];
  for (const web_accessible_resources of invalidRules) {
    const report = analyzeManifest({ ...base, web_accessible_resources });
    assert.ok(report.riskFlags.some(flag => flag.id === "web-accessible-resources-invalid"), JSON.stringify(web_accessible_resources));
  }

  const badPath = analyzeManifest({
    ...base,
    web_accessible_resources: [{ resources: ["asset.png"], matches: ["https://example.test/private/*"] }]
  });
  assert.ok(badPath.riskFlags.some(flag => flag.id === "web-accessible-match-path-invalid"));

  for (const target of [
    { matches: ["https://example.test/*"] },
    { extension_ids: ["abcdefghijklmnopabcdefghijklmnop"] },
    { matches: ["<all_urls>"], extension_ids: ["abcdefghijklmnopabcdefghijklmnop"] }
  ]) {
    const report = analyzeManifest({
      ...base,
      web_accessible_resources: [{ resources: ["asset.png"], ...target, use_dynamic_url: true }]
    });
    assert.ok(!report.riskFlags.some(flag => flag.id.startsWith("web-accessible-resources-invalid") || flag.id === "web-accessible-match-path-invalid"));
  }
});

test("flags exposure of the entire extension package", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Resource fixture",
    version: "1.0.0",
    web_accessible_resources: [{ resources: ["*"], matches: ["https://example.test/*"] }]
  });
  assert.ok(report.riskFlags.some(flag => flag.id === "entire-package-web-accessible" && flag.level === "high"));
});

test("validates external messaging callers and identifier privacy", () => {
  const base = { manifest_version: 3, name: "Messaging fixture", version: "1.0.0" };
  for (const externally_connectable of [
    null,
    [],
    { ids: "*" },
    { ids: ["invalid-id"] },
    { matches: "https://example.test/*" },
    { accepts_tls_channel_id: "yes" }
  ]) {
    const report = analyzeManifest({ ...base, externally_connectable });
    assert.ok(report.riskFlags.some(flag => flag.id === "externally-connectable-invalid"), JSON.stringify(externally_connectable));
  }

  const broad = analyzeManifest({
    ...base,
    externally_connectable: {
      ids: ["*"],
      matches: ["<all_urls>"],
      accepts_tls_channel_id: true
    }
  });
  for (const id of ["externally-connectable-all-urls-invalid", "all-extensions-connectable", "tls-channel-id-enabled"]) {
    assert.ok(broad.riskFlags.some(flag => flag.id === id), id);
  }
  assert.ok(broad.riskFlags.find(flag => flag.id === "tls-channel-id-enabled").message.includes("never logged or exported"));

  const valid = analyzeManifest({
    ...base,
    externally_connectable: {
      ids: ["abcdefghijklmnopabcdefghijklmnop"],
      matches: ["https://example.test/*"],
      accepts_tls_channel_id: false
    }
  });
  assert.ok(!valid.riskFlags.some(flag => flag.id.startsWith("externally-connectable") || flag.id === "all-extensions-connectable" || flag.id === "tls-channel-id-enabled"));
});

test("detects the implicit external-connectability default changing", () => {
  const previous = { manifest_version: 3, name: "Messaging fixture", version: "1.0.0" };
  const current = { ...previous, externally_connectable: {} };
  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.declarations.find(change => change.field === "externally_connectable.declared"), {
    field: "externally_connectable.declared",
    previous: false,
    current: true
  });
  assert.ok(report.findings.some(finding => finding.id === "external-connectability-policy-change" && finding.level === "critical"));
  assert.ok(report.findings.some(finding => finding.id === "extension-version-not-increased"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("compares TLS channel-ID acceptance without retaining identifiers", () => {
  const previous = {
    manifest_version: 3,
    name: "Messaging fixture",
    version: "1.0.0",
    externally_connectable: { matches: ["https://example.test/*"], accepts_tls_channel_id: false }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    externally_connectable: { matches: ["https://example.test/*"], accepts_tls_channel_id: true }
  };
  const report = compareManifests(previous, current);
  assert.ok(report.changes.declarations.some(change => change.field === "externally_connectable.accepts_tls_channel_id"));
  assert.ok(report.findings.some(finding => finding.id === "tls-channel-id-policy-change"));
});

test("compares MIME document handlers as a critical update boundary", () => {
  const previous = {
    manifest_version: 3,
    name: "PDF fixture",
    version: "1.0.0",
    minimum_chrome_version: "151",
    mime_types_handler: { "application/pdf": { handler_url: "old-viewer.html", can_embed: false } }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    mime_types_handler: { "application/pdf": { handler_url: "new-viewer.html", can_embed: true } }
  };
  const report = compareManifests(previous, current);
  const change = report.changes.declarations.find(item => item.field === "mime_types_handler");

  assert.ok(change);
  assert.deepEqual(change.previous, previous.mime_types_handler);
  assert.deepEqual(change.current, current.mime_types_handler);
  assert.ok(report.findings.some(finding => finding.id === "mime-types-handler-change" && finding.level === "critical"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("flags an overlong manifest description", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Description fixture",
    version: "1.0.0",
    description: "x".repeat(133)
  });
  assert.ok(report.riskFlags.some(flag => flag.id === "description-too-long"));
});

test("validates manifest icon declarations without reading image files", () => {
  const base = { manifest_version: 3, name: "Icon fixture", version: "1.0.0" };
  for (const icons of [null, [], {}, { zero: "icon.png" }, { "0": "icon.png" }, { "48": "" }]) {
    const report = analyzeManifest({ ...base, icons });
    assert.ok(report.riskFlags.some(flag => flag.id === "manifest-icons-invalid"), JSON.stringify(icons));
  }

  for (const iconPath of ["icon.svg", "images/ICON.WEBP"]) {
    const report = analyzeManifest({ ...base, icons: { "48": iconPath, "128": "icon.png" } });
    assert.ok(report.riskFlags.some(flag => flag.id === "manifest-icon-format-unsupported"), iconPath);
  }

  const incomplete = analyzeManifest({ ...base, icons: { "16": "icon.png" } });
  assert.ok(incomplete.riskFlags.some(flag => flag.id === "manifest-icon-sizes-incomplete" && flag.level === "medium"));

  const valid = analyzeManifest({ ...base, icons: { "48": "icon-48.png", "128": "icon-128.png" } });
  assert.ok(!valid.riskFlags.some(flag => flag.id.startsWith("manifest-icon")));
  assert.equal(valid.counts.manifestIcons, 2);
  assert.ok(valid.lanes.some(lane => lane.id === "extension-presentation"));
});

test("validates action icons in both supported declaration forms", () => {
  const base = { manifest_version: 3, name: "Action icon fixture", version: "1.0.0" };
  for (const default_icon of [null, [], {}, "", { size: "icon.png" }, { "0": "icon.png" }, { "16": "" }]) {
    const report = analyzeManifest({ ...base, action: { default_icon } });
    assert.ok(report.riskFlags.some(flag => flag.id === "action-icon-invalid"), JSON.stringify(default_icon));
  }

  for (const default_icon of ["icon.svg", { "16": "ICON.WEBP" }]) {
    const report = analyzeManifest({ ...base, action: { default_icon } });
    assert.ok(report.riskFlags.some(flag => flag.id === "action-icon-format-unsupported"), JSON.stringify(default_icon));
  }

  for (const default_icon of ["icon.png", { "16": "icon-16.png", "32": "icon-32.png" }]) {
    const report = analyzeManifest({ ...base, action: { default_icon } });
    assert.ok(!report.riskFlags.some(flag => flag.id.startsWith("action-icon")), JSON.stringify(default_icon));
  }
});

test("enforces the documented manifest-name length limit", () => {
  const report = analyzeManifest({ manifest_version: 3, name: "n".repeat(76), version: "1.0.0" });
  assert.ok(report.riskFlags.some(flag => flag.id === "manifest-name-too-long" && flag.level === "critical"));
  assert.ok(report.lanes.some(lane => lane.id === "manifest-identity-validation"));

  const valid = analyzeManifest({ manifest_version: 3, name: "n".repeat(75), version: "1.0.0" });
  assert.ok(!valid.riskFlags.some(flag => flag.id.startsWith("manifest-name")));
});

test("models cross-origin policies and managed storage schema boundaries", () => {
  const manifest = {
    manifest_version: 3,
    name: "Policy fixture",
    version: "1.0.0",
    permissions: ["storage"],
    cross_origin_embedder_policy: { value: "require-corp" },
    cross_origin_opener_policy: { value: "same-origin" },
    storage: { managed_schema: "policy-schema.json" }
  };
  const report = analyzeManifest(manifest);

  assert.equal(report.surfaces.crossOriginPolicies, true);
  assert.equal(report.surfaces.managedStorageSchema, true);
  assert.deepEqual(report.coverage.unmodeledTopLevelKeys, []);
  const isolationLane = report.lanes.find(lane => lane.id === "extension-page-isolation");
  const managedLane = report.lanes.find(lane => lane.id === "managed-storage-policy");
  assert.ok(isolationLane);
  assert.ok(managedLane);
  assert.ok(isolationLane.checks.some(check => /without assuming every context/i.test(check)));
  assert.ok(managedLane.checks.some(check => /without reading it through this tool/i.test(check)));
  assert.ok(managedLane.checks.some(check => /no policy data is logged or exported/i.test(check)));
});

test("compares cross-origin and managed-storage declarations precisely", () => {
  const previous = {
    manifest_version: 3,
    name: "Policy fixture",
    version: "1.0.0",
    permissions: ["storage"],
    cross_origin_embedder_policy: { value: "unsafe-none" },
    cross_origin_opener_policy: { value: "unsafe-none" },
    storage: { managed_schema: "old-schema.json" }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    cross_origin_embedder_policy: { value: "require-corp" },
    cross_origin_opener_policy: { value: "same-origin" },
    storage: { managed_schema: "new-schema.json" }
  };
  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.declarations.filter(change =>
    change.field.startsWith("cross_origin_") || change.field === "storage.managed_schema"), [
    { field: "cross_origin_embedder_policy.value", previous: "unsafe-none", current: "require-corp" },
    { field: "cross_origin_opener_policy.value", previous: "unsafe-none", current: "same-origin" },
    { field: "storage.managed_schema", previous: "old-schema.json", current: "new-schema.json" }
  ]);
  assert.ok(report.findings.some(finding => finding.id === "cross-origin-policy-change"));
  assert.ok(report.findings.some(finding => finding.id === "managed-storage-schema-change"));
  assert.ok(!report.findings.some(finding => finding.id === "unmodeled-manifest-key-change"));
});

test("warns when a managed schema lacks storage API permission", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Managed policy fixture",
    version: "1.0.0",
    storage: { managed_schema: "policy-schema.json" }
  });
  assert.ok(report.riskFlags.some(flag => flag.id === "managed-schema-without-storage-permission"));
});

test("models extension identity-key continuity without exposing the key", () => {
  const secretKey = "PRIVATE_EXTENSION_KEY_MATERIAL";
  const report = analyzeManifest({ manifest_version: 3, name: "Identity fixture", version: "1.0.0", key: secretKey });

  assert.equal(report.surfaces.extensionKeyDeclared, true);
  assert.ok(report.lanes.some(lane => lane.id === "extension-identity-continuity"));
  assert.ok(!report.coverage.unmodeledTopLevelKeys.includes("key"));
  assert.ok(!JSON.stringify(report).includes(secretKey));
});

test("gates identity-key changes while returning booleans only", () => {
  const previousKey = "PRIVATE_PREVIOUS_EXTENSION_KEY";
  const currentKey = "PRIVATE_CURRENT_EXTENSION_KEY";
  const base = { manifest_version: 3, name: "Identity fixture", version: "1.0.0" };
  const report = compareManifests(
    { ...base, key: previousKey },
    { ...base, version: "2.0.0", key: currentKey }
  );

  assert.deepEqual(report.changes.extensionKey, { previousDeclared: true, currentDeclared: true, changed: true });
  assert.ok(report.findings.some(finding => finding.id === "extension-identity-key-change" && finding.level === "critical"));
  assert.equal(report.requiresManualUpdateValidation, true);
  assert.ok(!JSON.stringify(report).includes(previousKey));
  assert.ok(!JSON.stringify(report).includes(currentKey));
  assert.equal(compareManifests({ ...base, key: previousKey }, { ...base, key: previousKey }).changes.extensionKey.changed, false);
});

test("CLI inspection reports identity-key presence without exposing its value", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mv3replay-key-"));
  const secretKey = "PRIVATE_CLI_EXTENSION_KEY";
  const manifestFile = path.join(folder, "manifest.json");
  await writeFile(manifestFile, JSON.stringify({ manifest_version: 3, name: "Identity fixture", version: "1.0.0", key: secretKey }));
  const result = runCli("inspect", manifestFile);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Extension identity key declared: yes/);
  assert.ok(!result.stdout.includes(secretKey));
  assert.ok(!result.stderr.includes(secretKey));
});

test("compares extension versions using Chrome update ordering", () => {
  const base = {
    manifest_version: 3,
    name: "Version fixture",
    version: "1.2"
  };

  const newer = compareManifests(base, { ...base, version: "1.2.0.1" });
  assert.deepEqual(newer.changes.version, {
    previous: "1.2",
    current: "1.2.0.1",
    relation: "newer"
  });
  assert.ok(!newer.findings.some(item => item.id.startsWith("extension-version-")));

  const older = compareManifests(base, { ...base, version: "1.1.65535.65535" });
  assert.equal(older.changes.version.relation, "older");
  assert.ok(older.findings.some(item => item.id === "extension-version-decreased"));
  assert.equal(older.requiresManualUpdateValidation, true);

  const unchanged = compareManifests(base, { ...base, permissions: ["storage"] });
  assert.equal(unchanged.changes.version.relation, "same");
  assert.ok(unchanged.findings.some(item => item.id === "extension-version-not-increased"));

  const equivalent = compareManifests(base, { ...base, version: "1.2.0" });
  assert.equal(equivalent.changes.version.relation, "same");
  assert.ok(equivalent.findings.some(item => item.id === "extension-version-not-increased"));

  const invalid = compareManifests(base, { ...base, version: "1.02" });
  assert.equal(invalid.changes.version.relation, "invalid");
  assert.ok(invalid.findings.some(item => item.id === "extension-version-invalid"));
});

test("inspection gates missing names and invalid package versions", () => {
  const missing = analyzeManifest({ manifest_version: 3 });
  assert.deepEqual(missing.riskFlags.slice(0, 2).map(flag => [flag.id, flag.level]), [
    ["manifest-name-invalid", "critical"],
    ["manifest-version-invalid", "critical"]
  ]);
  assert.ok(missing.lanes.some(lane => lane.id === "manifest-identity-validation"));

  for (const version of ["0", "01.2", "1.2.3.4.5", "1.65536", "1.beta"]) {
    const report = analyzeManifest({ manifest_version: 3, name: "Identity fixture", version });
    assert.ok(report.riskFlags.some(flag => flag.id === "manifest-version-invalid"), version);
  }

  const valid = analyzeManifest({ manifest_version: 3, name: "Identity fixture", version: "1.2.0.65535" });
  assert.ok(!valid.riskFlags.some(flag => flag.id.startsWith("manifest-")));
  assert.ok(!valid.lanes.some(lane => lane.id === "manifest-identity-validation"));
});

test("--fail-on critical gates invalid inspect identity after writing the report", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mv3replay-invalid-identity-"));
  const manifestFile = path.join(folder, "manifest.json");
  await writeFile(manifestFile, JSON.stringify({ manifest_version: 3, name: "", version: "01.0" }));
  const result = runCli("inspect", manifestFile, "--json", "--fail-on", "critical");

  assert.equal(result.status, 7);
  const report = JSON.parse(result.stdout);
  assert.ok(report.riskFlags.some(flag => flag.id === "manifest-name-invalid"));
  assert.ok(report.riskFlags.some(flag => flag.id === "manifest-version-invalid"));
});

test("detects required-versus-optional permission and host-access transitions", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    permissions: ["storage"],
    optional_permissions: ["tabCapture"],
    host_permissions: [],
    optional_host_permissions: ["https://legacy.example.com/*"]
  };
  const current = {
    ...previous,
    version: "2.0.0",
    permissions: ["storage", "tabCapture"],
    optional_permissions: [],
    host_permissions: ["https://legacy.example.com/*"],
    optional_host_permissions: []
  };

  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.permissionTransitions.optionalToRequired, ["tabCapture"]);
  assert.deepEqual(report.changes.hostTransitions.optionalToRequired, ["https://legacy.example.com/*"]);
  const findingIds = report.findings.map(item => item.id);
  assert.ok(findingIds.includes("optional-permission-required"));
  assert.ok(findingIds.includes("optional-host-required"));
  assert.equal(report.requiresManualUpdateValidation, true);

  const downgraded = compareManifests(current, previous);
  assert.deepEqual(downgraded.changes.permissionTransitions.requiredToOptional, ["tabCapture"]);
  assert.deepEqual(downgraded.changes.hostTransitions.requiredToOptional, ["https://legacy.example.com/*"]);
  assert.ok(downgraded.findings.some(item => item.id === "required-permission-optional"));
  assert.ok(downgraded.findings.some(item => item.id === "extension-version-decreased"));
  assert.equal(downgraded.requiresManualUpdateValidation, true);
});

test("detects removed required and optional permissions and host access", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    permissions: ["storage", "tabs"],
    optional_permissions: ["downloads"],
    host_permissions: ["https://example.com/*", "https://app.example.net/*"],
    optional_host_permissions: ["https://legacy.example.com/*"]
  };
  const current = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "2.0.0",
    permissions: ["storage"],
    optional_permissions: [],
    host_permissions: ["https://example.com/*"],
    optional_host_permissions: []
  };

  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.requiredPermissions.added, []);
  assert.deepEqual(report.changes.requiredPermissions.removed, ["tabs"]);
  assert.deepEqual(report.changes.optionalPermissions.removed, ["downloads"]);
  assert.deepEqual(report.changes.requiredHosts.removed, ["https://app.example.net/*"]);
  assert.deepEqual(report.changes.optionalHosts.removed, ["https://legacy.example.com/*"]);
  assert.deepEqual(report.changes.permissionTransitions.optionalToRequired, []);
  assert.deepEqual(report.changes.hostTransitions.optionalToRequired, []);
  assert.equal(report.requiresManualUpdateValidation, false);

  const readded = compareManifests(current, previous);
  assert.deepEqual(readded.changes.requiredPermissions.added, ["tabs"]);
  assert.deepEqual(readded.changes.requiredPermissions.removed, []);
});

test("compares content-script registrations deterministically", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    content_scripts: [{
      matches: ["https://example.com/*"],
      js: ["content.js"],
      run_at: "document_idle"
    }]
  };
  const current = {
    ...previous,
    version: "2.0.0",
    content_scripts: [
      {
        matches: ["https://example.com/*"],
        js: ["content.js"],
        run_at: "document_start",
        all_frames: true,
        exclude_matches: ["https://example.com/login*"]
      },
      {
        matches: ["https://other.example.org/*"],
        css: ["style.css"],
        world: "MAIN",
        match_origin_as_fallback: true
      }
    ]
  };

  const report = compareManifests(previous, current);
  assert.equal(report.changes.contentScripts.added.length, 2);
  assert.equal(report.changes.contentScripts.removed.length, 1);
  assert.deepEqual(report.changes.contentScripts.removed[0], {
    matches: ["https://example.com/*"],
    excludeMatches: [],
    files: ["content.js"],
    runAt: "document_idle",
    allFrames: false,
    world: "ISOLATED",
    matchAboutBlank: false,
    matchOriginAsFallback: false
  });

  const added = report.changes.contentScripts.added;
  const timingChange = added.find(item => item.runAt === "document_start");
  assert.deepEqual(timingChange.matches, ["https://example.com/*"]);
  assert.deepEqual(timingChange.files, ["content.js"]);
  assert.equal(timingChange.allFrames, true);
  assert.deepEqual(timingChange.excludeMatches, ["https://example.com/login*"]);

  const newRegistration = added.find(item => item.world === "MAIN");
  assert.deepEqual(newRegistration.matches, ["https://other.example.org/*"]);
  assert.deepEqual(newRegistration.files, ["style.css"]);
  assert.equal(newRegistration.matchOriginAsFallback, true);
  assert.ok(report.findings.some(item => item.id === "content-script-registration-change"));
  assert.ok(report.findings.some(item => item.id === "content-script-scope-expansion"));

  const identical = compareManifests(previous, structuredClone(previous));
  assert.deepEqual(identical.changes.contentScripts, { added: [], removed: [] });
  assert.ok(!identical.findings.some(item => item.id === "content-script-registration-change"));
});

test("validates static content-script declarations", () => {
  const base = { manifest_version: 3, name: "Content fixture", version: "1.0.0" };
  for (const content_scripts of [
    [],
    [{}],
    [{ matches: ["https://example.test/*"] }],
    [{ matches: [], js: ["content.js"] }],
    [{ matches: ["https://example.test/*"], js: [] }],
    [{ matches: ["https://example.test/*"], js: [""] }],
    [{ matches: ["https://example.test/*"], js: ["content.js"], run_at: "later" }],
    [{ matches: ["https://example.test/*"], css: ["content.css"], world: "PAGE" }],
    [{ matches: ["https://example.test/*"], js: ["content.js"], all_frames: "yes" }]
  ]) {
    const report = analyzeManifest({ ...base, content_scripts });
    assert.ok(report.riskFlags.some(flag => flag.id === "content-scripts-invalid"), JSON.stringify(content_scripts));
  }

  const valid = analyzeManifest({
    ...base,
    content_scripts: [{
      matches: ["https://example.test/*"],
      exclude_matches: ["https://example.test/private/*"],
      js: ["content.js"],
      css: ["content.css"],
      run_at: "document_idle",
      world: "ISOLATED",
      all_frames: false
    }]
  });
  assert.ok(!valid.riskFlags.some(flag => flag.id === "content-scripts-invalid"));
});

test("requires wildcard paths for content-script origin fallback", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Fallback fixture",
    version: "1.0.0",
    content_scripts: [{
      matches: ["https://example.test/specific"],
      js: ["content.js"],
      match_origin_as_fallback: true
    }]
  });
  assert.ok(report.riskFlags.some(flag => flag.id === "content-script-origin-fallback-path-invalid"));
});

test("validates static declarative_net_request ruleset declarations", () => {
  const base = { manifest_version: 3, name: "DNR fixture", version: "1.0.0" };
  const invalidValues = [
    null,
    [],
    {},
    { rule_resources: [] },
    { rule_resources: [null] },
    { rule_resources: [{ enabled: true, path: "rules.json" }] },
    { rule_resources: [{ id: "base", path: "rules.json" }] },
    { rule_resources: [{ id: "base", enabled: "yes", path: "rules.json" }] },
    { rule_resources: [{ id: "base", enabled: true }] },
    { rule_resources: [{ id: "base", enabled: true, path: "/etc/rules.json" }] },
    { rule_resources: [{ id: "base", enabled: true, path: "../rules.json" }] },
    { rule_resources: [{ id: "base", enabled: true, path: ["sub", "..", "..", "rules.json"].join("/") }] },
    {
      rule_resources: [
        { id: "base", enabled: true, path: "rules.json" },
        { id: "base", enabled: false, path: "extra.json" }
      ]
    }
  ];

  for (const declarative_net_request of invalidValues) {
    const report = analyzeManifest({ ...base, declarative_net_request });
    assert.ok(report.riskFlags.some(flag => flag.id === "static-rulesets-invalid" && flag.level === "critical"),
      JSON.stringify(declarative_net_request));
  }

  const valid = analyzeManifest({
    ...base,
    declarative_net_request: {
      rule_resources: [
        { id: "base", enabled: true, path: "rules/base.json" },
        { id: "extra", enabled: false, path: "rules/extra.json" }
      ]
    }
  });
  assert.ok(!valid.riskFlags.some(flag => flag.id === "static-rulesets-invalid"));
  assert.ok(valid.lanes.some(lane => lane.id === "network-rules"));
});

test("compares commands, DNR rulesets, external messaging, web-accessible resources, and surfaces", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    action: { default_popup: "popup.html" },
    commands: { "run-job": { suggested_key: { default: "Ctrl+Shift+1" } } },
    declarative_net_request: {
      rule_resources: [{ id: "base", enabled: true, path: "rules.json" }]
    },
    web_accessible_resources: [{ resources: ["injected.js"], matches: ["https://example.com/*"] }],
    externally_connectable: { matches: ["https://example.com/*"] }
  };
  const current = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "2.0.0",
    options_ui: { page: "options.html" },
    side_panel: { default_path: "side-panel.html" },
    devtools_page: "devtools.html",
    commands: { "run-job": {}, "open-panel": {} },
    declarative_net_request: {
      rule_resources: [
        { id: "base", enabled: true, path: "rules-v2.json" },
        { id: "extra", enabled: false, path: "extra.json" }
      ]
    },
    web_accessible_resources: [
      { resources: ["injected.js"], matches: ["https://example.com/*"] },
      { resources: ["bridge.js"], matches: ["https://other.example.org/*"] }
    ],
    externally_connectable: {
      matches: ["https://example.com/*", "https://other.example.org/*"],
      ids: ["abcdefabcdabcdef"]
    }
  };

  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.commands, { added: ["open-panel"], removed: [] });
  assert.deepEqual(report.changes.staticRulesets, {
    added: ["extra"],
    removed: [],
    changed: ["base"]
  });
  assert.deepEqual(report.changes.externalMessaging.matches.added, ["https://other.example.org/*"]);
  assert.deepEqual(report.changes.externalMessaging.ids.added, ["abcdefabcdabcdef"]);
  assert.deepEqual(report.changes.webAccessibleResources.added, [
    {
      matches: ["https://other.example.org/*"],
      resources: ["bridge.js"],
      extensionIds: [],
      useDynamicUrl: false
    }
  ]);
  assert.deepEqual(report.changes.webAccessibleResources.removed, []);
  assert.deepEqual(report.changes.surfaces.added, ["devtools", "options", "side-panel"]);
  assert.deepEqual(report.changes.surfaces.removed, ["action-popup", "toolbar-action"]);

  assert.deepEqual(report.findings.map(item => item.id), [
    "commands-change",
    "dnr-ruleset-change",
    "external-messaging-expansion",
    "web-accessible-resources-change",
    "toolbar-action-change",
    "extension-surface-change"
  ]);
  assert.equal(report.requiresManualUpdateValidation, true);

  const reversed = compareManifests(current, previous);
  assert.deepEqual(reversed.changes.surfaces.added, ["action-popup", "toolbar-action"]);
  assert.deepEqual(reversed.changes.surfaces.removed, ["devtools", "options", "side-panel"]);
  assert.deepEqual(reversed.changes.externalMessaging.matches.added, []);
  assert.ok(reversed.findings.some(item => item.id === "extension-version-decreased"));
  assert.equal(reversed.requiresManualUpdateValidation, true);
});

test("detects value-only declaration changes when surfaces stay present", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    background: { service_worker: "worker.js", type: "module" },
    action: { default_popup: "popup.html" },
    options_page: "options.html",
    side_panel: { default_path: "side-panel.html" },
    devtools_page: "devtools.html",
    commands: { "run-job": { suggested_key: { default: "Ctrl+Shift+1" } } }
  };
  const current = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "2.0.0",
    background: { service_worker: "worker-v2.js" },
    action: { default_popup: "popup-v2.html" },
    options_ui: { page: "options-v2.html" },
    side_panel: { default_path: "side-panel-v2.html" },
    devtools_page: "devtools-v2.html",
    commands: { "run-job": { description: "Runs the job immediately" } }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, []);
  assert.deepEqual(report.changes.surfaces.removed, []);

  assert.deepEqual(report.changes.declarations, [
    { field: "action.default_popup", previous: "popup.html", current: "popup-v2.html" },
    { field: "background.service_worker", previous: "worker.js", current: "worker-v2.js" },
    { field: "background.type", previous: "module", current: null },
    { field: "command.run-job", previous: { suggestedKeyDefault: "Ctrl+Shift+1" }, current: { description: "Runs the job immediately" } },
    { field: "devtools_page", previous: "devtools.html", current: "devtools-v2.html" },
    { field: "options_page", previous: "options.html", current: "options-v2.html" },
    { field: "side_panel.default_path", previous: "side-panel.html", current: "side-panel-v2.html" }
  ]);
  const findingIds = report.findings.map(item => item.id);
  assert.ok(findingIds.includes("service-worker-entry-change"));
  assert.ok(findingIds.includes("commands-change"));
  assert.ok(findingIds.includes("extension-surface-change"));

  const identical = compareManifests(current, structuredClone(current));
  assert.deepEqual(identical.changes.declarations, []);
});

test("a command-only definition change emits commands-change but never extension-surface-change", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    commands: { "run-job": { suggested_key: { default: "Ctrl+Shift+1" } } }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    commands: { "run-job": { description: "Runs the job immediately" } }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.declarations, [
    {
      field: "command.run-job",
      previous: { suggestedKeyDefault: "Ctrl+Shift+1" },
      current: { description: "Runs the job immediately" }
    }
  ]);
  assert.ok(report.findings.some(item => item.id === "commands-change"));
  assert.ok(!report.findings.some(item => item.id === "extension-surface-change"));
});

test("compares advanced entry-point presence and declaration values", () => {
  const previous = {
    manifest_version: 3,
    name: "Advanced fixture",
    version: "1.0.0",
    omnibox: { keyword: "old" },
    sandbox: { pages: ["old.html", "shared.html"] },
    optional_permissions: ["nativeMessaging"]
  };
  const current = {
    manifest_version: 3,
    name: "Advanced fixture",
    version: "2.0.0",
    omnibox: { keyword: "new" },
    sandbox: { pages: ["new.html", "shared.html"] },
    optional_permissions: ["userScripts"]
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["user-scripts"]);
  assert.deepEqual(report.changes.surfaces.removed, ["native-messaging"]);
  assert.deepEqual(report.changes.declarations, [
    { field: "omnibox.keyword", previous: "old", current: "new" },
    { field: "sandbox.pages", previous: ["old.html", "shared.html"], current: ["new.html", "shared.html"] }
  ]);
  assert.ok(report.findings.some(item => item.id === "extension-surface-change"));
});

test("compares browser support, CSP, and OAuth scope policy changes precisely", () => {
  const previous = {
    manifest_version: 3,
    name: "Policy fixture",
    version: "1.0.0",
    minimum_chrome_version: "110",
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'",
      sandbox: "sandbox allow-scripts; script-src 'self'"
    },
    oauth2: { scopes: ["openid"] }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    minimum_chrome_version: "120",
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'",
      sandbox: "sandbox allow-scripts allow-forms; script-src 'self'"
    },
    oauth2: { scopes: ["openid", "profile"] }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.oauthScopes, { added: ["profile"], removed: [] });
  assert.deepEqual(report.changes.declarations, [
    {
      field: "content_security_policy.extension_pages",
      previous: "script-src 'self'; object-src 'none'",
      current: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'"
    },
    {
      field: "content_security_policy.sandbox",
      previous: "sandbox allow-scripts; script-src 'self'",
      current: "sandbox allow-scripts allow-forms; script-src 'self'"
    },
    { field: "minimum_chrome_version", previous: "110", current: "120" }
  ]);
  const findingIds = report.findings.map(item => item.id);
  assert.ok(findingIds.includes("oauth-scope-expansion"));
  assert.ok(findingIds.includes("content-security-policy-change"));
  assert.ok(findingIds.includes("minimum-browser-version-change"));
  assert.ok(!findingIds.includes("extension-surface-change"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("validates keyboard-command declarations and the suggested-shortcut limit", () => {
  const base = { manifest_version: 3, name: "Command fixture", version: "1.0.0" };
  for (const commands of [
    [],
    {},
    { run: null },
    { run: { description: "Run", suggested_key: "ctrl+Shift+Y" } },
    { run: { description: "Run", suggested_key: "Ctrl+Alt+Y" } },
    { run: { description: "Run", suggested_key: { android: "Ctrl+Y" } } },
    { run: { description: "Run", suggested_key: { windows: "Command+Y" } } },
    { run: { description: 42 } },
    { run: { description: "Run", global: "yes" } }
  ]) {
    const report = analyzeManifest({ ...base, commands });
    assert.ok(report.riskFlags.some(flag => flag.id === "commands-invalid"), JSON.stringify(commands));
  }

  const commands = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    `command-${index}`,
    { description: `Command ${index}`, suggested_key: `Ctrl+Shift+${index}` }
  ]));
  const limit = analyzeManifest({ ...base, commands });
  assert.ok(limit.riskFlags.some(flag => flag.id === "too-many-suggested-shortcuts"));
});

test("requires descriptions for standard commands and rejects MV2 action names", () => {
  const base = { manifest_version: 3, name: "Command fixture", version: "1.0.0" };
  const missing = analyzeManifest({ ...base, commands: { run: { suggested_key: "Ctrl+Shift+Y" } } });
  assert.ok(missing.riskFlags.some(flag => flag.id === "command-description-missing"));

  const action = analyzeManifest({ ...base, commands: { _execute_action: { suggested_key: "Ctrl+Shift+Y" } } });
  assert.ok(!action.riskFlags.some(flag => flag.id === "command-description-missing"));

  const legacy = analyzeManifest({ ...base, commands: { _execute_browser_action: {} } });
  assert.ok(legacy.riskFlags.some(flag => flag.id === "deprecated-action-command"));
});

test("accepts documented platform-specific and media command shortcuts", () => {
  const report = analyzeManifest({
    manifest_version: 3,
    name: "Command fixture",
    version: "1.0.0",
    commands: {
      run: {
        description: "Run the command",
        suggested_key: {
          default: "Ctrl+Shift+Y",
          mac: "Command+Shift+Y",
          chromeos: "Ctrl+Search+Y"
        }
      },
      media: { description: "Pause media", suggested_key: "MediaPlayPause" }
    }
  });
  assert.ok(!report.riskFlags.some(flag => flag.id === "commands-invalid"));
});

test("detects update-source and incognito-mode changes", () => {
  const previous = {
    manifest_version: 3,
    name: "Distribution fixture",
    version: "1.0.0",
    update_url: "https://updates.example.test/old.xml",
    incognito: "spanning"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    update_url: "https://updates.example.test/new.xml",
    incognito: "split"
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(
    report.changes.declarations.filter(item => ["update_url", "incognito"].includes(item.field)),
    [
      { field: "incognito", previous: "spanning", current: "split" },
      {
        field: "update_url",
        previous: "https://updates.example.test/old.xml",
        current: "https://updates.example.test/new.xml"
      }
    ]
  );
  assert.ok(report.findings.some(item => item.id === "update-source-change"));
  assert.ok(report.findings.some(item => item.id === "incognito-mode-change"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("detects built-in Chrome page override changes", () => {
  const previous = {
    manifest_version: 3,
    name: "Override fixture",
    version: "1.0.0"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    chrome_url_overrides: { newtab: "newtab.html" }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["browser-page-override"]);
  assert.ok(report.changes.declarations.some(change =>
    change.field === "chrome_url_overrides.newtab"
    && change.previous === null
    && change.current === "newtab.html"));
  assert.ok(report.findings.some(item => item.id === "browser-page-override-change"));
  assert.ok(report.findings.some(item => item.id === "extension-surface-change"));
});

test("detects browser setting override changes", () => {
  const previous = {
    manifest_version: 3,
    name: "Settings fixture",
    version: "1.0.0"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    chrome_settings_overrides: {
      homepage: "https://example.test/home",
      startup_pages: ["https://example.test/start"]
    }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["browser-settings-override"]);
  assert.ok(report.changes.declarations.some(change =>
    change.field === "chrome_settings_overrides"
    && change.previous === null
    && change.current.homepage === "https://example.test/home"));
  assert.ok(report.findings.some(item => item.id === "browser-settings-override-change"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("compares toolbar action title, icon, and activation mode", () => {
  const previous = {
    manifest_version: 3,
    name: "Action fixture",
    version: "1.0.0",
    action: { default_title: "Run", default_icon: { "16": "old.png" } }
  };
  const current = {
    ...previous,
    version: "1.1.0",
    action: {
      default_title: "Open controls",
      default_icon: { "16": "new.png", "32": "new-32.png" },
      default_popup: "popup.html"
    }
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["action-popup"]);
  assert.ok(report.changes.declarations.some(change => change.field === "action.default_title"));
  assert.ok(report.changes.declarations.some(change => change.field === "action.default_icon"));
  assert.ok(report.changes.declarations.some(change => change.field === "action.default_popup"));
  assert.ok(report.findings.some(item => item.id === "toolbar-action-change"));
});

test("flags newly added browser-data and web-request surfaces", () => {
  const previous = {
    manifest_version: 3,
    name: "Boundary expansion",
    version: "1.0.0"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    optional_permissions: ["cookies", "history", "bookmarks", "webRequest", "browsingData", "tabs"],
    optional_host_permissions: ["https://synthetic.example.test/*"]
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, [
    "bookmarks", "browsing-data", "cookies", "history", "navigation-metadata", "web-request"
  ]);
  assert.ok(report.findings.some(item => item.id === "browser-data-surface-expansion"));
  assert.ok(report.findings.some(item => item.id === "web-request-surface-expansion"));
  assert.equal(report.requiresManualUpdateValidation, false);
});

test("gates newly added browser setting controls", () => {
  const previous = {
    manifest_version: 3,
    name: "Settings expansion",
    version: "1.0.0"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    permissions: ["contentSettings", "privacy", "proxy"]
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["content-settings", "privacy-settings", "proxy-settings"]);
  assert.ok(report.findings.some(item => item.id === "browser-setting-control-expansion"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("gates newly added capture and location surfaces", () => {
  const previous = {
    manifest_version: 3,
    name: "Capture expansion",
    version: "1.0.0"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    permissions: ["geolocation", "desktopCapture", "pageCapture"]
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["desktop-capture", "geolocation", "page-capture"]);
  assert.ok(report.findings.some(item => item.id === "capture-or-location-expansion"));
  assert.equal(report.requiresManualUpdateValidation, true);
});

test("flags newly added temporary tab and injection surfaces", () => {
  const previous = {
    manifest_version: 3,
    name: "Injection expansion",
    version: "1.0.0"
  };
  const current = {
    ...previous,
    version: "1.1.0",
    optional_permissions: ["activeTab", "scripting"]
  };

  const report = compareManifests(previous, current);
  assert.deepEqual(report.changes.surfaces.added, ["active-tab", "programmatic-injection"]);
  assert.ok(report.findings.some(item => item.id === "injection-surface-expansion"));
  assert.equal(report.requiresManualUpdateValidation, false);
});

test("normalizes command description and every suggested_key platform entry deterministically", () => {
  const previous = {
    manifest_version: 3,
    name: "Fixture extension",
    version: "1.0.0",
    commands: {
      "run-job": {
        description: "Runs the job",
        suggested_key: { default: "Ctrl+Shift+1", mac: "Command+Shift+1", windows: "Ctrl+Shift+1" }
      }
    }
  };
  const current = {
    ...previous,
    version: "2.0.0",
    commands: {
      "run-job": {
        description: "Runs the job immediately",
        suggested_key: { mac: "Command+Shift+2", windows: "Ctrl+Shift+1", default: "Ctrl+Shift+1" }
      },
      "other-job": {
        description: "Other job",
        suggested_key: { linux: "Ctrl+Alt+O" }
      }
    }
  };

  const report = compareManifests(previous, current);

  assert.deepEqual(report.changes.declarations, [
    {
      field: "command.run-job",
      previous: {
        description: "Runs the job",
        suggestedKeyDefault: "Ctrl+Shift+1",
        suggestedKeyMac: "Command+Shift+1",
        suggestedKeyWindows: "Ctrl+Shift+1"
      },
      current: {
        description: "Runs the job immediately",
        suggestedKeyDefault: "Ctrl+Shift+1",
        suggestedKeyMac: "Command+Shift+2",
        suggestedKeyWindows: "Ctrl+Shift+1"
      }
    }
  ]);
  assert.ok(report.findings.some(item => item.id === "commands-change"));

  const reordered = compareManifests(current, structuredClone(current));
  assert.deepEqual(reordered.changes.declarations, []);
});

test("CLI compare reads two manifests and reports critical changes", async () => {
  const previousDirectory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-previous-"));
  const currentDirectory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-current-"));
  await writeFile(path.join(previousDirectory, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Fixture", version: "1.0.0"
  }));
  await writeFile(path.join(currentDirectory, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Fixture", version: "1.1.0", permissions: ["tabCapture"]
  }));

  const result = runCli("compare", previousDirectory, currentDirectory, "--json");

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.requiresManualUpdateValidation, true);
  assert.deepEqual(report.changes.requiredPermissions.added, ["tabCapture"]);
});

test("keeps a minimal MV3 report honest", () => {
  const report = analyzeManifest({ manifest_version: 3, name: "Minimal", version: "0.1.0" });
  assert.deepEqual(report.lanes.map(lane => lane.id), ["install-and-upgrade"]);
  assert.equal(report.riskFlags.length, 0);
  assert.equal(report.counts.hostPermissions, 0);
});

test("rejects non-MV3 manifests", () => {
  assert.throws(
    () => analyzeManifest({ manifest_version: 2, name: "Old" }),
    /Manifest V3 only/
  );
});

test("CLI accepts an unpacked extension directory and returns JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-test-"));
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(richManifest));

  const result = runCli("inspect", directory, "--json");

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.identity.name, "Fixture extension");
  assert.equal(report.privacy.dataUploaded, false);
});

const fixtureExpectations = {
  "minimal-mv3": report => {
    assert.deepEqual(report.lanes.map(lane => lane.id), ["install-and-upgrade"]);
    assert.deepEqual(report.riskFlags, []);
    assert.equal(report.counts.hostPermissions, 0);
  },
  "action-popup": report => {
    assert.equal(report.surfaces.actionPopup, true);
    assert.ok(report.lanes.some(lane => lane.id === "action-popup"));
  },
  "options-page": report => {
    assert.equal(report.surfaces.optionsPage, true);
    assert.ok(report.lanes.some(lane => lane.id === "options"));
  },
  "service-worker": report => {
    assert.equal(report.surfaces.serviceWorker, true);
    assert.ok(report.lanes.some(lane => lane.id === "service-worker-lifecycle"));
    assert.ok(report.riskFlags.some(flag => flag.id === "ephemeral-worker"));
  },
  "content-scripts": report => {
    assert.equal(report.surfaces.contentScripts, 1);
    assert.ok(report.lanes.some(lane => lane.id === "host-page-safety"));
    assert.deepEqual(report.riskFlags, []);
  },
  "permissions-required-optional": report => {
    assert.equal(report.surfaces.storage, true);
    assert.equal(report.counts.permissions, 2);
    assert.equal(report.counts.optionalPermissions, 1);
    assert.ok(report.lanes.some(lane => lane.id === "optional-permissions"));
  },
  "host-permissions": report => {
    assert.equal(report.counts.hostPermissions, 2);
    assert.ok(report.lanes.some(lane => lane.id === "permission-boundaries"));
  },
  "declarative-net-request": report => {
    assert.equal(report.counts.staticRulesets, 2);
    assert.ok(report.lanes.some(lane => lane.id === "network-rules"));
    assert.ok(report.riskFlags.every(flag => flag.id !== "broad-host-scope"));
  },
  "side-panel": report => {
    assert.equal(report.surfaces.sidePanel, true);
    assert.ok(report.lanes.some(lane => lane.id === "side-panel"));
  },
  "risky-external-messaging": report => {
    const riskIds = report.riskFlags.map(flag => flag.id);
    assert.ok(riskIds.includes("externally-connectable-all-urls-invalid"));
    assert.ok(riskIds.includes("broad-web-accessible-resources"));
    assert.ok(report.lanes.some(lane => lane.id === "external-messaging"));
    assert.ok(report.lanes.some(lane => lane.id === "web-accessible-resources"));
  },
  "advanced-entry-points": report => {
    assert.equal(report.surfaces.omnibox, true);
    assert.equal(report.surfaces.sandboxPages, 2);
    assert.equal(report.surfaces.nativeMessaging, true);
    assert.equal(report.surfaces.userScripts, true);
    assert.equal(report.counts.sandboxPages, 2);
    for (const lane of ["omnibox-input", "sandboxed-pages", "native-messaging", "user-scripts"]) {
      assert.ok(report.lanes.some(item => item.id === lane));
    }
    assert.ok(report.riskFlags.some(flag => flag.id === "required-native-messaging" && flag.level === "critical"));
    assert.ok(report.riskFlags.some(flag => flag.id === "required-user-scripts" && flag.level === "high"));
  },
  "sensitive-permissions": report => {
    assert.equal(report.surfaces.debuggerAccess, true);
    assert.equal(report.surfaces.management, true);
    assert.equal(report.surfaces.identityAccess, true);
    assert.equal(report.surfaces.downloads, true);
    assert.equal(report.surfaces.clipboard, true);
    for (const lane of ["debugger-protocol", "extension-management", "identity-flow", "downloads", "clipboard-boundary"]) {
      assert.ok(report.lanes.some(item => item.id === lane));
    }
    assert.ok(report.riskFlags.some(flag => flag.id === "required-debugger-access" && flag.level === "critical"));
    assert.ok(report.riskFlags.some(flag => flag.id === "required-extension-management" && flag.level === "critical"));
    assert.ok(report.riskFlags.some(flag => flag.id === "required-clipboard-read" && flag.level === "high"));
    assert.ok(!report.riskFlags.some(flag => flag.id.includes("downloads") || flag.id.includes("identity")));
  },
  "browser-data-permissions": report => {
    for (const surface of [
      "cookies", "historyAccess", "bookmarksAccess", "browsingDataAccess",
      "navigationMetadataAccess", "webRequestAccess"
    ]) {
      assert.equal(report.surfaces[surface], true);
    }
    for (const lane of [
      "cookie-boundary", "history-boundary", "bookmarks-boundary",
      "browsing-data-removal", "navigation-metadata", "web-request-boundary"
    ]) {
      assert.ok(report.lanes.some(item => item.id === lane));
    }
  }
};

for (const [fixture, expect] of Object.entries(fixtureExpectations)) {
  test(`fixture ${fixture} produces its expected regression plan`, async () => {
    const result = runCli("inspect", path.join(FIXTURE_ROOT, fixture), "--json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.privacy.localOnly, true);
    expect(report);
  });
}

test("CLI rejects malformed JSON with a diagnostic on stderr", () => {
  const result = runCli("inspect", path.join(FIXTURE_ROOT, "malformed-json"));
  assert.equal(result.status, 4);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("CLI rejects a directory without a manifest", async () => {
  const emptyDirectory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-empty-"));
  const result = runCli("inspect", emptyDirectory);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("CLI rejects oversized manifests before parsing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-oversized-"));
  await writeFile(
    path.join(directory, "manifest.json"),
    " ".repeat(MAX_MANIFEST_BYTES + 1),
    "utf8"
  );
  const result = runCli("inspect", directory);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /1 MiB safety limit/);
});

test("CLI rejects non-MV3 input", () => {
  const result = runCli("inspect", path.join(FIXTURE_ROOT, "non-mv3"));
  assert.equal(result.status, 6);
  assert.match(result.stderr, /Manifest V3 only/);
});

test("JSON output is byte-stable across runs and matches the in-process fingerprint", async () => {
  const fixtureDirectory = path.join(FIXTURE_ROOT, "minimal-mv3");
  const first = runCli("inspect", fixtureDirectory, "--json");
  const second = runCli("inspect", fixtureDirectory, "--json");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);

  const report = JSON.parse(first.stdout);
  const manifest = await readFixtureManifest("minimal-mv3");
  assert.equal(report.fingerprint, analyzeManifest(manifest).fingerprint);
});
