// Under `bun test` the shim follows Node's runner semantics: without
// --test-only, `only` registers an ordinary test/suite (and must never trip
// bun:test's CI-only guard; this file runs with CI=1 in node-test.test.ts).
const assert = require("node:assert");
const { test, describe } = require("node:test");

const ran = [];
test.only("only-marked test runs", () => {
  ran.push("only");
});
test("sibling of an only-marked test also runs", () => {
  ran.push("sibling");
});
describe.only("only-marked suite runs", () => {
  test("test inside an only-marked suite", () => {
    ran.push("suite-child");
  });
});
test("only is a no-op without --test-only", () => {
  assert.deepStrictEqual(ran.sort(), ["only", "sibling", "suite-child"]);
});
