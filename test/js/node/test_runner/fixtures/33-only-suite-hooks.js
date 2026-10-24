// Passes as it is under `node --test --test-only`. Bun runs the hooks of a suite only where a test in it runs.
const assert = require("node:assert");
const { test, describe, before, after } = require("node:test");

const seen = [];
after(() => {
  assert.deepStrictEqual(seen, [
    "HOOK no test to run before",
    "HOOK no test to run after",
    "HOOK empty before",
    "HOOK empty after",
  ]);
});

test.only("a test that runs", () => {});

describe.only("only suite with no test to run", () => {
  before(() => seen.push("HOOK no test to run before"));
  after(() => seen.push("HOOK no test to run after"));
  test("opts out", { only: false }, () => {});
  test.skip("skipped", () => {});
});

describe.only("empty only suite", () => {
  before(() => seen.push("HOOK empty before"));
  after(() => seen.push("HOOK empty after"));
});
