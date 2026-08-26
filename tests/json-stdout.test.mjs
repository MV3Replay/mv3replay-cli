import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeManifest, compareManifests } from "../src/manifest-analyzer.mjs";

const CLI_PATH = path.resolve("src/cli.mjs");
const FIXTURE_ROOT = path.resolve("fixtures");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

async function writeManifest(directory, manifest) {
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return directory;
}

test("JSON mode writes exactly one JSON document to stdout and nothing else", () => {
  const inspect = runCli("inspect", path.join(FIXTURE_ROOT, "service-worker"), "--json");
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(inspect.stderr, "");
  assert.ok(inspect.stdout.endsWith("\n"));
  const parsed = JSON.parse(inspect.stdout);
  assert.equal(parsed.schemaVersion, 1);
});

test("compare JSON output is byte-stable across runs", () => {
  const first = runCli(
    "compare",
    path.join(FIXTURE_ROOT, "minimal-mv3"),
    path.join(FIXTURE_ROOT, "host-permissions"),
    "--json"
  );
  const second = runCli(
    "compare",
    path.join(FIXTURE_ROOT, "minimal-mv3"),
    path.join(FIXTURE_ROOT, "host-permissions"),
    "--json"
  );
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
});

test("reports are invariant under manifest key reordering", () => {
  const manifest = {
    manifest_version: 3,
    name: "Order probe",
    version: "1.0.0",
    permissions: ["storage", "tabs"],
    host_permissions: ["https://example.com/*"],
    content_scripts: [{ matches: ["https://example.com/*"], js: ["content.js"] }],
    commands: { "run-job": { suggested_key: { default: "Ctrl+Shift+1", mac: "Command+Shift+1" } } }
  };
  const reordered = {
    commands: { "run-job": { suggested_key: { mac: "Command+Shift+1", default: "Ctrl+Shift+1" } } },
    content_scripts: [{ js: ["content.js"], matches: ["https://example.com/*"] }],
    host_permissions: ["https://example.com/*"],
    permissions: ["tabs", "storage"],
    version: "1.0.0",
    name: "Order probe",
    manifest_version: 3
  };

  const direct = analyzeManifest(manifest);
  const flipped = analyzeManifest(reordered);
  assert.equal(direct.fingerprint, flipped.fingerprint);
  assert.deepEqual(flipped, direct);

  const compareDirect = compareManifests(manifest, reordered);
  assert.deepEqual(compareDirect.changes.declarations, []);
  assert.deepEqual(compareDirect.findings, []);
});
