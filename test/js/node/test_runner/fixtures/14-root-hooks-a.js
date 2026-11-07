// node-test.test.ts runs this file and then 14-root-hooks-b.js in one
// `bun test` process (in that order): file-level hooks, module-level mocks,
// and assert.register() additions must stay scoped to their own file
// (Node isolates per process).
const assert = require("node:assert");
const { test, beforeEach, mock, assert: testAssert } = require("node:test");

beforeEach(() => {
  globalThis.__fileARootHookRuns = (globalThis.__fileARootHookRuns || 0) + 1;
});

testAssert.register("fileAOnly", () => {});

// Shared with file B, which re-mocks the same method at its module scope.
globalThis.__sharedTarget = { v: () => "original" };
mock.method(globalThis.__sharedTarget, "v", () => "A");

test("file A runs its own file-level beforeEach and sees its own registrations", t => {
  assert.strictEqual(globalThis.__fileARootHookRuns, 1);
  assert.strictEqual(typeof t.assert.fileAOnly, "function");
  assert.strictEqual(globalThis.__sharedTarget.v(), "A");
});
