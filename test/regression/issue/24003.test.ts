import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

// Issue: https://github.com/oven-sh/bun/issues/24003
// Async stack traces are not produced within AsyncLocalStorage

test("async stack traces should be preserved within AsyncLocalStorage", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();

  async function fn3() {
    await Bun.sleep(1);
    throw new Error("Error in fn3");
  }

  async function fn2() {
    await Bun.sleep(1);
    await fn3();
  }

  async function fn1() {
    await Bun.sleep(1);
    await fn2();
  }

  // Get stack trace without AsyncLocalStorage
  let stackWithoutALS: string | undefined;
  try {
    await fn1();
  } catch (error: any) {
    stackWithoutALS = error.stack;
  }

  // Get stack trace with AsyncLocalStorage
  let stackWithALS: string | undefined;
  try {
    await asyncLocalStorage.run(null, async () => {
      await fn1();
    });
  } catch (error: any) {
    stackWithALS = error.stack;
  }

  expect(stackWithoutALS).toBeDefined();
  expect(stackWithALS).toBeDefined();

  // Both stacks should contain references to fn1, fn2, and fn3
  expect(stackWithoutALS).toContain("fn3");
  expect(stackWithoutALS).toContain("fn2");
  expect(stackWithoutALS).toContain("fn1");

  // The stack with ALS should also contain all three functions
  expect(stackWithALS).toContain("fn3");
  expect(stackWithALS).toContain("fn2");
  expect(stackWithALS).toContain("fn1");

  // Both should have similar stack depth (within reason)
  const countOccurrences = (str: string, substr: string) => {
    return (str.match(new RegExp(substr, "g")) || []).length;
  };

  const withoutALSFrames = countOccurrences(stackWithoutALS!, "at ");
  const withALSFrames = countOccurrences(stackWithALS!, "at ");

  // The stack with ALS might have a couple extra frames from the ALS.run() call,
  // but it should not be drastically different
  expect(Math.abs(withoutALSFrames - withALSFrames)).toBeLessThan(5);
});

test("async stack traces with Promise.resolve", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();

  async function fn3() {
    await Promise.resolve();
    throw new Error("Error in fn3");
  }

  async function fn2() {
    await Promise.resolve();
    await fn3();
  }

  async function fn1() {
    await Promise.resolve();
    await fn2();
  }

  let stackWithoutALS: string | undefined;
  try {
    await fn1();
  } catch (error: any) {
    stackWithoutALS = error.stack;
  }

  let stackWithALS: string | undefined;
  try {
    await asyncLocalStorage.run(null, async () => {
      await fn1();
    });
  } catch (error: any) {
    stackWithALS = error.stack;
  }

  expect(stackWithoutALS).toContain("fn3");
  expect(stackWithoutALS).toContain("fn2");
  expect(stackWithoutALS).toContain("fn1");

  expect(stackWithALS).toContain("fn3");
  expect(stackWithALS).toContain("fn2");
  expect(stackWithALS).toContain("fn1");
});
