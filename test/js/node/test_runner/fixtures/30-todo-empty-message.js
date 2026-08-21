// Node's todo directive is presence-based: { todo: "" } marks the test (or
// suite) todo just like { todo: true }, so neither failing body below may be
// reported as a failure (node v26.3.0 reports both with the todo directive
// and exits 0).
const { describe, it, test } = require("node:test");

test("todo with an empty message", { todo: "" }, () => {
  throw new Error("a todo body must not fail the file");
});

describe("todo suite with an empty message", { todo: "" }, () => {
  it("child of a todo suite", () => {
    throw new Error("a todo suite's child must not fail the file");
  });
});

test("sanity", () => {});
