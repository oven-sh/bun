// Bun only: this file does not describe Node. Node v26.3.0 checks a truthy
// `plan` when the test starts, also for a skipped test, and the count is then
// an error of the run. Bun does not start every test that it registers, so it
// checks a truthy plan when the test is declared. The error names `options.plan`.
import assert from "node:assert";
import { test } from "node:test";

const noop = () => {};
const expected = `ERR_INVALID_ARG_TYPE: The "options.plan" property must be of type number. Received type string ('x')`;

// Returns the error that `declare` throws.
function declared(declare) {
  try {
    declare();
  } catch (err) {
    return `${err.code}: ${err.message}`;
  }
  return "no error";
}

const atModuleLevel = declared(() => test("never declared", { plan: "x" }, noop));
const skippedAtModuleLevel = declared(() => test("never declared", { plan: "x", skip: true }, noop));

let finished;
test("a test that finishes", t => {
  finished = t;
});

test("an invalid truthy plan is reported when the test is declared", t => {
  assert.strictEqual(atModuleLevel, expected);
  assert.strictEqual(skippedAtModuleLevel, expected);
  assert.strictEqual(
    declared(() => t.test("never declared", { plan: "x" }, noop)),
    expected,
  );
  assert.strictEqual(
    declared(() => finished.test("never declared", { plan: "x" }, noop)),
    expected,
  );
});
