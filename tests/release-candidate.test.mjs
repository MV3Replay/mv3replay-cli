import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");
const packageJson = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8")
);
const changelog = await readFile(path.join(ROOT, "CHANGELOG.md"), "utf8");
const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
const candidate = JSON.parse(
  await readFile(path.join(ROOT, "docs", "release-candidate.json"), "utf8")
);
const ciWorkflow = await readFile(
  path.join(ROOT, ".github", "workflows", "ci.yml"),
  "utf8"
);

test("the package version is exactly 0.1.0-rc1", () => {
  assert.equal(packageJson.version, "0.1.0-rc1");
});

test("release notes distinguish implemented behavior from future ideas", () => {
  assert.match(changelog, /^## 0\.1\.0-rc1$/m);
  assert.match(changelog, /^### Implemented in 0\.1\.0-rc1$/m);
  assert.match(changelog, /^### Future ideas \(not implemented\)$/m);
  const implemented = changelog.split("### Future ideas")[0];
  assert.ok(implemented.includes("manifest-only"), "implemented section must describe shipped behavior");
  const future = changelog.split("### Future ideas")[1];
  assert.ok(future.includes("Browser automation"), "future ideas must state the absent browser automation");
});

test("README matches the release candidate and keeps limitations prominent", () => {
  assert.ok(readme.includes("mv3replay-cli-0.1.0-rc1.tgz"));
  assert.doesNotMatch(readme, /0\.0\.0-dev/);
  const limitations = readme.split(/^## Limitations$/m)[1].split(/^## /m)[0];
  assert.match(limitations, /no browser automation/i);
});

test("the compact release-candidate record distinguishes public source from an unpublished package", () => {
  assert.equal(candidate.version, "0.1.0-rc1");
  assert.equal(candidate.published, false);
  assert.equal(candidate.sourceRepositoryPublic, true);
  assert.equal(candidate.packagePublished, false);
  assert.equal(candidate.gitHubReleasePublished, false);
  assert.deepEqual(
    [...candidate.inventory.packageContents].sort(),
    [
      "LICENSE",
      "README.md",
      "package.json",
      "schemas/compare-v1.schema.json",
      "schemas/inspect-v1.schema.json",
      "src/cli.mjs",
      "src/manifest-analyzer.mjs"
    ]
  );
  assert.ok(Array.isArray(candidate.tests) && candidate.tests.length >= 4);
  assert.deepEqual(
    candidate.tests,
    [
      { command: "npm run check:public", status: "pass" },
      { command: "npm test", status: "pass" },
      { command: "npm pack --dry-run", status: "pass" },
      { command: "install exact local tarball offline and run inspect", status: "pass" }
    ]
  );
  assert.ok(Array.isArray(candidate.limitations) && candidate.limitations.length > 0);
  assert.ok(candidate.limitations.some(item => /browser automation/i.test(item)));
  assert.ok(Array.isArray(candidate.blockers));
});

test("the review record shows Claude and Codex validation complete", () => {
  assert.equal(candidate.review.claudeReview, "completed-no-blockers");
  assert.equal(candidate.review.codexValidation, "completed");
  assert.equal(candidate.status, "source-public-release-candidate");
});

test("CI runs the pack check as an explicit dry-run step after the tests", () => {
  const steps = [...ciWorkflow.matchAll(/^\s*- name: (.+)$/gm)].map(match => match[1]);
  const safetyIndex = steps.findIndex(name => /Public-safety scan/.test(name));
  const testIndex = steps.findIndex(name => /Test suite/.test(name));
  const packIndex = steps.findIndex(name => /Pack check/.test(name));
  assert.ok(safetyIndex !== -1, "CI must run the public-safety scan");
  assert.ok(testIndex !== -1, "CI must run the test suite");
  assert.ok(packIndex !== -1, "CI must run the pack check");
  assert.ok(safetyIndex < testIndex && testIndex < packIndex, "pack check must follow the tests");
  const packStep = ciWorkflow.slice(ciWorkflow.indexOf(steps[packIndex]));
  assert.match(packStep, /run: npm pack --dry-run/);
  assert.doesNotMatch(ciWorkflow, /npm publish|git push|actions\/release/);
});
