import { test, describe } from "node:test";
import assert from "node:assert";

test("skipped with option", { skip: true }, () => assert.fail());
test.skip("skipped with test.skip", () => assert.fail());

describe("describe skipped with option", { skip: true }, () => {
  test("should not run", () => assert.fail());
});
describe.skip("describe skipped with describe.skip", () => {
  test("should not run", () => assert.fail());
});

test("todo with option", { todo: true }, () => assert.fail());
test.todo("todo with test.todo", () => assert.fail());

describe("describe todo with option", { todo: true }, () => {
  test("should not run", () => assert.fail());
});
describe.todo("describe todo with describe.todo", () => {
  test("should not run", () => assert.fail());
});
