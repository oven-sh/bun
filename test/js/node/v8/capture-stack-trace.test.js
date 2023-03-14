import { test, expect } from "bun:test";

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

  f1();
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
