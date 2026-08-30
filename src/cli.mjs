#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { analyzeManifest, compareManifests } from "./manifest-analyzer.mjs";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANIFEST_DEPTH = 128;

const EXIT_CODES = {
  success: 0,
  internalError: 1,
  usage: 2,
  inputMissing: 3,
  jsonInvalid: 4,
  inputOversize: 5,
  manifestUnsupported: 6
};

class CliError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return `MV3 Replay local manifest analyzer

Usage:
  node src/cli.mjs inspect <extension-directory|manifest.json> [--json]
  node src/cli.mjs compare <previous-directory|manifest.json> <current-directory|manifest.json> [--json]

Exit codes:
  0  success
  1  unexpected internal error
  2  invocation error (missing or unknown command or arguments)
  3  input file or directory not found or unreadable
  4  input is not valid JSON, not a JSON object, or nests deeper than 128 levels
  5  input exceeds the 1 MiB manifest safety limit
  6  manifest_version other than 3

These commands read only local manifests. They do not upload data, inspect
source files, connect to Chrome, install an extension, or control a browser.`;
}

async function manifestPath(input) {
  const resolved = path.resolve(input);
  let info;
  try {
    info = await stat(resolved);
  } catch (error) {
    throw new CliError(EXIT_CODES.inputMissing, `No readable file or directory at "${safeInputLabel(input)}".`);
  }
  return info.isDirectory() ? path.join(resolved, "manifest.json") : resolved;
}

