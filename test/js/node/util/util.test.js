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
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast } from "harness";
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

  // styleText() has two paths. A call with a string format, a string text and
  // `validateStream: false` reads a snapshot of `util.inspect.colors`, which
  // the first such call takes. Every other call reads the table itself. So
  // the result of a call depends on the calls before it, and each case runs
  // in a new process. The expected values are the output of Node.js v26.12.1.
  describe("styleText after a change of util.inspect.colors", () => {
    const prelude = `
      const util = require("node:util");
      const colors = util.inspect.colors;
      const noValidate = { validateStream: false };
      const pipe = { write() {}, on() {} };
      const terminal = { write() {}, on() {}, isTTY: true, getColorDepth: () => 8 };
      const attempt = fn => { try { return fn(); } catch (error) { return "threw " + error.name + " " + error.code; } };
      const fast = format => attempt(() => util.styleText(format, "x", noValidate));
      const slow = format => attempt(() => util.styleText([format], "x", noValidate));
      const onTerminal = format => attempt(() => util.styleText(format, "x", { stream: terminal }));
      const onPipe = format => attempt(() => util.styleText(format, "x", { stream: pipe }));
      const out = {};
    `;
    const sgr = (open, close = 39) => `\u001b[${open}mx\u001b[${close}m`;
    const invalidValue = "threw TypeError ERR_INVALID_ARG_VALUE";
    const invalidType = "threw TypeError ERR_INVALID_ARG_TYPE";
    const noCode = "threw TypeError undefined";

    const cases = [
      [
        "a color added after the snapshot",
        `out.first = fast("red");
         colors.mine = [95, 39];
         out.mine = [fast("mine"), slow("mine"), onTerminal("mine"), onPipe("mine")];
         out.withBold = attempt(() => util.styleText(["bold", "mine"], "x", noValidate));
         out.nested = attempt(() => util.styleText("mine", "a" + util.styleText("mine", "b", noValidate) + "c", noValidate));
         out.unknown = [fast("nope"), slow("nope"), onTerminal("nope"), onPipe("nope")];`,
        {
          first: sgr(31),
          mine: [sgr(95), sgr(95), sgr(95), "x"],
          withBold: "\u001b[1m\u001b[95mx\u001b[39m\u001b[22m",
          nested: "\u001b[95ma\u001b[95mb\u001b[95mc\u001b[39m",
          unknown: [invalidValue, invalidValue, invalidValue, invalidValue],
        },
      ],
      [
        "a color added after the snapshot is read on every call",
        `out.first = fast("red");
         colors.mine = [95, 39];
         out.added = [fast("mine"), slow("mine")];
         colors.mine = [96, 39];
         out.replaced = [fast("mine"), slow("mine")];
         colors.mine[0] = 97;
         out.edited = [fast("mine"), slow("mine")];
         delete colors.mine;
         out.deleted = [fast("mine"), slow("mine")];`,
        {
          first: sgr(31),
          added: [sgr(95), sgr(95)],
          replaced: [sgr(96), sgr(96)],
          edited: [sgr(97), sgr(97)],
          deleted: [invalidValue, invalidValue],
        },
      ],
      [
        "a built-in color changed after the snapshot",
        `out.first = fast("red");
         colors.red = [91, 39];
         colors.gray = [37, 39];
         out.red = [fast("red"), slow("red"), onTerminal("red")];
         out.grey = [fast("grey"), slow("grey")];
         colors.red[0] = 92;
         out.edited = [fast("red"), slow("red")];`,
        {
          first: sgr(31),
          red: [sgr(31), sgr(91), sgr(91)],
          grey: [sgr(90), sgr(37)],
          edited: [sgr(31), sgr(92)],
        },
      ],
      [
        "a built-in color deleted after the snapshot",
        `out.first = fast("red");
         delete colors.red;
         out.red = [fast("red"), slow("red"), onTerminal("red"), onPipe("red")];`,
        {
          first: sgr(31),
          red: [sgr(31), invalidValue, invalidValue, invalidValue],
        },
      ],
      [
        "the table replaced after the snapshot",
        `out.first = fast("red");
         util.inspect.colors = { __proto__: null, red: [95, 39], mine: [96, 39] };
         out.fast = [fast("red"), fast("bold"), fast("mine")];
         out.slow = [slow("red"), slow("bold"), slow("mine")];`,
        {
          first: sgr(31),
          fast: [sgr(31), sgr(1, 22), sgr(96)],
          slow: [sgr(95), invalidValue, sgr(96)],
        },
      ],
      [
        "calls that do not take the snapshot",
        `out.before = [slow("red"), onTerminal("red"), onPipe("red"), attempt(() => util.styleText("red", 1, noValidate))];
         colors.red = [91, 39];
         colors.mine = [95, 39];
         out.after = [fast("red"), slow("red"), fast("mine"), slow("mine")];
         colors.red = [92, 39];
         out.later = [fast("red"), slow("red")];`,
        {
          before: [sgr(31), sgr(31), "x", invalidType],
          after: [sgr(91), sgr(91), sgr(95), sgr(95)],
          later: [sgr(91), sgr(92)],
        },
      ],
      [
        "'none' takes the snapshot",
        `out.none = fast("none");
         colors.red = [91, 39];
         out.red = [fast("red"), slow("red")];`,
        {
          none: "x",
          red: [sgr(31), sgr(91)],
        },
      ],
      [
        "an entry that is not a pair of codes",
        `out.first = fast("red");
         colors.nothing = null;
         colors.zero = 0;
         colors.text = "ab";
         out.nothing = [fast("nothing"), slow("nothing")];
         out.zero = slow("zero");
         out.text = slow("text");
         colors.red = null;
         out.red = [fast("red"), slow("red")];`,
        {
          first: sgr(31),
          nothing: [noCode, noCode],
          zero: "\u001b[undefinedmx\u001b[undefinedm",
          text: sgr("a", "b"),
          red: [sgr(31), noCode],
        },
      ],
      [
        // `__proto__` and `constructor` are not names: the table has no prototype.
        "the other arguments are checked before the table is read",
        `const reads = [];
         Object.defineProperty(colors, "watched", {
           get() { reads.push("watched"); return [95, 39]; },
           enumerable: true,
           configurable: true,
         });
         const check = fn => { reads.length = 0; return [attempt(fn), reads.length]; };
         out.text = check(() => util.styleText("watched", 1, noValidate));
         out.validateStream = check(() => util.styleText("watched", "x", { validateStream: 1 }));
         out.stream = check(() => util.styleText("watched", "x", { stream: 1 }));
         out.options = check(() => util.styleText("watched", "x", 1));
         out.unknownNameAndText = check(() => util.styleText("nope", 1, noValidate));
         out.valid = check(() => util.styleText(["watched", "watched"], "x", noValidate));
         out.names = [slow("__proto__"), slow("constructor")];
         out.hex = [onTerminal("#fc0"), onPipe("#fc0"), onPipe("#zzz")];`,
        {
          text: [invalidType, 0],
          validateStream: [invalidType, 0],
          stream: [invalidType, 0],
          options: [invalidType, 0],
          unknownNameAndText: [invalidType, 0],
          valid: ["\u001b[95m\u001b[95mx\u001b[39m\u001b[39m", 2],
          names: [invalidValue, invalidValue],
          hex: [sgr("38;2;255;204;0"), "x", invalidValue],
        },
      ],
      [
        "the order in which the codes are read and converted",
        `const log = [];
         const spy = (name, value) => ({ [Symbol.toPrimitive]() { log.push(name); return value; } });
         const watched = (name, codes) => new Proxy(codes, {
           get(target, key, receiver) {
             if (typeof key === "string") log.push(name + "[" + key + "]");
             return Reflect.get(target, key, receiver);
           },
         });
         const run = fn => { log.length = 0; return [attempt(fn), log.join(" ")]; };
         colors.spied = watched("spied", [spy("open", 95), spy("close", 39)]);
         colors.plain = watched("plain", [96, 39]);
         colors.half = watched("half", [97, spy("close", 49)]);
         out.slow = run(() => util.styleText(["spied"], "x", noValidate));
         out.slowTwice = run(() => util.styleText(["plain", "plain"], "x", noValidate));
         out.half = [run(() => util.styleText(["half"], "x", noValidate)), run(() => util.styleText(["half"], "x", noValidate))];
         out.snapshot = run(() => util.styleText("red", "x", noValidate));
         out.fast = run(() => util.styleText("spied", "x", noValidate));
         out.slowAgain = run(() => util.styleText(["spied"], "x", noValidate));`,
        {
          slow: [sgr(95), "spied[0] open spied[1] close"],
          slowTwice: ["\u001b[96m\u001b[96mx\u001b[39m\u001b[39m", "plain[0] plain[1] plain[0] plain[1]"],
          half: [
            [sgr(97, 49), "half[0] half[1] close"],
            [sgr(97, 49), "half[0] half[1] close"],
          ],
          snapshot: [sgr(31), "spied[0] open spied[1] close plain[0] plain[1] half[0] half[1] close"],
          fast: [sgr(95), ""],
          slowAgain: [sgr(95), "spied[0] open spied[1] close"],
        },
      ],
      [
        "colors that have the same open code, and codes of other kinds",
        `colors.a = [95, 39];
         colors.b = [95, 49];
         out.alternate = [slow("a"), slow("b"), slow("a"), slow("b")];
         out.together = attempt(() => util.styleText(["a", "b", "a"], "x", noValidate));
         colors.wide = [300, 39];
         colors.fraction = [1.5, 22];
         colors.negative = [-1, 39];
         colors.negativeZero = [-0, 39];
         colors.notANumber = [NaN, NaN];
         colors.bigOpen = [1n, 22];
         out.kinds = ["wide", "fraction", "negative", "negativeZero", "notANumber", "bigOpen", "a", "reset"].map(slow);
         colors.boldLike = [1, 39];
         out.boldLike = attempt(() => util.styleText(["boldLike"], "a\\u001b[39mb", noValidate));
         out.bold = attempt(() => util.styleText(["bold"], "a\\u001b[22mb", noValidate));`,
        {
          alternate: [sgr(95), sgr(95, 49), sgr(95), sgr(95, 49)],
          together: "\u001b[95m\u001b[95m\u001b[95mx\u001b[39m\u001b[49m\u001b[39m",
          kinds: [sgr(300), sgr(1.5, 22), sgr(-1), sgr(0), sgr(NaN, NaN), sgr(1, 22), sgr(95), sgr(0, 0)],
          boldLike: "\u001b[1ma\u001b[39m\u001b[1mb\u001b[39m",
          bold: "\u001b[1ma\u001b[22m\u001b[1mb\u001b[22m",
        },
      ],
      [
        // The string "1" gives the same escape string as the number 1. Only the number is the bold code.
        "codes that are strings",
        `colors.orange = ["38;5;208", 39];
         colors.stringBold = ["1", "22"];
         out.orange = [slow("orange"), slow("orange")];
         out.bold = attempt(() => util.styleText(["bold"], "a\\u001b[22mb", noValidate));
         out.stringBold = attempt(() => util.styleText(["stringBold"], "a\\u001b[22mb", noValidate));
         colors.orange[0] = "38;5;209";
         out.edited = [slow("orange"), fast("orange")];`,
        {
          orange: [sgr("38;5;208"), sgr("38;5;208")],
          bold: "\u001b[1ma\u001b[22m\u001b[1mb\u001b[22m",
          stringBold: "\u001b[1ma\u001b[1mb\u001b[22m",
          edited: [sgr("38;5;209"), sgr("38;5;209")],
        },
      ],
      [
        "more codes than the table of escape strings keeps",
        `const wrong = [];
         for (let round = 0; round < 2; round++) {
           for (let i = 0; i < 600; i++) {
             colors.tmp = [1000 + i, "c" + i];
             if (slow("tmp") !== "\\u001b[" + (1000 + i) + "mx\\u001b[c" + i + "m") wrong.push(i);
           }
         }
         out.wrong = wrong;
         out.after = [slow("red"), slow("bold"), fast("red")];`,
        {
          wrong: [],
          after: [sgr(31), sgr(1, 22), sgr(31)],
        },
      ],
    ];

    async function check(exe, script, expected) {
      await using proc = Bun.spawn({
        cmd: [exe, "-e", `${prelude}${script}\nprocess.stdout.write(JSON.stringify(out));`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    }

    // Not concurrent: a debug build takes a second to start, and longer when thirteen start at once.
    it.each(cases)("bun: %s", (_, script, expected) => check(bunExe(), script, expected));

    // Node.js reads the table on every slow call since v26.4.0.
    const node = nodeExeAtLeast("26.4.0");
    it.skipIf(!node).concurrent.each(cases)("node: %s", (_, script, expected) => check(node, script, expected));

    it("keeps a bounded number of escape strings", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { heapStats } = require("bun:jsc");
           const util = require("node:util");
           const colors = util.inspect.colors;
           const strings = () => { Bun.gc(true); return heapStats().objectTypeCounts.string; };
           const use = (from, to) => {
             for (let i = from; i < to; i++) {
               colors.tmp = ["38;5;" + i, 39];
               util.styleText(["tmp"], "x", { validateStream: false });
             }
             delete colors.tmp;
           };
           use(0, 400);
           const before = strings();
           use(400, 6400);
           process.stdout.write(String(strings() - before));`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      // 6,000 codes, all different. A table without a bound keeps one string for each.
      expect(Number(stdout)).toBeLessThan(3500);
      expect(exitCode).toBe(0);
    });
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

    it("reports a number that no int32 holds as it is", () => {
      expect(util.getSystemErrorName(-4294967297)).toBe("Unknown system error -4294967297");
      expect(util.getSystemErrorName(-2147483649)).toBe("Unknown system error -2147483649");
      expect(util.getSystemErrorName(Number.MIN_SAFE_INTEGER)).toBe("Unknown system error -9007199254740991");
    });

    it("reports -0 with its sign", () => {
      expect(() => util.getSystemErrorName(-0)).toThrow(
        'The value of "err" is out of range. It must be a negative integer. Received -0',
      );
    });

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

it("inspect() does not use isMapIterator and isSetIterator of the writable node:util/types", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const types = require("node:util/types");
        const calls = { isMapIterator: 0, isSetIterator: 0 };
        for (const name of Object.keys(calls)) {
          const original = types[name];
          types[name] = value => (calls[name]++, original(value));
        }
        // Loaded after the replacement.
        const { inspect } = require("node:util");
        const map = new Map([["a", 1]]);
        const set = new Set([1]);
        const inspected = [map.keys(), map.entries(), set.values(), set.entries(), { [Symbol.iterator]() {} }].map(v => inspect(v));
        console.log(JSON.stringify({ inspected, calls }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    out: {
      inspected: [
        "[Map Iterator] { 'a' }",
        "[Map Entries] { [ 'a', 1 ] }",
        "[Set Iterator] { 1 }",
        "[Set Entries] { [ 1, 1 ] }",
        "{ Symbol(Symbol.iterator): [Function: [Symbol.iterator]] }",
      ],
      calls: { isMapIterator: 0, isSetIterator: 0 },
    },
    stderr: "",
    exitCode: 0,
  });
});

describe("util.parseEnv", () => {
  it("accepts a String object without crashing", () => {
    expect(util.parseEnv(new String("FOO=bar"))).toEqual({ FOO: "bar" });
  });

  it.each([
    [undefined, "undefined"],
    [null, "null"],
    [1, "type number (1)"],
    [{}, "an instance of Object"],
  ])("says what Node says of %p", (content, received) => {
    expect(() => util.parseEnv(content)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "content" argument must be of type string. Received ${received}`,
      }),
    );
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
