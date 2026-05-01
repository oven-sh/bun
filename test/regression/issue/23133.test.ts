// https://github.com/oven-sh/bun/issues/23133
// Passing HookOptions to lifecycle hooks should work
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";

const logs: string[] = [];

// Test beforeAll with object timeout option
beforeAll(
  () => {
    logs.push("beforeAll with object timeout");
  },
  { timeout: 10_000 },
);

// Test beforeAll with numeric timeout option
beforeAll(() => {
  logs.push("beforeAll with numeric timeout");
}, 5000);

// Test beforeEach with timeout option
beforeEach(
  () => {
    logs.push("beforeEach");
  },
  { timeout: 10_000 },
);

// Test afterEach with timeout option
afterEach(
  () => {
    logs.push("afterEach");
  },
  { timeout: 10_000 },
);

// Test afterAll with timeout option
afterAll(
  () => {
    logs.push("afterAll");
  },
  { timeout: 10_000 },
);

test("lifecycle hooks accept timeout options", () => {
  expect(logs).toContain("beforeAll with object timeout");
  expect(logs).toContain("beforeAll with numeric timeout");
  expect(logs).toContain("beforeEach");
});

test("beforeEach runs before each test", () => {
  // beforeEach should have run twice now (once for each test)
  const beforeEachCount = logs.filter(l => l === "beforeEach").length;
  expect(beforeEachCount).toBe(2);
});
