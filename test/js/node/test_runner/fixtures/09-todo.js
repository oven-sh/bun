const test = require("node:test");
const { describe } = test;
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

test("regular test still runs", () => {
  console.log("LOG:regular");
});

describe.todo("todo suite (modifier)", () => {
  test("inside the modifier suite", () => {
    console.log("LOG:todo-suite-modifier");
  });
});

describe("todo suite (option)", { todo: true }, () => {
  test("inside the option suite", () => {
    console.log("LOG:todo-suite-option");
    assert.fail("expected failure: must be reported as todo, not fail the run");
  });
});
