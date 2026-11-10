// node-test.test.ts runs this with `--todo`: the todo body must actually run
// (bun expects a todo body to fail; an empty registration would "pass").
const { test } = require("node:test");

test.todo("a todo body runs and may fail", () => {
  throw new Error("expected todo failure");
});

test("a todo option body runs and may fail", { todo: true }, () => {
  throw new Error("expected todo failure too");
});

test("sibling test still passes", () => {});
