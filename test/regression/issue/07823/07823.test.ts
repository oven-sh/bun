import { test, expect, mock } from "bun:test";
import { foo } from "./07823.fixture";

test("mock.restore() works with mock.module()", async () => {
  // First, verify original behavior
  expect(foo()).toBe("foo");

  // Mock the module
  mock.module("./07823.fixture", () => ({
    foo: () => "bar",
  }));

  // Verify the mock works
  expect(foo()).toBe("bar");

  // Restore the mock
  mock.restore();

  // Verify original behavior is restored
  expect(foo()).toBe("foo");
});
