import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(".");
const FIXTURE = path.join(ROOT, "fixtures", "minimal-mv3");
const EXPECTED_PACKAGE_CONTENTS = [
  "LICENSE",
  "README.md",
  "app/app.js",
  "app/index.html",
  "app/server.mjs",
  "app/styles.css",
  "package.json",
  "schemas/compare-v1.schema.json",
  "schemas/inspect-v1.schema.json",
  "src/cli.mjs",
  "src/manifest-analyzer.mjs"
];

function shellQuote(value) {
  return `"${value}"`;
}

function npmScratchEnv(scratch) {
  return {
    HOME: scratch,
    USERPROFILE: scratch,
    npm_config_cache: path.join(scratch, "npm-cache")
  };
}

function runShell(command, cwd, extraEnv = {}) {
  return spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv }
  });
}

test("every npm subprocess gets its cache and home inside its own scratch directory", () => {
  const scratch = path.join("some", "scratch");
  const env = npmScratchEnv(scratch);
  assert.equal(env.HOME, scratch);
  assert.equal(env.USERPROFILE, scratch);
  assert.equal(env.npm_config_cache, path.join(scratch, "npm-cache"));
});

test(
  "a locally packed tarball installs into a temporary directory and exposes mv3replay",
  async t => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "mv3-replay-pack-"));
    const packDir = path.join(scratch, "pack");
    const installDir = path.join(scratch, "install");
    const npmCacheDir = npmScratchEnv(scratch).npm_config_cache;
    const npmEnv = npmScratchEnv(scratch);
    await mkdir(packDir);
    await mkdir(installDir);
    await mkdir(npmCacheDir, { recursive: true });
    t.after(() => rm(scratch, { recursive: true, force: true }));

    const packed = runShell(
      `npm pack --json --pack-destination ${shellQuote(packDir)}`,
      ROOT,
      npmEnv
    );
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);

    const [manifest] = JSON.parse(packed.stdout);
    const inventory = manifest.files.map(entry => entry.path).sort();
    assert.deepEqual(inventory, EXPECTED_PACKAGE_CONTENTS);

    const tarball = path.join(packDir, manifest.filename);
    await writeFile(
      path.join(installDir, "package.json"),
      `${JSON.stringify({ name: "mv3replay-install-smoke", version: "0.0.0", private: true }, null, 2)}\n`,
      "utf8"
    );

    const installed = runShell(
      `npm install --no-audit --no-fund --loglevel=error ${shellQuote(tarball)}`,
      installDir,
      npmEnv
    );
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const cacheEntries = await readdir(npmCacheDir);
    assert.ok(
      cacheEntries.length > 0,
      "npm subprocesses never wrote to the private scratch cache"
    );

    const installedPackageJson = path.join(
      installDir,
      "node_modules",
      "mv3replay-cli",
      "package.json"
    );
    assert.ok(existsSync(installedPackageJson), "package payload missing");
    const installedBinShim = path.join(
      installDir,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "mv3replay.cmd" : "mv3replay"
    );
    assert.ok(existsSync(installedBinShim), "bin shim not created");
    const installedCli = path.join(
      installDir,
      "node_modules",
      "mv3replay-cli",
      "src",
      "cli.mjs"
    );
    assert.ok(existsSync(installedCli), "installed CLI entry point missing");

    const installedAppDir = path.join(installDir, "node_modules", "mv3replay-cli", "app");
    for (const asset of ["server.mjs", "index.html", "app.js", "styles.css"]) {
      assert.ok(
        existsSync(path.join(installedAppDir, asset)),
        `packed installation missing local interface asset: ${asset}`
      );
    }

    const helpViaBin = runShell(`${shellQuote(installedBinShim)} --help`, installDir);
    assert.equal(helpViaBin.status, 0, helpViaBin.stderr || helpViaBin.stdout);
    assert.ok(helpViaBin.stdout.includes("MV3 Replay"), helpViaBin.stdout);

    const report = spawnSync(
      process.execPath,
      [installedCli, "inspect", FIXTURE, "--json"],
      { cwd: installDir, encoding: "utf8" }
    );
    assert.equal(report.status, 0, report.stderr);
    const parsed = JSON.parse(report.stdout);
    assert.equal(parsed.schemaVersion, 1);

    const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
    assert.ok(readme.includes("mv3replay"), "README must document the mv3replay command");
  }
);
