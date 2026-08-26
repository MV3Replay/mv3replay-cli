#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".opencode",
  ".cache",
  ".npm",
  "coverage",
  "dist",
  "node_modules",
  "tmp"
]);
const SKIPPED_FILE_EXTENSIONS = new Set([".log", ".tgz"]);

const SECRET_RULES = [
  {
    id: "private-key-block",
    pattern: /-{3,}\s*BEGIN [A-Z0-9 ]*PRIVATE KEY/,
    redact: true
  },
  {
    id: "aws-access-key-id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    redact: true
  },
  {
    id: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    redact: true
  },
  {
    id: "bearer-api-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    redact: true
  },
  {
    id: "assigned-secret",
    pattern: /\b(api[-_]?key|secret|token|password|passwd|client[-_]?secret|private[-_]?key|auth[-_]?token)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/i,
    redact: true
  }
];

const EMAIL_RULE = {
  id: "email-address",
  pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/,
  redact: true
};

const WINDOWS_PATH_RULE = {
  id: "personal-windows-path",
  pattern: /[A-Za-z]:[\\/]+(?:Users|Documents and Settings)(?:[\\/]+|$)|[\\/]+AppData[\\/]+(?:Roaming|Local)(?:[\\/]+|$)/i,
  redact: false
};

const TRAVERSAL_RULE = {
  id: "parent-directory-traversal",
  pattern: /\.\.[\\/]\.\./,
  redact: false
};

// Unrelated private-project terms are enforced by a separate private pre-push
// gate; they are intentionally not encoded in this public script because
// browser names such as Edge are legitimate MV3 documentation.

const RULES = [...SECRET_RULES, EMAIL_RULE, WINDOWS_PATH_RULE, TRAVERSAL_RULE];

export function scanText(text, filePath = "<text>") {
  const violations = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const rule of RULES) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      const excerpt = rule.redact
        ? `${match[0].slice(0, 4)}...[redacted]`
        : match[0].slice(0, 80);
      violations.push({
        file: filePath,
        line: index + 1,
        rule: rule.id,
        excerpt
      });
    }
  }
  return violations;
}

async function walk(root, directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await walk(root, resolved, files);
    } else if (entry.isFile() && !SKIPPED_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.relative(root, resolved).split(path.sep).join("/"));
    }
  }
}

export async function listPublicFiles(root = REPO_ROOT) {
  const files = [];
  await walk(root, root, files);
  return files.sort();
}

export async function scanRepository() {
  const violations = [];
  let filesScanned = 0;
  for (const file of await listPublicFiles()) {
    const resolved = path.join(REPO_ROOT, file);
    let content;
    try {
      content = await readFile(resolved, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue;
    filesScanned += 1;
    violations.push(...scanText(content, file));
  }
  return { filesScanned, violations };
}

function printReport({ filesScanned, violations }) {
  if (violations.length === 0) {
    process.stdout.write(`public-safety: OK (${filesScanned} public working-tree files scanned)\n`);
    return;
  }
  process.stdout.write(`public-safety: ${violations.length} violation(s) found\n`);
  for (const violation of violations) {
    process.stdout.write(`- ${violation.file}:${violation.line} [${violation.rule}] ${violation.excerpt}\n`);
  }
  process.stdout.write("Remove or replace the flagged content before any public push.\n");
}

const isMainProcess = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainProcess) {
  const report = await scanRepository();
  printReport(report);
  if (report.violations.length > 0) process.exitCode = 1;
}
