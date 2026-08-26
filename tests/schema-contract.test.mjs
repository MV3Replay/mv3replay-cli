import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = path.resolve("src/cli.mjs");
const FIXTURE_ROOT = path.resolve("fixtures");
const SCHEMA_ROOT = path.resolve("schemas");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: path.resolve(".")
  });
}

const TYPES = new Set([
  "object", "array", "string", "number", "integer", "boolean", "null"
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  return typeof value;
}

function validate(value, schema, location, errors) {
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${location} must be one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!expected.includes(actual)) {
      errors.push(`${location} must be of type ${expected.join("|")}, got ${actual}`);
      return;
    }
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${location} must match ${schema.pattern}`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${location} must be >= ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location} must have at least ${schema.minItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validate(item, schema.items, `${location}[${index}]`, errors));
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${location} is missing required property "${key}"`);
    }
    const properties = schema.properties ?? {};
    for (const [key, subschema] of Object.entries(properties)) {
      if (key in value) validate(value[key], subschema, `${location}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${location} has unexpected property "${key}"`);
      }
    }
  }
}

async function loadSchema(name) {
  const raw = await readFile(path.join(SCHEMA_ROOT, name), "utf8");
  const schema = JSON.parse(raw);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(typeof schema.$id, "string");
  assert.ok(schema.$id.startsWith("urn:mv3replay:"));
  return schema;
}

function assertConforms(report, schema, label) {
  const errors = [];
  validate(report, schema, label, errors);
  assert.deepEqual(errors, []);
}

const INSPECT_FIXTURES = [
  "minimal-mv3",
  "action-popup",
  "options-page",
  "service-worker",
  "content-scripts",
  "permissions-required-optional",
  "host-permissions",
  "declarative-net-request",
  "side-panel",
  "risky-external-messaging"
];

for (const fixture of INSPECT_FIXTURES) {
  test(`inspect output for ${fixture} conforms to inspect-v1 schema`, async () => {
    const schema = await loadSchema("inspect-v1.schema.json");
    const result = runCli("inspect", path.join(FIXTURE_ROOT, fixture), "--json");
    assert.equal(result.status, 0, result.stderr);
    assertConforms(JSON.parse(result.stdout), schema, "inspect");
  });
}

test("compare output for two fixture manifests conforms to compare-v1 schema", async () => {
  const schema = await loadSchema("compare-v1.schema.json");
  const result = runCli(
    "compare",
    path.join(FIXTURE_ROOT, "minimal-mv3"),
    path.join(FIXTURE_ROOT, "host-permissions"),
    "--json"
  );
  assert.equal(result.status, 0, result.stderr);
  assertConforms(JSON.parse(result.stdout), schema, "compare");
});
