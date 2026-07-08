const { test, describe } = require("node:test");

// In Node, describe(name, { skip: true }, fn) marks the suite as skipped
// and never calls fn. A LOG: line below reaching stdout means the body was
// evaluated; a RAN: line means a child test executed.

describe("via options skip:true", { skip: true }, () => {
  console.log("LOG:options-skip-body");
  test("inner", t => {
    console.log("RAN:options-skip-inner");
    t.assert.fail("must not run");
  });
});

describe("via options skip:'reason'", { skip: "needs docker" }, () => {
  console.log("LOG:options-skip-string-body");
  test("inner", t => t.assert.fail("must not run"));
});

describe("via options todo:true", { todo: true }, () => {
  test("inner", t => t.assert.ok(true));
});

describe("via options skip:false", { skip: false }, () => {
  test("inner runs", t => {
    console.log("RAN:options-skip-false-inner");
    t.assert.ok(true);
  });
});

describe.skip("via method skip", () => {
  console.log("LOG:method-skip-body");
  test("inner", t => t.assert.fail("must not run"));
});
