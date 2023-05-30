import { test, expect, describe } from "bun:test";

describe("describe #1", () => {
  test("test #1a", () => {});
  test.skip("test #1b", () => {});
  test.todo("test #1c", () => {});
  test.todo("test #1d");

  describe("describe #2", () => {
    test("test #2a", () => {});
  });

  describe.skip("describe #3", () => {
    test("test #3a", () => {});
    throw new Error();
    test.skip("test #3b", () => {});
    test.todo("test #3c", () => {});
    test.todo("test #3d");
  });

  describe.todo("describe #4", () => {
    test("test #4a", () => {});
    test.skip("test #4b", () => {});
    test.todo("test #4c", () => {});
    test.todo("test #4d");
  });
});

describe("describe #5", () => {
  test("test #5a", () => {});
});

test("test #5", () => {});
