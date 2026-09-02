// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Tests adapted from https://github.com/nodejs/node/blob/main/test/parallel/test-util.js

import assert from "assert";
import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, it, spyOn } from "bun:test";
import { bunEnv, bunExe } from "harness";
import util from "util";
// const context = require('vm').runInNewContext; // TODO: Use a vm polyfill

const strictEqual = (...args) => {
  expect(args[0]).toStrictEqual(args[1]);
};

const deepStrictEqual = (...args) => {
  expect(args[0]).toEqual(args[1]);
};

// Tests adapted from https://github.com/nodejs/node/blob/main/test/parallel/test-util.js
describe("util", () => {
  it("toUSVString", () => {
    const strings = [
      // Lone high surrogate
      "ab\uD800",
      "ab\uD800c",
      // Lone low surrogate
      "\uDFFFab",
      "c\uDFFFab",
      // Well-formed
      "abc",
      "ab\uD83D\uDE04c",
    ];
    const outputs = ["ab�", "ab�c", "�ab", "c�ab", "abc", "ab😄c"];
    for (let i = 0; i < strings.length; i++) {
      expect(util.toUSVString(strings[i])).toBe(outputs[i]);
    }
  });
  it("inherits", () => {
    function Bar() {}
    Bar.prototype.bar = function () {};

    Wat.prototype.func = function () {
      return 43;
    };

    function Wat() {}

    expect(util.inherits(Wat, Bar)).toBeUndefined();
    expect(Wat.prototype.func).toBeDefined();
  });
  describe("isArray", () => {
    it("all cases", () => {
      strictEqual(util.isArray([]), true);
      strictEqual(util.isArray(Array()), true);
      strictEqual(util.isArray(new Array()), true);
      strictEqual(util.isArray(new Array(5)), true);
      strictEqual(util.isArray(new Array("with", "some", "entries")), true);
      // strictEqual(util.isArray(context('Array')()), true); unable to test due to dependency on context
      strictEqual(util.isArray({}), false);
      strictEqual(util.isArray({ push: function () {} }), false);
      strictEqual(util.isArray(/regexp/), false);
      strictEqual(util.isArray(new Error()), false);
      strictEqual(util.isArray(Object.create(Array.prototype)), false);
    });
  });
  describe("isRegExp", () => {
    it("all cases", () => {
      strictEqual(util.isRegExp(/regexp/), true);
      strictEqual(util.isRegExp(RegExp(), "foo"), true);
      strictEqual(util.isRegExp(new RegExp()), true);
      // strictEqual(util.isRegExp(context("RegExp")()), true); unable to test due to dependency on context
      strictEqual(util.isRegExp({}), false);
      strictEqual(util.isRegExp([]), false);
      strictEqual(util.isRegExp(new Date()), false);
      strictEqual(util.isRegExp(Object.create(RegExp.prototype)), false);
    });
  });
  describe("isDate", () => {
    it("all cases", () => {
      strictEqual(util.isDate(new Date()), true);
      strictEqual(util.isDate(new Date(0), "foo"), true);
      // strictEqual(util.isDate(new (context("Date"))()), true); unable to test due to dependency on context
      strictEqual(util.isDate(Date()), false);
      strictEqual(util.isDate({}), false);
      strictEqual(util.isDate([]), false);
      strictEqual(util.isDate(new Error()), false);
      strictEqual(util.isDate(Object.create(Date.prototype)), false);
    });
  });

  describe("isError", () => {
    it("all cases", () => {
      strictEqual(util.isError(new Error()), true);
      strictEqual(util.isError(new TypeError()), true);
      strictEqual(util.isError(new SyntaxError()), true);
      //   strictEqual(util.isError(new (context("Error"))()), true); unable to test due to dependency on context
      //   strictEqual(util.isError(new (context("TypeError"))()), true); unable to test due to dependency on context
      //   strictEqual(util.isError(new (context("SyntaxError"))()), true); unable to test due to dependency on context
      strictEqual(util.isError({}), false);
      strictEqual(util.isError({ name: "Error", message: "" }), false);
      strictEqual(util.isError([]), false);
      strictEqual(util.isError(Object.create(Error.prototype)), true);

      let err1 = {};
      err1.__proto__ = Error.prototype;
      strictEqual(util.isError(err1), true);

      let err2 = {};
      err2[Symbol.toStringTag] = "Error";
      strictEqual(util.isError(err2), true);

      let err3 = {};
      err3[Symbol.toStringTag] = "[object Error]";
      strictEqual(util.isError(err3), false);

      let err4 = {};
      err4.toString = () => "[object Error]";
      strictEqual(util.isError(err4), false);

      let err5 = {};
      err5.toString = () => "Error";
      strictEqual(util.isError(err5), false);

      class Error2 extends Error {}
      let err6 = new Error2();
      strictEqual(util.isError(err6), true);

      let err7 = {};
      err7.name = "Error";
      strictEqual(util.isError(err7), false);

      class Error3 extends Error2 {}
      let err8 = new Error3();
      strictEqual(util.isError(err8), true);
    });

    // These inputs used to segfault the process, so they run in a child.
    it.concurrent("handles revoked proxies and getPrototypeOf traps", async () => {
      const fixture = /* js */ `
        const { isError } = require("node:util");
        const attempt = fn => {
          try {
            return String(fn());
          } catch (e) {
            return "threw " + (e instanceof Error ? e.constructor.name + ": " + e.message : String(e));
          }
        };
        const { proxy: revoked, revoke } = Proxy.revocable({}, {});
        revoke();
        console.log("revoked:", attempt(() => isError(revoked)));
        console.log("throwing trap:", attempt(() => isError(new Proxy({}, { getPrototypeOf() { throw new Error("from trap"); } }))));
        const thrown = { from: "trap" };
        let caught;
        try {
          isError(new Proxy({}, { getPrototypeOf() { throw thrown; } }));
        } catch (e) {
          caught = e;
        }
        console.log("throwing trap rethrows the same value:", caught === thrown);
        console.log("null trap:", attempt(() => isError(new Proxy({}, { getPrototypeOf: () => null }))));
        console.log("Error.prototype trap:", attempt(() => isError(new Proxy({}, { getPrototypeOf: () => Error.prototype }))));
        console.log("proxy of an Error:", attempt(() => isError(new Proxy(new Error("x"), {}))));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(
        [
          "revoked: threw TypeError: Proxy has already been revoked. No more operations are allowed to be performed on it",
          "throwing trap: threw Error: from trap",
          "throwing trap rethrows the same value: true",
          "null trap: false",
          "Error.prototype trap: true",
          "proxy of an Error: true",
          "",
        ].join("\n"),
      );
      expect(exitCode).toBe(0);
    });
  });

  describe("isObject", () => {
    it("all cases", () => {
      strictEqual(util.isObject({}), true);
      strictEqual(util.isObject([]), true);
      strictEqual(util.isObject(new Number(3)), true);
      strictEqual(util.isObject(Number(4)), false);
      strictEqual(util.isObject(1), false);
    });
  });

  describe("isPrimitive", () => {
    it("all cases", () => {
      strictEqual(util.isPrimitive({}), false);
      strictEqual(util.isPrimitive(new Error()), false);
      strictEqual(util.isPrimitive(new Date()), false);
      strictEqual(util.isPrimitive([]), false);
      strictEqual(util.isPrimitive(/regexp/), false);
      strictEqual(
        util.isPrimitive(function () {}),
        false,
      );
      strictEqual(util.isPrimitive(new Number(1)), false);
      strictEqual(util.isPrimitive(new String("bla")), false);
      strictEqual(util.isPrimitive(new Boolean(true)), false);
      strictEqual(util.isPrimitive(1), true);
      strictEqual(util.isPrimitive("bla"), true);
      strictEqual(util.isPrimitive(true), true);
      strictEqual(util.isPrimitive(undefined), true);
      strictEqual(util.isPrimitive(null), true);
      strictEqual(util.isPrimitive(Infinity), true);
      strictEqual(util.isPrimitive(NaN), true);
      strictEqual(util.isPrimitive(Symbol("symbol")), true);
    });
  });

  describe("isBuffer", () => {
    it("all cases", () => {
      strictEqual(util.isBuffer("foo"), false);
      strictEqual(util.isBuffer(Buffer.from("foo")), true);
    });
  });

  describe("_extend", () => {
    it("all cases", () => {
      deepStrictEqual(util._extend({ a: 1 }), { a: 1 });
      deepStrictEqual(util._extend({ a: 1 }, []), { a: 1 });
      deepStrictEqual(util._extend({ a: 1 }, null), { a: 1 });
      deepStrictEqual(util._extend({ a: 1 }, true), { a: 1 });
      deepStrictEqual(util._extend({ a: 1 }, false), { a: 1 });
      deepStrictEqual(util._extend({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
      deepStrictEqual(util._extend({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
    });
  });

  describe("isBoolean", () => {
    it("all cases", () => {
      strictEqual(util.isBoolean(true), true);
      strictEqual(util.isBoolean(false), true);
      strictEqual(util.isBoolean("string"), false);
    });
  });

  describe("isNull", () => {
    it("all cases", () => {
      strictEqual(util.isNull(null), true);
      strictEqual(util.isNull(undefined), false);
      strictEqual(util.isNull(), false);
      strictEqual(util.isNull("string"), false);
    });
  });

  describe("isUndefined", () => {
    it("all cases", () => {
      strictEqual(util.isUndefined(undefined), true);
      strictEqual(util.isUndefined(), true);
      strictEqual(util.isUndefined(null), false);
      strictEqual(util.isUndefined("string"), false);
    });
  });

  describe("isNullOrUndefined", () => {
    it("all cases", () => {
      strictEqual(util.isNullOrUndefined(null), true);
      strictEqual(util.isNullOrUndefined(undefined), true);
      strictEqual(util.isNullOrUndefined(), true);
      strictEqual(util.isNullOrUndefined("string"), false);
    });
  });

  describe("isNumber", () => {
    it("all cases", () => {
      strictEqual(util.isNumber(42), true);
      strictEqual(util.isNumber(), false);
      strictEqual(util.isNumber("string"), false);
    });
  });

  describe("isString", () => {
    it("all cases", () => {
      strictEqual(util.isString("string"), true);
      strictEqual(util.isString(), false);
      strictEqual(util.isString(42), false);
    });
  });

  describe("isSymbol", () => {
    it("all cases", () => {
      strictEqual(util.isSymbol(Symbol()), true);
      strictEqual(util.isSymbol(), false);
      strictEqual(util.isSymbol("string"), false);
    });
  });

  describe("isFunction", () => {
    it("all cases", () => {
      strictEqual(
        util.isFunction(() => {}),
        true,
      );
      strictEqual(
        util.isFunction(function () {}),
        true,
      );
      strictEqual(util.isFunction(), false);
      strictEqual(util.isFunction("string"), false);
    });
  });

  describe("types.isNativeError", () => {
    it("all cases", () => {
      strictEqual(util.types.isNativeError(new Error()), true);
      strictEqual(util.types.isNativeError(new TypeError()), true);
      strictEqual(util.types.isNativeError(new SyntaxError()), true);
      // TODO: unable to test due to dependency on context
      //   strictEqual(util.types.isNativeError(new (context("Error"))()), true);
      //   strictEqual(util.types.isNativeError(new (context("TypeError"))()), true);
      //   strictEqual(
      //     util.types.isNativeError(new (context("SyntaxError"))()),
      //     true
      //   );
      strictEqual(util.types.isNativeError({}), false);
      strictEqual(util.types.isNativeError({ name: "Error", message: "" }), false);
      strictEqual(util.types.isNativeError([]), false);
      strictEqual(
        // FIXME: failing test
        util.types.isNativeError(Object.create(Error.prototype)),
        false,
      );
      //   strictEqual( // FIXME: failing test
      //     util.types.isNativeError(new errors.codes.ERR(.IPC_CHANNEL_CLOSED, )),
      //     true
      //   );
    });
  });

  //   describe("", () => {
  //     it("all cases", () => {
  //       strictEqual(util.toUSVString("string\ud801"), "string\ufffd"); // TODO: currently unsupported
  //     });
  //   });

  describe("TextEncoder", () => {
    // test/bun.js/text-encoder.test.js covers test cases for TextEncoder
    // here we test only if we use the same via util.TextEncoder
    it("is same as global TextEncoder", () => {
      expect(util.TextEncoder === globalThis.TextEncoder).toBe(true);
    });
  });

  describe("TextDecoder", () => {
    // test/bun.js/text-decoder.test.js covers test cases for TextDecoder
    // here we test only if we use the same via util.TextDecoder
    it("is same as global TextDecoder", () => {
      expect(util.TextDecoder === globalThis.TextDecoder).toBe(true);
    });
  });

  it("format", () => {
    expect(util.format("%s:%s", "foo")).toBe("foo:%s");
  });
  // Messages verified against the node v26.3.0 binary.
  const invalidArgType = message =>
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError", message });
  it("formatWithOptions and inspect.defaultOptions validate their options like Node", () => {
    function opts() {}
    // Arrays are allowed for formatWithOptions (kValidateObjectAllowArray), functions and null are not.
    expect(util.formatWithOptions([], "%s", 1)).toBe("1");
    expect(() => util.formatWithOptions(opts, "x")).toThrow(
      invalidArgType('The "inspectOptions" argument must be of type object. Received function opts'),
    );
    expect(() => util.formatWithOptions(null, "x")).toThrow(
      invalidArgType('The "inspectOptions" argument must be of type object. Received null'),
    );
    const saved = { ...util.inspect.defaultOptions };
    try {
      expect(() => (util.inspect.defaultOptions = opts)).toThrow(
        invalidArgType('The "options" argument must be of type object. Received function opts'),
      );
      expect(() => (util.inspect.defaultOptions = [])).toThrow(
        invalidArgType('The "options" argument must be of type object. Received an instance of Array'),
      );
      expect(() => (util.inspect.defaultOptions = { depth: 3 })).not.toThrow();
    } finally {
      util.inspect.defaultOptions = saved;
    }
    expect(() => util.stripVTControlCharacters(1)).toThrow(
      invalidArgType('The "str" argument must be of type string. Received type number (1)'),
    );
  });
  // Ported from the validateObject block of node's test/parallel/test-validators.js (v26.3.0).
  it("validateObject honors the kValidateObject* flags like Node", () => {
    const { validateObject, kValidateObjectAllowNullable, kValidateObjectAllowArray, kValidateObjectAllowFunction } =
      exposedInternals["internal/validators"];
    const err = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" });
    function fn() {}
    const allFlags = kValidateObjectAllowNullable | kValidateObjectAllowArray | kValidateObjectAllowFunction;

    validateObject({}, "foo");
    validateObject({ a: 42, b: "foo" }, "foo");
    for (const val of [undefined, null, true, false, 0, 0.0, 42, "", "string", [], fn]) {
      expect(() => validateObject(val, "foo")).toThrow(err);
    }

    validateObject(null, "foo", kValidateObjectAllowNullable);
    validateObject([], "foo", kValidateObjectAllowArray);
    validateObject(fn, "foo", kValidateObjectAllowFunction);
    for (const val of [{}, null, [], fn]) {
      expect(() => validateObject(val, "foo", allFlags)).not.toThrow();
    }

    // Each flag only admits its own kind of value.
    expect(() => validateObject(null, "foo", kValidateObjectAllowArray | kValidateObjectAllowFunction)).toThrow(
      invalidArgType('The "foo" argument must be of type object. Received null'),
    );
    expect(() => validateObject([], "foo", kValidateObjectAllowNullable | kValidateObjectAllowFunction)).toThrow(
      invalidArgType('The "foo" argument must be of type object. Received an instance of Array'),
    );
    expect(() => validateObject(fn, "foo", kValidateObjectAllowNullable | kValidateObjectAllowArray)).toThrow(
      invalidArgType('The "foo" argument must be of type object. Received function fn'),
    );
    expect(() => validateObject(undefined, "foo", allFlags)).toThrow(
      invalidArgType('The "foo" argument must be of type object. Received undefined'),
    );
    expect(() => validateObject("string", "foo", allFlags)).toThrow(
      invalidArgType("The \"foo\" argument must be of type object. Received type string ('string')"),
    );
  });

  it("formatWithOptions", () => {
    expect(util.formatWithOptions({ colors: true }, "%s:%s", "foo")).toBe("foo:%s");
    expect(util.formatWithOptions({ colors: true }, "wow(%o)", { obj: true })).toBe(
      "wow({ obj: \u001B[33mtrue\u001B[39m })",
    );
  });

  // styleText hex support, added in Node v26. Expectations verified against the
  // node v26.3.0 binary.
  describe("styleText hex colors", () => {
    const noValidate = { validateStream: false };

    it("parses 6-digit hex", () => {
      expect(util.styleText("#ffcc00", "test", noValidate)).toBe("\u001b[38;2;255;204;0mtest\u001b[39m");
      expect(util.styleText("#000000", "test", noValidate)).toBe("\u001b[38;2;0;0;0mtest\u001b[39m");
      expect(util.styleText("#ffffff", "test", noValidate)).toBe("\u001b[38;2;255;255;255mtest\u001b[39m");
    });

    it("is case-insensitive", () => {
      expect(util.styleText("#AABBCC", "test", noValidate)).toBe("\u001b[38;2;170;187;204mtest\u001b[39m");
      expect(util.styleText("#aAbBcC", "test", noValidate)).toBe("\u001b[38;2;170;187;204mtest\u001b[39m");
    });

    it("expands 3-digit shorthand", () => {
      expect(util.styleText("#fc0", "test", noValidate)).toBe("\u001b[38;2;255;204;0mtest\u001b[39m");
      expect(util.styleText("#000", "test", noValidate)).toBe("\u001b[38;2;0;0;0mtest\u001b[39m");
      expect(util.styleText("#FFF", "test", noValidate)).toBe("\u001b[38;2;255;255;255mtest\u001b[39m");
      expect(util.styleText("#abc", "test", noValidate)).toBe("\u001b[38;2;170;187;204mtest\u001b[39m");
    });

    it("combines hex with named formats", () => {
      expect(util.styleText(["bold", "#fc0"], "x", noValidate)).toBe(
        "\u001b[1m\u001b[38;2;255;204;0mx\u001b[39m\u001b[22m",
      );
      expect(util.styleText(["#fc0", "underline"], "x", noValidate)).toBe(
        "\u001b[38;2;255;204;0m\u001b[4mx\u001b[24m\u001b[39m",
      );
    });

    it("nests hex colors by reopening the outer color", () => {
      const inner = util.styleText("#0000ff", "inner", noValidate);
      expect(util.styleText("#ff0000", `before${inner}after`, noValidate)).toBe(
        "\u001b[38;2;255;0;0mbefore\u001b[38;2;0;0;255minner\u001b[38;2;255;0;0mafter\u001b[39m",
      );
    });

    it("treats `none` as a passthrough", () => {
      expect(util.styleText("none", "test", noValidate)).toBe("test");
      expect(util.styleText(["none", "#fc0"], "x", noValidate)).toBe("\u001b[38;2;255;204;0mx\u001b[39m");
    });

    for (const invalid of ["#gggggg", "#ff", "#ffff", "#fffff", "#fffffff", "#", "ffcc00"]) {
      it(`rejects ${invalid}`, () => {
        expect(() => util.styleText(invalid, "t", noValidate)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
        expect(() => util.styleText([invalid], "t", noValidate)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
      });
    }
  });

  it("multiplecolors", () => {
    const noValidate = { validateStream: false };
    expect(util.styleText(["bold", "red"], "test", noValidate)).toBe("\u001b[1m\u001b[31mtest\u001b[39m\u001b[22m");
    expect(util.styleText("bold", "test", noValidate)).toBe("\u001b[1mtest\u001b[22m");
    expect(util.styleText("red", "test", noValidate)).toBe("\u001b[31mtest\u001b[39m");
  });

  it("styleText", () => {
    [undefined, null, false, 5n, 5, Symbol(), () => {}, {}].forEach(invalidOption => {
      assert.throws(
        () => {
          util.styleText(invalidOption, "test");
        },
        {
          code: "ERR_INVALID_ARG_VALUE",
        },
      );
      assert.throws(
        () => {
          util.styleText("red", invalidOption);
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
        },
      );
    });

    assert.throws(
      () => {
        util.styleText("invalid", "text");
      },
      {
        code: "ERR_INVALID_ARG_VALUE",
      },
    );

    assert.strictEqual(util.styleText("red", "test", { validateStream: false }), "\u001b[31mtest\u001b[39m");
  });

  describe("getCallSites", () => {
    it("restores Error state when stackTraceLimit is non-writable", () => {
      const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
      const savedPrepare = Error.prepareStackTrace;
      try {
        Object.defineProperty(Error, "stackTraceLimit", { value: 10, writable: false, configurable: true });
        const sites = util.getCallSites(5);
        expect(Array.isArray(sites)).toBe(true);
        // Critical invariant: a user-installed prepareStackTrace must not be leaked.
        expect(Error.prepareStackTrace).toBe(savedPrepare);
      } finally {
        Object.defineProperty(Error, "stackTraceLimit", desc);
        Error.prepareStackTrace = savedPrepare;
      }
    });

    it("each frame has the node v26 shape", () => {
      const sites = util.getCallSites(3);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites[0]).toEqual({
        functionName: expect.any(String),
        scriptId: expect.any(String),
        scriptName: expect.stringContaining("util.test.js"),
        lineNumber: expect.any(Number),
        columnNumber: expect.any(Number),
        column: sites[0].columnNumber,
      });
    });
  });

  describe("getSystemErrorName", () => {
    for (const item of ["test", {}, []]) {
      it(`throws when passing: ${item}`, () => {
        expect(() => util.getSystemErrorName(item)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
      });
    }

    for (const item of [0, 1, Infinity, -Infinity, NaN]) {
      it(`throws when passing: ${item}`, () => {
        expect(() => util.getSystemErrorName(item)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
      });
    }

    // Batch all node lookups into a single subprocess instead of one per code (was 74 spawns).
    const negativeSpaceCodes = [];
    for (let i = -4095; i <= -4023; i++) negativeSpaceCodes.push(i);
    const proc = Bun.spawnSync({
      cmd: [
        "node",
        "-e",
        `const u = require('node:util');
         const map = [...u.getSystemErrorMap().entries()].map((v) => [v[0], v[1][0]]);
         const neg = {};
         for (const i of ${JSON.stringify(negativeSpaceCodes)}) neg[i] = u.getSystemErrorName(i);
         console.log(JSON.stringify({ map, neg }));`,
      ],
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (proc.exitCode !== 0) {
      throw new Error(`node subprocess exited ${proc.exitCode}: ${proc.stderr.toString()}`);
    }
    const nodeResults = JSON.parse(proc.stdout.toString());
    for (const [code, name] of nodeResults.map) {
      it(`getSystemErrorName(${code}) should be ${name}`, () => {
        expect(util.getSystemErrorName(code)).toBe(name);
      });
    }

    it("getSystemErrorName(-4096) should be unknown", () => {
      expect(util.getSystemErrorName(-4096)).toBe("Unknown system error -4096");
    });

    // these are the windows/fallback codes and they should match node in either returning the correct name or 'Unknown system error'.
    // eg on linux getSystemErrorName(-4034) should return unkown and not 'ERANGE' since errno defines it as -34 for that platform.
    for (const i of negativeSpaceCodes) {
      it(`negative space: getSystemErrorName(${i}) is correct`, () => {
        expect(util.getSystemErrorName(i)).toEqual(nodeResults.neg[i]);
      });
    }
  });
});

describe("util.parseEnv", () => {
  it("accepts a String object without crashing", () => {
    expect(util.parseEnv(new String("FOO=bar"))).toEqual({ FOO: "bar" });
  });

  it("stores array-index keys as indexed properties", () => {
    // 4294967295 is 2^32 - 1, the first integer that is not an array index.
    const parsed = util.parseEnv("A=1\n0=zero\n2023=y\n4294967295=notidx\n");
    expect(parsed[0]).toBe("zero");
    expect(parsed["0"]).toBe("zero");
    expect(0 in parsed).toBe(true);
    expect(parsed[2023]).toBe("y");
    expect(parsed[4294967295]).toBe("notidx");
    expect(Object.getOwnPropertyDescriptor(parsed, "0")).toEqual({
      value: "zero",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    // Index keys come first, in ascending order. The rest keep file order.
    expect(Object.entries(parsed)).toEqual([
      ["0", "zero"],
      ["2023", "y"],
      ["A", "1"],
      ["4294967295", "notidx"],
    ]);

    parsed[0] = "set";
    expect(parsed[0]).toBe("set");
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({ 0: "set", 2023: "y", A: "1", 4294967295: "notidx" });
  });
});

// format, formatWithOptions, inspect and stripVTControlCharacters come from
// internal/util/inspect, which loads on first use. Node exposes them as data
// properties, so descriptor-based wrappers (sinon, spyOn) must see a `value`.
describe("lazy inspect exports", () => {
  const lazyKeys = ["format", "formatWithOptions", "inspect", "stripVTControlCharacters"];

  it.concurrent("are data properties before the first read, and load inspect on that read", async () => {
    const fixture = `
      const { heapStats } = require("bun:jsc");
      const util = require("node:util");
      const functionsAfterRequire = heapStats().objectTypeCounts.Function;
      const keys = ${JSON.stringify(lazyKeys)};
      const shape = d => ({ value: typeof d.value, get: typeof d.get, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable });
      const before = keys.map(k => shape(Object.getOwnPropertyDescriptor(util, k)));
      const functionsAfterRead = heapStats().objectTypeCounts.Function;
      // the descriptor-based wrapper pattern
      const d = Object.getOwnPropertyDescriptor(util, "inspect");
      const out = d.value.call(util, { a: 1 });
      console.log(JSON.stringify({
        before,
        out,
        same: util.inspect === d.value && util.format === require("node:util").format,
        custom: typeof util.inspect.custom,
        loadedOnRead: functionsAfterRead - functionsAfterRequire > 20,
        after: shape(Object.getOwnPropertyDescriptor(util, "inspect")),
      }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const data = { value: "function", get: "undefined", writable: true, enumerable: true, configurable: true };
    expect(JSON.parse(stdout)).toEqual({
      before: [data, data, data, data],
      out: "{ a: 1 }",
      same: true,
      custom: "symbol",
      loadedOnRead: true,
      after: data,
    });
    expect(exitCode).toBe(0);
  });

  it.concurrent("spyOn works before the first read", async () => {
    const fixture = `
      const { spyOn } = require("bun:test");
      const util = require("node:util");
      const spy = spyOn(util, "format").mockReturnValue("mocked");
      const mocked = util.format("%s", "x");
      const calls = spy.mock.calls.length;
      spy.mockRestore();
      const d = Object.getOwnPropertyDescriptor(util, "format");
      console.log(JSON.stringify({ mocked, calls, restored: util.format("%s!", "ok"), value: typeof d.value, get: typeof d.get }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      mocked: "mocked",
      calls: 1,
      restored: "ok!",
      value: "function",
      get: "undefined",
    });
    expect(exitCode).toBe(0);
  });

  it("spyOn works after the first read", () => {
    expect(util.inspect({ a: 1 })).toBe("{ a: 1 }");
    const spy = spyOn(util, "inspect").mockReturnValue("mocked");
    try {
      expect(util.inspect({ a: 1 })).toBe("mocked");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(util.inspect({ a: 1 })).toBe("{ a: 1 }");
    expect(Object.getOwnPropertyDescriptor(util, "inspect")).toEqual({
      value: util.inspect,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  it("can be replaced through the descriptor, as sinon does", () => {
    const original = Object.getOwnPropertyDescriptor(util, "stripVTControlCharacters");
    expect(typeof original.value).toBe("function");
    const stub = () => "stubbed";
    Object.defineProperty(util, "stripVTControlCharacters", { ...original, value: stub });
    try {
      expect(util.stripVTControlCharacters("\u001b[31mx\u001b[0m")).toBe("stubbed");
    } finally {
      Object.defineProperty(util, "stripVTControlCharacters", original);
    }
    expect(util.stripVTControlCharacters("\u001b[31mx\u001b[0m")).toBe("x");
  });

  it.concurrent("can be replaced by assignment and deleted", async () => {
    const fixture = `
      const util = require("node:util");
      const stub = () => "stubbed";
      util.formatWithOptions = stub;
      const replaced = util.formatWithOptions === stub && Object.getOwnPropertyDescriptor(util, "formatWithOptions").value === stub;
      const deleted = delete util.inspect;
      console.log(JSON.stringify({ replaced, deleted, gone: !("inspect" in util), keys: Object.keys(util).filter(k => k === "inspect" || k === "format") }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ replaced: true, deleted: true, gone: true, keys: ["format"] });
    expect(exitCode).toBe(0);
  });

  it.concurrent("stay read-only on a frozen util, as in node", async () => {
    const fixture = `
      const util = require("node:util");
      Object.freeze(util);
      const shape = d => ({ value: typeof d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable });
      const before = shape(Object.getOwnPropertyDescriptor(util, "inspect"));
      const first = util.inspect;
      util.inspect = () => "replaced";
      const after = shape(Object.getOwnPropertyDescriptor(util, "inspect"));
      console.log(JSON.stringify({ frozen: Object.isFrozen(util), before, after, same: util.inspect === first, out: util.inspect({ a: 1 }) }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const readOnly = { value: "function", writable: false, enumerable: true, configurable: false };
    expect(JSON.parse(stdout)).toEqual({
      frozen: true,
      before: readOnly,
      after: readOnly,
      same: true,
      out: "{ a: 1 }",
    });
    expect(exitCode).toBe(0);
  });
});
