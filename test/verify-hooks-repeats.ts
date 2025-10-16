import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("repeats with hooks", () => {
  let log: string[] = [];

  beforeEach(() => {
    log.push("beforeEach");
  });

  afterEach(() => {
    log.push("afterEach");
  });

  test(
    "repeat test",
    () => {
      log.push("test");
    },
    { repeats: 2 },
  );

  test("verify hooks ran twice", () => {
    // Should have: beforeEach, test, afterEach (first), beforeEach, test, afterEach (second), beforeEach (this test)
    expect(log).toEqual(["beforeEach", "test", "afterEach", "beforeEach", "test", "afterEach", "beforeEach"]);
  });
});

describe("retry with hooks", () => {
  let attempts = 0;
  let log: string[] = [];

  beforeEach(() => {
    log.push("beforeEach");
  });

  afterEach(() => {
    log.push("afterEach");
  });

  test(
    "flaky test",
    () => {
      attempts++;
      log.push(`test-${attempts}`);
      if (attempts < 2) {
        throw new Error("fail");
      }
    },
    { retry: 3 },
  );

  test("verify hooks ran for retries", () => {
    // Should have: beforeEach, test-1, afterEach (fail), beforeEach, test-2, afterEach (pass), beforeEach (this test)
    expect(log).toEqual(["beforeEach", "test-1", "afterEach", "beforeEach", "test-2", "afterEach", "beforeEach"]);
  });
});
