// Under `--only` / `--test-only` (Node's --test-only) the seven only-marked
// entries are selected (five run, one todo, one skip); without the flag `only`
// is a no-op and all ten entries are selected.
const { test, describe } = require("node:test");

test.only("top-level only modifier", () => console.log("RAN top-only-modifier"));
test("top-level only option", { only: true }, () => console.log("RAN top-only-option"));
test("top-level plain", () => console.log("RAN top-plain"));

describe.only("only-modifier suite", () => {
  test("child of only-modifier suite", () => console.log("RAN suite-modifier-child"));
});
describe("only-option suite", { only: true }, () => {
  test("child of only-option suite", () => console.log("RAN suite-option-child"));
});
describe("plain suite", () => {
  test.only("only test inside plain suite", () => console.log("RAN plain-suite-only-child"));
  test("plain test inside plain suite", () => console.log("RAN plain-suite-plain-child"));
});
describe("unmarked suite", () => {
  test("unmarked child", () => console.log("RAN unmarked-child"));
});
// `only` is independent of skip/todo: under --test-only these are included in
// the filter and reported as their directive, not filtered out.
test.only("only+todo", { todo: true }, () => console.log("RAN only-todo"));
test.only("only+skip", { skip: true }, () => console.log("RAN only-skip"));
