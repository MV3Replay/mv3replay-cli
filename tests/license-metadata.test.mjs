import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");
const PACKAGE_JSON = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8")
);

test("the repository ships the complete Apache-2.0 license text", async () => {
  const license = await readFile(path.join(ROOT, "LICENSE"), "utf8");
  assert.match(license, /^[\t ]*Apache License/);
  assert.ok(license.includes("Version 2.0, January 2004"));
  assert.ok(license.includes("http://www.apache.org/licenses/"));
  assert.ok(license.includes('"Derivative Works" shall mean any work'));
  assert.ok(license.includes("APPENDIX: How to apply the Apache License to your work."));
});

test("package metadata is complete and consistent with the license", async () => {
  assert.equal(PACKAGE_JSON.name, "mv3replay-cli");
  assert.match(PACKAGE_JSON.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(typeof PACKAGE_JSON.description, "string");
  assert.ok(PACKAGE_JSON.description.length > 0);
  assert.equal(PACKAGE_JSON.license, "Apache-2.0");
  assert.deepEqual(PACKAGE_JSON.engines, { node: ">=20" });
  assert.equal(PACKAGE_JSON.bin && PACKAGE_JSON.bin.mv3replay, "src/cli.mjs");
  await access(path.join(ROOT, PACKAGE_JSON.bin.mv3replay));
  // Local-only project: the package must refuse accidental registry publishes.
  assert.equal(PACKAGE_JSON.private, true);
});

test("every declared packaged file exists in the repository", async () => {
  assert.ok(Array.isArray(PACKAGE_JSON.files) && PACKAGE_JSON.files.length > 0);
  for (const declared of PACKAGE_JSON.files) {
    await access(path.join(ROOT, declared));
  }
});
