// Run a bun:test-style file (describe/test/expect with the small matcher
// subset used by the regex suites) under node, to cross-check hand-written
// expectations against V8. Not a general bun:test emulator -- just enough for
// pure computational assertions.
//
//   node run-buntest-under-node.mjs ../regex-lookbehind-alternation.test.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.argv[2]);
let failures = 0;
let passes = 0;
const path = [];

function isEqual(a, b) {
  if (a === b) return a !== 0 || 1 / a === 1 / b;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) if (!isEqual(a[k], b[k])) return false;
  return true;
}

function fmt(v) {
  try {
    return JSON.stringify(v, (k, x) => (x === undefined ? null : x));
  } catch {
    return String(v);
  }
}

globalThis.describe = (name, fn) => {
  path.push(name);
  fn();
  path.pop();
};
globalThis.test = (name, fn) => {
  try {
    fn();
    passes++;
  } catch (e) {
    failures++;
    console.log(`FAIL ${[...path, name].join(" > ")}\n  ${e.message}`);
  }
};
globalThis.expect = actual => ({
  toEqual(expected) {
    if (!isEqual(actual, expected)) throw new Error(`toEqual: expected ${fmt(expected)} got ${fmt(actual)}`);
  },
  toBe(expected) {
    if (!Object.is(actual, expected)) throw new Error(`toBe: expected ${fmt(expected)} got ${fmt(actual)}`);
  },
  toBeNull() {
    if (actual !== null) throw new Error(`toBeNull: got ${fmt(actual)}`);
  },
  toBeUndefined() {
    if (actual !== undefined) throw new Error(`toBeUndefined: got ${fmt(actual)}`);
  },
  toContain(item) {
    if (!(actual && typeof actual.includes === "function" && actual.includes(item)))
      throw new Error(`toContain: ${fmt(actual)} lacks ${fmt(item)}`);
  },
});

// Strip the TypeScript-specific import and type annotations the regex suites use.
let src = readFileSync(file, "utf8");
src = src.replace(/^import\s+\{[^}]*\}\s+from\s+"bun:test";?$/m, "");
src = src
  .replace(/:\s*RegExp\b/g, "")
  .replace(/:\s*string(\[\])?/g, "")
  .replace(/:\s*unknown/g, "");
(0, eval)(src);
console.log(`\n${passes} passed, ${failures} failed under node`);
process.exit(failures ? 1 : 0);
