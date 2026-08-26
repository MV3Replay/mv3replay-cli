import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { listPublicFiles, scanText } from "../scripts/check-public-safety.mjs";

const violation = text => scanText(text).map(item => item.rule);
const joined = (...parts) => parts.join("");

test("rejects likely secrets", () => {
  const awsKey = joined("AKIA", "IOSFODNN7EXAMPLE");
  const assigned = joined("secret", ": 'hunted42value9'");
  const token = joined("ghp_", "Zx8yQw1mKd3Vb7Nc2Fj5Hs0Lp6Tr4UeA");
  assert.ok(violation(awsKey).includes("aws-access-key-id"));
  assert.ok(violation(assigned).includes("assigned-secret"));
  assert.ok(violation(token).includes("github-token"));
  assert.ok(violation(joined("-----", "BEGIN RSA PRIVATE KEY-----")).includes("private-key-block"));
});

test("rejects email addresses", () => {
  const email = joined("contact", "@example.org");
  assert.ok(violation(email).includes("email-address"));
});

test("rejects personal Windows paths in plain and escaped forms", () => {
  const plain = joined("C:", "\\Users\\tester\\report.docx");
  const escaped = joined("C:", "\\\\Users\\\\tester\\\\report.docx");
  assert.ok(violation(plain).includes("personal-windows-path"));
  assert.ok(violation(escaped).includes("personal-windows-path"));
});

test("rejects parent-directory traversal that escapes the repository", () => {
  const traversal = joined("..", "/..", "/outside/file.txt");
  assert.ok(violation(traversal).includes("parent-directory-traversal"));
});

test("accepts ordinary project content", () => {
  assert.deepEqual(violation("https://example.com/*"), []);
  assert.deepEqual(violation("<all_urls>"), []);
  assert.deepEqual(violation('import { analyzeManifest } from "../src/manifest-analyzer.mjs";'), []);
  assert.deepEqual(violation("chrome.storage.local.get"), []);
  assert.deepEqual(violation("MV3 Replay local manifest report"), []);
});

test("reports rule, line, and redacted excerpts", () => {
  const secret = joined("api-key", ": 'abcd1234efgh5678'");
  const [entry] = scanText(`keep = 1\n${secret}\n`);
  assert.equal(entry.line, 2);
  assert.equal(entry.rule, "assigned-secret");
  assert.ok(!entry.excerpt.includes("abcd1234efgh5678"));
});

test("the scan list covers untracked release-candidate working-tree files", async () => {
  const files = await listPublicFiles();
  for (const expected of [
    ".github/workflows/ci.yml",
    "LICENSE",
    "README.md",
    "schemas/inspect-v1.schema.json",
    "schemas/compare-v1.schema.json",
    "tests/tarball-install.test.mjs",
    "tests/documentation-coverage.test.mjs"
  ]) {
    assert.ok(files.includes(expected), `missing public working-tree file: ${expected}`);
  }
});

test("the scan list deterministically skips repository metadata and generated artifacts", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-safety-tree-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const kept = ["README.md", path.join("src", "cli.mjs")];
  const skipped = [
    path.join(".git", "HEAD"),
    path.join(".opencode", "state.json"),
    path.join(".cache", "npm", "entry"),
    path.join(".npm", "_logs", "run.log"),
    path.join("node_modules", "left-pad", "index.js"),
    path.join("coverage", "lcov.info"),
    path.join("dist", "bundle.js"),
    path.join("tmp", "scratch.txt"),
    "debug.log",
    "mv3replay-cli-0.1.0-rc1.tgz"
  ];
  for (const relative of [...kept, ...skipped]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "placeholder\n", "utf8");
  }

  const files = await listPublicFiles(root);
  assert.deepEqual(files, ["README.md", "src/cli.mjs"]);
});

test("repository scan passes via the CLI entry point", () => {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/check-public-safety.mjs")
  ], { encoding: "utf8", cwd: path.resolve(".") });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /^public-safety: OK \(\d+ public working-tree files scanned\)/);
});
