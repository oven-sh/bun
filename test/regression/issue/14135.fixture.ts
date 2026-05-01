import { describe, test, expect, beforeAll } from "bun:test";

describe("desc1", () => {
  beforeAll(() => {
    console.log("beforeAll 1");
  });
  test("test1", () => {
    console.log("test 1");
  });
});

describe.only("desc2", () => {
  beforeAll(() => {
    console.log("beforeAll 2");
  });
  test("test2", () => {
    console.log("test 2");
  });
});
