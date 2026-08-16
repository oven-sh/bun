// Use bun:test in Bun, or node:test in Node.js
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);

// Detect runtime and import appropriate test framework
const isBun = typeof Bun !== "undefined";
let test, expect;

if (isBun) {
  ({ test, expect } = await import("bun:test"));
} else {
  const nodeTest = await import("node:test");
  const assert = await import("node:assert/strict");
  test = nodeTest.test;
  expect = value => ({
    toBe: expected => assert.strictEqual(value, expected),
  });
}

// Create a fixture module that reports its own __dirname.
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "bun-require-dirname-"));
  const child = join(root, "child.js");
  writeFileSync(child, "module.exports = __dirname;");
  return { root, child };
}

test("__dirname is correct when requiring an absolute path with forward slashes", () => {
  const { root } = makeFixture();
  try {
    // Build the id with string concatenation so the forward slashes are
    // preserved (path.join would normalize them away on Windows).
    const forward = root.replaceAll("\\", "/");
    for (const id of [forward + "/child", forward + "/child.js"]) {
      expect(require(id)).toBe(dirname(require.resolve(id)));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("__dirname is correct when requiring an absolute path with native separators", () => {
  const { root } = makeFixture();
  try {
    const id = join(root, "child.js");
    expect(require(id)).toBe(dirname(require.resolve(id)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});