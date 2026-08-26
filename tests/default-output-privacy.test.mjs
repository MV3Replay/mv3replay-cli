import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = path.resolve("src/cli.mjs");
const FIXTURE_ROOT = path.resolve("fixtures");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

const WINDOWS_DRIVE_PATH = /(^|[^A-Za-z])[A-Za-z]:[\\/]/;
const UNIX_ROOT_PATH = /(^|\s)\/(?:home|tmp|Users|root)\//;
const ABSOLUTE_PATH_PATTERN = new RegExp(`${WINDOWS_DRIVE_PATH.source}|${UNIX_ROOT_PATH.source}`);

test("default inspect output never contains an absolute local path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-privacy-"));
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Privacy probe", version: "1.0.0"
  }));

  const result = runCli("inspect", directory);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("MV3 Replay local manifest report"));
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(result.stdout), result.stdout);
  assert.ok(!result.stdout.includes(directory));
});

test("default compare output never contains an absolute local path", () => {
  const result = runCli(
    "compare",
    path.join(FIXTURE_ROOT, "minimal-mv3"),
    path.join(FIXTURE_ROOT, "host-permissions")
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("MV3 Replay local manifest comparison"));
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(result.stdout), result.stdout);
});

test("a missing absolute inspect input is reported without echoing the path", () => {
  const missing = path.join(os.tmpdir(), "mv3-replay-absent-probe", "no-such-manifest.json");
  const result = runCli("inspect", missing);
  assert.equal(result.status, 3);
  assert.ok(result.stderr.startsWith("MV3 Replay:"), result.stderr);
  assert.ok(!result.stderr.includes(missing), result.stderr);
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(result.stderr), result.stderr);
  assert.ok(result.stderr.includes(path.basename(missing)), result.stderr);
});

test("missing absolute compare inputs are reported without echoing the paths", () => {
  const previous = path.join(os.tmpdir(), "mv3-replay-absent-previous", "old-manifest.json");
  const current = path.join(os.tmpdir(), "mv3-replay-absent-current", "new-manifest.json");
  const result = runCli("compare", previous, current);
  assert.equal(result.status, 3);
  assert.ok(!result.stderr.includes(previous), result.stderr);
  assert.ok(!result.stderr.includes(current), result.stderr);
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(result.stderr), result.stderr);
  assert.ok(result.stderr.includes(path.basename(previous)), result.stderr);
});

test("a directory without a manifest is reported without echoing its absolute path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-manifest-less-"));
  const result = runCli("inspect", directory);
  assert.equal(result.status, 3);
  assert.ok(!result.stderr.includes(directory), result.stderr);
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(result.stderr), result.stderr);
});
