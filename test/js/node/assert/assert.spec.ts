import assert, { AssertionError } from "assert";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import vm from "node:vm";
import { inheritedErrors, thrownBy } from "../inherited-errors";

describe("assert(expr)", () => {
  // https://github.com/oven-sh/bun/issues/941
  it.each([true, 1, "foo"])(`assert(%p) does not throw`, expr => {
    expect(() => assert(expr)).not.toThrow();
  });

  it.each([false, 0, "", null, undefined])(`assert(%p) throws`, expr => {
    expect(() => assert(expr)).toThrow(AssertionError);
  });

  it("behaves like assert.ok (a distinct function since node 25)", () => {
    // node >= 25 builds the namespace from Assert.prototype, so assert !== assert.ok.
    expect(assert as Function).not.toBe(assert.ok);
    expect(() => assert.ok(1)).not.toThrow();
    expect(() => assert.ok(0)).toThrow(AssertionError);
  });
});

describe("assert.equal(actual, expected)", () => {
  it.each([
    ["foo", "foo"],
    [1, 1],
    [1, true],
    [0, ""],
    [0, false],
    [Symbol.for("foo"), Symbol.for("foo")],
  ])(`%p == %p`, (actual, expected) => {
    expect(() => assert.equal(actual, expected)).not.toThrow();
  });
  it.each([
    //
    ["foo", "bar"],
    [1, 0],
    [true, false],
    [{}, {}],
    [Symbol("foo"), Symbol("foo")],
    [new Error("oops"), new Error("oops")],
  ])("%p != %p", (actual, expected) => {
    expect(() => assert.equal(actual, expected)).toThrow(AssertionError);
  });
});

