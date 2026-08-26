import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");
const readme = await readFile(path.join(ROOT, "README.md"), "utf8");

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
