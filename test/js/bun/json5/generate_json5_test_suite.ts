#!/usr/bin/env bun
/**
 * Generates json5-test-suite.test.ts from the official json5/json5-tests repository.
 *
 * Usage:
 *   bun run test/js/bun/json5/generate_json5_test_suite.ts [path-to-json5-tests]
 *
 * If no path is given, clones json5/json5-tests into a temp directory.
 * Requires the `json5` npm package (installed in bench/json5/).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Locate json5-tests
// ---------------------------------------------------------------------------
let testsDir = process.argv[2];
if (!testsDir) {
  const tmp = mkdtempSync(join(tmpdir(), "json5-tests-"));
  console.log(`Cloning json5/json5-tests into ${tmp} ...`);
  execSync(`git clone --depth 1 https://github.com/json5/json5-tests.git ${tmp}`, { stdio: "inherit" });
  testsDir = tmp;
}

// ---------------------------------------------------------------------------
// 2. Discover test files grouped by category
// ---------------------------------------------------------------------------
interface TestCase {
  name: string; // human-readable name derived from filename
  input: string; // raw file contents
  isError: boolean; // .txt / .js files are error cases
  errorMessage?: string; // our parser's error message for this input
  expected?: unknown; // parsed value for valid inputs
  isNaN?: boolean; // special handling for NaN
}

interface Category {
  name: string;
  tests: TestCase[];
}

const CATEGORIES = ["arrays", "comments", "misc", "new-lines", "numbers", "objects", "strings", "todo"];

function nameFromFile(filename: string): string {
  // strip extension, convert hyphens to spaces
  return basename(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/-/g, " ");
}

// The json5 npm package – resolve from bench/json5 where it's installed
const json5PkgPath = join(import.meta.dir, "../../../../bench/json5/node_modules/json5");
const JSON5Ref = require(json5PkgPath) as { parse: (s: string) => unknown };

function getExpected(input: string): { value: unknown; isNaN: boolean } {
  const value = JSON5Ref.parse(input);
  if (typeof value === "number" && Number.isNaN(value)) {
    return { value, isNaN: true };
  }
  return { value, isNaN: false };
}

function getErrorMessage(input: string): string {
  try {
    (Bun as any).JSON5.parse(input);
    throw new Error("Expected parse to fail but it succeeded");
  } catch (e: any) {
    // Format: "JSON5 Parse error: <message>"
    const msg: string = e.message;
    const prefix = "JSON5 Parse error: ";
    if (msg.startsWith(prefix)) {
      return msg.slice(prefix.length);
    }
    return msg;
  }
}

const categories: Category[] = [];

for (const cat of CATEGORIES) {
  const catDir = join(testsDir, cat);
  if (!existsSync(catDir)) continue;

  const files = readdirSync(catDir)
    .filter(f => /\.(json5?|txt|js)$/.test(f))
    .sort();

  const tests: TestCase[] = [];

  for (const file of files) {
    const name = nameFromFile(file);

    const filepath = join(catDir, file);
    const input = readFileSync(filepath, "utf8");
    const isError = /\.(txt|js)$/.test(file);

    if (isError) {
      const errorMessage = getErrorMessage(input);
      tests.push({ name, input, isError, errorMessage });
    } else {
      const { value, isNaN: isNaNValue } = getExpected(input);
      tests.push({ name, input, isError, expected: value, isNaN: isNaNValue });
    }
  }

  categories.push({ name: cat, tests });
}

// ---------------------------------------------------------------------------
// 3. Code generation helpers
// ---------------------------------------------------------------------------

function escapeJSString(s: string): string {
  let result = "";
  for (const ch of s) {
    switch (ch) {
      case "\\":
        result += "\\\\";
        break;
      case '"':
        result += '\\"';
        break;
      case "\n":
        result += "\\n";
        break;
      case "\r":
        result += "\\r";
        break;
      case "\t":
        result += "\\t";
        break;
      case "\b":
        result += "\\b";
        break;
      case "\f":
        result += "\\f";
        break;
      default:
        if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) {
          result += `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
        } else {
          result += ch;
        }
        break;
    }
  }
  return `"${result}"`;
}

function valueToJS(val: unknown, indent: number = 0): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") {
    if (val === Infinity) return "Infinity";
    if (val === -Infinity) return "-Infinity";
    if (Object.is(val, -0)) return "-0";
    // Strip "+" from exponent: 2e+23 -> 2e23
    return String(val).replace("e+", "e");
  }
  if (typeof val === "string") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.map(v => valueToJS(v, indent + 1));
    // Simple arrays on one line if short
    const oneLine = `[${items.join(", ")}]`;
    if (oneLine.length < 80 && !oneLine.includes("\n")) return oneLine;
    const pad = "  ".repeat(indent + 1);
    const endPad = "  ".repeat(indent);
    return `[\n${items.map(i => `${pad}${i},`).join("\n")}\n${endPad}]`;
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const parts = entries.map(([k, v]) => {
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return `${key}: ${valueToJS(v, indent + 1)}`;
    });
    // Simple objects on one line if short
    const oneLine = `{ ${parts.join(", ")} }`;
    if (oneLine.length < 80 && !oneLine.includes("\n")) return oneLine;
    const pad = "  ".repeat(indent + 1);
    const endPad = "  ".repeat(indent);
    return `{\n${parts.map(p => `${pad}${p},`).join("\n")}\n${endPad}}`;
  }
  return String(val);
}

// ---------------------------------------------------------------------------
// 4. Generate the test file
// ---------------------------------------------------------------------------

let output = `// Tests generated from json5/json5-tests official test suite
// Expected values verified against json5@2.2.3 reference implementation
import { JSON5 } from "bun";
import { describe, expect, test } from "bun:test";
`;

for (const cat of categories) {
  output += `\ndescribe("${cat.name}", () => {\n`;

  for (let i = 0; i < cat.tests.length; i++) {
    const tc = cat.tests[i];
    const inputStr = escapeJSString(tc.input);
    const testName = tc.isError ? `${tc.name} (throws)` : tc.name;
    const separator = i < cat.tests.length - 1 ? "\n" : "";

    if (tc.isError) {
      output += `  test(${JSON.stringify(testName)}, () => {\n`;
      output += `    const input: string = ${inputStr};\n`;
      output += `    expect(() => JSON5.parse(input)).toThrow(${JSON.stringify(tc.errorMessage)});\n`;
      output += `  });\n${separator}`;
    } else if (tc.isNaN) {
      output += `  test(${JSON.stringify(testName)}, () => {\n`;
      output += `    const input: string = ${inputStr};\n`;
      output += `    const parsed = JSON5.parse(input);\n`;
      output += `    expect(Number.isNaN(parsed)).toBe(true);\n`;
      output += `  });\n${separator}`;
    } else {
      const expectedStr = valueToJS(tc.expected!, 2);
      output += `  test(${JSON.stringify(testName)}, () => {\n`;
      output += `    const input: string = ${inputStr};\n`;
      output += `    const parsed = JSON5.parse(input);\n`;
      output += `    const expected: any = ${expectedStr};\n`;
      output += `    expect(parsed).toEqual(expected);\n`;
      output += `  });\n${separator}`;
    }
  }

  output += `});\n`;
}

const suffix = process.argv.includes("--check") ? "2" : "";
const outPath = join(import.meta.dir, `json5-test-suite${suffix}.test.ts`);
writeFileSync(outPath, output);
console.log(`Wrote ${outPath}`);
