import { nativeFrameForTesting } from "bun:internal-for-testing";
import { test, expect, afterEach } from "bun:test";

const origPrepareStackTrace = Error.prepareStackTrace;
afterEach(() => {
  Error.prepareStackTrace = origPrepareStackTrace;
});

test("Regular .stack", () => {
  var err;
  class Foo {
    constructor() {
      err = new Error("wat");
    }
  }

  new Foo();
  expect(err.stack).toMatch(/at new Foo/);
});

test("throw inside Error.prepareStackTrace doesnt crash", () => {
  Error.prepareStackTrace = function (err, stack) {
    Error.prepareStackTrace = null;
    throw new Error("wat");
  };

  expect(() => new Error().stack).toThrow("wat");
});

test("capture stack trace", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    logErrorStackTrace();
  }

  function logErrorStackTrace() {
    let error = {};
    Error.captureStackTrace(error);
    expect(error.stack !== undefined).toBe(true);
  }

  f1();
});

test("capture stack trace with message", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    logErrorStackTrace();
  }

  function logErrorStackTrace() {
    let e1 = { message: "bad error!" };
    Error.captureStackTrace(e1);
    expect(e1.message === "bad error!").toBe(true);

    let e2 = new Error("bad error!");
    Error.captureStackTrace(e2);
    expect(e2.message === "bad error!").toBe(true);
  }

  f1();
});

test("capture stack trace with constructor", () => {
  class S {
    constructor() {
      captureStackTrace();
    }
  }

  function captureStackTrace() {
    let e1 = {};
    Error.captureStackTrace(e1);
    expect(e1.stack.split("\n")[2].includes("new S")).toBe(true);
  }

  let s = new S();
});

test("capture stack trace limit", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    f4();
  }

  function f4() {
    f5();
  }

  function f5() {
    f6();
  }

  function f6() {
    f7();
  }

  function f7() {
    f8();
  }

  function f8() {
    f9();
  }

  function f9() {
    f10();
  }

  function f10() {
    captureStackTrace();
  }

  var originalLimit = Error.stackTraceLimit;
  function captureStackTrace() {
    let e1 = {};
    Error.captureStackTrace(e1);

    expect(e1.stack.split("\n").length).toBe(11);

    let e2 = new Error();
    Error.captureStackTrace(e2);

    expect(e2.stack.split("\n").length).toBe(11);

    let e3 = {};
    Error.stackTraceLimit = 4;
    Error.captureStackTrace(e3);
    expect(e3.stack.split("\n").length).toBe(5);

    let e4 = new Error();
    Error.captureStackTrace(e4);
    expect(e4.stack.split("\n").length).toBe(5);

    let e5 = { stackTraceLimit: 2 };
    Error.captureStackTrace(e5);
    expect(e5.stack.split("\n").length).toBe(5);

    let e6 = {};
    Error.stackTraceLimit = Infinity;
    Error.captureStackTrace(e6);
    expect(e6.stack.split("\n").length).toBe(13);
  }
  try {
    f1();
  } finally {
    Error.stackTraceLimit = originalLimit;
  }
});

test("prepare stack trace", () => {
  function f1() {
    f2();
  }

  function f2() {
    let e = {};
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, stack) => {
      return "custom stack trace";
    };
    Error.captureStackTrace(e);
    expect(e.stack).toBe("custom stack trace");
    Error.prepareStackTrace = prevPrepareStackTrace;
    f3();
  }

  function f3() {
    let e = { message: "bad error!" };
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      expect(e.message === "bad error!").toBe(true);
      expect(s.length).toBe(4);
    };
    Error.stackTraceLimit = 10;
    Error.captureStackTrace(e);
    expect(e.stack === undefined).toBe(true);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

test("capture stack trace second argument", () => {
  function f0() {
    let s = new S();
  }

  class S {
    constructor() {
      f1();
    }
  }

  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    f4();
  }

  function f4() {
    f5();
  }

  function f5() {
    f6();
  }

  function f6() {
    let e = { message: "bad error!" };
    Error.captureStackTrace(e);
    expect(e.stack.split("\n")[1].includes("at f6")).toBe(true);
    expect(e.stack.split("\n")[2].includes("at f5")).toBe(true);

    let e2 = {};
    Error.captureStackTrace(e2, f3);
    expect(e2.stack.split("\n")[1].includes("at f2")).toBe(true);
    expect(e2.stack.split("\n")[2].includes("at f1")).toBe(true);

    let e3 = {};
    Error.captureStackTrace(e3, f9);
    expect(e3.stack.split("\n").length).toBe(1);

    let e4 = { message: "exclude constructor!" };
    Error.captureStackTrace(e4, S.constructor);
    expect(e4.stack.split("\n").length).toBe(1);

    let e5 = { message: "actually exclude constructor!" };
    Error.captureStackTrace(e5, S);
    expect(e5.stack.split("\n")[1].includes("at f0")).toBe(true);
  }

  function f9() {
    // nothing
  }

  f0();
});

