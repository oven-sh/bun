import { beforeAll, describe, expect, it } from "bun:test";

// Execution order log
const executionLog: string[] = [];

describe("outer", () => {
  console.log("EVALUATION: outer describe");

  beforeAll(() => {
    console.log("EXECUTION: outer beforeAll");
    executionLog.push("outer beforeAll");
  });

  describe("inner1", () => {
    console.log("EVALUATION: inner1 describe");

    beforeAll(() => {
      console.log("EXECUTION: inner1 beforeAll");
      executionLog.push("inner1 beforeAll");
    });

    it("inner1 test", () => {
      console.log("EXECUTION: inner1 test");
      executionLog.push("inner1 test");
      expect(true).toBe(true);
    });
  });

  describe("inner2", () => {
    console.log("EVALUATION: inner2 describe");

    beforeAll(() => {
      console.log("EXECUTION: inner2 beforeAll");
      executionLog.push("inner2 beforeAll");
    });

    it("inner2 test", () => {
      console.log("EXECUTION: inner2 test");
      executionLog.push("inner2 test");
      expect(true).toBe(true);
    });
  });

  // At the end of all tests, we'll check if execution order matches what we expect
  it("should execute beforeAll hooks in the correct order", () => {
    console.log("EXECUTION: outer test");

    // For Jest-compatible behavior, the executionLog should be:
    // [
    //   'outer beforeAll',        // First execute outer beforeAll
    //   'inner1 beforeAll',       // Then inner1 beforeAll right before its tests
    //   'inner1 test',            // Then inner1 test
    //   'inner2 beforeAll',       // Then inner2 beforeAll right before its tests
    //   'inner2 test',            // Then inner2 test
    //   'outer test'              // Then the outer test
    // ]

    // But currently in Bun, the executionLog is:
    // [
    //   'outer beforeAll',
    //   'inner1 beforeAll',
    //   'inner2 beforeAll',
    //   'inner1 test',
    //   'inner2 test',
    //   'outer test'
    // ]

    console.log("Execution log:", executionLog);

    // This test will initially fail, but after our fix it should pass
    expect(executionLog).toEqual([
      "outer beforeAll",
      "inner1 beforeAll",
      "inner1 test",
      "inner2 beforeAll",
      "inner2 test",
      "outer test",
    ]);
  });
});
