import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");
const readme = (await readFile(path.join(ROOT, "README.md"), "utf8")).replace(/\r\n?/g, "\n");

test("README documents every required topic as a section", () => {
  const requiredSections = [
    "Install",
    "Usage",
    "JSON contract",
    "Exit codes",
    "Privacy boundary",
    "Limitations",
    "Support status",
    "License"
  ];
  for (const section of requiredSections) {
    assert.match(readme, new RegExp(`^## ${section}$`, "m"), `missing section: ${section}`);
  }
});

test("README shows runnable inspect, compare, and JSON examples via the documented command", () => {
  assert.match(readme, /```[a-z]*\n[\s\S]*?mv3replay inspect [\s\S]*?\n```/);
  assert.match(readme, /```[a-z]*\n[\s\S]*?mv3replay compare [\s\S]*?\n```/);
  assert.ok(readme.includes("--json"), "--json output mode must be documented");
  assert.ok(readme.includes("--fail-on"), "finding-threshold mode must be documented");
});

test("README documents deterministic finding-threshold behavior", () => {
  assert.match(readme, /--fail-on critical\|high\|medium\|low/);
  assert.match(readme, /complete human or JSON report first/);
  assert.match(readme, /code 7/);
  assert.match(readme, /not proof that a release is safe/);
});

test("README examples are safe placeholders without machine-specific paths", () => {
  for (const [index, line] of readme.split(/\r?\n/).entries()) {
    assert.doesNotMatch(line, /[A-Za-z]:[\\/]/, `drive-letter path on line ${index + 1}`);
    assert.doesNotMatch(line, /\.\.[\\/]\.\./, `parent traversal on line ${index + 1}`);
  }
});

test("README stays truthful about distribution and support", () => {
  assert.doesNotMatch(
    readme,
    /npm\s+(?:install|i)\s+(?:-g\s+)?mv3replay-cli(?![\w.-]*\.tgz)/,
    "must not imply a registry install of an unpublished package"
  );
  assert.doesNotMatch(readme, /blazing|lightning-?fast|revolutionary|#1/i);
  assert.match(readme, /pre-release/i, "support status must state the pre-release reality");
});

test("README documents the current local interface without claiming browser execution", () => {
  assert.match(readme, /built-in analysis and comparison examples/);
  assert.match(readme, /severity filters/);
  assert.match(readme, /manual-validation gates/);
  assert.match(readme, /private 10-minute tester guide/);
  assert.match(readme, /local-app-client-runtime\.test\.mjs/);
  assert.match(readme, /without controlling a real\nbrowser/);
  assert.match(readme, /manual browser testing remains separate and is never implied/);
});
