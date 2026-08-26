import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = path.resolve("src/cli.mjs");
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANIFEST_DEPTH = 128;
const SECRET_MARKER = "mv3-robustness-secret-marker";

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

async function manifestDirectory(name, contents) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-robust-"));
  await writeFile(path.join(directory, "manifest.json"), contents, "utf8");
  return directory;
}

test("a UTF-8 BOM is tolerated and a BOM-only file fails as invalid JSON", async () => {
  const withBom = await manifestDirectory(
    "bom",
    `\uFEFF${JSON.stringify({ manifest_version: 3, name: "Bom probe", version: "1.0.0" })}`
  );
  const accepted = runCli("inspect", withBom, "--json");
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).identity.name, "Bom probe");

  const bomOnly = await manifestDirectory("bom-only", "\uFEFF");
  const rejected = runCli("inspect", bomOnly);
  assert.equal(rejected.status, 4);
  assert.match(rejected.stderr, /^MV3 Replay:/);
});

test("a UTF-16 byte-order mark fails safely as invalid JSON", async () => {
  const directory = await manifestDirectory(
    "utf16",
    Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00])
  );
  const result = runCli("inspect", directory);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /^MV3 Replay:/);
});

test("malformed JSON variants all exit 4", async () => {
  const variants = [
    "{",
    '{"manifest_version":3,}',
    '{"manifest_version":3 "name":"x"}',
    "[1,2,",
    "not json at all"
  ];
  for (const [index, variant] of variants.entries()) {
    const directory = await manifestDirectory(`malformed-${index}`, variant);
    const result = runCli("inspect", directory);
    assert.equal(result.status, 4, `variant ${index}: ${result.stderr}`);
    assert.match(result.stderr, /^MV3 Replay:/);
  }
});

test("a manifest at exactly the 1 MiB limit is accepted", async () => {
  const template = '{"manifest_version":3,"name":"P","version":"1","pad":"';
  const suffix = '"}';
  const padding = "A".repeat(MAX_MANIFEST_BYTES - template.length - suffix.length);
  const directory = await manifestDirectory("boundary", `${template}${padding}${suffix}`);
  const result = runCli("inspect", directory, "--json");
  assert.equal(result.status, 0, result.stderr.slice(0, 200));
});

test("nesting beyond the safety limit exits 4 without a stack-trace diagnostic", async () => {
  const depth = 50000;
  const deep = `{"manifest_version":3,"name":"Deep","version":"1","x":${'{"x":'.repeat(depth)}3${"}".repeat(depth + 1)}`;
  assert.equal(deep.length < MAX_MANIFEST_BYTES, true);
  const directory = await manifestDirectory("deep", deep);
  const result = runCli("inspect", directory);
  assert.equal(result.status, 4, `stderr: ${result.stderr.slice(0, 300)}`);
  assert.match(result.stderr, /nest/i, result.stderr);
  assert.doesNotMatch(result.stderr, /call stack|RangeError/i, result.stderr);
});

test("nesting within the safety limit keeps working", async () => {
  const depth = MAX_MANIFEST_DEPTH - 1;
  const nested = `{"manifest_version":3,"name":"Nested","version":"1","x":${'{"x":'.repeat(depth)}3${"}".repeat(depth + 1)}`;
  const directory = await manifestDirectory("nested-ok", nested);
  const result = runCli("inspect", directory, "--json");
  assert.equal(result.status, 0, result.stderr.slice(0, 200));
  assert.equal(JSON.parse(result.stdout).identity.name, "Nested");
});

test("large arrays inside the size limit are counted deterministically", async () => {
  const permissions = Array.from({ length: 20000 }, (_, index) =>
    index % 3 === 0 ? "storage" : `perm${index % 7}`
  );
  const directory = await manifestDirectory(
    "wide",
    JSON.stringify({ manifest_version: 3, name: "Wide", version: "1", permissions })
  );
  const result = runCli("inspect", directory, "--json");
  assert.equal(result.status, 0, result.stderr.slice(0, 200));
  assert.equal(JSON.parse(result.stdout).counts.permissions, 8);
});

test("a missing file, an empty directory, and a directory named manifest.json exit 3", async () => {
  const missing = runCli("inspect", path.join(os.tmpdir(), "mv3-replay-robust-absent"));
  assert.equal(missing.status, 3);

  const empty = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-robust-empty-"));
  assert.equal(runCli("inspect", empty).status, 3);

  const parent = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-robust-dirdir-"));
  const { mkdir } = await import("node:fs/promises");
  const disguised = path.join(parent, "manifest.json");
  await mkdir(disguised);
  assert.equal(runCli("inspect", parent).status, 3);
});

test("an unreadable manifest exits 3 without echoing the path", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-robust-denied-"));
  const file = path.join(directory, "manifest.json");
  await writeFile(
    file,
    JSON.stringify({ manifest_version: 3, name: SECRET_MARKER, version: "1" }),
    "utf8"
  );
  await chmod(file, 0o000);
  try {
    let readable = true;
    try {
      await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") readable = false;
      else throw error;
    }
    if (readable) return t.skip("platform does not allow making the file unreadable");
    const result = runCli("inspect", file);
    assert.equal(result.status, 3);
    assert.ok(!result.stderr.includes(SECRET_MARKER), result.stderr);
    assert.ok(!result.stderr.includes(directory), result.stderr);
  } finally {
    await chmod(file, 0o644);
  }
});