test("capture stack trace edge cases", () => {
  let e1 = {};
  Error.captureStackTrace(e1, null);
  expect(e1.stack !== undefined).toBe(true);

  let e2 = {};
  Error.captureStackTrace(e2, undefined);
  expect(e2.stack !== undefined).toBe(true);

  let e3 = {};
  Error.captureStackTrace(e3, 1);
  expect(e3.stack !== undefined).toBe(true);

  let e4 = {};
  Error.captureStackTrace(e4, "foo");
  expect(e4.stack !== undefined).toBe(true);

  let e5 = {};
  Error.captureStackTrace(e5, {});
  expect(e5.stack !== undefined).toBe(true);

  expect(Error.captureStackTrace({})).toBe(undefined);
  expect(Error.captureStackTrace({}, () => {})).toBe(undefined);
  expect(Error.captureStackTrace({}, undefined)).toBe(undefined);
  expect(Error.captureStackTrace({}, null)).toBe(undefined);
  expect(Error.captureStackTrace({}, 1)).toBe(undefined);
  expect(Error.captureStackTrace({}, "foo")).toBe(undefined);
  expect(Error.captureStackTrace({}, {})).toBe(undefined);
  expect(Error.captureStackTrace({}, [])).toBe(undefined);
  expect(Error.captureStackTrace({}, true)).toBe(undefined);
});

test("prepare stack trace call sites", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    let e = { message: "bad error!" };
    // let e = new Error("bad error!");
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      expect(s[0].getThis !== undefined).toBe(true);
      expect(s[0].getTypeName !== undefined).toBe(true);
      expect(s[0].getFunction !== undefined).toBe(true);
      expect(s[0].getFunctionName !== undefined).toBe(true);
      expect(s[0].getMethodName !== undefined).toBe(true);
      expect(s[0].getFileName !== undefined).toBe(true);
      expect(s[0].getLineNumber !== undefined).toBe(true);
      expect(s[0].getColumnNumber !== undefined).toBe(true);
      expect(s[0].getEvalOrigin !== undefined).toBe(true);
      expect(s[0].isToplevel !== undefined).toBe(true);
      expect(s[0].isEval !== undefined).toBe(true);
      expect(s[0].isNative !== undefined).toBe(true);
      expect(s[0].isConstructor !== undefined).toBe(true);
      expect(s[0].isAsync !== undefined).toBe(true);
      expect(s[0].isPromiseAll !== undefined).toBe(true);
      expect(s[0].getPromiseIndex !== undefined).toBe(true);
    };
    Error.captureStackTrace(e);
    expect(e.stack === undefined).toBe(true);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

test("sanity check", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    let e = new Error("bad error!");
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      // getThis returns undefined in strict mode
      expect(s[0].getThis()).toBe(undefined);
      expect(s[0].getTypeName()).toBe("undefined");
      // getFunction returns undefined in strict mode
      expect(s[0].getFunction()).toBe(undefined);
      expect(s[0].getFunctionName()).toBe("f3");
      expect(s[0].getMethodName()).toBe("f3");
      expect(typeof s[0].getLineNumber()).toBe("number");
      expect(typeof s[0].getColumnNumber()).toBe("number");
      expect(s[0].getFileName().includes("capture-stack-trace.test.js")).toBe(true);

      expect(s[0].getEvalOrigin()).toBe(undefined);
      expect(s[0].isToplevel()).toBe(true);
      expect(s[0].isEval()).toBe(false);
      expect(s[0].isNative()).toBe(false);
      expect(s[0].isConstructor()).toBe(false);
      expect(s[0].isAsync()).toBe(false);
      expect(s[0].isPromiseAll()).toBe(false);
      expect(s[0].getPromiseIndex()).toBe(null);
    };
    Error.captureStackTrace(e);
    expect(e.stack === undefined).toBe(true);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

