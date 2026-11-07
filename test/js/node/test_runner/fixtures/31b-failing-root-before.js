// A before() hook at the root of the file. Node v26.3.0 runs no test body after it fails.
const { before, describe, test } = require("node:test");

before(() => {
  throw new Error("root before() threw");
});

test("must not run", () => {
  console.log("BODY RAN at the root");
});

describe("suite", () => {
  test("must not run", () => {
    console.log("BODY RAN in the suite");
  });
});
