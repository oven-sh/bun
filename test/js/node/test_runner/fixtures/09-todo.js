const test = require("node:test");
const { describe, before, after } = test;
const assert = require("node:assert");

// Node runs the body of a `todo` test and reports the outcome as todo either
// way; a failing todo never fails the run. The LOG: lines prove each body ran.

test("passing todo (option)", { todo: true }, () => {
  console.log("LOG:passing-todo-option");
});

test("failing todo (option)", { todo: true }, () => {
  console.log("LOG:failing-todo-option");
  assert.fail("expected failure: must be reported as todo, not fail the run");
});

test.todo("passing todo (modifier)", () => {
  console.log("LOG:passing-todo-modifier");
});

test.todo("failing todo (modifier)", () => {
  console.log("LOG:failing-todo-modifier");
  assert.fail("expected failure: must be reported as todo, not fail the run");
});

test("todo with a reason string", { todo: "not implemented yet" }, () => {
  console.log("LOG:todo-reason-string");
});

test.todo("todo without a body");

// The 10ms test timeout always wins the race against a 500ms timer. The timer
// (rather than a never-settling promise) is a bound on how long the body stays
// pending, so the process always reaches the next test and exits on its own.
test("todo that times out", { todo: true, timeout: 10 }, async () => {
  console.log("LOG:todo-timeout");
  await new Promise(resolve => setTimeout(resolve, 500));
});

// `skip` wins over `todo` in Node: the body must never execute.
test("skip wins over todo", { todo: true, skip: true }, () => {
  console.log("LOG:MUST-NOT-APPEAR-skip-and-todo");
  assert.fail("a skipped body must never execute");
});

test.todo("skip wins over the todo modifier", { skip: true }, () => {
  console.log("LOG:MUST-NOT-APPEAR-skip-and-todo-modifier");
  assert.fail("a skipped body must never execute");
});

describe.todo("skipped todo suite", { skip: true }, () => {
  test("inside the skipped todo suite", () => {
    console.log("LOG:MUST-NOT-APPEAR-skipped-todo-suite");
    assert.fail("a skipped suite's bodies must never execute");
  });
});

test("regular test still runs", () => {
  console.log("LOG:regular");
});

describe.todo("todo suite (modifier)", () => {
  // A passing hook must not be reported or counted as a todo entry.
  before(() => {
    console.log("LOG:passing-before-hook");
  });

  test("inside the modifier suite", () => {
    console.log("LOG:todo-suite-modifier");
  });

  // Node never runs an explicitly skipped body, even inside a todo suite.
  test("skipped inside the todo suite", { skip: true }, () => {
    console.log("LOG:MUST-NOT-APPEAR-skip-in-todo-suite");
    assert.fail("a skipped body must never execute");
  });
});

describe("todo suite (option)", { todo: true }, () => {
  test("inside the option suite", () => {
    console.log("LOG:todo-suite-option");
    assert.fail("expected failure: must be reported as todo, not fail the run");
  });
});

// Node runs a todo suite's before/after hooks and absorbs their failures too,
// whether they throw synchronously or reject asynchronously: the hook and the
// tests it cancels are reported as todo, never as failures.
describe.todo("throwing before suite", () => {
  before(() => {
    console.log("LOG:before-hook");
    assert.fail("expected failure: a todo suite's before() must not fail the run");
  });

  test("after the failing before", () => {
    console.log("LOG:after-failed-before");
  });
});

describe("throwing after suite", { todo: true }, () => {
  after(async () => {
    console.log("LOG:after-hook");
    assert.fail("expected failure: a todo suite's rejecting after() must not fail the run");
  });

  test("inside the after suite", () => {
    console.log("LOG:inside-after-suite");
  });
});
