#!/usr/bin/env bun
/**
 * Generates toml-test-suite.test.ts from the official toml-lang/toml-test repository.
 *
 * Usage:
 *   bun run test/js/bun/toml/generate_toml_test_suite.ts [path-to-toml-test] [--check]
 *
 * If no path is given, clones toml-lang/toml-test into a temp directory.
 * Only tests in the TOML v1.0.0 manifest (tests/files-toml-1.0.0) are used.
 * --check regenerates to a temp file and exits 1 if it differs from the
 * committed suite.
 *
 * Expected values come from the suite's own tagged-JSON files (no reference
 * implementation needed). Encoding of TOML types in JS:
 *   - integers within Number.MAX_SAFE_INTEGER -> number, outside -> BigInt
 *   - datetime/datetime-local/date-local/time-local -> string (source text),
 *     compared via separator/fraction normalization (see generated helper)
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Locate toml-test
// ---------------------------------------------------------------------------
const checkMode = process.argv.includes("--check");
let suiteDir = process.argv.slice(2).find(a => a !== "--check");
if (!suiteDir) {
  const tmp = mkdtempSync(join(tmpdir(), "toml-test-"));
  console.log(`Cloning toml-lang/toml-test into ${tmp} ...`);
  execSync(`git clone --depth 1 https://github.com/toml-lang/toml-test.git ${tmp}`, { stdio: "inherit" });
  suiteDir = tmp;
}
const commit = execSync("git rev-parse HEAD", { cwd: suiteDir }).toString().trim();
const testsDir = join(suiteDir, "tests");

// ---------------------------------------------------------------------------
// 2. Read the TOML v1.0.0 manifest
// ---------------------------------------------------------------------------
const manifest = readFileSync(join(testsDir, "files-toml-1.0.0"), "utf8")
  .split("\n")
  .filter(line => line.endsWith(".toml"))
  .sort();

// ignoreBOM keeps a leading U+FEFF in the decoded string — the BOM-acceptance
// tests (valid/utf8-bom-*) are vacuous without it.
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const excluded: string[] = [];

interface ValidCase {
  name: string;
  input: string;
  expected: unknown;
}
interface InvalidCase {
  name: string;
  input: string;
}
const validCases: ValidCase[] = [];
const invalidCases: InvalidCase[] = [];

// ---------------------------------------------------------------------------
// 3. Decode toml-test tagged JSON into JS values
// ---------------------------------------------------------------------------
const DATETIME_KINDS = ["datetime", "datetime-local", "date-local", "time-local"] as const;
class TaggedDateTime {
  constructor(
    public kind: string,
    public value: string,
  ) {}
}

function isTagged(v: unknown): v is { type: string; value: string } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as any).type === "string" &&
    typeof (v as any).value === "string" &&
    Object.keys(v).length === 2
  );
}

function decodeTagged(v: unknown): unknown {
  if (isTagged(v)) {
    const { type, value } = v;
    switch (type) {
      case "string":
        return value;
      case "bool":
        return value === "true";
      case "integer": {
        const big = BigInt(value);
        if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(big);
        return big;
      }
      case "float": {
        if (/^[-+]?nan$/.test(value)) return NaN;
        if (/^[-+]?inf$/.test(value)) return value.startsWith("-") ? -Infinity : Infinity;
        return Number(value);
      }
      default:
        if ((DATETIME_KINDS as readonly string[]).includes(type)) return new TaggedDateTime(type, value);
        throw new Error(`Unknown tagged type: ${type}`);
    }
  }
  if (Array.isArray(v)) return v.map(decodeTagged);
  if (v !== null && typeof v === "object") {
    // Null prototype so a "__proto__" key is stored as an own property.
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, val] of Object.entries(v)) out[k] = decodeTagged(val);
    return out;
  }
  throw new Error(`Unexpected raw value in tagged JSON: ${JSON.stringify(v)}`);
}

// ---------------------------------------------------------------------------
// 4. Collect cases
// ---------------------------------------------------------------------------
for (const rel of manifest) {
  const tomlPath = join(testsDir, rel);
  const bytes = readFileSync(tomlPath);
  let input: string;
  try {
    input = utf8Strict.decode(bytes);
  } catch {
    excluded.push(rel);
    continue;
  }
  const name = rel.replace(/\.toml$/, "");
  if (rel.startsWith("valid/")) {
    const expected = decodeTagged(JSON.parse(readFileSync(tomlPath.replace(/\.toml$/, ".json"), "utf8")));
    validCases.push({ name, input, expected });
  } else {
    invalidCases.push({ name, input });
  }
}

// ---------------------------------------------------------------------------
// 5. Code generation helpers
// ---------------------------------------------------------------------------

// JSON.stringify covers C0 controls, quotes, and backslashes; additionally
// escape DEL/C1 controls, U+2028/U+2029, and U+FEFF so the generated source
// stays visibly ASCII-clean where it matters.
function jsString(s: string): string {
  return JSON.stringify(s).replace(/[\u007f-\u009f\u2028\u2029\ufeff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function valueToJS(val: unknown, indent: number = 0): string {
  if (typeof val === "boolean") return String(val);
  if (typeof val === "bigint") return `${val}n`;
  if (typeof val === "number") {
    if (Number.isNaN(val)) return "NaN";
    if (val === Infinity) return "Infinity";
    if (val === -Infinity) return "-Infinity";
    if (Object.is(val, -0)) return "-0";
    return String(val).replace("e+", "e");
  }
  if (typeof val === "string") return jsString(val);
  if (val instanceof TaggedDateTime) return `dt(${jsString(val.kind)}, ${jsString(val.value)})`;
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.map(v => valueToJS(v, indent + 1));
    const oneLine = `[${items.join(", ")}]`;
    if (oneLine.length < 80 && !oneLine.includes("\n")) return oneLine;
    const pad = "  ".repeat(indent + 1);
    const endPad = "  ".repeat(indent);
    return `[\n${items.map(i => `${pad}${i},`).join("\n")}\n${endPad}]`;
  }
  if (val !== null && typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const parts = entries.map(([k, v]) => {
      // A literal "__proto__" key would set the prototype; the computed form
      // creates an own property.
      const key =
        k === "__proto__" ? '["__proto__"]' : /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : jsString(k);
      return `${key}: ${valueToJS(v, indent + 1)}`;
    });
    const oneLine = `{ ${parts.join(", ")} }`;
    if (oneLine.length < 80 && !oneLine.includes("\n")) return oneLine;
    const pad = "  ".repeat(indent + 1);
    const endPad = "  ".repeat(indent);
    return `{\n${parts.map(p => `${pad}${p},`).join("\n")}\n${endPad}}`;
  }
  throw new Error(`Cannot serialize ${String(val)}`);
}

// ---------------------------------------------------------------------------
// 6. Generate the test file
// ---------------------------------------------------------------------------
const kindUnion = DATETIME_KINDS.map(k => JSON.stringify(k)).join(" | ");

let output = `// Tests generated from the official toml-lang/toml-test conformance suite
// Generated from toml-test commit: ${commit}
// Scope: TOML v1.0.0 manifest (tests/files-toml-1.0.0): ${validCases.length} valid + ${invalidCases.length} invalid cases
// Regenerate with: bun run test/js/bun/toml/generate_toml_test_suite.ts [path-to-toml-test]
//
// TOML type encoding asserted by these tests:
//   - integer: number when within Number.MAX_SAFE_INTEGER, BigInt otherwise
//   - datetime, datetime-local, date-local, time-local: string (source text);
//     compared after normalizing the date/time separator to "T", uppercasing
//     "Z", and trimming trailing zeros from fractional seconds
//   - invalid documents must throw SyntaxError
//
// Excluded: ${excluded.length} invalid-encoding inputs that are not valid UTF-8. Bun.TOML.parse
// takes a JS string, so byte-level encoding rejection cannot be tested here:
${excluded.map(e => `//   ${e}`).join("\n")}
import { TOML } from "bun";
import { describe, expect, test } from "bun:test";

class TomlDateTime {
  constructor(
    public kind: ${kindUnion},
    public value: string,
  ) {}
}
function dt(kind: TomlDateTime["kind"], value: string): TomlDateTime {
  return new TomlDateTime(kind, value);
}

function normalizeDateTime(s: string): string {
  return s
    .replace(/^(\\d{4}-\\d{2}-\\d{2})[ tT]/, "$1T")
    .replace(/[zZ]$/, "Z")
    .replace(/\\.(\\d+)/, (_, frac: string) => {
      const trimmed = frac.replace(/0+$/, "");
      return trimmed === "" ? "" : "." + trimmed;
    });
}

// Datetime markers become normalized strings; everything else is unchanged.
function normalizeExpected(expected: unknown): unknown {
  if (expected instanceof TomlDateTime) return normalizeDateTime(expected.value);
  if (Array.isArray(expected)) return expected.map(normalizeExpected);
  if (expected !== null && typeof expected === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(expected)) out[k] = normalizeExpected(v);
    return out;
  }
  return expected;
}

// Normalize the positions of \`actual\` that \`expected\` marks as datetimes, in
// lockstep, so a single toEqual compares everything else exactly.
function normalizeActual(actual: unknown, expected: unknown): unknown {
  if (expected instanceof TomlDateTime) {
    return typeof actual === "string" ? normalizeDateTime(actual) : actual;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return actual.map((a, i) => normalizeActual(a, expected[i]));
  }
  if (
    expected !== null &&
    typeof expected === "object" &&
    actual !== null &&
    typeof actual === "object" &&
    !Array.isArray(actual)
  ) {
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(actual)) out[k] = normalizeActual(v, (expected as any)[k]);
    return out;
  }
  return actual;
}

function expectTomlEqual(parsed: unknown, expected: unknown): void {
  expect(normalizeActual(parsed, expected)).toEqual(normalizeExpected(expected) as any);
}
`;

output += `\ndescribe("toml-test/valid", () => {\n`;
for (const tc of validCases) {
  output += `  test(${jsString(tc.name)}, () => {\n`;
  output += `    const input: string = ${jsString(tc.input)};\n`;
  output += `    const expected: any = ${valueToJS(tc.expected, 2)};\n`;
  output += `    expectTomlEqual(TOML.parse(input), expected);\n`;
  output += `  });\n\n`;
}
output += `});\n`;

output += `\ndescribe("toml-test/invalid", () => {\n`;
for (const tc of invalidCases) {
  output += `  test(${jsString(tc.name)}, () => {\n`;
  output += `    const input: string = ${jsString(tc.input)};\n`;
  output += `    expect(() => TOML.parse(input)).toThrow(SyntaxError);\n`;
  output += `  });\n\n`;
}
output += `});\n`;

const committedPath = join(import.meta.dir, "toml-test-suite.test.ts");
const outPath = checkMode ? join(mkdtempSync(join(tmpdir(), "toml-suite-check-")), "toml-test-suite.test.ts") : committedPath;
writeFileSync(outPath, output);
// Same prettier invocation as the repo's `bun run prettier` script, pinned to
// the repo config so output is byte-stable wherever it is written.
const repoRoot = join(import.meta.dir, "../../../..");
execSync(
  [
    JSON.stringify(join(repoRoot, "node_modules/.bin/prettier")),
    "--plugin=prettier-plugin-organize-imports",
    `--config ${JSON.stringify(join(repoRoot, ".prettierrc"))}`,
    `--write ${JSON.stringify(outPath)}`,
  ].join(" "),
  { stdio: "inherit", cwd: repoRoot },
);
if (checkMode) {
  const fresh = readFileSync(outPath, "utf8");
  const committed = readFileSync(committedPath, "utf8");
  if (fresh !== committed) {
    console.error(`MISMATCH: ${committedPath} is stale; regenerate it.`);
    process.exit(1);
  }
  console.log(`OK: ${committedPath} is up to date.`);
} else {
  console.log(
    `Wrote ${outPath}: ${validCases.length} valid + ${invalidCases.length} invalid tests (${excluded.length} excluded)`,
  );
}
