// Bun only: node has no t.describe(). `only` is not applied to a suite that a running test declares.
const assert = require("node:assert");
const { test, after } = require("node:test");

const seen = [];
after(() => assert.deepStrictEqual(seen, ["RAN suite > not marked", "RAN suite > marked", "RAN after the suite"]));

test.only("t.describe()", async t => {
  await t.describe("suite", () => {
    test("not marked", () => seen.push("RAN suite > not marked"));
    test.only("marked", () => seen.push("RAN suite > marked"));
  });
  await t.test("after the suite", () => seen.push("RAN after the suite"));
});
