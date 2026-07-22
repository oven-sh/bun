import { nativeFrameForTesting } from "bun:internal-for-testing";
import { noInline } from "bun:jsc";
import { afterEach, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

test("Error.captureStackTrace installs .stack as non-enumerable", () => {
  // V8 installs .stack with enumerable: false regardless of target type.
  const expectNonEnumerableStack = target => {
    const d = Object.getOwnPropertyDescriptor(target, "stack");
    expect({ enumerable: d.enumerable, configurable: d.configurable }).toEqual({
      enumerable: false,
      configurable: true,
    });
    // V8 installs an accessor (no `writable`), Bun installs a data property; both
    // must allow assignment. Only `writable: false` would be a regression.
    expect(d.writable).not.toBe(false);
    expect(Object.prototype.propertyIsEnumerable.call(target, "stack")).toBe(false);
  };

  // plain object target
  const o = { a: 1 };
  Error.captureStackTrace(o);
  expect(Object.keys(o)).toEqual(["a"]);
  expect(JSON.stringify(o)).toBe('{"a":1}');
  const forIn = [];
  for (const k in o) forIn.push(k);
  expect(forIn).toEqual(["a"]);
  expectNonEnumerableStack(o);
  expect(typeof o.stack).toBe("string");
  o.stack = "overwritten";
  expect(o.stack).toBe("overwritten");
  expectNonEnumerableStack(o);

  // plain object with Error.prepareStackTrace set. Inside the callback, .stack
  // holds the temporary default-formatted string; observing it there pins the
  // attribute on that write, which the final putDirect would otherwise mask.
  let insidePrepare;
  Error.prepareStackTrace = (err, sites) => {
    insidePrepare = {
      keys: Object.keys(err),
      enumerable: Object.getOwnPropertyDescriptor(err, "stack").enumerable,
    };
    return "from-prepare";
  };
  try {
    const o2 = {};
    Error.captureStackTrace(o2);
    expect(insidePrepare).toEqual({ keys: [], enumerable: false });
    expect(Object.keys(o2)).toEqual([]);
    expectNonEnumerableStack(o2);
    expect(o2.stack).toBe("from-prepare");
  } finally {
    Error.prepareStackTrace = origPrepareStackTrace;
  }

  // Object.keys must run before any descriptor lookup: getOwnPropertyDescriptor trips
  // ErrorInstance::materializeErrorInfoIfNeeded, which overwrites with its own DontEnum
  // and would mask the attribute captureStackTrace installed on the accessor path.
  const lazy = new Error("lazy");
  Error.captureStackTrace(lazy);
  expect(Object.keys(lazy)).toEqual([]);
  expectNonEnumerableStack(lazy);

  // ErrorInstance whose .stack has already been materialized
  const materialized = new Error("materialized");
  void materialized.stack;
  Error.captureStackTrace(materialized);
  expect(Object.keys(materialized)).toEqual([]);
  expectNonEnumerableStack(materialized);
  materialized.stack = "overwritten";
  expect(materialized.stack).toBe("overwritten");
  expectNonEnumerableStack(materialized);
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

test("CallFrame isEval works as expected", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;

  let name, fn;

  Error.prepareStackTrace = (e, s) => {
    return s;
  };

  name = "f1";
  const stack = eval(`(function ${name}() {
    return new Error().stack;
  })()`);

  Error.prepareStackTrace = prevPrepareStackTrace;
  // TODO: 0 and 1 should both return true here.
  expect(stack[1].isEval()).toBe(true);
  expect(stack[0].getFunctionName()).toBe(name);
});

test("CallFrame isTopLevel returns false for Function constructor", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const sloppyFn = new Function("let e=new Error();Error.captureStackTrace(e);return e.stack");
  sloppyFn.displayName = "sloppyFnWow";
  noInline(sloppyFn);
  const that = {};

  Error.prepareStackTrace = (e, s) => {
    expect(s[0].getFunctionName()).toBe(sloppyFn.displayName);
    expect(s[0].getFunction()).toBe(sloppyFn);

    expect(s[0].isToplevel()).toBe(false);
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

// https://github.com/oven-sh/bun/issues/17303
// https://github.com/oven-sh/bun/issues/18250
test("CallFrame.p.getColumnNumber is 1-based and matches toString()", async () => {
  // Run in a subprocess so the column isn't shifted by the CJS-wrapper transform applied
  // to .js test files: the function-call column must be observable at exactly 1.
  const src = [
    `let frames;`,
    `Error.prepareStackTrace = (_, s) => s;`,
    `function callee() { frames = new Error().stack; }`,
    `callee();`,
    `Error.prepareStackTrace = undefined;`,
    `const callee0 = frames[0];`,
    `const caller = frames[1];`,
    `const colOf = f => Number(/:(\\d+):(\\d+)\\)?$/.exec(f.toString())[2]);`,
    `console.log(JSON.stringify({`,
    `  calleeMatch: callee0.getColumnNumber() === colOf(callee0),`,
    `  callerCol: caller.getColumnNumber(),`,
    `  callerStrCol: colOf(caller),`,
    `  json: callee0.toJSON().columnNumber === callee0.getColumnNumber(),`,
    `}));`,
  ].join("\n");
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // `callee()` starts at column 1; V8 reports 1, source-map-support subtracts 1 to get 0.
  expect(JSON.parse(stdout)).toEqual({ calleeMatch: true, callerCol: 1, callerStrCol: 1, json: true });
  expect(exitCode).toBe(0);
});

test("CallFrame.p.getLineNumber/getColumnNumber return null for native frames", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => s;
  let frames;
  nativeFrameForTesting(() => {
    const err = new Error("");
    Error.captureStackTrace(err);
    frames = err.stack;
    return 0;
  });
  Error.prepareStackTrace = prevPrepareStackTrace;
  const nativeFrame = frames[1];
  expect(nativeFrame.isNative()).toBe(true);
  expect(nativeFrame.getLineNumber()).toBeNull();
  expect(nativeFrame.getColumnNumber()).toBeNull();
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
test("err.stack should invoke prepareStackTrace", () => {
  var lineNumber = -1;
  var functionName = "";
  var parentLineNumber = -1;
  var referenceStack = "";
  // Line numbers of the first two frames of a default-formatted stack string.
  function defaultStackLineNumbers(stack) {
    return String(stack)
      .split("\n")
      .map(line => /:(\d+):\d+\)?\s*$/.exec(line))
      .filter(Boolean)
      .slice(0, 2)
      .map(match => Number(match[1]));
  }
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
    // `reference` shares `e`'s line so the default formatter (consulted after the
    // hook is removed) must report the same call-site lines prepareStackTrace saw.
    const [reference, e] = [new Error(), new Error()];
    e.stack;
    Error.prepareStackTrace = prevPrepareStackTrace;
    referenceStack = reference.stack;
  }

  functionWithAName();

  const [expectedLineNumber, expectedParentLineNumber] = defaultStackLineNumbers(referenceStack);
  expect(referenceStack).toContain("at functionWithAName");
  expect(expectedLineNumber).toBeGreaterThan(0);
  expect(expectedParentLineNumber).toBeGreaterThan(expectedLineNumber);
  expect(functionName).toBe("functionWithAName");
  expect(lineNumber).toBe(expectedLineNumber);
  expect(parentLineNumber).toBe(expectedParentLineNumber);
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

test("Error.captureStackTrace updates the stack property each call, even if Error.prepareStackTrace is set", () => {
  const prevPrepareStackTrace = Error.prepareStackTrace;
  var didCallPrepareStackTrace = false;

  let error = new Error();
  const firstStack = error.stack;
  Error.prepareStackTrace = function (err, stack) {
    expect(err.stack).not.toBe(firstStack);
    didCallPrepareStackTrace = true;
    return stack;
  };
  function outer() {
    inner();
  }
  function inner() {
    Error.captureStackTrace(error);
  }
  outer();
  const secondStack = error.stack;
  expect(firstStack).not.toBe(secondStack);
  expect(firstStack).toBeString();
  expect(firstStack).not.toContain("outer");
  expect(firstStack).not.toContain("inner");
  expect(didCallPrepareStackTrace).toBe(true);
  expect(secondStack.find(a => a.getFunctionName() === "outer")).toBeTruthy();
  expect(secondStack.find(a => a.getFunctionName() === "inner")).toBeTruthy();
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("Error.captureStackTrace updates the stack property each call", () => {
  let error = new Error();
  const firstStack = error.stack;
  function outer() {
    inner();
  }
  function inner() {
    Error.captureStackTrace(error);
  }
  outer();
  const secondStack = error.stack;
  expect(firstStack).not.toBe(secondStack);
  expect(firstStack.length).toBeLessThan(secondStack.length);
  expect(firstStack).not.toContain("outer");
  expect(firstStack).not.toContain("inner");
  expect(secondStack).toContain("outer");
  expect(secondStack).toContain("inner");
});

test("calling .stack later uses the stored StackTrace", function hey() {
  let error = new Error();
  let stack;
  function outer() {
    inner();
  }
  function inner() {
    stack = error.stack;
  }
  outer();

  expect(stack).not.toContain("outer");
  expect(stack).not.toContain("inner");
  expect(stack).toContain("hey");
});

test("calling .stack on a non-materialized Error updates the stack properly", function hey() {
  let error = new Error();
  let stack;
  function outer() {
    inner();
  }
  function inner() {
    stack = error.stack;
  }
  function wrapped() {
    Error.captureStackTrace(error);
  }
  wrapped();
  outer();

  expect(stack).not.toContain("outer");
  expect(stack).not.toContain("inner");
  expect(stack).toContain("hey");
  expect(stack).toContain("wrapped");
});

test("Error.prepareStackTrace on an array with non-CallSite objects doesn't crash", () => {
  const result = Error.prepareStackTrace(new Error("ok"), [{ a: 1 }, { b: 2 }, { c: 3 }]);
  expect(result).toBe("Error: ok\n    at [object Object]\n    at [object Object]\n    at [object Object]");
});

test("Error.prepareStackTrace calls toString()", () => {
  const result = Error.prepareStackTrace(new Error("ok"), [
    { a: 1 },
    { b: 2 },
    {
      c: 3,
      toString() {
        return "potato";
      },
    },
  ]);
  expect(result).toBe("Error: ok\n    at [object Object]\n    at [object Object]\n    at potato");
});

test("Error.prepareStackTrace propagates exceptions", () => {
  expect(() =>
    Error.prepareStackTrace(new Error("ok"), [
      { a: 1 },
      { b: 2 },
      {
        c: 3,
        toString() {
          throw new Error("hi");
        },
      },
    ]),
  ).toThrow("hi");
});

test("CallFrame.p.getScriptNameOrSourceURL inside eval", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const prepare = mock((e, s) => {
    expect(s[0].getScriptNameOrSourceURL()).toBe("https://zombo.com/welcome-to-zombo.js");
    expect(s[1].getScriptNameOrSourceURL()).toBe("https://zombo.com/welcome-to-zombo.js");
    expect(s[2].getScriptNameOrSourceURL()).toBe("[native code]");
    expect(s[3].getScriptNameOrSourceURL()).toBe(import.meta.path);
    expect(s[4].getScriptNameOrSourceURL()).toBe(import.meta.path);
  });
  Error.prepareStackTrace = prepare;
  let evalScript = `(function() {
    throw new Error("bad error!");
  })() //# sourceURL=https://zombo.com/welcome-to-zombo.js`;

  try {
    function insideAFunction() {
      eval(evalScript);
    }
    insideAFunction();
  } catch (e) {
    e.stack;
  }
  Error.prepareStackTrace = prevPrepareStackTrace;

  expect(prepare).toHaveBeenCalledTimes(1);
});

test("CallFrame.p.isAsync", async () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const prepare = mock((e, s) => {
    expect(s[0].isAsync()).toBeFalse();
    expect(s[1].isAsync()).toBeTrue();
    expect(s[2].isAsync()).toBeTrue();
    expect(s[3].isAsync()).toBeTrue();
  });
  Error.prepareStackTrace = prepare;
  async function foo() {
    await bar();
  }
  async function bar() {
    await baz();
  }
  async function baz() {
    await 1;
    throw new Error("error from baz");
  }

  try {
    await foo();
  } catch (e) {
    e.stack;
  }
  Error.prepareStackTrace = prevPrepareStackTrace;

  expect(prepare).toHaveBeenCalledTimes(1);
});

test("captureStackTrace with constructor function not in stack returns error string", () => {
  // When the second argument to captureStackTrace is a function that isn't in
  // the call stack, all frames are filtered out and .stack should still return
  // the error name and message (matching Node.js behavior).
  function notInStack() {}

  // Case 1: stack not accessed before captureStackTrace
  {
    const e = new Error("test");
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("Error: test");
  }

  // Case 2: stack accessed before captureStackTrace
  {
    const e = new Error("test");
    void e.stack;
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("Error: test");
  }

  // Case 3: empty message
  {
    const e = new Error();
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("Error");
  }

  // Case 4: custom error name
  {
    const e = new TypeError("bad type");
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("TypeError: bad type");
  }
});

test("Error.captureStackTrace includes async frames from the await chain", async () => {
  async function innerAsync() {
    await new Promise(r => setImmediate(r));
    const err = new Error("async test");
    Error.captureStackTrace(err);
    return err;
  }
  noInline(innerAsync);

  async function outerAsync() {
    return await innerAsync();
  }
  noInline(outerAsync);

  const err = await outerAsync();
  expect(err.stack).toContain("at innerAsync");
  expect(err.stack).toContain("at async outerAsync");
});

test("Error.captureStackTrace with caller argument preserves async frames", async () => {
  async function innerAsync() {
    await new Promise(r => setImmediate(r));
    const err = new Error("async test");
    Error.captureStackTrace(err, innerAsync);
    return err;
  }
  noInline(innerAsync);

  async function middleAsync() {
    return await innerAsync();
  }
  noInline(middleAsync);

  async function outerAsync() {
    return await middleAsync();
  }
  noInline(outerAsync);

  const err = await outerAsync();
  // innerAsync should be filtered out, but async parents should remain
  expect(err.stack).not.toContain("at innerAsync");
  expect(err.stack).toContain("at async middleAsync");
  expect(err.stack).toContain("at async outerAsync");
});

test("Error.captureStackTrace with caller not in stack clears async frames too", async () => {
  function notInStack() {}

  async function innerAsync() {
    await new Promise(r => setImmediate(r));
    const err = new Error("async test");
    Error.captureStackTrace(err, notInStack);
    return err;
  }
  noInline(innerAsync);

  async function outerAsync() {
    return await innerAsync();
  }
  noInline(outerAsync);

  const err = await outerAsync();
  // When caller is not found, V8 clears everything
  expect(err.stack).toBe("Error: async test");
});

test("Error.captureStackTrace applies stackTraceLimit after caller removal", () => {
  // Build a deep call chain so the caller sits beyond stackTraceLimit.
  // If the limit were applied before removal, all collected frames would
  // be above the caller and get removed, yielding an empty trace.
  const origLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 3;
  try {
    function target() {
      const err = {};
      Error.captureStackTrace(err, target);
      return err;
    }
    noInline(target);

    function recurse(depth) {
      if (depth === 0) return target();
      // Not a tail call — keeps each frame on the stack.
      return recurse(depth - 1) || null;
    }
    noInline(recurse);

    const err = recurse(20);
    const frames = err.stack.split("\n").filter(l => l.includes("    at "));
    // Should have exactly 3 frames (the limit), all below target()
    expect(frames.length).toBe(3);
    expect(err.stack).not.toContain("at target");
    expect(err.stack).toContain("at recurse");
  } finally {
    Error.stackTraceLimit = origLimit;
  }
});

test("captureStackTrace does not crash when stackTraceLimit is non-numeric", () => {
  const origLimit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = "foo";
    const obj = {};
    expect(() => Error.captureStackTrace(obj)).not.toThrow();
    expect(typeof obj.stack).toBe("string");

    delete Error.stackTraceLimit;
    const obj2 = {};
    expect(() => Error.captureStackTrace(obj2)).not.toThrow();
    expect(typeof obj2.stack).toBe("string");
  } finally {
    Error.stackTraceLimit = origLimit;
  }
});

test("Error.stackTraceLimit default matches the limit captureStackTrace applies", async () => {
  // Run in a fresh process so nothing has written to Error.stackTraceLimit yet.
  const src = `
    function depth(n) {
      if (n) return 0 + depth(n - 1);
      const e = {};
      Error.captureStackTrace(e);
      return e.stack.split("\\n").length - 1;
    }
    const reported = Error.stackTraceLimit;
    const before = depth(30);
    Error.stackTraceLimit = Error.stackTraceLimit;
    const after = depth(30);
    process.stdout.write(JSON.stringify({ reported, before, after }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { reported, before, after } = JSON.parse(stdout);
  // Node.js defaults to 10 and the reported value must match the applied limit.
  expect({ reported, before, after, exitCode }).toEqual({ reported: 10, before: 10, after: 10, exitCode: 0 });
});

test("call sites inside a WebSocket message listener only contain script frames when the message arrives with the upgrade response", async () => {
  // Runs in its own process: which dispatch path delivers the message (and therefore
  // which frames are on the stack under the listener) depends on prior event-loop state.
  const src = [
    `const { createHash } = require("node:crypto");`,
    `const buffers = new Map();`,
    `const server = Bun.listen({`,
    `  hostname: "127.0.0.1",`,
    `  port: 0,`,
    `  socket: {`,
    `    data(socket, chunk) {`,
    `      const previous = buffers.get(socket) ?? Buffer.alloc(0);`,
    `      const request = Buffer.concat([previous, chunk]);`,
    `      buffers.set(socket, request);`,
    `      const text = request.toString("latin1");`,
    `      if (!text.includes("\\r\\n\\r\\n")) return;`,
    `      const key = /^Sec-WebSocket-Key:\\s*(.+?)\\r\\n/im.exec(text)?.[1];`,
    `      if (!key) { console.error("missing Sec-WebSocket-Key header"); process.exit(1); }`,
    `      const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");`,
    `      const response = "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n";`,
    `      socket.write(Buffer.concat([Buffer.from(response, "latin1"), Buffer.from([0x81, 0x02, 0x68, 0x69])]));`,
    `    },`,
    `    error() { process.exit(1); },`,
    `  },`,
    `});`,
    `const ws = new WebSocket("ws://127.0.0.1:" + server.port);`,
    `ws.addEventListener("close", event => { console.error("closed " + event.code); process.exit(1); });`,
    `ws.addEventListener("message", event => {`,
    `  const previousPrepareStackTrace = Error.prepareStackTrace;`,
    `  let callSites;`,
    `  try {`,
    `    Error.prepareStackTrace = (_error, stack) => stack;`,
    `    const error = new Error();`,
    `    Error.captureStackTrace(error);`,
    `    callSites = error.stack;`,
    `  } finally {`,
    `    Error.prepareStackTrace = previousPrepareStackTrace;`,
    `  }`,
    `  console.log(event.data, callSites.filter(callSite => callSite.isNative()).length);`,
    `  process.exit(0);`,
    `});`,
  ].join("\n");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("hi 0");
  expect(exitCode).toBe(0);
});

test("printing an error whose message getter calls Error.captureStackTrace on itself prints normally", async () => {
  const fixture = [
    `const vm = require("node:vm");`,
    `let src = "function f0() {\\n";`,
    `src += "  const e = new Error('first');\\n";`,
    `src += "  Object.defineProperty(e, 'message', { get() { Error.captureStackTrace(e); return 'second'; } });\\n";`,
    `src += "  return e;\\n";`,
    `src += "}\\n";`,
    `for (let i = 1; i < 12; i++) src += "function f" + i + "() { return f" + (i - 1) + "(); }\\n";`,
    `src += "f11();\\n";`,
    `const err = vm.runInThisContext(src, { filename: "frame-index-fixture.js" });`,
    `console.log(err);`,
    `console.log("after");`,
  ].join("\n");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ lastLine: stdout.trimEnd().split("\n").pop(), exitCode }).toEqual({ lastLine: "after", exitCode: 0 });
});

// https://github.com/oven-sh/bun/issues/34095
test("lazy error-info materialization does not store an empty stack value when the compute hook throws", async () => {
  const src = `
    Error.prepareStackTrace = (e, s) => "custom-stack";
    const e = new Error("x");
    Object.defineProperty(e, "message", { get() { throw new TypeError("msg-boom"); } });
    let first = "no-throw";
    try { void e.stack; } catch (err) { first = err.message; }
    console.log(JSON.stringify({ first, secondType: typeof e.stack }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify({ first: "msg-boom", secondType: "undefined" }),
    signalCode: null,
  });
  expect(exitCode).toBe(0);
});
