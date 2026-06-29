const { describe, test } = require("node:test");
const assert = require("node:assert");

// Node validates `concurrency` as a boolean or an integer >= 1.
for (const concurrency of [0, -1, 1.5, Infinity, NaN]) {
  assert.throws(() => describe("rejected", { concurrency }, () => {}), { code: "ERR_OUT_OF_RANGE" });
}
assert.throws(() => describe("rejected", { concurrency: "yes" }, () => {}), { code: "ERR_INVALID_ARG_TYPE" });

test("invalid concurrency values were rejected", () => {});