describe("assert.deepEqual(actual, expected)", () => {
  describe("error instances", () => {
    let e1: Error & Record<string, any>, e2: Error & Record<string, any>;

    beforeEach(() => {
      e1 = new Error("oops");
      e2 = new Error("oops");
    });

    it("errors with the same message and constructor are equal", () => {
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
    });

    it("errors with different messages are not equal", () => {
      e2.message = "nope";
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with different constructors are not equal", () => {
      e2 = new TypeError("oops");
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with different names are not equal", () => {
      e2.name = "SpecialError";
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with different causes are not equal", () => {
      e1.cause = { property: "value" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
      e2.cause = { property: "another value" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });

    it("errors with the same cause are equal", () => {
      e1.cause = { property: "value" };
      e2.cause = { property: "value" };
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
    });

    it("adding different arbitrary properties makes errors unequal", () => {
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
      e1.a = 1;
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
      e2.a = 1;
      expect(() => assert.deepEqual(e1, e2)).not.toThrow();
      e2.a = { foo: "bar" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
      e1.a = { foo: "baz" };
      expect(() => assert.deepEqual(e1, e2)).toThrow(AssertionError);
    });
  });
});

// The message of a failed comparison shows both operands with util.inspect. Two errors are shown
// as copies, and a copy of a DOMException has `name` and `message` getters that throw.
describe("a comparison that fails, with a value that inherits from Error.prototype", () => {
  // The AssertionError constructor sets the limit to 0 while it builds the message.
  const stackTraceLimit = Error.stackTraceLimit;
  afterEach(() => {
    Error.stackTraceLimit = stackTraceLimit;
  });

  function compare(actual: unknown, expected: unknown) {
    const thrown = thrownBy(() => assert.deepStrictEqual(actual, expected));
    return {
      throws: thrown instanceof AssertionError ? "AssertionError" : thrown,
      stackTraceLimit: Error.stackTraceLimit,
    };
  }

  it.each(inheritedErrors)("%s as an operand or as a cause", (_kind, make) => {
    const asNode = { throws: "AssertionError", stackTraceLimit };
    expect({
      operand: compare(make(), new Error("y")),
      cause: compare(new Error("a", { cause: make() }), new Error("b")),
    }).toEqual({ operand: asNode, cause: asNode });
  });

  // The copy of these operands keeps stack frames, so util.inspect also reads the stack of the cause.
  // Node v26.3.0 throws a TypeError for both and leaves the limit at 0.
  it.each<[string, () => Error]>([
    [
      "a stack that it inherits",
      () => Object.assign(Object.create(new Error("x")), { cause: new DOMException("m", "AbortError") }),
    ],
    [
      "an enumerable stack",
      () => {
        const error = new Error("x", { cause: new DOMException("m", "AbortError") });
        return Object.defineProperty(error, "stack", { value: error.stack, enumerable: true });
      },
    ],
  ])("a DOMException as the cause of an operand with %s", (_, make) => {
    expect(compare(make(), new Error("y"))).toEqual({ throws: "AssertionError", stackTraceLimit });
  });
});

// Node asks one isError everywhere in assert: a native error of any realm, or `instanceof Error`.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util.js#L99-L104
describe("errors that Error.isError() does not accept", () => {
  const errors: typeof inheritedErrors = [
    ...inheritedErrors,
    ["an error of another realm", () => vm.runInNewContext("new Error('m')")],
  ];
  const makeError = Object.fromEntries(inheritedErrors);
  const instance = new assert.Assert();
  const { ok: destructuredOk } = instance;
  const thrower = () => {
    throw new Error("a");
  };

  const calls: [call: string, fail: (e: any) => void][] = [
    ["assert(false, e)", e => assert(false, e)],
    ["assert.ok(false, e)", e => assert.ok(false, e)],
    ["assert.strict.ok(false, e)", e => assert.strict.ok(false, e)],
    ["new assert.Assert().ok(false, e)", e => instance.ok(false, e)],
    ["ok(false, e) destructured from an Assert", e => destructuredOk(false, e)],
    ["assert.fail(e)", e => assert.fail(e)],
    ["assert.equal(1, 2, e)", e => assert.equal(1, 2, e)],
    ["assert.notEqual(1, 1, e)", e => assert.notEqual(1, 1, e)],
    ["assert.strictEqual(1, 2, e)", e => assert.strictEqual(1, 2, e)],
    ["assert.notStrictEqual(1, 1, e)", e => assert.notStrictEqual(1, 1, e)],
    ["assert.deepEqual({ a: 1 }, { a: 2 }, e)", e => assert.deepEqual({ a: 1 }, { a: 2 }, e)],
    ["assert.notDeepEqual({ a: 1 }, { a: 1 }, e)", e => assert.notDeepEqual({ a: 1 }, { a: 1 }, e)],
    ["assert.deepStrictEqual({ a: 1 }, { a: 2 }, e)", e => assert.deepStrictEqual({ a: 1 }, { a: 2 }, e)],
    ["assert.notDeepStrictEqual({ a: 1 }, { a: 1 }, e)", e => assert.notDeepStrictEqual({ a: 1 }, { a: 1 }, e)],
    ["assert.partialDeepStrictEqual({ a: 1 }, { a: 2 }, e)", e => assert.partialDeepStrictEqual({ a: 1 }, { a: 2 }, e)],
    ["assert.match('a', /b/, e)", e => assert.match("a", /b/, e)],
    ["assert.doesNotMatch('a', /a/, e)", e => assert.doesNotMatch("a", /a/, e)],
    ["assert.throws(fn, { message: 'b' }, e)", e => assert.throws(thrower, { message: "b" }, e)],
  ];
  const everyErrorItself = Object.fromEntries(errors.map(([kind]) => [kind, "thrown itself"]));

  it.each(calls)("%s throws the error that is the message", (_call, fail) => {
    const outcome = Object.fromEntries(
      errors.map(([kind, make]) => {
        const e = make();
        return [kind, thrownBy(() => fail(e)) === e ? "thrown itself" : "replaced"];
      }),
    );
    expect(outcome).toEqual(everyErrorItself);
  });

  it.each([
    ["util.inherits(F, Error)", "Inherits", "Inherits: m"],
    ["new DOMException()", "DOMException", "AbortError: m"],
    ["a Proxy of an Error", "Error", "Error: m"],
  ])("assert.throws() reports %s as an error", (kind, name, text) => {
    const e = makeError[kind]();
    const throwIt = () => {
      throw e;
    };
    const validate = () => false;
    const message = (fn: () => void) => (thrownBy(fn) as Error).message;
    expect({
      otherClass: message(() => assert.throws(throwIt, TypeError)),
      validation: message(() => assert.throws(throwIt, validate)),
    }).toEqual({
      otherClass: `The error is expected to be an instance of "TypeError". Received "${name}"\n\nError message:\n\nm`,
      validation: `The "validate" validation function is expected to return "true". Received false\n\nCaught error:\n\n${text}`,
    });
  });

  it("the message shows a cause of an old-style class without its stack", () => {
    const thrown = thrownBy(() =>
      assert.deepStrictEqual(new Error("a", { cause: makeError["util.inherits(F, Error)"]() }), new Error("b")),
    ) as AssertionError;
    expect(Bun.stripANSI(thrown.message)).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n" +
        "+ [Error: a] {\n+   [cause]: [Inherits: m] {\n+     code: 'E_OLD'\n+   }\n+ }\n- [Error: b]\n",
    );
  });

  // Not as in Node: it throws a RangeError. JavaScriptCore's `x instanceof Error` never returns.
  it("a message whose prototype chain cycles through a Proxy is no error", () => {
    const message: object = new Proxy({}, { getPrototypeOf: () => message });
    expect(thrownBy(() => assert.ok(false, message as Error))).toBeInstanceOf(AssertionError);
  });

  it("globals replaced after node:assert is loaded change nothing", async () => {
    const script = `
      const assert = require("node:assert");
      function OldError(message) {
        this.message = message;
      }
      OldError.prototype = Object.create(Error.prototype);
      const errors = { "a native error": new Error("m"), "an old-style error": new OldError("m") };
      const calls = { "assert.ok(false, e)": e => assert.ok(false, e), "assert.fail(e)": e => assert.fail(e) };
      function run(tamper) {
        for (const [kind, e] of Object.entries(errors)) {
          for (const [call, fail] of Object.entries(calls)) {
            let thrown;
            try {
              fail(e);
            } catch (x) {
              thrown = x;
            }
            console.log(tamper + ", " + call + ", " + kind + ": " + (thrown === e ? "e itself" : "another error"));
          }
        }
      }
      const RealError = Error;
      const realIsError = Error.isError;
      globalThis.Error = function FakeError() {};
      run("globalThis.Error replaced");
      globalThis.Error = RealError;
      Error.isError = () => false;
      run("Error.isError replaced");
      Error.isError = realIsError;
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: [
        "globalThis.Error replaced, assert.ok(false, e), a native error: e itself",
        "globalThis.Error replaced, assert.fail(e), a native error: e itself",
        "globalThis.Error replaced, assert.ok(false, e), an old-style error: e itself",
        "globalThis.Error replaced, assert.fail(e), an old-style error: e itself",
        "Error.isError replaced, assert.ok(false, e), a native error: e itself",
        "Error.isError replaced, assert.fail(e), a native error: e itself",
        "Error.isError replaced, assert.ok(false, e), an old-style error: e itself",
        "Error.isError replaced, assert.fail(e), an old-style error: e itself",
      ],
      stderr: expect.any(String),
      exitCode: 0,
    });
  });
});
