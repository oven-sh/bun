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
import { describe, expect, it } from "bun:test";
import "harness";
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
  it("formatWithOptions", () => {
    expect(util.formatWithOptions({ colors: true }, "%s:%s", "foo")).toBe("foo:%s");
    expect(util.formatWithOptions({ colors: true }, "wow(%o)", { obj: true })).toBe(
      "wow({ obj: \u001B[33mtrue\u001B[39m })",
    );
  });

  it("multiplecolors", () => {
    expect(util.styleText(["bold", "red"], "test")).toBe("\u001b[1m\u001b[31mtest\u001b[39m\u001b[22m");
    expect(util.styleText("bold", "test")).toBe("\u001b[1mtest\u001b[22m");
    expect(util.styleText("red", "test")).toBe("\u001b[31mtest\u001b[39m");
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

    assert.strictEqual(util.styleText("red", "test"), "\u001b[31mtest\u001b[39m");
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
});

describe("isDeepStrictEqual skipPrototype (third argument)", () => {
  class Foo {
    constructor(a) {
      this.a = a;
    }
  }
  class Bar {
    constructor(a) {
      this.a = a;
    }
  }

  it("has length 3 to match Node", () => {
    expect(util.isDeepStrictEqual.length).toBe(3);
  });

  it("skips the prototype check when the third argument is truthy", () => {
    // https://github.com/oven-sh/bun/issues/33074
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), true)).toBe(true);
  });

  it("keeps the prototype check without the third argument", () => {
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1))).toBe(false);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), false)).toBe(false);
  });

  it("coerces the third argument like Node (truthiness)", () => {
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), 1)).toBe(true);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), "x")).toBe(true);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), {})).toBe(true);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), 0)).toBe(false);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), "")).toBe(false);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), null)).toBe(false);
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(1), undefined)).toBe(false);
  });

  it("still enforces the other strict rules when skipping prototypes", () => {
    expect(util.isDeepStrictEqual(new Foo(1), new Bar(2), true)).toBe(false);
    const extra = new Bar(1);
    extra.b = 2;
    expect(util.isDeepStrictEqual(new Foo(1), extra, true)).toBe(false);
    expect(util.isDeepStrictEqual([], {}, true)).toBe(false);
    expect(util.isDeepStrictEqual(new Date(0), {}, true)).toBe(false);
  });

  it("treats plain, null-prototype and class objects as equal", () => {
    expect(util.isDeepStrictEqual({ a: 1 }, new Foo(1), true)).toBe(true);
    expect(util.isDeepStrictEqual(Object.create(null), {}, true)).toBe(true);
  });

  it("applies recursively to nested values", () => {
    expect(util.isDeepStrictEqual({ x: new Foo(1) }, { x: new Bar(1) }, true)).toBe(true);
    expect(util.isDeepStrictEqual({ a: { b: { c: new Foo(1) } } }, { a: { b: { c: new Bar(1) } } }, true)).toBe(true);

    const g1 = {};
    Object.defineProperty(g1, "x", { enumerable: true, get: () => new Foo(1) });
    const g2 = {};
    Object.defineProperty(g2, "x", { enumerable: true, get: () => new Bar(1) });
    expect(util.isDeepStrictEqual(g1, g2, true)).toBe(true);
  });

  it("applies recursively through arrays, Maps and Sets", () => {
    class MyMap extends Map {}
    expect(util.isDeepStrictEqual([new Foo(1)], [new Bar(1)], true)).toBe(true);
    expect(util.isDeepStrictEqual(new MyMap([["a", 1]]), new Map([["a", 1]]), true)).toBe(true);
    expect(util.isDeepStrictEqual(new Map([["k", new Foo(1)]]), new Map([["k", new Bar(1)]]), true)).toBe(true);
    expect(util.isDeepStrictEqual(new Map([[new Foo(1), 1]]), new Map([[new Bar(1), 1]]), true)).toBe(true);
    expect(util.isDeepStrictEqual(new Map([[new Foo(1), 1]]), new Map([[new Bar(1), 2]]), true)).toBe(false);
    expect(util.isDeepStrictEqual(new Set([new Foo(1)]), new Set([new Bar(1)]), true)).toBe(true);
  });

  it("skips the prototype check for boxed String objects", () => {
    class MyStr extends String {}
    expect(util.isDeepStrictEqual(new String("a"), new MyStr("a"), true)).toBe(true);
    expect(util.isDeepStrictEqual(new String("a"), new MyStr("a"))).toBe(false);
    expect(util.isDeepStrictEqual(new String("a"), new MyStr("b"), true)).toBe(false);
  });
});
