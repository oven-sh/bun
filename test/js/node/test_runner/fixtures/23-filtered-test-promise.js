// node-test.test.ts runs this with `-t "should resolve"`, which filters out
// `filtered-out`. Node still resolves that test's returned promise; a deferred
// tied to a runner bun:test never invokes would hang the awaiting test forever.
const assert = require("node:assert");
const { test, it } = require("node:test");

let bodyRan = false;
const p = test("filtered-out", () => {
  bodyRan = true;
});

it("should resolve the promise of a name-pattern-filtered test", async () => {
  assert.strictEqual(await p, undefined);
  assert.strictEqual(bodyRan, false);
});
