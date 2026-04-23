import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/27708
// Error.prepareStackTrace should accept non-ErrorInstance objects as first argument,
// matching V8/Node.js behavior. Previously, Bun threw TypeError when the first
// argument wasn't a JSC ErrorInstance, which caused hangs when libraries like
// @babel/core wrapped Error.prepareStackTrace and delegated to the original.

test("Error.prepareStackTrace accepts non-ErrorInstance objects", () => {
  const orig = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = function (err, trace) {
      return orig!(err, trace);
    };

    function CustomError(this: any, msg: string) {
      this.message = msg;
      Error.captureStackTrace(this, CustomError);
    }
    CustomError.prototype = Object.create(Error.prototype);
    CustomError.prototype.constructor = CustomError;

    // This should NOT throw - previously threw "First argument must be an Error object"
    const err = new (CustomError as any)("test");
    expect(err.stack).toBeString();
    expect(err.stack).toContain("test");
  } finally {
    Error.prepareStackTrace = orig;
  }
});

test("Error.prepareStackTrace works with class that extends Error prototype", () => {
  const orig = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = function (err, trace) {
      return orig!(err, trace);
    };

    // Simulate @xmldom/xmldom's ParseError pattern
    function ParseError(this: any, message: string) {
      this.message = message;
      this.name = "ParseError";
      Error.captureStackTrace(this, ParseError);
    }
    ParseError.prototype = Object.create(Error.prototype);

    const err = new (ParseError as any)("unclosed xml tag");
    expect(err.stack).toBeString();
    expect(err.stack).toContain("unclosed xml tag");
  } finally {
    Error.prepareStackTrace = orig;
  }
});

test("Error.prepareStackTrace still works normally with real Error instances", () => {
  const orig = Error.prepareStackTrace;
  try {
    let callCount = 0;
    Error.prepareStackTrace = function (err, trace) {
      callCount++;
      return orig!(err, trace);
    };

    const err = new Error("real error");
    // Access stack to trigger prepareStackTrace
    expect(err.stack).toBeString();
    expect(err.stack).toContain("real error");
    expect(callCount).toBe(1);
  } finally {
    Error.prepareStackTrace = orig;
  }
});
