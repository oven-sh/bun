const { test } = require("node:test");
const assert = require("node:assert");

// A t.test() that escapes its parent (the forgot-to-await shape): Node runs the
// body, resolves the returned promise with undefined, and records the late
// subtest as a parentAlreadyFinished failure so the run exits 1. Before the
// fix, bun resolved the promise but dropped the failure and exited 0.
let saved;
let bodyRan = false;
let doneBodyRan = false;
let suiteBodyRan = false;
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
  // A (t, done) body must receive a callable done so the body runs to completion.
  await saved.test("late-done", (_t, done) => {
    done();
    doneBodyRan = true;
  });
  console.log("DONE_BODY_RAN=" + String(doneBodyRan));
  // t.describe() after the parent finished takes the same path (isSuite=true).
  await saved.describe("late-suite", () => {
    suiteBodyRan = true;
  });
  console.log("SUITE_BODY_RAN=" + String(suiteBodyRan));
  // A late skip/todo subtest is not counted as a failure (Node exits 0 for
  // those); these must not add further fail entries to this run. Node replaces
  // a {skip:true} body with a noop, so it must not run; a {todo:true} body does.
  let skipBodyRan = false;
  let todoBodyRan = false;
  await saved.test("late-skip", { skip: true }, () => {
    skipBodyRan = true;
  });
  await saved.test("late-todo", { todo: true }, () => {
    todoBodyRan = true;
  });
  console.log("SKIP_BODY_RAN=" + String(skipBodyRan));
  console.log("TODO_BODY_RAN=" + String(todoBodyRan));
});

process.on("exit", () => {
  assert.strictEqual(bodyRan, true, "late subtest body must run (Node runs it)");
  assert.strictEqual(resolvedWith, undefined, "late subtest promise must resolve to undefined");
});
