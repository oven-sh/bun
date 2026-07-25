// Under `--only` / `--test-only` (Node's --test-only), exactly the five
// only-marked tests run; without the flag, `only` is a no-op and all eight run.
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
