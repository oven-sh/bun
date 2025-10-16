// Basic tests to verify retry and repeats functionality works
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("retry option", () => {
  let attempts = 0;
  test(
    "retries failed test until it passes",
    () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("fail");
      }
      expect(attempts).toBe(3);
    },
    { retry: 3 },
  );
});

describe("repeats option with hooks", () => {
  let log: string[] = [];

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

  test("verify hooks ran for each repeat", () => {
    // Should have: beforeEach, test, afterEach (first), beforeEach, test, afterEach (second), beforeEach (this test)
    expect(log).toEqual(["beforeEach", "test", "afterEach", "beforeEach", "test", "afterEach", "beforeEach"]);
  });
});

describe("retry option with hooks", () => {
  let attempts = 0;
  let log: string[] = [];

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

  test("verify hooks ran for each retry", () => {
    // Should have: beforeEach, test-1, afterEach (fail), beforeEach, test-2, afterEach (pass), beforeEach (this test)
    expect(log).toEqual(["beforeEach", "test-1", "afterEach", "beforeEach", "test-2", "afterEach", "beforeEach"]);
  });
});