test("CallFrame.p.getThisgetFunction: works in sloppy mode", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const sloppyFn = new Function("let e=new Error();Error.captureStackTrace(e);return e.stack");
  sloppyFn.displayName = "sloppyFnWow";
  const that = {};

  Error.prepareStackTrace = (e, s) => {
    expect(s[0].getThis()).toBe(that);
    expect(s[0].getFunction()).toBe(sloppyFn);
    expect(s[0].getFunctionName()).toBe(sloppyFn.displayName);
    expect(s[0].isToplevel()).toBe(false);
    // TODO: This should be true.
    expect(s[0].isEval()).toBe(false);

    // Strict-mode functions shouldn't have getThis or getFunction
    // available.
    expect(s[1].getThis()).toBe(undefined);
    expect(s[1].getFunction()).toBe(undefined);
  };

  sloppyFn.call(that);

  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.getThisgetFunction: strict/sloppy mode interaction", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;

  const strictFn = new Function('"use strict";let e=new Error();Error.captureStackTrace(e);return e.stack');
  const sloppyFn = new Function("x", "x()");
  const that = {};

  Error.prepareStackTrace = (e, s) => {
    // The first strict mode function encounted during stack unwinding
    // stops subsequent frames from having getThis\getFunction.
    for (const t of s) {
      expect(t.getThis()).toBe(undefined);
      expect(t.getFunction()).toBe(undefined);
    }
  };

  sloppyFn.call(that, strictFn);

  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.isConstructor", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;

  class C {
    constructor() {
      Error.captureStackTrace(new Error(""));
    }
  }

  Error.prepareStackTrace = (e, s) => {
    expect(s[0].isConstructor()).toBe(true);
    // TODO: should be false: this is an instance of C
    expect(s[0].isToplevel()).toBe(true);
    // TODO: should return the class name
    // expect(s[0].getTypeName()).toBe('C');

    expect(s[1].isConstructor()).toBe(false);
    expect(s[1].isToplevel()).toBe(true);
  };
  new C();
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.isNative", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => {
    expect(s[0].isNative()).toBe(false);
    expect(s[1].isNative()).toBe(true);
    expect(s[2].isNative()).toBe(false);
  };

  nativeFrameForTesting(() => {
    const err = new Error("");
    Error.captureStackTrace(err);
    return 0;
  });
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("return non-strings from Error.prepareStackTrace", () => {
  // This behavior is allowed by V8 and used by the node-depd npm package.
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => s;
  const e = new Error();
  Error.captureStackTrace(e);
  expect(Array.isArray(e.stack)).toBe(true);
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.toString", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => s;
  const e = new Error();
  Error.captureStackTrace(e);
  expect(e.stack[0].toString().includes("<anonymous>")).toBe(true);
});

// TODO: line numbers are wrong in a release build
test.todo("err.stack should invoke prepareStackTrace", () => {
  var lineNumber = -1;
  var functionName = "";
  var parentLineNumber = -1;
  function functionWithAName() {
    // This is V8's behavior.
    let prevPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (e, s) => {
      lineNumber = s[0].getLineNumber();
      functionName = s[0].getFunctionName();
      parentLineNumber = s[1].getLineNumber();
      expect(s[0].getFileName().includes("capture-stack-trace.test.js")).toBe(true);
      expect(s[1].getFileName().includes("capture-stack-trace.test.js")).toBe(true);
    };
    const e = new Error();
    e.stack;
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  functionWithAName();

  expect(functionName).toBe("functionWithAName");
  expect(lineNumber).toBe(391);
  // TODO: this is wrong
  expect(parentLineNumber).toBe(394);
});

test("Error.prepareStackTrace inside a node:vm works", () => {
  const { runInNewContext } = require("node:vm");
  Error.prepareStackTrace = null;
  const result = runInNewContext(
    `
    Error.prepareStackTrace = (err, stack) => {
      if (typeof err.stack !== "string") {
        throw new Error("err.stack is not a string");
      }

      return "custom stack trace";
    };

    const err = new Error();
    err.stack;
    `,
  );
  expect(result).toBe("custom stack trace");
  expect(Error.prepareStackTrace).toBeNull();
});

test("Error.captureStackTrace inside error constructor works", () => {
  class ExtendedError extends Error {
    constructor() {
      super();
      Error.captureStackTrace(this, ExtendedError);
    }
  }

  class AnotherError extends ExtendedError {}

  expect(() => {
    throw new AnotherError();
  }).toThrow();
});

import "harness";
import { join } from "path";

test("Error.prepareStackTrace has a default implementation which behaves the same as being unset", () => {
  expect([join(import.meta.dirname, "error-prepare-stack-default-fixture.js")]).toRun();
});

test("Error.prepareStackTrace returns a CallSite object", () => {
  Error.prepareStackTrace = function (err, stack) {
    return stack;
  };
  const error = new Error();
  expect(error.stack[0]).not.toBeString();
  expect(error.stack[0][Symbol.toStringTag]).toBe("CallSite");
});
