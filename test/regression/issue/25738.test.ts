import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/25738
// Error.prepareStackTrace should include all intermediate stack frames

test("Error.prepareStackTrace call sites include all intermediate frames", () => {
  function getCallSites() {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const obj = {};
    Error.captureStackTrace(obj);
    const stack = obj.stack;
    Error.prepareStackTrace = orig;
    return stack.slice(1); // Skip getCallSites itself
  }

  function innerFunction() {
    const sites = getCallSites();
    return sites.map((s: any) => s.getFunctionName() || "<anonymous>");
  }

  function middleFunction() {
    return innerFunction();
  }

  function outerFunction() {
    return middleFunction();
  }

  const result = outerFunction();

  // The first 4 frames should be:
  // 0: innerFunction (where getCallSites is called)
  // 1: middleFunction (calls innerFunction)
  // 2: outerFunction (calls middleFunction)
  // 3: <anonymous> (test function)
  expect(result[0]).toBe("innerFunction");
  expect(result[1]).toBe("middleFunction");
  expect(result[2]).toBe("outerFunction");
  // The 4th frame is the anonymous test function - no need to assert its name
});

test("Error stack trace includes all intermediate frames", () => {
  let capturedStack: string | undefined;

  function innerFunction() {
    try {
      throw new Error("test");
    } catch (e: any) {
      capturedStack = e.stack;
    }
  }

  function middleFunction() {
    innerFunction();
  }

  function outerFunction() {
    middleFunction();
  }

  outerFunction();

  expect(capturedStack).toBeDefined();
  expect(capturedStack).toContain("innerFunction");
  expect(capturedStack).toContain("middleFunction");
  expect(capturedStack).toContain("outerFunction");
});

test("Error.captureStackTrace with caller argument skips frames correctly", () => {
  function getCallSites(caller?: Function) {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const obj = {};
    Error.captureStackTrace(obj, caller);
    const stack = obj.stack;
    Error.prepareStackTrace = orig;
    return stack.map((s: any) => s.getFunctionName() || "<anonymous>");
  }

  function innerFunction() {
    return getCallSites(innerFunction);
  }

  function middleFunction() {
    return innerFunction();
  }

  function outerFunction() {
    return middleFunction();
  }

  const result = outerFunction();

  // When caller is innerFunction, the stack should start from middleFunction
  expect(result[0]).toBe("middleFunction");
  expect(result[1]).toBe("outerFunction");
});

test("deeply nested function calls preserve all frames", () => {
  function getCallSites() {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const obj = {};
    Error.captureStackTrace(obj);
    const stack = obj.stack;
    Error.prepareStackTrace = orig;
    return stack.slice(1).map((s: any) => s.getFunctionName() || "<anonymous>");
  }

  function level1() {
    return getCallSites();
  }

  function level2() {
    return level1();
  }

  function level3() {
    return level2();
  }

  function level4() {
    return level3();
  }

  function level5() {
    return level4();
  }

  const result = level5();

  expect(result[0]).toBe("level1");
  expect(result[1]).toBe("level2");
  expect(result[2]).toBe("level3");
  expect(result[3]).toBe("level4");
  expect(result[4]).toBe("level5");
});
