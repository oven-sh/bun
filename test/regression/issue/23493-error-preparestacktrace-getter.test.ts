// https://github.com/oven-sh/bun/issues/23493
// When Error.prepareStackTrace is defined with Object.defineProperty using a getter/setter,
// the getter must be called when formatting stack traces

import { expect, test } from "bun:test";

test("Error.prepareStackTrace getter is called when defined with Object.defineProperty", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
  let getterCallCount = 0;
  let prepareCallCount = 0;

  const myPrepareStackTrace = function (err: Error, callsites: any[]) {
    prepareCallCount++;
    return "Custom stack trace";
  };

  // This is how error-callsites and similar modules define prepareStackTrace
  Object.defineProperty(Error, "prepareStackTrace", {
    configurable: true,
    enumerable: true,
    get: function () {
      getterCallCount++;
      return myPrepareStackTrace;
    },
    set: function (fn: any) {
      // setter not used in this test
    },
  });

  try {
    const err = new Error("test error");
    const stack = err.stack;

    // The getter should be called at least once when formatting the stack
    // The prepare function should also be called
    expect(getterCallCount).toBeGreaterThan(0);
    expect(prepareCallCount).toBeGreaterThanOrEqual(1);
    expect(stack).toBe("Custom stack trace");
  } finally {
    // Restore original descriptor
    if (originalDescriptor) {
      Object.defineProperty(Error, "prepareStackTrace", originalDescriptor);
    } else {
      delete (Error as any).prepareStackTrace;
    }
  }
});

test("error-callsites module compatibility", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");

  // Simulate what error-callsites does
  const callsitesSym = Symbol("callsites");

  const fallback =
    (Error as any).prepareStackTrace ||
    function (err: Error, callsites: any[]) {
      return err.stack;
    };

  let lastPrepareStackTrace = fallback;

  Object.defineProperty(Error, "prepareStackTrace", {
    configurable: true,
    enumerable: true,
    get: function () {
      return csPrepareStackTrace;
    },
    set: function (fn: any) {
      if (fn === csPrepareStackTrace || fn === undefined) {
        lastPrepareStackTrace = fallback;
      } else {
        lastPrepareStackTrace = fn;
      }
    },
  });

  function csPrepareStackTrace(err: any, callsites: any[]) {
    if (Object.prototype.hasOwnProperty.call(err, callsitesSym)) {
      return fallback(err, callsites);
    }

    Object.defineProperty(err, callsitesSym, {
      enumerable: false,
      configurable: true,
      writable: false,
      value: callsites,
    });

    return lastPrepareStackTrace(err, callsites);
  }

  function errorCallsites(err: any) {
    err.stack; // eslint-disable-line no-unused-expressions
    return err[callsitesSym];
  }

  try {
    const err = new Error("test error");
    const callsites = errorCallsites(err);

    // Should return an array of callsites, not undefined
    expect(callsites).toBeDefined();
    expect(Array.isArray(callsites)).toBe(true);
    expect(callsites.length).toBeGreaterThan(0);

    // Verify callsites have expected properties
    const firstCallsite = callsites[0];
    expect(firstCallsite).toBeDefined();
    expect(typeof firstCallsite.getFileName).toBe("function");
    expect(typeof firstCallsite.getLineNumber).toBe("function");
  } finally {
    // Restore original descriptor
    if (originalDescriptor) {
      Object.defineProperty(Error, "prepareStackTrace", originalDescriptor);
    } else {
      delete (Error as any).prepareStackTrace;
    }
  }
});
