import { expect, test, describe, beforeEach, beforeAll, afterAll, afterEach } from "bun:test";

beforeAll(() => {
  console.log("beforeAll");
});

afterAll(() => {
  console.log("afterAll");
});

test("<!-- <Test [0]> -->", () => {
  console.log("Test #1 ran");
});

test("<!-- <Test [1]> -->", () => {
  console.log("Test #2 ran");
});

describe("<!-- <Describe [0]> -->", () => {
  beforeEach(() => {
    console.log("beforeEach");
  });

  afterEach(() => {
    console.log("afterEach");
  });

  test("<!-- <Test In Describe [0]> -->", () => {
    console.log("Test #3 ran");
  });
  /// --- Before Test#2InDescribe

  test("<!-- <Test In Describe [1]> -->", () => {
    console.log("Test #4 ran");
  });

  // --- Before Test#3InDescribe

  test("<!-- <Test In Describe [2]> -->", () => {
    console.log("Test #5 ran");
  });
});

// --- Before test.only
test.only("<!-- <Test [5]> -->", () => {
  console.log("Test #6 ran");
});

// After test.only

test("<!-- <Test [6]> -->", () => {
  console.log("Test #7 ran");
});
