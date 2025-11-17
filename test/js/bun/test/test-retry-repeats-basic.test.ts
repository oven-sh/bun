// Basic tests to verify retry and repeats functionality works
import { afterAll, afterEach, beforeEach, describe, expect, onTestFinished, test } from "bun:test";

describe("retry option", () => {
  let attempts = 0;
  test(
    "retries failed test until it passes",
    () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("fail");
      }
    },
    { retry: 3 },
  );
  test("correct number of attempts from previous test", () => {
    expect(attempts).toBe(3);
  });
});

describe("repeats option with hooks", () => {
  let log: string[] = [];
  describe("isolated test with repeats", () => {
    beforeEach(() => {
      log.push("beforeEach");
    });

    afterEach(() => {
      log.push("afterEach");
    });

    test(
      "repeats test multiple times",
      () => {
        log.push("test");
      },
      { repeats: 2 },
    );
  });

  test("verify hooks ran for each repeat", () => {
    // Should have: beforeEach, test, afterEach (first), beforeEach, test, afterEach (second), beforeEach, test, afterEach (third)
    // repeats: 2 means 1 initial + 2 repeats = 3 total runs
    expect(log).toEqual([
      "beforeEach",
      "test",
      "afterEach",
      "beforeEach",
      "test",
      "afterEach",
      "beforeEach",
      "test",
      "afterEach",
    ]);
  });
});

describe("retry option with hooks", () => {
  let attempts = 0;
  let log: string[] = [];
  describe("isolated test with retry", () => {
    beforeEach(() => {
      log.push("beforeEach");
    });

    afterEach(() => {
      log.push("afterEach");
    });

    test(
      "retries with hooks",
      () => {
        attempts++;
        log.push(`test-${attempts}`);
        if (attempts < 2) {
          throw new Error("fail");
        }
      },
      { retry: 3 },
    );
  });

  test("verify hooks ran for each retry", () => {
    // Should have: beforeEach, test-1, afterEach (fail), beforeEach, test-2, afterEach (pass)
    expect(log).toEqual(["beforeEach", "test-1", "afterEach", "beforeEach", "test-2", "afterEach"]);
  });
});
describe("repeats with onTestFinished", () => {
  let log: string[] = [];
  test(
    "repeats with onTestFinished",
    () => {
      onTestFinished(() => {
        log.push("onTestFinished");
      });
      log.push("test");
    },
    { repeats: 3 },
  );
  test("verify correct log", () => {
    // repeats: 3 means 1 initial + 3 repeats = 4 total runs
    expect(log).toEqual([
      "test",
      "onTestFinished",
      "test",
      "onTestFinished",
      "test",
      "onTestFinished",
      "test",
      "onTestFinished",
    ]);
  });
});

describe("retry with onTestFinished", () => {
  let attempts = 0;
  let log: string[] = [];
  test(
    "retry with onTestFinished",
    () => {
      attempts++;
      onTestFinished(() => {
        log.push("onTestFinished");
      });
      log.push(`test-${attempts}`);
      if (attempts < 3) {
        throw new Error("fail");
      }
    },
    { retry: 3 },
  );
  test("verify correct log", () => {
    expect(log).toEqual(["test-1", "onTestFinished", "test-2", "onTestFinished", "test-3", "onTestFinished"]);
  });
});

describe("retry with inner afterAll", () => {
  let attempts = 0;
  let log: string[] = [];
  test(
    "retry with inner afterAll",
    () => {
      attempts++;
      afterAll(() => {
        log.push("inner afterAll");
      });
      log.push(`test-${attempts}`);
      if (attempts < 3) {
        throw new Error("fail");
      }
    },
    { retry: 3 },
  );
  test("verify correct log", () => {
    expect(log).toEqual(["test-1", "inner afterAll", "test-2", "inner afterAll", "test-3", "inner afterAll"]);
  });
});

expect(() => {
  test("can't pass both", () => {}, { retry: 5, repeats: 6 });
}).toThrow(/Cannot set both retry and repeats/);
