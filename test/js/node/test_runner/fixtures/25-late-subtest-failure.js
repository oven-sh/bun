const { test } = require("node:test");
const assert = require("node:assert");

// A t.test() that escapes its parent (the forgot-to-await shape): Node runs the
// body, resolves the returned promise with undefined, and records the late
// subtest as a parentAlreadyFinished failure so the run exits 1. Before the
// fix, bun resolved the promise but dropped the failure and exited 0.
let saved;
let bodyRan = false;
let resolvedWith = "unset";

test("parent", t => {
  saved = t;
});

test("observer", async () => {
  const result = await saved.test("late", () => {
    bodyRan = true;
  });
  resolvedWith = result;
  console.log("RESOLVED_WITH=" + String(resolvedWith));
  console.log("BODY_RAN=" + String(bodyRan));
  // A late skip/todo subtest is not counted as a failure (Node exits 0 for
  // those); these must not add further fail entries to this run.
  await saved.test("late-skip", { skip: true }, () => {});
  await saved.test("late-todo", { todo: true }, () => {});
});

process.on("exit", () => {
  assert.strictEqual(bodyRan, true, "late subtest body must run (Node runs it)");
  assert.strictEqual(resolvedWith, undefined, "late subtest promise must resolve to undefined");
});
