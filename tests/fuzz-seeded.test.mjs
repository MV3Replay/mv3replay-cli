import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeManifest, compareManifests } from "../src/manifest-analyzer.mjs";

const SEED = 0x005005;
const PROPERTY_CASES = 240;
const CLI_SAMPLE_CASES = 5;
const CODED_ERRORS = new Set(["MANIFEST_NOT_OBJECT", "UNSUPPORTED_MANIFEST_VERSION"]);
const CLI_ACCEPTED_EXIT_CODES = new Set([0, 4, 6]);
const PRIVACY_BLOCK = {
  localOnly: true,
  sourceFilesRead: false,
  browserConnected: false,
  dataUploaded: false
};

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIRD_VALUES = [
  0, -1, 3.14, 1e308, -0, true, false, null,
  "", " ", "\t", "\u0000", "<all_urls>",
  "popup-\u{1F680}", "\u0645\u0631\u062d\u0628\u0627", "e\u0301", "\u200b",
  "A".repeat(10000), "3", 3,
  [], ["storage", "storage"], [1, "two", null, true],
  [[], ["nested"]], [{}, { matches: ["https://example.com/*"] }],
  Array.from({ length: 2000 }, () => "storage"),
  {}, { nested: { deeper: { value: 1 } } }
];

const MANIFEST_SLOTS = [
  "name", "version", "description", "permissions", "optional_permissions",
  "host_permissions", "optional_host_permissions", "content_scripts",
  "commands", "background", "action", "options_ui", "options_page",
  "side_panel", "devtools_page", "declarative_net_request",
  "web_accessible_resources", "externally_connectable", "incognito",
  "minimum_chrome_version", "update_url"
];

function buildFuzzManifest(random) {
  const manifest = {
    manifest_version: 3,
    name: "Fuzz probe",
    version: "1.0.0"
  };
  const slotCount = 3 + Math.floor(random() * 6);
  for (let index = 0; index < slotCount; index += 1) {
    const slot = MANIFEST_SLOTS[Math.floor(random() * MANIFEST_SLOTS.length)];
    manifest[slot] = WEIRD_VALUES[Math.floor(random() * WEIRD_VALUES.length)];
  }
  if (random() < 0.1) {
    manifest.manifest_version = WEIRD_VALUES[Math.floor(random() * WEIRD_VALUES.length)];
  }
  return manifest;
}

function buildFuzzCases() {
  const random = mulberry32(SEED);
  return Array.from({ length: PROPERTY_CASES }, () => buildFuzzManifest(random));
}

function assertCodedOrStable(manifest) {
  let first;
  try {
    first = analyzeManifest(manifest);
  } catch (error) {
    assert.ok(
      CODED_ERRORS.has(error.code),
      `unexpected error code ${error.code ?? "(none)"}: ${error.message}`
    );
    return null;
  }
  assert.deepEqual(first.privacy, PRIVACY_BLOCK);
  const rerun = analyzeManifest(manifest);
  const fromClone = analyzeManifest(structuredClone(manifest));
  assert.equal(first.fingerprint, rerun.fingerprint, "fingerprint must be stable across runs");
  assert.equal(first.fingerprint, fromClone.fingerprint, "fingerprint must be stable across clones");
  assert.equal(typeof first.fingerprint, "string");
  assert.match(first.fingerprint, /^[0-9a-f]{16}$/);
  return first;
}

test("seeded fuzz manifests either analyze deterministically or fail with a coded error", () => {
  const cases = buildFuzzCases();
  assert.equal(cases.length, PROPERTY_CASES);
  for (const [index, manifest] of cases.entries()) {
    assertCodedOrStable(manifest);
    assert.doesNotThrow(() => JSON.stringify(manifest), `case ${index} must stay serializable`);
  }
});

test("seeded fuzz manifest pairs compare deterministically or fail with a coded error", () => {
  const cases = buildFuzzCases();
  for (let index = 0; index < cases.length; index += 1) {
    const previous = cases[index];
    const current = cases[(index + 1) % cases.length];
    let first;
    try {
      first = compareManifests(previous, current);
    } catch (error) {
      assert.ok(CODED_ERRORS.has(error.code), `unexpected error code: ${error.message}`);
      continue;
    }
    const rerun = compareManifests(structuredClone(previous), structuredClone(current));
    assert.equal(first.fingerprint, rerun.fingerprint, `pair ${index} must be deterministic`);
  }
});

test("seeded fuzz sample keeps CLI exit codes bounded and JSON fingerprints in sync", async () => {
  const cases = buildFuzzCases().filter(value => {
    try {
      JSON.stringify(value);
      return true;
    } catch {
      return false;
    }
  });
  const step = Math.floor(cases.length / CLI_SAMPLE_CASES);
  for (let index = 0; index < CLI_SAMPLE_CASES; index += 1) {
    const manifest = cases[index * step];
    const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-fuzz-"));
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest), "utf8");
    const result = spawnSync(
      process.execPath,
      [path.resolve("src/cli.mjs"), "inspect", directory, "--json"],
      { encoding: "utf8", cwd: path.resolve(".") }
    );
    assert.ok(
      CLI_ACCEPTED_EXIT_CODES.has(result.status),
      `case ${index * step} exited ${result.status}: ${result.stderr}`
    );
    if (result.status === 0) {
      assert.equal(result.stderr, "", "successful runs must keep stderr empty");
      const report = JSON.parse(result.stdout);
      assert.equal(report.fingerprint, analyzeManifest(manifest).fingerprint);
    }
  }
});

test("named edge values keep their documented deterministic outcomes", () => {
  const unicode = analyzeManifest({
    manifest_version: 3,
    name: "  \u{1F680}\u0645\u0631\u062d\u0628\u0627e\u0301  ",
    version: "\u200b1.0.0\u200b"
  });
  assert.equal(unicode.identity.name, "\u{1F680}\u0645\u0631\u062d\u0628\u0627e\u0301");
  assert.equal(unicode.identity.version, "\u200b1.0.0\u200b");

  const duplicates = analyzeManifest({
    manifest_version: 3,
    name: "Dupes",
    version: "1",
    permissions: ["storage", "storage", "tabs", "tabs"]
  });
  assert.equal(duplicates.counts.permissions, 2);

  const duplicateKeys = JSON.parse(
    '{"manifest_version":3,"name":"First","name":"Last","version":"1"}'
  );
  assert.equal(analyzeManifest(duplicateKeys).identity.name, "Last");

  const extreme = analyzeManifest({
    manifest_version: 3,
    name: `X${"y".repeat(100000)}`,
    version: "1",
    permissions: Array.from({ length: 5000 }, (_, index) => (index % 2 === 0 ? "a" : "b"))
  });
  assert.equal(extreme.counts.permissions, 2);

  assert.throws(
    () => analyzeManifest({ manifest_version: "3", name: "Str", version: "1" }),
    error => error.code === "UNSUPPORTED_MANIFEST_VERSION"
  );
  assert.throws(
    () => analyzeManifest([3]),
    error => error.code === "MANIFEST_NOT_OBJECT"
  );
  assert.throws(
    () => analyzeManifest(null),
    error => error.code === "MANIFEST_NOT_OBJECT"
  );
});
