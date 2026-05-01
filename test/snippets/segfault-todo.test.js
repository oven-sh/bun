// This file will segfault the test runner with BUN_GARBAGE_COLLECTOR_LEVEL=2
import { expect, it, describe } from "bun:test";

it("TEST 1", () => {});

describe("DESC 1", () => {});

it.todo("TEST 2", () => {
  expect(1).toBe(2);
});

it.todo("TEST 3", () => {
  expect(1).toBe(2); // SEGFAULT HERE
});
