import { describe, expect, test } from "bun:test";

// Coverage for the WebKit dbdca7545d sync. Each case pins an observable difference between
// the old and the new JavaScriptCore. The sources that depend on how JavaScriptCore parses
// are compiled with `new Function` or an indirect eval, so that Bun's transpiler leaves them alone.

describe.concurrent("WebKit dbdca7545d upgrade", () => {
  test("the call in `(a?.b)(x)` is outside the optional chain (63b7d629dd1)", () => {
    const log: string[] = [];
    const call = new Function("a", "arg", "return (a?.b)(arg());");
    expect(() => call(undefined, () => log.push("arg"))).toThrow(TypeError);
    // The arguments are evaluated before the call throws: the chain ended at the closing parenthesis.
    expect(log).toEqual(["arg"]);
    // Without the parentheses the call is still part of the chain.
    expect(new Function("a", "arg", "return a?.b(arg());")(undefined, () => log.push("arg"))).toBeUndefined();
    expect(log).toEqual(["arg"]);
  });

  test("a parenthesized optional chain used as a template tag keeps its `this` (7fbe85cfbfd)", () => {
    const receiver = {
      tag() {
        "use strict";
        return this;
      },
    };
    expect(new Function("o", "return (o?.tag)`x`;")(receiver)).toBe(receiver);
    expect(new Function("o", "return (o?.['tag'])`x`;")(receiver)).toBe(receiver);
  });

  test("`super.tag` used as a template tag is called with the current `this` (24e354459de)", () => {
    class Base {
      tag() {
        return this;
      }
    }
    const Derived = new Function("Base", "return class extends Base { run() { return super.tag`x`; } };")(Base);
    const instance = new Derived();
    expect(instance.run()).toBe(instance);
  });

  test("a catch parameter named `await` is a SyntaxError where `await` is not an identifier (edb17fbf37d)", () => {
    expect(() => (0, eval)("(async function () { try {} catch (await) {} })")).toThrow(SyntaxError);
    expect(() => (0, eval)("(async function () { try {} catch (aw\\u0061it) {} })")).toThrow(SyntaxError);
    // In a plain function `await` is an ordinary identifier.
    expect(new Function("try { throw 1; } catch (await) { return await; }")()).toBe(1);
  });

  // TODO: any SyntaxError from the Function constructor aborts a build that validates exception checks
  // (BUN_JSC_validateExceptionChecks=1, which the ASAN lane sets), `new Function("(")` included:
  //
  //   ERROR: Unchecked JS exception:
  //       This scope can throw a JS exception: computeErrorInfoToJSValueWithoutSkipping @ src/jsc/bindings/FormatStackTraceForJS.cpp
  //       But the exception was unchecked as of this scope: constructFunctionSkippingEvalEnabledCheck @ Source/JavaScriptCore/runtime/FunctionConstructor.cpp
  //   ASSERTION FAILED: exception check validation failed
  //
  // JavaScriptCore's addErrorInfo() runs the stack formatting hook while the parser's error object is made, and the
  // Function constructor then throws that error with no exception check in between. eval and vm.Script check, which is
  // why the test above uses an indirect eval. The assertions below hold on a build without the validation.
  test.todo("the Function constructor throws that SyntaxError too", () => {
    expect(() => new Function("return async function () { try {} catch (await) {} };")).toThrow(SyntaxError);
    expect(() => new Function("return async function () { try {} catch (aw\\u0061it) {} };")).toThrow(SyntaxError);
  });

  test("`await` is an identifier in a non-async function nested in an async function's parameters (09c4cfc7d73)", async () => {
    const f = new Function(
      "return async function (a = function () { var await = 42; return await; }) { return a(); };",
    )();
    expect(await f()).toBe(42);
  });

  test("new Array(length) reads newTarget.prototype before it throws for an invalid length (e4e335cf8df)", () => {
    const newTarget = new Proxy(function () {}, {
      get() {
        throw new EvalError("prototype read");
      },
    });
    for (const length of [-1, 1.5, 2 ** 32, Infinity]) {
      expect(() => Reflect.construct(Array, [length], newTarget)).toThrow(EvalError);
    }
    expect(() => new Array(-1)).toThrow(RangeError);
  });

  test("Intl.DurationFormat keeps the minus sign of a fraction between -1 and 0 (501d1f661f9)", () => {
    const format = (options: Intl.DurationFormatOptions, duration: Intl.DurationInput) =>
      new Intl.DurationFormat("en", options).format(duration);
    expect(format({ seconds: "numeric" }, { milliseconds: -500 })).toBe("-0.5");
    expect(format({ seconds: "2-digit" }, { milliseconds: -500 })).toBe("-00.5");
    expect(format({ seconds: "numeric" }, { nanoseconds: -1 })).toBe("-0.000000001");
  });

  test("Intl.Segmenter containing() finds the segment of a low surrogate (3e27303e85c)", () => {
    const input = "a\u{1F600}b";
    const segments = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(input);
    const iterated = [...segments];
    for (let index = 0; index < input.length; index++) {
      const expected = iterated.find(s => index >= s.index && index < s.index + s.segment.length)!;
      const hit = segments.containing(index)!;
      expect({ segment: hit.segment, index: hit.index }).toEqual({ segment: expected.segment, index: expected.index });
    }
  });

  test("for-of and destructuring over Arrays and Strings close the iteration when asked to (35637c64339, 5330149c555)", () => {
    // Neither loop allocates an iterator object any more. One has to appear when `return` does.
    const calls: string[] = [];
    const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
    const stringIteratorPrototype = Object.getPrototypeOf(""[Symbol.iterator]());
    function firstOf(iterable: Iterable<unknown>) {
      for (const value of iterable) return value;
    }
    try {
      for (let i = 0; i < 100; i++) {
        expect(firstOf([i, 2, 3])).toBe(i);
        expect(firstOf("\u{1F600}bc")).toBe("\u{1F600}");
      }
      arrayIteratorPrototype.return = function () {
        calls.push("array");
        return {};
      };
      stringIteratorPrototype.return = function () {
        calls.push("string");
        return {};
      };
      expect(firstOf([1, 2, 3])).toBe(1);
      expect(firstOf("abc")).toBe("a");
      const [first] = [7, 8];
      const [head] = "xyz";
      expect([first, head]).toEqual([7, "x"]);
      expect(calls).toEqual(["array", "string", "array", "string"]);
    } finally {
      delete arrayIteratorPrototype.return;
      delete stringIteratorPrototype.return;
    }
  });
});
