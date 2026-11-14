const test = require("node:test");

// This file fails on purpose. A test whose subtest failed gets the error
// "1 subtest failed" after its hooks. A `todo` parent does not count its
// subtests on Node, so the parent has to fail. The process prints what the
// context of the parent has at exit.
let parent;

test("parent", async t => {
  parent = t;
  await t.test("child", () => {
    throw new Error("from the child");
  });
});

process.on("exit", () => {
  const { passed, error } = parent;
  const { code, failureType, message, cause } = error;
  console.log("SEEN " + JSON.stringify({ passed, code, failureType, message, cause }));
});
