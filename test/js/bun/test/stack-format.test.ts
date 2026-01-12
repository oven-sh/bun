import { expect, test } from "bun:test";

// Additional test cases for FormatStackTraceForJS.cpp Error.stack formatting
// These tests ensure our async frame deduplication works correctly across various scenarios

test("deep async call stacks should not have duplicates", async () => {
  Error.stackTraceLimit = 50; // Increase to see all frames

  async function level1() {
    return await level2();
  }
  async function level2() {
    return await level3();
  }
  async function level3() {
    return await level4();
  }
  async function level4() {
    return await level5();
  }
  async function level5() {
    throw new Error("deep");
  }

  try {
    await level1();
    throw new Error("Should have thrown");
  } catch (e: any) {
    const stack = e.stack;
    const lines = stack.split("\n");

    // Should have all 5 levels
    const levelLines = lines.filter(l => l.includes("level"));
    expect(levelLines.length).toBe(5);

    // No consecutive duplicates
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].trim()).not.toBe(lines[i - 1].trim());
    }

    // No asyncFunctionResume
    expect(stack).not.toContain("asyncFunctionResume");
  }
});

test("actual async recursion should preserve all recursive frames", async () => {
  async function recursiveAsync(n: number): Promise<never> {
    if (n === 0) throw new Error("end");
    return await recursiveAsync(n - 1);
  }

  try {
    await recursiveAsync(3);
    throw new Error("Should have thrown");
  } catch (e: any) {
    const stack = e.stack;
    const recursiveFrames = stack.split("\n").filter((l: string) => l.includes("recursiveAsync"));

    // Should have multiple recursive frames
    expect(recursiveFrames.length).toBeGreaterThan(1);

    // No asyncFunctionResume
    expect(stack).not.toContain("asyncFunctionResume");
  }
});

test("sync function stacks should still work correctly", () => {
  function inner() {
    throw new Error("sync");
  }

  try {
    inner();
    throw new Error("Should have thrown");
  } catch (e: any) {
    const stack = e.stack;

    // Should have the function that threw
    expect(stack).toContain("inner");

    // No asyncFunctionResume in sync code
    expect(stack).not.toContain("asyncFunctionResume");

    // No consecutive duplicates
    const lines = stack.split("\n");
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].trim()).not.toBe(lines[i - 1].trim());
    }
  }
});

test("mixed sync and async should not have duplicates", async () => {
  function syncOuter() {
    return asyncMiddle();
  }

  async function asyncMiddle() {
    return await syncInner();
  }

  function syncInner() {
    throw new Error("mixed");
  }

  try {
    await syncOuter();
    throw new Error("Should have thrown");
  } catch (e: any) {
    const stack = e.stack;
    const lines = stack.split("\n");

    // No consecutive duplicates
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].trim()).not.toBe(lines[i - 1].trim());
    }

    // No asyncFunctionResume
    expect(stack).not.toContain("asyncFunctionResume");
  }
});

test("constructed errors (not thrown) should have clean stacks", async () => {
  async function createError() {
    return new Error("constructed");
  }

  const err = await createError();

  expect(err.stack).toContain("createError");
  expect(err.stack).not.toContain("asyncFunctionResume");

  // No consecutive duplicates
  const lines = err.stack!.split("\n");
  for (let i = 1; i < lines.length; i++) {
    expect(lines[i].trim()).not.toBe(lines[i - 1].trim());
  }
});

test("Promise rejection stacks should not have duplicates", async () => {
  async function rejecter() {
    return await Promise.reject(new Error("rejected"));
  }

  try {
    await rejecter();
    throw new Error("Should have thrown");
  } catch (e: any) {
    const lines = e.stack!.split("\n");

    // No consecutive duplicates
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].trim()).not.toBe(lines[i - 1].trim());
    }

    expect(e.stack).not.toContain("asyncFunctionResume");
  }
});
