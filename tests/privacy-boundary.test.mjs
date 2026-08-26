import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = path.resolve("src/cli.mjs");
const SRC_ROOT = path.resolve("src");
const SOURCE_MARKER = "mv3-sibling-source-marker-9f41";
const PROFILE_MARKER = "mv3-fake-profile-marker-2c7b";
const ENV_MARKER = "mv3-poison-env-value-42";
const ABSOLUTE_PATH_PATTERN = new RegExp(
  `${/(^|[^A-Za-z])[A-Za-z]:[\\/]/.source}|${/(^|\s)\/(?:home|tmp|Users|root)\//.source}`
);

async function readSourceFiles() {
  const sources = [];
  for (const entry of await readdir(SRC_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      const { readFile } = await import("node:fs/promises");
      sources.push({
        file: entry.name,
        text: await readFile(path.join(SRC_ROOT, entry.name), "utf8")
      });
    }
  }
  assert.ok(sources.length > 0, "expected shipped source files to scan");
  return sources;
}

test("shipped source has no network, browser, or environment access", async () => {
  const forbidden = [
    /process\.env/,
    /\brequire\s*\(/,
    /["']node:(?:http|https|net|dns|tls|dgram|child_process|inspector|repl|worker_threads)["']/,
    /["'](?:http|https|net|dns|tls|child_process)["']/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bWebSocket\b/,
    /\bchrome\b/
  ];
  for (const { file, text } of await readSourceFiles()) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} must not contain ${pattern}`);
    }
  }
});

test("the package declares no runtime dependencies or install scripts", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies"
  ]) {
    assert.ok(!(field in pkg), `package.json must not declare ${field}`);
  }
  for (const script of Object.keys(pkg.scripts ?? {})) {
    assert.doesNotMatch(script, /(?:pre)?install|postinstall|prepare/);
  }
});

test("inspect reads only the selected manifest, never sibling source files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-boundary-src-"));
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "Boundary probe", version: "1.0.0" })
  );
  await writeFile(path.join(directory, "background.js"), `const marker = "${SOURCE_MARKER}";`);
  await writeFile(path.join(directory, "options.html"), SOURCE_MARKER);
  await mkdir(path.join(directory, "scripts"));
  await writeFile(path.join(directory, "scripts", "hidden.js"), SOURCE_MARKER);

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "inspect", directory, "--json"],
    { encoding: "utf8", cwd: path.resolve(".") }
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.privacy.sourceFilesRead, false);
  assert.ok(!result.stdout.includes(SOURCE_MARKER), "source marker leaked into stdout");
  assert.ok(!result.stderr.includes(SOURCE_MARKER), "source marker leaked into stderr");
});

test("inspect ignores environment values and fake profile directories", async () => {
  const extension = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-boundary-env-"));
  await writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "Env probe", version: "1.0.0" })
  );
  const fakeProfile = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-fake-profile-"));
  await writeFile(path.join(fakeProfile, "Preferences"), PROFILE_MARKER);

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "inspect", extension, "--json"],
    {
      encoding: "utf8",
      cwd: path.resolve("."),
      timeout: 20000,
      env: {
        ...process.env,
        MV3REPLAY_PROBE_MARKER: ENV_MARKER,
        HOME: fakeProfile,
        USERPROFILE: fakeProfile,
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9"
      }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const emitted = `${result.stdout}${result.stderr}`;
  assert.ok(!emitted.includes(ENV_MARKER), "environment value leaked into output");
  assert.ok(!emitted.includes(PROFILE_MARKER), "fake profile content leaked into output");
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(emitted), emitted);
  const report = JSON.parse(result.stdout);
  assert.equal(report.privacy.browserConnected, false);
  assert.equal(report.privacy.dataUploaded, false);
});

test("error paths also ignore environment values and fake profile directories", async () => {
  const missing = path.join(os.tmpdir(), "mv3-replay-boundary-absent-manifest.json");
  const fakeProfile = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-fake-profile-"));
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "inspect", missing],
    {
      encoding: "utf8",
      cwd: path.resolve("."),
      timeout: 20000,
      env: {
        ...process.env,
        MV3REPLAY_PROBE_MARKER: ENV_MARKER,
        HOME: fakeProfile,
        USERPROFILE: fakeProfile
      }
    }
  );
  assert.equal(result.status, 3);
  const emitted = `${result.stdout}${result.stderr}`;
  assert.ok(!emitted.includes(ENV_MARKER), "environment value leaked into error output");
  assert.ok(!emitted.includes(PROFILE_MARKER), "fake profile content leaked into error output");
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(emitted), emitted);
});
