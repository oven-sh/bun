const test = require("node:test");

// bun only: with `bun test --retry 1` the second attempt starts without the failure of the first.
let attempt = 0;

test("fails on the first attempt", () => {
  if (++attempt === 1) throw new Error("first attempt");
});
