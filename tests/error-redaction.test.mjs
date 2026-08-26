import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = path.resolve("src/cli.mjs");
const MAX_MANIFEST_BYTES = 1024 * 1024;
const LEAK_VALUE = "mv3-leak-value-do-not-print-7788";
const LEAK_USER = "mv3leak";
const PERSONAL_PATH = ["C:", "\\Users\\mv3leak\\notes.txt"].join("");
const ABSOLUTE_PATH_PATTERN = new RegExp(
  `${/(^|[^A-Za-z])[A-Za-z]:[\\/]/.source}|${/(^|\s)\/(?:home|tmp|Users|root)\//.source}`
);

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

async function manifestDirectory(name, contents) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-redact-"));
  await writeFile(path.join(directory, "manifest.json"), contents, "utf8");
  return directory;
}

function assertNothingLeaked(result, context) {
  const emitted = `${result.stdout}${result.stderr}`;
  assert.ok(!emitted.includes(LEAK_VALUE), `${context} leaked the planted value`);
  assert.ok(!emitted.includes(LEAK_USER), `${context} leaked the planted user name`);
  assert.ok(!emitted.includes(PERSONAL_PATH), `${context} leaked the planted path`);
  assert.doesNotMatch(result.stderr, ABSOLUTE_PATH_PATTERN, result.stderr);
  assert.match(result.stderr, /^MV3 Replay:/);
}

test("invalid JSON never echoes the manifest prefix that V8 quotes in parse errors", async () => {
  const payload = `{"user_dir":"${PERSONAL_PATH}","note_text":"${LEAK_VALUE}",`;
  const directory = await manifestDirectory("snippet", `${payload}]broken`);
  const result = runCli("inspect", directory);
  assert.equal(result.status, 4, result.stderr);
  assertNothingLeaked(result, "invalid JSON");
});

test("short invalid inputs are not echoed wholesale by the parser diagnostic", async () => {
  const shortPayloads = [
    LEAK_VALUE,
    PERSONAL_PATH,
    `${LEAK_VALUE}{`
  ];
  for (const [index, payload] of shortPayloads.entries()) {
    const directory = await manifestDirectory(`short-${index}`, payload);
    const result = runCli("inspect", directory);
    assert.equal(result.status, 4, `payload ${index}: ${result.stderr}`);
    assertNothingLeaked(result, `short payload ${index}`);
  }
});

test("compare reports invalid JSON without echoing either input", async () => {
  const payload = manifest =>
    `{"ext":"${manifest}","user_dir":"${PERSONAL_PATH}","note_text":"${LEAK_VALUE}",}]`;
  const previous = await manifestDirectory("compare-prev", payload("previous"));
  const current = await manifestDirectory("compare-curr", payload("current"));
  const result = runCli("compare", previous, current);
  assert.equal(result.status, 4, result.stderr);
  assertNothingLeaked(result, "invalid compare input");
});

test("a non-object JSON document is rejected without echoing its content", async () => {
  const directory = await manifestDirectory(
    "array",
    JSON.stringify([{ note_text: LEAK_VALUE, user_dir: PERSONAL_PATH }])
  );
  const result = runCli("inspect", directory);
  assert.equal(result.status, 4, result.stderr);
  assertNothingLeaked(result, "non-object input");
});

test("an unsupported manifest version is rejected without echoing its content", async () => {
  const directory = await manifestDirectory(
    "old-version",
    JSON.stringify({
      manifest_version: 2,
      name: LEAK_VALUE,
      user_dir: PERSONAL_PATH
    })
  );
  const result = runCli("inspect", directory);
  assert.equal(result.status, 6, result.stderr);
  assertNothingLeaked(result, "unsupported version");
});

test("an oversize manifest is rejected before parsing without echoing content", async () => {
  const padded = `{"manifest_version":3,"name":"${LEAK_VALUE}","pad":"${LEAK_VALUE.repeat(100)}`;
  const directory = await manifestDirectory("oversize", padded.padEnd(MAX_MANIFEST_BYTES + 1, "x"));
  const result = runCli("inspect", directory);
  assert.equal(result.status, 5, result.stderr);
  assertNothingLeaked(result, "oversize input");
});

test("the nesting-limit diagnostic stays generic for marker-laden deep input", async () => {
  const depth = 400;
  const deep = `{"manifest_version":3,"name":"${LEAK_VALUE}","x":${'{"x":'.repeat(depth)}3${"}".repeat(depth + 1)}`;
  const directory = await manifestDirectory("deep-marked", deep);
  const result = runCli("inspect", directory);
  assert.equal(result.status, 4, result.stderr);
  assertNothingLeaked(result, "deep input");
});
