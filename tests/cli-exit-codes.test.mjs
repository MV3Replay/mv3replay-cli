import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = path.resolve("src/cli.mjs");
const FIXTURE_ROOT = path.resolve("fixtures");
const MAX_MANIFEST_BYTES = 1024 * 1024;

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

test("successful inspect exits 0", () => {
  const result = runCli("inspect", path.join(FIXTURE_ROOT, "minimal-mv3"), "--json");
  assert.equal(result.status, 0, result.stderr);
});

test("missing command or arguments exit 2", () => {
  assert.equal(runCli().status, 2);
  assert.equal(runCli("frobnicate", "somewhere").status, 2);
  assert.equal(runCli("inspect").status, 2);
  assert.equal(runCli("compare", "only-one-path").status, 2);
});

test("help works only as a standalone command", () => {
  assert.equal(runCli("--help").status, 0);
  assert.equal(runCli("-h").status, 0);
  assert.equal(runCli("inspect", "somewhere", "--help").status, 2);
  assert.equal(runCli("compare", "a", "b", "--help").status, 2);
  assert.equal(runCli("--help", "inspect").status, 2);
  assert.equal(runCli("--json", "--help").status, 2);
});

test("inspect accepts exactly one path plus at most one --json", () => {
  const good = path.join(FIXTURE_ROOT, "minimal-mv3");
  assert.equal(runCli("inspect", good, "--json").status, 0);
  assert.equal(runCli("inspect", "--json").status, 2);
  assert.equal(runCli("inspect", "--json", good).status, 2);
  assert.equal(runCli("inspect", good, "extra").status, 2);
  assert.equal(runCli("inspect", good, "--json", "--json").status, 2);
  assert.equal(runCli("inspect", good, "--unknown").status, 2);
  assert.equal(runCli("inspect", good, "--fail-on", "critical").status, 0);
  assert.equal(runCli("inspect", good, "--json", "--fail-on", "critical").status, 0);
  assert.equal(runCli("inspect", good, "--fail-on", "critical", "--json").status, 0);
  assert.equal(runCli("inspect", good, "--fail-on").status, 2);
  assert.equal(runCli("inspect", good, "--fail-on", "warning").status, 2);
  assert.equal(runCli("inspect", good, "--fail-on", "high", "--fail-on", "low").status, 2);
});

test("compare accepts exactly two paths plus at most one --json", () => {
  const previous = path.join(FIXTURE_ROOT, "minimal-mv3");
  const current = path.join(FIXTURE_ROOT, "host-permissions");
  assert.equal(runCli("compare", previous, current, "--json").status, 0);
  assert.equal(runCli("compare", previous, "--json").status, 2);
  assert.equal(runCli("compare", previous, current, "extra").status, 2);
  assert.equal(runCli("compare", previous, current, "--json", "--json").status, 2);
  assert.equal(runCli("compare", previous, current, "--unknown").status, 2);
  assert.equal(runCli("compare", previous, current, "--fail-on", "critical").status, 7);
  assert.equal(runCli("compare", previous, current, "--json", "--fail-on", "critical").status, 7);
});

test("a missing manifest path exits 3", () => {
  const result = runCli("inspect", path.join(FIXTURE_ROOT, "does-not-exist"));
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("a directory without a manifest exits 3", async () => {
  const emptyDirectory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-empty-"));
  const result = runCli("inspect", emptyDirectory);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("invalid JSON exits 4", () => {
  const result = runCli("inspect", path.join(FIXTURE_ROOT, "malformed-json"));
  assert.equal(result.status, 4);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("oversize input exits 5", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-oversized-"));
  await writeFile(
    path.join(directory, "manifest.json"),
    " ".repeat(MAX_MANIFEST_BYTES + 1),
    "utf8"
  );
  const result = runCli("inspect", directory);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("unsupported manifest versions exit 6", () => {
  const result = runCli("inspect", path.join(FIXTURE_ROOT, "non-mv3"));
  assert.equal(result.status, 6);
  assert.match(result.stderr, /Manifest V3 only/);
});

test("--fail-on writes the complete report before exiting 7", () => {
  const result = runCli(
    "inspect",
    path.join(FIXTURE_ROOT, "sensitive-permissions"),
    "--json",
    "--fail-on",
    "critical"
  );
  assert.equal(result.status, 7);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  const report = JSON.parse(result.stdout);
  assert.ok(report.riskFlags.some(flag => flag.level === "critical"));
  assert.match(result.stderr, /^MV3 Replay: --fail-on critical matched 2 findings\.$/m);
});

test("--fail-on honors severity ordering without changing defaults", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-threshold-"));
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Threshold fixture",
    version: "1.0.0",
    description: "x".repeat(133)
  }), "utf8");

  assert.equal(runCli("inspect", directory).status, 0);
  assert.equal(runCli("inspect", directory, "--fail-on", "high").status, 0);
  assert.equal(runCli("inspect", directory, "--fail-on", "medium").status, 7);
  assert.equal(runCli("inspect", directory, "--fail-on", "low").status, 7);
});
