// Runs after 14-root-hooks-a.js in the same `bun test` process: this file's
// module-scope registrations (made before its first test) must survive the
// per-file reset, and file A's hooks/mocks/assertions must not apply here.
const assert = require("node:assert");
const { test, mock, assert: testAssert } = require("node:test");

// File A's mock on the shared object must be restored before this one is
// captured, so restoring this one yields the true original.
mock.method(globalThis.__sharedTarget, "v", () => "B");
testAssert.register("fileBOnly", () => {});

test("first test in file B", () => {});

test("file A's file-level beforeEach and custom assertion did not leak into file B", t => {
  assert.strictEqual(globalThis.__fileARootHookRuns, 1);
  assert.strictEqual(t.assert.fileAOnly, undefined);
});

test("module-scope registrations from this file survive and capture the true original", t => {
  assert.strictEqual(typeof t.assert.fileBOnly, "function");
  assert.strictEqual(globalThis.__sharedTarget.v(), "B");
  globalThis.__sharedTarget.v.mock.restore();
  assert.strictEqual(globalThis.__sharedTarget.v(), "original");
});
