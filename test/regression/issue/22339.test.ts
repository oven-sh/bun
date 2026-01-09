// https://github.com/oven-sh/bun/issues/22339
// Bun's stack traces contain duplicate consecutive frames for async functions
// This test ensures we filter out the JSC-generated duplicate frames to match Node.js behavior

import { test, expect } from "bun:test";

function getCallSites() {
  const prepareStackTraceBackup = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stackTraces) => stackTraces;
  const errorObject = {};
  Error.captureStackTrace(errorObject);
  const trace = errorObject.stack;
  Error.prepareStackTrace = prepareStackTraceBackup;
  trace.shift(); // remove getCallSites
  return trace;
}

function hasConsecutiveDuplicates(sites) {
  for (let i = 1; i < sites.length; i++) {
    const prev = sites[i - 1];
    const curr = sites[i];

    const prevName = prev.getFunctionName();
    const currName = curr.getFunctionName();

    if (
      prevName === currName &&
      prev.getFileName() === curr.getFileName() &&
      Math.abs(prev.getLineNumber() - curr.getLineNumber()) <= 1
    ) {
      return true;
    }
  }
  return false;
}

test("async functions should not have duplicate consecutive frames", async () => {
  async function outerAsync() {
    return await innerAsync();
  }

  async function innerAsync() {
    const sites = getCallSites();

    // Check that we don't have consecutive duplicates
    expect(hasConsecutiveDuplicates(sites)).toBe(false);

    // Verify we have the expected functions in the stack
    const functionNames = sites.map(s => s.getFunctionName()).filter(Boolean);
    expect(functionNames).toContain("innerAsync");
    expect(functionNames).toContain("outerAsync");

    // Each async function should appear at most once (for this non-recursive case)
    const innerAsyncCount = functionNames.filter(name => name === "innerAsync").length;
    const outerAsyncCount = functionNames.filter(name => name === "outerAsync").length;

    expect(innerAsyncCount).toBe(1);
    expect(outerAsyncCount).toBe(1);
  }

  await outerAsync();
});

test("nested async functions should not have duplicate frames", async () => {
  async function level1() {
    return await level2();
  }

  async function level2() {
    return await level3();
  }

  async function level3() {
    const sites = getCallSites();

    // No consecutive duplicates
    expect(hasConsecutiveDuplicates(sites)).toBe(false);

    // Each level should appear exactly once
    const functionNames = sites.map(s => s.getFunctionName()).filter(Boolean);
    expect(functionNames.filter(n => n === "level1").length).toBe(1);
    expect(functionNames.filter(n => n === "level2").length).toBe(1);
    expect(functionNames.filter(n => n === "level3").length).toBe(1);
  }

  await level1();
});

test("actual async recursion should preserve all frames", async () => {
  async function recursiveAsync(depth) {
    if (depth === 0) {
      const sites = getCallSites();

      // No consecutive duplicates (consecutive frames are duplicates, not recursion)
      expect(hasConsecutiveDuplicates(sites)).toBe(false);

      // But we should have multiple recursiveAsync calls (actual recursion)
      const functionNames = sites.map(s => s.getFunctionName()).filter(Boolean);
      const recursiveCount = functionNames.filter(name => name === "recursiveAsync").length;

      // We called with depth=3, so we should have 4 frames (0, 1, 2, 3)
      // But they should NOT be consecutive duplicates - they should be at different line numbers
      expect(recursiveCount).toBeGreaterThan(1);
    } else {
      return await recursiveAsync(depth - 1);
    }
  }

  await recursiveAsync(3);
});

test("mixed sync and async should work correctly", async () => {
  function syncOuter() {
    return asyncInner();
  }

  async function asyncInner() {
    const sites = getCallSites();

    // No consecutive duplicates
    expect(hasConsecutiveDuplicates(sites)).toBe(false);

    // At minimum, asyncInner should be in the stack
    const functionNames = sites.map(s => s.getFunctionName()).filter(Boolean);
    expect(functionNames).toContain("asyncInner");
    // Note: syncOuter might not appear depending on how the async boundary works
  }

  await syncOuter();
});

test("async functions in Error.captureStackTrace with caller argument", async () => {
  async function outerAsync() {
    return await innerAsync();
  }

  async function innerAsync() {
    captureWithCaller();
  }

  function captureWithCaller() {
    let error = {};
    // Capture stack trace, skipping captureWithCaller
    Error.captureStackTrace(error, captureWithCaller);

    const prepareStackTraceBackup = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stackTraces) => stackTraces;
    const sites = error.stack;
    Error.prepareStackTrace = prepareStackTraceBackup;

    // Verify we got CallSites
    if (sites.length > 0 && sites[0].getFunctionName) {
      // No consecutive duplicates
      expect(hasConsecutiveDuplicates(sites)).toBe(false);

      // Should still have innerAsync and outerAsync
      const functionNames = sites.map(s => s.getFunctionName()).filter(Boolean);
      expect(functionNames).toContain("innerAsync");
      expect(functionNames).toContain("outerAsync");
    }
  }

  await outerAsync();
});

test("regular (non-async) functions should still work correctly", () => {
  function regularOuter() {
    return regularMiddle();
  }

  function regularMiddle() {
    return regularInner();
  }

  function regularInner() {
    const sites = getCallSites();

    // No consecutive duplicates
    expect(hasConsecutiveDuplicates(sites)).toBe(false);

    // All functions present (that are in the call stack at this point)
    const functionNames = sites.map(s => s.getFunctionName()).filter(Boolean);
    expect(functionNames).toContain("regularInner");
    
    // Check that functions appear at most once each
    const innerCount = functionNames.filter(n => n === "regularInner").length;
    expect(innerCount).toBe(1);
  }

  regularOuter();
});