function safeInputLabel(input) {
  const base = path.basename(String(input));
  return base.length > 0 ? base : "the given input";
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  if (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return path.basename(file);
}

function printHuman(report, file) {
  const lines = [
    "MV3 Replay local manifest report",
    `Manifest: ${displayPath(file)}`,
    `Extension: ${report.identity.name} ${report.identity.version}`,
    `Report fingerprint: ${report.fingerprint}`,
    "",
    "Detected surfaces",
    `- Action popup: ${yesNo(report.surfaces.actionPopup)}`,
    `- Options: ${yesNo(report.surfaces.optionsPage)}`,
    `- Service worker: ${yesNo(report.surfaces.serviceWorker)}`,
    `- Content-script registrations: ${report.surfaces.contentScripts}`,
    `- Side panel: ${yesNo(report.surfaces.sidePanel)}`,
    `- DevTools page: ${yesNo(report.surfaces.devtoolsPage)}`,
    `- Storage access: ${yesNo(report.surfaces.storage)}`,
    `- Omnibox keyword: ${yesNo(report.surfaces.omnibox)}`,
    `- Sandboxed pages: ${report.surfaces.sandboxPages}`,
    `- Native messaging: ${yesNo(report.surfaces.nativeMessaging)}`,
    `- User scripts: ${yesNo(report.surfaces.userScripts)}`,
    `- Debugger access: ${yesNo(report.surfaces.debuggerAccess)}`,
    `- Extension management: ${yesNo(report.surfaces.management)}`,
    `- Identity flow: ${yesNo(report.surfaces.identityAccess)}`,
    `- Downloads: ${yesNo(report.surfaces.downloads)}`,
    `- Clipboard access: ${yesNo(report.surfaces.clipboard)}`,
    `- Chrome page override: ${yesNo(report.surfaces.chromeUrlOverrides)}`,
    `- Chrome settings override: ${yesNo(report.surfaces.chromeSettingsOverrides)}`,
    "",
    "Recommended regression lanes"
  ];

  for (const lane of report.lanes) {
    lines.push(`- [${lane.priority}] ${lane.id}: ${lane.reason}`);
    for (const check of lane.checks) lines.push(`  - ${check}`);
  }

  lines.push("", "Risk flags");
  if (report.riskFlags.length === 0) lines.push("- No structural risk flag detected in the manifest.");
  for (const risk of report.riskFlags) lines.push(`- [${risk.level}] ${risk.message}`);

  lines.push(
    "",
    "Privacy boundary",
    "- Local only; no upload or analytics.",
    "- No extension source file was read.",
    "- No browser was connected or controlled.",
    "",
    "This is a plan, not evidence that the extension passed any test."
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printComparison(report, previousFile, currentFile) {
  const lines = [
    "MV3 Replay local manifest comparison",
    `Previous: ${displayPath(previousFile)}`,
    `Current: ${displayPath(currentFile)}`,
    `Versions: ${report.from.version} -> ${report.to.version}`,
    `Report fingerprint: ${report.fingerprint}`,
    "",
    "Update findings"
  ];

  if (report.findings.length === 0) lines.push("- No access or entry-point expansion detected by this manifest-only comparison.");
  for (const finding of report.findings) lines.push(`- [${finding.level}] ${finding.message}`);

  lines.push(
    "",
    `Manual update validation required: ${yesNo(report.requiresManualUpdateValidation)}`,
    "",
    "This comparison does not predict Chrome Web Store approval or prove that an update is safe."
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

function exceedsNestingLimit(value, limit) {
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop();
    const isContainer = Array.isArray(current)
      || (current !== null && typeof current === "object");
    if (!isContainer) continue;
    if (depth > limit) return true;
    const childDepth = depth + 1;
    const children = Array.isArray(current)
      ? current
      : Object.keys(current).map(key => current[key]);
    for (const child of children) stack.push([child, childDepth]);
  }
  return false;
}

async function readManifest(input) {
  const file = await manifestPath(input);
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new CliError(EXIT_CODES.inputMissing, `No readable manifest at "${safeInputLabel(input)}".`);
  }
  if (!info.isFile()) throw new CliError(EXIT_CODES.inputMissing, "The resolved manifest path is not a file.");
  if (info.size > MAX_MANIFEST_BYTES) throw new CliError(EXIT_CODES.inputOversize, "The manifest is larger than the 1 MiB safety limit.");

  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new CliError(EXIT_CODES.inputMissing, `The manifest at "${safeInputLabel(input)}" could not be read.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new CliError(EXIT_CODES.jsonInvalid, "The manifest is not valid JSON.");
  }
  if (exceedsNestingLimit(manifest, MAX_MANIFEST_DEPTH)) {
    throw new CliError(
      EXIT_CODES.jsonInvalid,
      `The manifest nests deeper than the ${MAX_MANIFEST_DEPTH}-level safety limit.`
    );
  }
  return { file, manifest };
}

function parseArguments(args) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { command: "help", operands: [], json: false };
  }
  const [command, ...rest] = args;
  if (command !== "inspect" && command !== "compare") {
    throw new CliError(EXIT_CODES.usage, usage());
  }
  const operandCount = command === "inspect" ? 1 : 2;
  const json =
    rest.length === operandCount + 1 && rest[operandCount] === "--json";
  const operands = rest.slice(0, operandCount);
  if (
    (rest.length !== operandCount && !json) ||
    operands.some(operand => operand.startsWith("-"))
  ) {
    throw new CliError(EXIT_CODES.usage, usage());
  }
  return { command, operands, json };
}

async function main() {
  const { command, operands, json } = parseArguments(process.argv.slice(2));
  if (command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const inputs = [];
  for (const operand of operands) inputs.push(await readManifest(operand));
  if (command === "compare") {
    const report = compareManifests(inputs[0].manifest, inputs[1].manifest);
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printComparison(report, inputs[0].file, inputs[1].file);
    }
    return;
  }

  const report = analyzeManifest(inputs[0].manifest);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report, inputs[0].file);
  }
}

const ANALYZER_EXIT_CODES = {
  MANIFEST_NOT_OBJECT: EXIT_CODES.jsonInvalid,
  UNSUPPORTED_MANIFEST_VERSION: EXIT_CODES.manifestUnsupported
};

main().catch(error => {
  process.stderr.write(`MV3 Replay: ${error.message}\n`);
  if (Number.isInteger(error.exitCode)) {
    process.exitCode = error.exitCode;
    return;
  }
  process.exitCode = ANALYZER_EXIT_CODES[error.code] ?? EXIT_CODES.internalError;
});
