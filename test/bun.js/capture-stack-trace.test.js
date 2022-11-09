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
  }

  f1();
});

test("prepare stack trace", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    let e = { message: "bad error!" };
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      expect(e.message === "bad error!").toBe(true);
      expect(s.length).toBe(4);
      Object.keys(s[0]).forEach((key) => {
        console.log(key);
        // expect(s[0][key] !== undefined).toBe(true);
      });
    };
    Error.captureStackTrace(e);
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
      // console.log("getThis: " + s[0].getThis());
      // console.log("getTypeName: " + s[0].getTypeName());
      // console.log("getFunction: " + s[0].getFunction());
      // console.log("getFunctionName: " + s[0].getFunctionName());
      // console.log("getMethodName: " + s[0].getMethodName());
      // console.log("getFileName: " + s[0].getFileName());
      // console.log("getLineNumber: " + s[0].getLineNumber());
      // console.log("getColumnNumber: " + s[0].getColumnNumber());
      // console.log("getEvalOrigin: " + s[0].getEvalOrigin());
      // console.log("isToplevel: " + s[0].isToplevel());
      // console.log("isEval: " + s[0].isEval());
      // console.log("isNative: " + s[0].isNative());
      // console.log("isConstructor: " + s[0].isConstructor());
      // console.log("isAsync: " + s[0].isAsync());
      // console.log("isPromiseAll: " + s[0].isPromiseAll());
      // console.log("getPromiseIndex: " + s[0].getPromiseIndex());

      expect(s[0].getThis !== undefined).toBe(false);
      expect(s[0].getTypeName !== undefined).toBe(false);
      expect(s[0].getFunction !== undefined).toBe(false);
      expect(s[0].getFunctionName !== undefined).toBe(false);
      expect(s[0].getMethodName !== undefined).toBe(false);
      expect(s[0].getFileName !== undefined).toBe(false);
      expect(s[0].getLineNumber !== undefined).toBe(false);
      expect(s[0].getColumnNumber !== undefined).toBe(false);
      expect(s[0].getEvalOrigin !== undefined).toBe(false);
      expect(s[0].isToplevel !== undefined).toBe(false);
      expect(s[0].isEval !== undefined).toBe(false);
      expect(s[0].isNative !== undefined).toBe(false);
      expect(s[0].isConstructor !== undefined).toBe(false);
      expect(s[0].isAsync !== undefined).toBe(false);
      expect(s[0].isPromiseAll !== undefined).toBe(false);
      expect(s[0].getPromiseIndex !== undefined).toBe(false);
    };
    Error.captureStackTrace(e);
    console.log(e.stack);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

// function f1() {
//   f2();
// }

// function f2() {
//   f3();
// }

// function f3() {
//   // let e = { message: "bad error!" };
//   let e = new Error("bad error!");
//   let prevPrepareStackTrace = Error.prepareStackTrace;
//   Error.prepareStackTrace = (e, s) => {
//     console.log("getThis: " + s[0].getThis());
//     console.log("getTypeName: " + s[0].getTypeName());
//     console.log("getFunction: " + s[0].getFunction());
//     console.log("getFunctionName: " + s[0].getFunctionName());
//     console.log("getMethodName: " + s[0].getMethodName());
//     console.log("getFileName: " + s[0].getFileName());
//     console.log("getLineNumber: " + s[0].getLineNumber());
//     console.log("getColumnNumber: " + s[0].getColumnNumber());
//     console.log("getEvalOrigin: " + s[0].getEvalOrigin());
//     console.log("isToplevel: " + s[0].isToplevel());
//     console.log("isEval: " + s[0].isEval());
//     console.log("isNative: " + s[0].isNative());
//     console.log("isConstructor: " + s[0].isConstructor());
//     console.log("isAsync: " + s[0].isAsync());
//     console.log("isPromiseAll: " + s[0].isPromiseAll());
//     console.log("getPromiseIndex: " + s[0].getPromiseIndex());
//   };
//   Error.captureStackTrace(e);
//   console.log(e.stack);
//   Error.prepareStackTrace = prevPrepareStackTrace;
// }

// f1();
