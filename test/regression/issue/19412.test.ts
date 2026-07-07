// https://github.com/oven-sh/bun/issues/19412
// The top-level node:test test() ignored {skip, todo, only} options.
import assert from "node:assert";
import { test } from "node:test";

test("node:test honours { skip: true }", { skip: true }, () => {
  assert.fail("should have been skipped");
});

test("node:test honours { skip: 'reason' }", { skip: "reason" }, () => {
  assert.fail("should have been skipped");
});

test("node:test honours { todo: true }", { todo: true }, () => {
  assert.fail("todo tests may run but failures are not fatal");
});

let nullOptionsRan = false;
test("node:test treats null options as no options", null, () => {
  nullOptionsRan = true;
});

test("node:test ran the previous test's body (fn not dropped)", () => {
  assert.strictEqual(nullOptionsRan, true);
});
