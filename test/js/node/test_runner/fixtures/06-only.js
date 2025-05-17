import { test, describe } from "node:test";
import assert from "node:assert";

test("should not run", () => assert.fail());
describe("describe should not run", () => {
  test("test should not run", () => assert.fail());
});

test.only("test.only", () => {});
test("only option", { only: true }, () => {});

describe.only("describe.only", () => {
  test("test", () => {});
});
describe("describe with only option", { only: true }, () => {
  test("test", () => {});
});

describe.only("describe.only with test.only", () => {
  test.todo("should not run", () => assert.fail()); // todo: bun runs this test but it should not
  test.only("test.only", () => {});
  test("only option", { only: true }, () => {});
});
