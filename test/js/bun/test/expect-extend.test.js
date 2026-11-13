/// <reference path="./expect-extend.types.d.ts" />
// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/expect-extend.test.js`
 *  `bunx vitest test/js/bun/test/expect-extend.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/expect-extend.test.js`
 */

import { bunEnv, bunExe, tempDir, withoutAggressiveGC } from "harness";
import test_interop from "./test-interop.js";
var { isBun, expect, describe, test, it, jest } = await test_interop();

//expect.addSnapshotSerializer(alignedAnsiStyleSerializer);

expect.extend({
  // @ts-expect-error
  _toHaveMessageThatThrows(actual, expected) {
    const message = () => ({
      [Symbol.toPrimitive]: () => {
        throw new Error("i have successfully propagated the error message!");
      },
    });

    return { message, pass: 42 };
  },
  [""](actual, expected) {
    return { pass: actual === expected };
  },
  _toBeDivisibleBy(actual, expected) {
    const pass = typeof actual === "number" && actual % expected === 0;
    const message = pass
      ? () => `expected ${this.utils.printReceived(actual)} not to be divisible by ${expected}`
      : () => `expected ${this.utils.printReceived(actual)} to be divisible by ${expected}`;

    return { message, pass };
  },
  _toBeSymbol(actual, expected) {
    const pass = actual === expected;
    const message = () =>
      `expected ${this.utils.printReceived(actual)} to be Symbol ${this.utils.printExpected(expected)}`;

    return { message, pass };
  },
  _toBeWithinRange(actual, floor, ceiling) {
    const pass = typeof actual === "number" && actual >= floor && actual <= ceiling;
    const message = pass
      ? () => `expected ${this.utils.printReceived(actual)} not to be within range ${floor} - ${ceiling}`
      : () => `expected ${this.utils.printReceived(actual)} to be within range ${floor} - ${ceiling}`;

    return { message, pass };
  },
  _toCustomEqual(actual, expected) {
    return { pass: this.equals(actual, expected) };
  },

  // this matcher has not been defined through declaration merging, but expect.extends should allow it anyways,
  // type-enforcing the generic signature
  _untypedMatcher(actual) {
    return { pass: !!actual, message: () => "isNot=" + this.isNot };
  },

  // @ts-expect-error: return type doesn't match
  _invalidMatcher() {},
});

// TODO: remove this stubbing when _toThrowErrorMatchingSnapshot is implemented
expect.extend({
  _toThrowErrorMatchingSnapshot(value) {
    if (typeof value !== "function") throw new Error("not a function");
    try {
      value();
      return { pass: false, message: () => "abc" };
    } catch (err) {
      return { pass: true, message: () => "abc" };
    }
  },
});

it("is available globally when matcher is unary", () => {
  expect(15)._toBeDivisibleBy(5);
  expect(15)._toBeDivisibleBy(3);
  expect(15).not._toBeDivisibleBy(6);

  expect(() => expect(15)._toBeDivisibleBy(2))._toThrowErrorMatchingSnapshot();
});

it("is available globally when matcher is variadic", () => {
  expect(15)._toBeWithinRange(10, 20);
  expect(15).not._toBeWithinRange(6, 10);

  expect(() => expect(15)._toBeWithinRange(1, 3))._toThrowErrorMatchingSnapshot();
});

it("exposes matcherUtils in context", () => {
  expect.extend({
    _shouldNotError(_actual) {
      const pass =
        typeof this.equals === "function" &&
        typeof this.utils.iterableEquality === "function" &&
        typeof this.utils.subsetEquality === "function";
      const message = pass
        ? () => "expected this.utils to be defined in an extend call"
        : () => "expected this.utils not to be defined in an extend call";

      return { message, pass };
    },
  });

  expect("test")._shouldNotError();
});

it("is ok if there is no message specified", () => {
  expect.extend({
    _toFailWithoutMessage(_expected) {
      return { message: () => "", pass: false };
    },
  });

  expect(() => expect(true)._toFailWithoutMessage())._toThrowErrorMatchingSnapshot();
});

it("works with empty matcher name", () => {
  expect(1)[""](1);
});

it("exposes an equality function to custom matchers", () => {
  // expect and expect share the same global state
  //expect.assertions(3);
  expect.extend({
    _toBeOne(_expected) {
      expect(this.equals).toBeFunction();
      return { message: () => "", pass: !!this.equals(1, 1) };
    },
  });

  expect(() => expect("test")._toBeOne()).not.toThrow();
});

it("defines asymmetric unary matchers", () => {
  expect(() => expect({ value: 2 }).toEqual({ value: expect._toBeDivisibleBy(2) })).not.toThrow();
  expect(() => expect({ value: 3 }).toEqual({ value: expect._toBeDivisibleBy(2) }))._toThrowErrorMatchingSnapshot();
  expect(() => expect({ value: 3 }).toEqual({ value: expect._toBeDivisibleBy(2) })).toThrow();
});

it("defines asymmetric unary matchers that can be prefixed by not", () => {
  expect(() => expect({ value: 2 }).toEqual({ value: expect.not._toBeDivisibleBy(2) }))._toThrowErrorMatchingSnapshot();
  expect(() => expect({ value: 3 }).toEqual({ value: expect.not._toBeDivisibleBy(2) })).not.toThrow();
});

it("defines asymmetric variadic matchers", () => {
  expect(() => expect({ value: 2 }).toEqual({ value: expect._toBeWithinRange(1, 3) })).not.toThrow();
  expect(() => expect({ value: 3 }).toEqual({ value: expect._toBeWithinRange(4, 11) }))._toThrowErrorMatchingSnapshot();
});

it("defines asymmetric variadic matchers that can be prefixed by not", () => {
  expect(() =>
    expect({ value: 2 }).toEqual({
      value: expect.not._toBeWithinRange(1, 3),
    }),
  )._toThrowErrorMatchingSnapshot();
  expect(() =>
    expect({ value: 3 }).toEqual({
      value: expect.not._toBeWithinRange(5, 7),
    }),
  ).not.toThrow();
});

it("prints the Symbol into the error message", () => {
  const foo = Symbol("foo");
  const bar = Symbol("bar");

  expect(() =>
    expect({ a: foo }).toEqual({
      a: expect._toBeSymbol(bar),
    }),
  )._toThrowErrorMatchingSnapshot();
});

it("allows overriding existing extension", () => {
  expect.extend({
    _toAllowOverridingExistingMatcher(_expected) {
      return { message: () => "", pass: _expected === "bar" };
    },
  });

  expect("foo").not._toAllowOverridingExistingMatcher();

  expect.extend({
    _toAllowOverridingExistingMatcher(_expected) {
      return { message: () => "", pass: _expected === "foo" };
    },
  });

  expect("foo")._toAllowOverridingExistingMatcher();
});

it("throws descriptive errors for invalid matchers", () => {
  expect(() =>
    expect.extend({
      // @ts-expect-error
      _default: undefined,
    }),
  ).toThrow('expect.extend: `_default` is not a valid matcher. Must be a function, is "undefined"');
  expect(() =>
    expect.extend({
      // @ts-expect-error
      _default: null,
    }),
  ).toThrow('expect.extend: `_default` is not a valid matcher. Must be a function, is "null"');
  expect(() =>
    expect.extend({
      // @ts-expect-error
      _default: 42,
    }),
  ).toThrow('expect.extend: `_default` is not a valid matcher. Must be a function, is "number"');
  expect(() =>
    expect.extend({
      // @ts-expect-error
      _default: "foobar",
    }),
  ).toThrow('expect.extend: `_default` is not a valid matcher. Must be a function, is "string"');
});

describe("invalid matcher implementations errors", () => {
  const buildErrorMsg = (/** @type {string} */ val) => {
    return (
      (isBun
        ? "Unexpected return from matcher function `_toCustomA`.\n"
        : "Unexpected return from a matcher function.\n") +
      "Matcher functions should return an object in the following format:\n" +
      "  {message?: string | function, pass: boolean}\n" +
      `'${val}' was returned`
    );
  };

  it("handles correctly when matcher throws", () => {
    expect.extend({
      _toCustomA: _expected => {
        throw new Error("MyError");
      },
    });
    expect(() => expect(0)._toCustomA()).toThrow("MyError");
  });

  it("throws when returns undefined", () => {
    expect.extend({
      // @ts-expect-error
      _toCustomA: _expected => 42,
    });
    expect(() => expect(0)._toCustomA()).toThrow(buildErrorMsg("42"));
  });

  it("throws when returns not an object", () => {
    expect.extend({
      // @ts-expect-error
      _toCustomA: _expected => 42,
    });
    expect(() => expect(0)._toCustomA()).toThrow(buildErrorMsg("42"));
  });

  it('throws when return is missing "pass"', () => {
    expect.extend({
      // @ts-expect-error
      _toCustomA: _expected => ({}),
    });
    expect(() => expect(0)._toCustomA()).toThrow(buildErrorMsg("{}"));
  });

  it("supports undefined message", () => {
    expect.extend({
      _toCustomA: _expected => ({ pass: _expected === 1 }),
    });
    expect(() => expect(1)._toCustomA()).not.toThrow();
    expect(() => expect(0).not._toCustomA()).not.toThrow();

    // check default values
    expect(() => expect(0)._toCustomA()).toThrow("No message was specified for this matcher.");
    expect(() => expect(1).not._toCustomA()).toThrow("No message was specified for this matcher.");
  });

  it('handles correctly when "message" getter throws', () => {
    expect.extend({
      _toCustomA: _expected => ({
        pass: false,
        message: () => {
          throw new Error("MyError");
        },
      }), // not a function
    });
    expect(() => expect(0)._toCustomA()).toThrow("MyError");
  });
});

describe("async support", () => {
  it("supports async matcher result", async () => {
    expect.extend({
      _toCustomA: _expected => Promise.resolve({ pass: _expected === 1 }),
      _toCustomB: async _expected => Promise.resolve({ pass: _expected === 1 }),
    });

    await expect(1)._toCustomA(); // symmetric use
    await expect(1)._toCustomB(); // symmetric use
    if (isBun) {
      // jest somehow can't handle this
      await expect(1).toEqual(expect._toCustomA()); // asymmetric use
      await expect(1).toEqual(expect._toCustomB()); // asymmetric use
    }
  });

  it("throws on async matcher result rejection", async () => {
    expect.extend({
      _toCustomA: _expected => Promise.reject("error"),
      _toCustomB: async _expected => Promise.reject("error"),
    });

    if (isBun) {
      // jest throws an UnhandledPromiseRejection
      await expect(async () => await expect(1)._toCustomA()).toThrow(); // symmetric use
      await expect(async () => await expect(1)._toCustomB()).toThrow(); // symmetric use
      await expect(async () => await expect(1).toEqual(expect._toCustomA())).toThrow(); // asymmetric use
      await expect(async () => await expect(1).toEqual(expect._toCustomB())).toThrow(); // asymmetric use
    }
  });

  it("throws the matcher's rejection error when printing the rejected value throws", () => {
    const rejection = new String("rejection");
    rejection.toString = () => {
      throw new TypeError("toString throws");
    };
    expect.extend({
      _toCustomA: _expected => Promise.reject(rejection),
    });

    if (isBun) {
      // the matcher call throws its own error, not the TypeError from toString()
      expect(() => expect(1)._toCustomA()).toThrow("Matcher `_toCustomA` returned a promise that rejected");
    }
  });
});

it("passes any number of arguments on", () => {
  let seen;
  expect.extend({
    _toSeeArguments(...args) {
      seen = args;
      return { pass: true, message: () => "" };
    },
  });
  for (const count of [0, 1, 6, 7, 8, 9, 40]) {
    const args = Array.from({ length: count }, (_, i) => ({ i }));
    const received = { received: count };
    expect(received)._toSeeArguments(...args);
    expect(seen).toEqual([received, ...args]);
    expect(seen.every((arg, i) => arg === (i ? args[i - 1] : received))).toBe(true);
    seen = undefined;
    expect({ a: received }).toEqual({ a: expect._toSeeArguments(...args) });
    expect(seen.every((arg, i) => arg === (i ? args[i - 1] : received))).toBe(true);
    expect(seen).toHaveLength(count + 1);
  }
});

it("should not crash under intensive usage", () => {
  withoutAggressiveGC(() => {
    for (let i = 0; i < 10000; ++i) {
      expect(i)._toBeDivisibleBy(1);
      expect(i).toEqual(expect._toBeDivisibleBy(1));
    }
  });
  Bun.gc(true);
});

it("should propagate errors from calling .toString() on the message callback value", () => {
  expect(() => expect("abc").not._toHaveMessageThatThrows("def")).toThrow(
    "i have successfully propagated the error message!",
  );
});

it("should support asymmetric matchers", () => {
  expect(1)._toCustomEqual(expect.anything());
  expect(1)._toCustomEqual(expect.any(Number));
  expect({ a: "test" })._toCustomEqual({ a: expect.any(String) });
  expect(() => expect(1)._toCustomEqual(expect.any(String))).toThrow();

  expect(1).not._toCustomEqual(expect.any(String));
  expect({ a: "test" }).not._toCustomEqual({ a: expect.any(Number) });
  expect(() => expect(1).not._toCustomEqual(expect.any(Number))).toThrow();
});

it("works on prototypes", () => {
  const Bar = {
    _toBeBar() {
      return { pass: true };
    },
  };
  const Foo = Object.create(Bar);

  expect.extend(Foo);
  expect(123)._toBeBar();
});

it("works on classes", () => {
  class Bar {
    _toBeBar() {
      return { pass: true };
    }
  }
  class Foo extends Bar {}

  expect.extend(new Foo());
  expect(123)._toBeBar();
});

test("expect.extend with numeric index keys does not crash", () => {
  // Numeric keys are valid array indices. putDirect asserts they are not indices,
  // so putMayBeIndex must be used instead. Without the fix, putDirect incorrectly
  // stores the property in the Structure table rather than indexed storage,
  // making the matcher inaccessible via normal property lookup.
  expect.extend({
    1073741820: received => ({ pass: received === 42, message: () => "not 42" }),
  });
  expect(typeof expect[1073741820]).toBe("function");
});

describe("a failing custom matcher's message is thrown unchanged", () => {
  expect.extend({
    _toFailWith(received, result) {
      return { pass: false, ...result };
    },
    _toPassWith(received, result) {
      return { pass: true, ...result };
    },
    async _toFailLaterWith(received, result) {
      return { pass: false, ...result };
    },
    _toFailWithItsHint() {
      const options = { isNot: this.isNot, promise: this.promise };
      return { pass: this.isNot, message: () => this.utils.matcherHint("_toFailWithItsHint", "it", "", options) };
    },
  });
  const messageOf = async fn => {
    try {
      await fn();
    } catch (error) {
      return Bun.stripANSI(error.message);
    }
  };
  const message = () => "line 1\nline 2\n";

  test("with and without modifiers", async () => {
    expect([
      await messageOf(() => expect(1)._toFailWith({ message })),
      await messageOf(() => expect(1).not._toPassWith({ message })),
      await messageOf(() => expect(Promise.resolve(1)).resolves._toFailWith({ message })),
      await messageOf(() => expect(Promise.reject(1)).rejects._toFailWith({ message })),
      await messageOf(() => expect(Promise.resolve(1)).resolves.not._toPassWith({ message })),
      await messageOf(() => expect(1)._toFailLaterWith({ message })),
    ]).toEqual(Array(6).fill("line 1\nline 2\n"));
  });

  test("a matcher can build the hint itself from this.isNot and this.promise", async () => {
    expect([
      await messageOf(() => expect(1)._toFailWithItsHint()),
      await messageOf(() => expect(1).not._toFailWithItsHint()),
      await messageOf(() => expect(Promise.resolve(1)).resolves._toFailWithItsHint()),
      await messageOf(() => expect(Promise.reject(1)).rejects.not._toFailWithItsHint()),
    ]).toEqual([
      "expect(it)._toFailWithItsHint()",
      "expect(it).not._toFailWithItsHint()",
      "expect(it).resolves._toFailWithItsHint()",
      "expect(it).rejects.not._toFailWithItsHint()",
    ]);
  });

  test.skipIf(!isBun)("under the label of expect(value, label)", async () => {
    expect(await messageOf(() => expect(1, "the label")._toFailWith({ message }))).toBe(
      "the label\n\nline 1\nline 2\n",
    );
  });

  test("no message", async () => {
    for (const result of [{}, { message: undefined }, { message: () => undefined }, { message: () => "" }]) {
      expect(await messageOf(() => expect(1)._toFailWith(result))).toBe("No message was specified for this matcher.");
    }
  });

  test("other messages", async () => {
    expect(await messageOf(() => expect(1)._toFailWith({ message: () => 5 }))).toBe("5");
    const thrown = new Error("from message()");
    expect(() =>
      expect(1)._toFailWith({
        message() {
          throw thrown;
        },
      }),
    ).toThrow(thrown);
  });

  test("a failing asymmetric matcher is printed by the enclosing matcher", async () => {
    expect(await messageOf(() => expect({ a: 1 }).toEqual({ a: expect._toFailWith({ message }) }))).toStartWith(
      "expect(received).toEqual(expected)",
    );
  });
});

describe("MatcherContext", () => {
  describe("utils", () => {
    test("RECEIVED_COLOR is a function", () => {
      expect.extend({
        toBeCustomColor(_actual, _expected) {
          expect(this.utils.RECEIVED_COLOR).toBeFunction();
          return { pass: true };
        },
      });

      expect(123).toBeCustomColor(456);
    });

    /** @type {import("bun:test").MatcherContext["utils"]} */
    let utils;
    expect.extend({
      _toGiveItsUtils() {
        utils = this.utils;
        return { pass: true };
      },
    });
    expect()._toGiveItsUtils();
    const inAngles = text => `<${text}>`;

    // Expected values measured on jest-matcher-utils 30.5.1.
    test.each([
      [["toX"], "expect(received).toX(expected)"],
      [[".toX"], "expect(received).toX(expected)"],
      [[".not.toX"], "expect(received).not.toX(expected)"],
      [["toX", "element"], "expect(element).toX(expected)"],
      [["toX", "element", ""], "expect(element).toX()"],
      [[".toBeDisabled", "element", ""], "expect(element).toBeDisabled()"],
      [[".not.toBeDisabled", "element", ""], "expect(element).not.toBeDisabled()"],
      [["toX", "", ""], "expect.toX()"],
      [["toX", "", "e"], "expect.toX(e)"],
      [["toX", undefined, undefined], "expect(received).toX(expected)"],
      [["toX", "r", "e", undefined], "expect(r).toX(e)"],
      [["toX", "r", "e", {}], "expect(r).toX(e)"],
      [["toX", undefined, undefined, { isNot: true }], "expect(received).not.toX(expected)"],
      [["toX", undefined, undefined, { promise: "resolves" }], "expect(received).resolves.toX(expected)"],
      [
        ["toX", undefined, undefined, { promise: "rejects", isNot: true }],
        "expect(received).rejects.not.toX(expected)",
      ],
      [["toX", undefined, undefined, { comment: "deep equality" }], "expect(received).toX(expected) // deep equality"],
      [["toX", undefined, "", { comment: "c" }], "expect(received).toX() // c"],
      [["toX", undefined, undefined, { secondArgument: "second" }], "expect(received).toX(expected, second)"],
      [["toX", undefined, "", { secondArgument: "second" }], "expect(received).toX()"],
      [["toX", undefined, undefined, { isDirectExpectCall: true }], "expect.toX(expected)"],
      [["toX", "", undefined, { isDirectExpectCall: true, isNot: true }], "expect.not.toX(expected)"],
      [[".toX", undefined, undefined, { isNot: true }], "expect(received).not.toX(expected)"],
      [[".toX", undefined, undefined, { promise: "resolves" }], "expect(received).resolves.toX(expected)"],
      [
        [
          "toX",
          "r",
          "e",
          { expectedColor: inAngles, receivedColor: inAngles, secondArgument: "s", secondArgumentColor: inAngles },
        ],
        "expect(<r>).toX(<e>, <s>)",
      ],
      [["toX", "r", "e", { comment: "", promise: "", secondArgument: "" }], "expect(r).toX(e)"],
      [["toX", "r", "e", { isNot: 1, comment: 5 }], "expect(r).not.toX(e) // 5"],
      [["toX", 1, 2], "expect(1).toX(2)"],
      [["toX", null, null], "expect(null).toX(null)"],
      [["toX", "a.b", "c.d"], "expect(a.b).toX(c.d)"],
      [["a.b.c"], "expect(received)a.b.c(expected)"],
      [["toX", "multi\nline", "e"], "expect(multi\nline).toX(e)"],
      [["", "r", "e"], "expect(r).(e)"],
    ])("matcherHint(...%j)", (args, hint) => {
      expect(Bun.stripANSI(utils.matcherHint(...args))).toBe(hint);
    });

    test("matcherHint reads each argument once, in order", () => {
      const log = [];
      const logged = name => ({
        toString() {
          log.push(name);
          return name;
        },
      });
      const options = new Proxy(
        { comment: logged("comment"), promise: logged("promise"), secondArgument: logged("secondArgument") },
        {
          get(target, key) {
            log.push(`options.${String(key)}`);
            return target[key];
          },
        },
      );
      expect(Bun.stripANSI(utils.matcherHint("toX", logged("received"), logged("expected"), options))).toBe(
        "expect(received).promise.toX(expected, secondArgument) // comment",
      );
      expect(log).toEqual([
        "received",
        "expected",
        "options.comment",
        "comment",
        "options.expectedColor",
        "options.isDirectExpectCall",
        "options.isNot",
        "options.promise",
        "promise",
        "options.receivedColor",
        "options.secondArgument",
        "secondArgument",
        "options.secondArgumentColor",
      ]);
    });

    test("matcherHint throws on invalid arguments", () => {
      expect(() => utils.matcherHint()).toThrow("the first argument (matcher name) must be a string");
      expect(() => utils.matcherHint(1)).toThrow("the first argument (matcher name) must be a string");
      expect(() => utils.matcherHint("toX", "r", "e", 1)).toThrow("options must be an object (or undefined)");
      for (const option of ["receivedColor", "expectedColor", "secondArgumentColor"]) {
        expect(() => utils.matcherHint("toX", "r", "e", { secondArgument: "s", [option]: 1 })).toThrow(
          new TypeError(`matcherHint: options.${option} must be a function`),
        );
      }
      // Like Jest, an unused color option isn't validated.
      expect(Bun.stripANSI(utils.matcherHint("toX", "", "", { receivedColor: 1, expectedColor: 1 }))).toBe(
        "expect.toX()",
      );
      const thrown = new Error("from the color");
      expect(() =>
        utils.matcherHint("toX", "r", "e", {
          receivedColor() {
            throw thrown;
          },
        }),
      ).toThrow(thrown);
    });

    test.each(["EXPECTED_COLOR", "RECEIVED_COLOR"])("%s adds color without quoting or formatting the text", name => {
      const color = (...args) => Bun.stripANSI(utils[name](...args));
      expect([
        color("text"),
        color('"quoted"'),
        color("a  \nb "),
        color(""),
        color(),
        color(5),
        color(true),
        color(null),
        color(undefined),
        color({ a: "b" }),
        color([1, "x"]),
        color("a", "b", 1),
      ]).toEqual([
        "text",
        '"quoted"',
        "a  \nb ",
        "",
        "",
        "5",
        "true",
        "null",
        "undefined",
        "[object Object]",
        "1,x",
        "a b 1",
      ]);
    });

    // Expected values measured on jest-matcher-utils 30.5.1.
    test.each([
      [[1, 1], null],
      [[1, 2], null],
      [[NaN, NaN], null],
      [[0, -0], null],
      [[1n, 2n], null],
      [[true, false], null],
      [[expect.any(Number), 1], null],
      [[], "Compared values have no visual difference."],
      [["a", "a"], "Compared values have no visual difference."],
      [["", ""], "Compared values have no visual difference."],
      [[null, null], "Compared values have no visual difference."],
      [[{ a: 1 }, { a: 1 }], "Compared values have no visual difference."],
      [[[1], [1]], "Compared values have no visual difference."],
      [[1, 1n], "  Comparing two different types of values. Expected number but received bigint."],
      [["1", 1], "  Comparing two different types of values. Expected string but received number."],
      [[1], "  Comparing two different types of values. Expected number but received undefined."],
      [[null, undefined], "  Comparing two different types of values. Expected null but received undefined."],
      [[null, {}], "  Comparing two different types of values. Expected null but received object."],
      [[{}, []], "  Comparing two different types of values. Expected object but received array."],
      [[new Map(), new Set()], "  Comparing two different types of values. Expected map but received set."],
      [[/a/, {}], "  Comparing two different types of values. Expected regexp but received object."],
      [[new Date(0), {}], "  Comparing two different types of values. Expected date but received object."],
      [[() => {}, {}], "  Comparing two different types of values. Expected function but received object."],
      [[Symbol(), {}], "  Comparing two different types of values. Expected symbol but received object."],
      [[new String("a"), "a"], "  Comparing two different types of values. Expected object but received string."],
    ])("diff(...%p)", (args, text) => {
      const diff = utils.diff(...args);
      expect(diff && Bun.stripANSI(diff)).toBe(text);
    });

    test("diff marks the lines that differ", () => {
      const marked = (...args) =>
        Bun.stripANSI(utils.diff(...args))
          .split("\n")
          .filter(line => /^[-+]/.test(line));
      const counts = (expected, received) => [`- Expected  - ${expected}`, `+ Received  + ${received}`];
      expect(marked("a\nb\nc", "a\nx\nc")).toEqual(["- b", "+ x", ...counts(1, 1)]);
      expect(marked({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['-   "b": 2,', '+   "b": 3,', ...counts(1, 1)]);
      expect(marked([1, 2, 3], [1, 3])).toEqual(["-   2,", ...counts(1, 0)]);
      expect(marked(new Map([["a", 1]]), new Map([["a", 2]]))).toEqual([
        '-   "a" => 1,',
        '+   "a" => 2,',
        ...counts(1, 1),
      ]);
      expect(marked({ a: 1 }, { a: 2 }, { expand: false, contextLines: 0 })).toEqual([
        '-   "a": 1,',
        '+   "a": 2,',
        ...counts(1, 1),
      ]);
      expect(Bun.stripANSI(utils.diff("color: blue;", "color: red;"))).toBe(
        "Expected: color: blue;\nReceived: color: red;",
      );
      expect(Bun.stripANSI(utils.diff(new Error("a"), new Error("b")))).toBe(
        "Expected: [Error: a]\nReceived: [Error: b]",
      );
      expect(Bun.stripANSI(utils.diff(Symbol("a"), Symbol("b")))).toBe("Expected: Symbol(a)\nReceived: Symbol(b)");
    });

    test("diff rethrows an error thrown while printing a value", () => {
      const thrown = new Error("from the trap");
      const value = new Proxy(
        {},
        {
          ownKeys() {
            throw thrown;
          },
        },
      );
      expect(() => utils.diff(value, {})).toThrow(thrown);
      expect(() => utils.diff({}, value)).toThrow(thrown);
    });

    // Expected values measured on jest-matcher-utils 30.5.1.
    test.each([
      [undefined, "Received has value: <undefined>"],
      [null, "Received has value: <object>"],
      [[1], "Received has type:  array\nReceived has value: <object>"],
      [true, "Received has type:  boolean\nReceived has value: <boolean>"],
      [() => {}, "Received has type:  function\nReceived has value: <function>"],
      [1, "Received has type:  number\nReceived has value: <number>"],
      ["s", "Received has type:  string\nReceived has value: <string>"],
      [1n, "Received has type:  bigint\nReceived has value: <bigint>"],
      [{ a: 1 }, "Received has type:  object\nReceived has value: <object>"],
      [/a/, "Received has type:  regexp\nReceived has value: <object>"],
      [new Map(), "Received has type:  map\nReceived has value: <object>"],
      [new Set(), "Received has type:  set\nReceived has value: <object>"],
      [new Date(0), "Received has type:  date\nReceived has value: <object>"],
      [Symbol("s"), "Received has type:  symbol\nReceived has value: <symbol>"],
      [new Error("e"), "Received has type:  object\nReceived has value: <object>"],
      [Object.create(null), "Received has type:  object\nReceived has value: <object>"],
    ])("printWithType(%p)", (value, text) => {
      expect(utils.printWithType("Received", value, printed => `<${typeof printed}>`)).toBe(text);
    });

    test("printWithType converts and checks its arguments", () => {
      expect(utils.printWithType(5, 1, String)).toBe("5 has type:  number\n5 has value: 1");
      expect(utils.printWithType("N", 1, () => 7)).toBe("N has type:  number\nN has value: 7");
      expect(Bun.stripANSI(utils.printWithType("Received", "s", utils.printReceived))).toBe(
        'Received has type:  string\nReceived has value: "s"',
      );
      for (const args of [[], ["N", 1], ["N", 1, 5]]) {
        expect(() => utils.printWithType(...args)).toThrow(
          new TypeError("printWithType: the third argument (print) must be a function"),
        );
      }
      const thrown = new Error("from print");
      expect(() =>
        utils.printWithType("N", 1, () => {
          throw thrown;
        }),
      ).toThrow(thrown);
    });

    test.each(["stringify", "printExpected", "printReceived"])("%s prints an error without its stack", name => {
      class CustomError extends Error {
        name = "CustomError";
      }
      expect(
        [
          new Error("a"),
          new TypeError("b"),
          new CustomError("c"),
          new Error(""),
          new Error("l1\nl2"),
          Object.assign(new Error("d"), { code: 1 }),
          new Error("e", { cause: new Error("f") }),
        ].map(error => Bun.stripANSI(utils[name](error))),
      ).toEqual([
        "[Error: a]",
        "[TypeError: b]",
        "[CustomError: c]",
        "[Error]",
        "[Error: l1\nl2]",
        "[Error: d]",
        "[Error: e]",
      ]);
    });

    test("colors", async () => {
      using dir = tempDir("matcher-utils-colors", {
        "colors.test.js": `
          import { expect, test } from "bun:test";
          test("colors", () => {
            expect.extend({
              _toPrintColors() {
                const { matcherHint, EXPECTED_COLOR, RECEIVED_COLOR } = this.utils;
                console.log(
                  JSON.stringify([
                    matcherHint("toX"),
                    matcherHint(".toX", "element", ""),
                    matcherHint("toX", "r", "e", { isNot: true, promise: "resolves", comment: "c", secondArgument: "s" }),
                    EXPECTED_COLOR("a"),
                    RECEIVED_COLOR("a"),
                    EXPECTED_COLOR(""),
                  ]),
                );
                return { pass: true };
              },
            });
            expect()._toPrintColors();
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "colors.test.js"],
        cwd: String(dir),
        env: { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const [dim, red, green, reset] = ["\x1b[2m", "\x1b[31m", "\x1b[32m", "\x1b[0m"];
      expect({
        printed: stdout
          .split("\n")
          .filter(line => line.startsWith("["))
          .map(line => JSON.parse(line))[0],
        stderr,
      }).toEqual({
        printed: [
          `${dim}expect(${reset}${red}received${reset}${dim}).${reset}toX${dim}(${reset}${green}expected${reset}${dim})${reset}`,
          `${dim}expect(${reset}${red}element${reset}${dim}).toX()${reset}`,
          `${dim}expect(${reset}${red}r${reset}${dim}).${reset}resolves${dim}.${reset}not${dim}.${reset}toX${dim}(${reset}${green}e${reset}${dim}, ${reset}${green}s${reset}${dim}) // c${reset}`,
          `${green}a${reset}`,
          `${red}a${reset}`,
          "",
        ],
        stderr: expect.any(String),
      });
      expect(exitCode).toBe(0);
    });
  });
});

describe.skipIf(!isBun)("passing a module namespace to expect.extend()", () => {
  test("only `default` and `__esModule` are left out when they are not functions", () => {
    expect.extend({
      // @ts-expect-error
      default: { _toBeInTheDefaultExport() {} },
      // @ts-expect-error
      __esModule: true,
      _toBeInTheNamespace(actual) {
        return { pass: actual === "namespace" };
      },
    });
    // @ts-expect-error
    expect("namespace")._toBeInTheNamespace();
    expect("default" in expect(1)).toBe(false);
    expect("__esModule" in expect(1)).toBe(false);
    expect("_toBeInTheDefaultExport" in expect(1)).toBe(false);

    for (const name of ["Default", "esModule", "__esmodule", "module.exports"]) {
      expect(() => expect.extend({ [name]: {} })).toThrow(
        `expect.extend: \`${name}\` is not a valid matcher. Must be a function, is "object"`,
      );
    }
  });

  test("import * as matchers from a CommonJS module", async () => {
    using dir = tempDir("expect-extend-namespace", {
      "plain.cjs": `exports.toBeEven = actual => ({ pass: actual % 2 === 0 });`,
      "transpiled.cjs": `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.toBeOdd = actual => ({ pass: actual % 2 === 1 });
        exports.default = { toBeOdd: exports.toBeOdd };
      `,
      "namespace.test.js": `
        import { expect, test } from "bun:test";
        import * as plain from "./plain.cjs";
        import * as transpiled from "./transpiled.cjs";
        for (const matchers of [plain, transpiled]) {
          console.log(Object.keys(matchers).map(name => name + ": " + typeof matchers[name]).join(", "));
          expect.extend(matchers);
        }
        test("the matchers of the modules", () => {
          expect(2).toBeEven();
          expect(2).not.toBeOdd();
        });
        test("a function named default is a matcher", () => {
          expect.extend({ default: actual => ({ pass: actual === 1 }) });
          expect(1).default();
          expect(2).not.default();
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "namespace.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.split("\n").slice(1),
      stderr: stderr.split("\n").filter(line => /^ \d+ \w+$/.test(line)),
    }).toEqual({
      stdout: ["default: object, toBeEven: function", "default: object, toBeOdd: function", ""],
      stderr: [" 2 pass", " 0 fail"],
    });
    expect(exitCode).toBe(0);
  });
});

// What the two answer is in expect-utils.test.ts. These tests are about the matcher that gets them, and about what
// Bun's own matchers do beside it.
describe.skipIf(!isBun)("this.utils.iterableEquality and this.utils.subsetEquality", () => {
  /** Calls `probe` with the `this` of a custom matcher. */
  function inMatcher(probe) {
    let result;
    expect.extend({
      _toRunInMatcher() {
        result = probe(this);
        return { pass: true, message: () => "" };
      },
    });
    expect(0)._toRunInMatcher();
    return result;
  }

  /** Checks `[expected, run]` rows: what `run` returns. */
  function check(rows) {
    const entries = Object.entries(rows);
    expect(Object.fromEntries(entries.map(([name, [, run]]) => [name, run()]))).toStrictEqual(
      Object.fromEntries(entries.map(([name, [expected]]) => [name, expected])),
    );
  }

  function passes(assert) {
    try {
      assert();
      return true;
    } catch {
      return false;
    }
  }

  function* gen(items) {
    yield* items;
  }
  /** The built-in rules take two of these for equal, whatever they hold: they have no property. */
  class Hidden {
    #items;
    constructor(items) {
      this.#items = items;
    }
    *[Symbol.iterator]() {
      yield* this.#items;
    }
  }

  test("both are own functions of this.utils, and the same ones in every matcher", () => {
    const utils = inMatcher(context => context.utils);
    const describeMember = name => ({
      type: typeof utils[name],
      name: utils[name].name,
      length: utils[name].length,
      isSameInNextCall: inMatcher(context => context.utils[name]) === utils[name],
      descriptor: Object.getOwnPropertyDescriptor(utils, name),
    });
    const own = { writable: true, enumerable: true, configurable: true };
    expect(["iterableEquality", "subsetEquality"].map(describeMember)).toEqual([
      {
        type: "function",
        name: "iterableEquality",
        length: 2,
        isSameInNextCall: true,
        descriptor: { value: utils.iterableEquality, ...own },
      },
      {
        type: "function",
        name: "subsetEquality",
        length: 2,
        isSameInNextCall: true,
        descriptor: { value: utils.subsetEquality, ...own },
      },
    ]);

    let inAsymmetricMatcher;
    expect.extend({
      _toSeeItsUtils() {
        inAsymmetricMatcher = this.utils;
        return { pass: true, message: () => "" };
      },
    });
    expect(1).toEqual(expect._toSeeItsUtils());
    expect(inAsymmetricMatcher).toBe(utils);
  });

  test("a custom matcher hands them to this.equals()", () => {
    expect.extend({
      _toEqualIterable(received, expected) {
        const pass = this.equals(received, expected, [this.utils.iterableEquality]);
        return { pass, message: () => "the two " + (pass ? "are equal" : "differ") };
      },
      _toBeSupersetOf(received, expected) {
        const testers = [...this.customTesters, this.utils.iterableEquality, this.utils.subsetEquality];
        const pass = this.equals(received, expected, testers);
        return { pass, message: () => "the first " + (pass ? "has" : "lacks") + " what the second has" };
      },
    });
    expect(new Set([1, 2]))._toEqualIterable(new Set([1, 2]));
    expect(new Set([1, 2])).not._toEqualIterable(new Set([1, 3]));
    expect(new Hidden([1, 2]))._toEqualIterable(new Hidden([1, 2]));
    expect(new Hidden([1, 2])).not._toEqualIterable(new Hidden([1, 3]));
    expect(() => expect(new Hidden([1, 2]))._toEqualIterable(new Hidden([1, 3]))).toThrow("the two differ");
    expect(() => expect(new Hidden([1, 2])).not._toEqualIterable(new Hidden([1, 2]))).toThrow("the two are equal");
    expect({ a: new Hidden([1]), b: { c: 2, d: 3 } })._toBeSupersetOf({ a: new Hidden([1]), b: { c: 2 } });
    expect({ a: new Hidden([1]), b: { c: 2, d: 3 } }).not._toBeSupersetOf({ a: new Hidden([2]), b: { c: 2 } });
    expect({ b: { c: 2 } }).not._toBeSupersetOf({ b: { c: 2, d: 3 } });
  });

  test("a matcher that uses them works in every place a matcher can be", async () => {
    expect.extend({
      _toHoldTheItemsOf(received, expected) {
        const pass = this.equals(received, expected, [...this.customTesters, this.utils.iterableEquality]);
        return { pass, message: () => "the two " + (pass ? "are equal" : "differ") };
      },
    });
    const [same, other] = [() => new Hidden([1, 2]), () => new Hidden([1, 3])];

    await expect(Promise.resolve(same())).resolves._toHoldTheItemsOf(same());
    await expect(Promise.resolve(same())).resolves.not._toHoldTheItemsOf(other());
    await expect(Promise.reject(same())).rejects._toHoldTheItemsOf(same());
    await expect(Promise.reject(same())).rejects.not._toHoldTheItemsOf(other());
    expect.soft(same())._toHoldTheItemsOf(same());
    expect.soft(same()).not._toHoldTheItemsOf(other());
    await expect.poll(same)._toHoldTheItemsOf(same());
    await expect.poll(same).not._toHoldTheItemsOf(other());

    expect({ a: same() }).toEqual({ a: expect._toHoldTheItemsOf(same()) });
    expect({ a: same() }).not.toEqual({ a: expect._toHoldTheItemsOf(other()) });
    expect({ a: same() }).toEqual({ a: expect.not._toHoldTheItemsOf(other()) });
    expect({ a: same() }).toStrictEqual({ a: expect._toHoldTheItemsOf(same()) });
    expect({ a: same() }).not.toStrictEqual({ a: expect._toHoldTheItemsOf(other()) });
    expect({ a: same(), b: 1 }).toMatchObject({ a: expect._toHoldTheItemsOf(same()) });
    expect({ a: same(), b: 1 }).not.toMatchObject({ a: expect._toHoldTheItemsOf(other()) });
    expect([1, same()]).toContainEqual(expect._toHoldTheItemsOf(same()));
    expect([1, same()]).not.toContainEqual(expect._toHoldTheItemsOf(other()));
    const fn = jest.fn();
    fn(same());
    expect(fn).toHaveBeenCalledWith(expect._toHoldTheItemsOf(same()));
    expect(fn).not.toHaveBeenCalledWith(expect._toHoldTheItemsOf(other()));
    expect([
      expect._toHoldTheItemsOf(same()).asymmetricMatch(same()),
      expect._toHoldTheItemsOf(other()).asymmetricMatch(same()),
    ]).toEqual([true, false]);
  });

  // Bun's toEqual() and toMatchObject() are not made of the two testers. Each row has what the built-in matcher says,
  // and then what a matcher says that is made of them the way Jest makes its own.
  test("toEqual() and toMatchObject() beside a matcher that is made of the two", () => {
    expect.extend({
      _toEqualByTesters(received, expected) {
        const pass = this.equals(received, expected, [this.utils.iterableEquality]);
        return { pass, message: () => "the two " + (pass ? "are equal" : "differ") };
      },
      _toMatchByTesters(received, expected) {
        const pass = this.equals(received, expected, [this.utils.iterableEquality, this.utils.subsetEquality]);
        return { pass, message: () => "the first " + (pass ? "has" : "lacks") + " what the second has" };
      },
    });
    /** `pair` makes the two values anew for each matcher: a generator can be read once. */
    const equal = pair => [
      passes(() => expect(pair()[0]).toEqual(pair()[1])),
      passes(() => expect(pair()[0])._toEqualByTesters(pair()[1])),
    ];
    const match = pair => [
      passes(() => expect(pair()[0]).toMatchObject(pair()[1])),
      passes(() => expect(pair()[0])._toMatchByTesters(pair()[1])),
    ];
    check({
      "toEqual(): Sets in another order": [[true, true], () => equal(() => [new Set([1, 2]), new Set([2, 1])])],
      "toEqual(): Sets that differ": [[false, false], () => equal(() => [new Set([1, 2]), new Set([1, 3])])],
      "toEqual(): Maps that differ": [[false, false], () => equal(() => [new Map([[1, 2]]), new Map([[1, 3]])])],
      "toEqual(): generators": [[true, true], () => equal(() => [gen([1, 2]), gen([1, 2])])],
      // toEqual() has no rule for an iterable that is no Set and no Map. It compares the properties, and these have
      // none.
      "toEqual(): generators that differ": [[true, false], () => equal(() => [gen([1, 2]), gen([1, 3])])],
      "toEqual(): iterables with different private items": [
        [true, false],
        () => equal(() => [new Hidden([1, 2]), new Hidden([1, 3])]),
      ],
      "toEqual(): a Set and a generator": [[false, false], () => equal(() => [new Set([1]), gen([1])])],
      "toMatchObject(): fewer properties": [[true, true], () => match(() => [{ a: 1, b: 2 }, { a: 1 }])],
      "toMatchObject(): more properties": [[false, false], () => match(() => [{ a: 1 }, { a: 1, b: 2 }])],
      "toMatchObject(): an array of subsets": [[true, true], () => match(() => [[{ a: 1, b: 2 }], [{ a: 1 }]])],
      "toMatchObject(): a Date": [[true, true], () => match(() => [{ a: new Date(0) }, { a: new Date(0) }])],
      // toMatchObject() compares the properties of every two objects: #44405, #15673.
      "toMatchObject(): another Date": [[true, false], () => match(() => [{ a: new Date(0) }, { a: new Date(1) }])],
      "toMatchObject(): another Error": [
        [true, false],
        () => match(() => [{ a: new Error("x") }, { a: new Error("y") }]),
      ],
      "toMatchObject(): another Set": [[true, false], () => match(() => [{ a: new Set([1]) }, { a: new Set([2]) }])],
      "toMatchObject(): another Map": [
        [true, false],
        () => match(() => [{ a: new Map([[1, 2]]) }, { a: new Map([[1, 3]]) }]),
      ],
      "toMatchObject(): a generator that differs": [
        [true, false],
        () => match(() => [{ a: gen([1]) }, { a: gen([2]) }]),
      ],
    });
  });

  // Like Jest, an asymmetric matcher compares with the registered testers, and not with the list of the this.equals()
  // call around it. Each row has what toMatchObject() says, and then what a matcher says that has subsetEquality in its
  // list.
  test("subsetEquality in the list does not loosen what an asymmetric matcher compares", () => {
    expect.extend({
      _toMatchShape(received, expected) {
        const pass = this.equals(received, expected, [this.utils.iterableEquality, this.utils.subsetEquality]);
        return { pass, message: () => "the value " + (pass ? "has" : "does not have") + " the shape" };
      },
      _toEqualWithItsTesters(received, expected) {
        const pass = this.equals(received, expected, this.customTesters);
        return { pass, message: () => "the two " + (pass ? "are equal" : "differ") };
      },
      _toEqualWithoutAList(received, expected) {
        const pass = this.equals(received, expected);
        return { pass, message: () => "the two " + (pass ? "are equal" : "differ") };
      },
      _toBeSupersetByCall(received, expected) {
        const pass = this.utils.subsetEquality(received, expected) === true;
        return { pass, message: () => "the first " + (pass ? "has" : "lacks") + " what the second has" };
      },
      _toMatchShapeWith(received, expected, tester) {
        const testers = [tester, this.utils.iterableEquality, this.utils.subsetEquality];
        const pass = this.equals(received, expected, testers);
        return { pass, message: () => "the value " + (pass ? "has" : "does not have") + " the shape" };
      },
    });
    class Boxed {
      constructor(inner) {
        this.inner = inner;
      }
    }
    /** A tester of the user that compares with the testers it is asked with. */
    function byInner(a, b, testers) {
      return a instanceof Boxed && b instanceof Boxed ? this.equals(a.inner, b.inner, testers) : undefined;
    }
    const boxed = (a, b) => passes(() => expect(a)._toMatchShapeWith(b, byInner));
    const both = (a, b) => [passes(() => expect(a).toMatchObject(b)), passes(() => expect(a)._toMatchShape(b))];
    const item = { id: 1 };
    const longerItem = { id: 1, required: "x" };
    const equalByToEqual = sample => ({ asymmetricMatch: other => passes(() => expect(other).toEqual(sample)) });
    const [items, longerItems] = [() => new Set([item]), () => new Set([longerItem])];
    const containing = sample => expect.objectContaining(sample);
    check({
      "any()": [[true, true], () => both({ a: 1, b: 2 }, { a: expect.any(Number) })],
      "any() that does not match": [[false, false], () => both({ a: "x", b: 2 }, { a: expect.any(Number) })],
      // toMatchObject() of Bun takes this pair, which Jest's and Vitest's do not: the row is the made matcher alone.
      "arrayContaining() whose item has a property more": [
        false,
        () => passes(() => expect([item])._toMatchShape(expect.arrayContaining([longerItem]))),
      ],
      "arrayContaining() whose item has a property more, in a property": [
        [false, false],
        () => both({ nested: [item] }, { nested: expect.arrayContaining([longerItem]) }),
      ],
      "arrayContaining() whose item has a property less": [
        [false, false],
        () => both({ nested: [longerItem] }, { nested: expect.arrayContaining([item]) }),
      ],
      "a property more beside arrayContaining()": [
        [false, false],
        () => both({ nested: [item] }, { nested: expect.arrayContaining([item]), extra: true }),
      ],
      "arrayContaining() with the same item": [
        [true, true],
        () => both({ nested: [longerItem] }, { nested: expect.arrayContaining([longerItem]) }),
      ],
      "arrayContaining() of an array with an item more": [
        [true, true],
        () => both({ nested: [longerItem, { extra: true }] }, { nested: expect.arrayContaining([longerItem]) }),
      ],
      "a property less beside arrayContaining()": [
        [true, true],
        () => both({ nested: [item], extra: true }, { nested: expect.arrayContaining([item]) }),
      ],
      "not.arrayContaining() whose item has a property more": [
        [true, true],
        () => both({ nested: [item] }, { nested: expect.not.arrayContaining([longerItem]) }),
      ],
      "objectContaining() whose property has a property less": [
        [false, false],
        () => both({ a: { b: { c: 1, d: 2 } } }, { a: expect.objectContaining({ b: { c: 1 } }) }),
      ],
      "objectContaining() with fewer properties": [
        [true, true],
        () => both({ a: { b: { c: 1 }, e: 3 } }, { a: expect.objectContaining({ b: { c: 1 } }) }),
      ],
      "a matcher of expect.extend() that hands on this.customTesters": [
        [false, false],
        () => both({ a: { c: 1, d: 2 } }, { a: expect._toEqualWithItsTesters({ c: 1 }) }),
      ],
      "a matcher of expect.extend() that hands on no list": [
        [false, false],
        () => both({ a: { c: 1, d: 2 } }, { a: expect._toEqualWithoutAList({ c: 1 }) }),
      ],
      "an object whose asymmetricMatch() uses toEqual()": [
        [false, false],
        () => both({ a: { c: 1, d: 2 } }, { a: equalByToEqual({ c: 1 }) }),
      ],
      // A matcher that has subsetEquality in its own list, or calls it, gets it as an asymmetric matcher too.
      "a matcher of expect.extend() that hands on subsetEquality": [
        [true, true],
        () => both({ a: { c: { e: 1, f: 2 }, d: 2 } }, { a: expect._toMatchShape({ c: { e: 1 } }) }),
      ],
      "a matcher of expect.extend() that hands on subsetEquality, for a Set in a Set": [
        [true, true],
        () => both({ a: new Set([new Set([longerItem])]) }, { a: expect._toMatchShape(new Set([new Set([item])])) }),
      ],
      "a matcher of expect.extend() that calls subsetEquality()": [
        [true, true],
        () => both({ a: { c: { e: 1, f: 2 }, d: 2 } }, { a: expect._toBeSupersetByCall({ c: { e: 1 } }) }),
      ],
      "a matcher of expect.extend() that calls subsetEquality(), with a property more": [
        [false, false],
        () => both({ a: { c: { e: 1 } } }, { a: expect._toBeSupersetByCall({ c: { e: 1, f: 2 } }) }),
      ],
      // A tester of the list compares with the list it is asked with. arrayContaining() would ask it with the item of the
      // sample first, and objectContaining() with the received value first: neither asks it.
      "a tester of the list that hands the list on": [
        true,
        () => boxed(new Boxed({ c: 1, d: 2 }), new Boxed({ c: 1 })),
      ],
      "a tester of the list, in arrayContaining()": [
        false,
        () => boxed([new Boxed({ c: 1 })], expect.arrayContaining([new Boxed({ c: 1, d: 2 })])),
      ],
      "a tester of the list, in arrayContaining() with the same item": [
        true,
        () => boxed([new Boxed({ c: 1 })], expect.arrayContaining([new Boxed({ c: 1 })])),
      ],
      "a tester of the list, in objectContaining()": [
        false,
        () => boxed({ k: new Boxed({ c: 1, d: 2 }) }, expect.objectContaining({ k: new Boxed({ c: 1 }) })),
      ],
      "a tester of the list, for a Set in arrayContaining() in a Set": [
        false,
        () =>
          boxed(
            new Set([{ x: [new Boxed(items())] }]),
            new Set([{ x: expect.arrayContaining([new Boxed(longerItems())]) }]),
          ),
      ],
      // toMatchObject() compares a Set by its properties (#15673), so these rows are the made matcher alone. What
      // iterableEquality hands to the members of a Set has subsetEquality, and is in the list of the call too.
      "objectContaining() in a Set, with a Set whose item has a property less": [
        false,
        () =>
          passes(() =>
            expect(new Set([{ inner: longerItems() }]))._toMatchShape(new Set([containing({ inner: items() })])),
          ),
      ],
      "objectContaining() in a property of an object in a Set": [
        false,
        () =>
          passes(() =>
            expect(new Set([{ a: { inner: longerItems() } }]))._toMatchShape(
              new Set([{ a: containing({ inner: items() }) }]),
            ),
          ),
      ],
      "arrayContaining() in a Set, with a Set whose item has a property more": [
        false,
        () =>
          passes(() => expect(new Set([[items()]]))._toMatchShape(new Set([expect.arrayContaining([longerItems()])]))),
      ],
      "objectContaining() in a Set, with a Set of the same items": [
        true,
        () =>
          passes(() =>
            expect(new Set([{ inner: items(), b: 2 }]))._toMatchShape(new Set([containing({ inner: items() })])),
          ),
      ],
      "a Set beside objectContaining() in a Set, whose item has a property less": [
        true,
        () =>
          passes(() =>
            expect(new Set([{ a: { inner: items() }, b: longerItems() }]))._toMatchShape(
              new Set([{ a: containing({ inner: items() }), b: items() }]),
            ),
          ),
      ],
    });
  });

  // The rows are what Jest 30.5.2 answers.
  test("the list of this.equals() is for that call: an asymmetric matcher and this.customTesters get the registered testers", () => {
    let asked = 0;
    const seen = {};
    const counting = () => void asked++;
    const asksOf = compare => ((asked = 0), compare(), asked);
    expect.extend({
      _toCompareWithAList(received, expected) {
        return { pass: this.equals(received, expected, [counting]), message: () => "the two differ" };
      },
      _toSeeItsTesters() {
        seen.inAsymmetricMatcher = this.customTesters;
        return { pass: true, message: () => "" };
      },
      _toSeeItsTestersInATester(received, expected) {
        const seeing = () => void (seen.inTester = this.customTesters);
        return { pass: this.equals(received, expected, [seeing]), message: () => "the two differ" };
      },
    });
    expect({
      "asks about an array of an object": asksOf(() => expect([{ x: 1 }])._toCompareWithAList([{ x: 1 }])),
      "asks in arrayContaining()": asksOf(() =>
        expect([{ x: 1 }])._toCompareWithAList(expect.arrayContaining([{ x: 1 }])),
      ),
      "asks with objectContaining() in a property": asksOf(() =>
        expect({ a: { x: 1 } })._toCompareWithAList({ a: expect.objectContaining({ x: 1 }) }),
      ),
      "asks with an object that has asymmetricMatch() in a property": asksOf(() =>
        expect({ a: { x: 1 } })._toCompareWithAList({ a: { asymmetricMatch: () => true } }),
      ),
    }).toEqual({
      "asks about an array of an object": 3,
      "asks in arrayContaining()": 0,
      "asks with objectContaining() in a property": 1,
      "asks with an object that has asymmetricMatch() in a property": 1,
    });
    expect({ a: 1 })._toCompareWithAList({ a: expect._toSeeItsTesters() });
    expect({ a: 1 })._toSeeItsTestersInATester({ a: 1 });
    expect(seen).toEqual({ inAsymmetricMatcher: [], inTester: [] });
  });

  // As from this.equals(): the caller gets a boolean at once, so no matcher in the two values can wait for a promise.
  test("an async matcher can't wait in a call of the two by a matcher", () => {
    expect.extend({
      _toAnswerByCall(received, expected, name) {
        const pass = this.utils[name](received, expected) === true;
        return { pass, message: () => name + "() answers " + pass };
      },
    });
    /** A promise that is pending when the matcher gets it. */
    const later = value => Promise.resolve().then(() => value);
    const containing = text => expect.resolvesTo.stringContaining(text);
    const error = "An async matcher only works inside an expect() matcher";
    expect(() => expect({ a: later("one"), b: 2 })._toAnswerByCall({ a: containing("one") }, "subsetEquality")).toThrow(
      error,
    );
    expect(() =>
      expect(new Set([later("one")]))._toAnswerByCall(new Set([containing("one")]), "iterableEquality"),
    ).toThrow(error);
    expect(() =>
      expect(new Hidden([later("one")]))._toAnswerByCall(new Hidden([containing("one")]), "iterableEquality"),
    ).toThrow(error);
    expect({ a: "one", b: 2 })._toAnswerByCall({ a: expect.stringContaining("one") }, "subsetEquality");
    expect(new Set(["one"]))._toAnswerByCall(new Set([expect.stringContaining("one")]), "iterableEquality");

    // What the two hand to the members is a function that a tester gets in its list, and that a matcher can call too.
    expect.extend({
      _toAnswerByMemberTester(received, expected, [a, b, name]) {
        let ofMembers;
        const keeping = (a, b, testers) =>
          void (ofMembers = testers.find(tester => !own.includes(tester)) ?? ofMembers);
        const own = [keeping, this.utils[name]];
        this.equals(a, b, own);
        const pass = ofMembers(received, expected) === true;
        return { pass, message: () => ofMembers.name + "() answers " + pass };
      },
    });
    const ofSets = [new Set([new Set([0])]), new Set([new Set([0])]), "iterableEquality"];
    const ofObjects = [{ a: { b: 0 } }, { a: { b: 0 } }, "subsetEquality"];
    expect(() => expect(new Set([later("one")]))._toAnswerByMemberTester(new Set([containing("one")]), ofSets)).toThrow(
      error,
    );
    expect(() =>
      expect({ a: later("one"), b: 2 })._toAnswerByMemberTester({ a: containing("one") }, ofObjects),
    ).toThrow(error);
    expect(new Set(["one"]))._toAnswerByMemberTester(new Set([expect.stringContaining("one")]), ofSets);
    expect({ a: "one", b: 2 })._toAnswerByMemberTester({ a: expect.stringContaining("one") }, ofObjects);
  });

  test("subsetEquality has no answer for a subset that is an asymmetric matcher", () => {
    const { equals, utils } = inMatcher(context => context);
    expect([
      utils.subsetEquality(5, expect.objectContaining({ a: 1 })),
      utils.subsetEquality({ a: 1, b: 2 }, expect.objectContaining({ a: 1 })),
      utils.subsetEquality([2], expect.arrayContaining([2])),
      utils.subsetEquality(5, expect.any(Number)),
      equals({ a: 1, b: 2 }, expect.objectContaining({ a: 1 }), [utils.subsetEquality]),
      equals(5, expect.objectContaining({ a: 1 }), [utils.subsetEquality]),
      utils.subsetEquality({ a: { b: 1, c: 2 } }, { a: expect.objectContaining({ b: 1 }) }),
      utils.subsetEquality({ a: 5 }, { a: expect.objectContaining({ b: 1 }) }),
    ]).toEqual([undefined, undefined, undefined, undefined, true, false, true, false]);
  });

  test("a comparison that throws leaves the testers as they were", () => {
    const context = inMatcher(context => context);
    const { iterableEquality, subsetEquality } = context.utils;
    const throwing = () => {
      throw new RangeError("thrown while the two are compared");
    };
    expect(() => context.equals({ a: 1 }, { a: { asymmetricMatch: throwing } }, [subsetEquality])).toThrow(RangeError);
    expect(() => context.equals(new Set([{}]), new Set([{}]), [iterableEquality, throwing])).toThrow(RangeError);
    expect(() => context.equals({ a: {} }, { a: {} }, [subsetEquality, throwing])).toThrow(RangeError);
    expect(context.customTesters).toEqual([]);
    expect(context.equals({ a: 1, b: 2 }, { a: 1 }, [subsetEquality])).toBe(true);
    expect(context.equals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(context.equals(gen([1]), gen([2]))).toBe(true);
  });

  /** Runs `bun test` on a file with this text, or on the files of an object of names and texts. */
  async function runTestFile(text) {
    const files = typeof text === "string" ? { "testers.test.js": text } : text;
    using dir = tempDir("expect-extend-testers", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...Object.keys(files)],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const results = stderr
      .split("\n")
      .filter(line => /^\((pass|fail)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
    return { stdout, results, exitCode };
  }

  /** The start of a test file that registers these members of `this.utils` with expect.addEqualityTesters(). */
  const registering = names => `
    import { expect, mock, test } from "bun:test";
    class Hidden {
      #items;
      constructor(items) { this.#items = items; }
      *[Symbol.iterator]() { yield* this.#items; }
    }
    function* gen(items) { yield* items; }
    /** A promise that is pending when a matcher gets it. */
    const later = value => Promise.resolve().then(() => value);
    let utils;
    expect.extend({ toGrabUtils() { utils = this.utils; return { pass: true, message: () => "" }; } });
    expect(0).toGrabUtils();
    expect.addEqualityTesters(${JSON.stringify(names)}.map(name => utils[name]));
  `;

  test.concurrent(
    "expect.addEqualityTesters() takes iterableEquality, and the built-in matchers then use it",
    async () => {
      const { results, exitCode } = await runTestFile(`
        ${registering(["iterableEquality"])}
        test("iterables are compared by their items", () => {
          expect(new Hidden([1, 2])).toEqual(new Hidden([1, 2]));
          expect(new Hidden([1, 2])).not.toEqual(new Hidden([1, 3]));
          expect({ a: [new Hidden([1])] }).not.toEqual({ a: [new Hidden([2])] });
          expect(new Hidden([1, 2])).not.toStrictEqual(new Hidden([1, 3]));
          expect([new Hidden([1])]).toContainEqual(new Hidden([1]));
          expect([new Hidden([1])]).not.toContainEqual(new Hidden([2]));
          const fn = mock();
          fn(new Hidden([1]));
          expect(fn).toHaveBeenCalledWith(new Hidden([1]));
          expect(fn).not.toHaveBeenCalledWith(new Hidden([2]));
        });
        test("toStrictEqual() stays strict for the members of an iterable", () => {
          class Metre {}
          class Yard {}
          const pairs = [[new Metre(), new Yard()], [[, 1], [undefined, 1]], [{ a: undefined, b: 1 }, { b: 1 }]];
          for (const [a, b] of pairs) {
            expect(new Set([a])).toEqual(new Set([b]));
            expect(new Set([a])).not.toStrictEqual(new Set([b]));
            expect(new Map([[1, a]])).not.toStrictEqual(new Map([[1, b]]));
            expect(new Hidden([a])).toEqual(new Hidden([b]));
            expect(new Hidden([a])).not.toStrictEqual(new Hidden([b]));
          }
        });
        test("an object that two Sets hold is compared once", () => {
          const make = () => {
            const root = {};
            const object = { root };
            root.a = new Set([object]);
            root.b = new Set([object]);
            return root;
          };
          expect(make()).toEqual(make());
          expect(make()).toStrictEqual(make());
        });
        test("a matcher in a member of a Set or a Map waits for a promise", async () => {
          const containing = text => expect.resolvesTo.stringContaining(text);
          await expect(new Set([later("one")])).toEqual(new Set([containing("one")]));
          await expect(new Set([later("one")])).not.toEqual(new Set([containing("two")]));
          await expect(new Map([[1, later("one")]])).toEqual(new Map([[1, containing("one")]]));
          await expect(new Map([[1, later("one")]])).not.toEqual(new Map([[1, containing("two")]]));
          await expect({ a: [new Set([later("one")])] }).toStrictEqual({ a: [new Set([containing("one")])] });
        });
        test("a matcher in an item of an iterable that may be read once can't wait", () => {
          const compare = () => expect(gen([later("one")])).toEqual(gen([expect.resolvesTo.stringContaining("one")]));
          expect(compare).toThrow("An async matcher only works inside an expect() matcher");
        });
    `);
      expect(results).toEqual([
        "(pass) iterables are compared by their items",
        "(pass) toStrictEqual() stays strict for the members of an iterable",
        "(pass) an object that two Sets hold is compared once",
        "(pass) a matcher in a member of a Set or a Map waits for a promise",
        "(pass) a matcher in an item of an iterable that may be read once can't wait",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("expect.addEqualityTesters() takes subsetEquality, and toEqual() then takes a subset", async () => {
    const { results, exitCode } = await runTestFile(`
        ${registering(["iterableEquality", "subsetEquality"])}
        test("toEqual() takes an object with fewer properties", () => {
          expect({ a: 1, b: 2 }).toEqual({ a: 1 });
          expect({ a: 1 }).not.toEqual({ a: 1, b: 2 });
          expect({ a: 1, b: 2 }).not.toEqual({ a: 2 });
          expect({ a: new Hidden([1]), b: 2 }).toEqual({ a: new Hidden([1]) });
          expect({ a: new Hidden([1]), b: 2 }).not.toEqual({ a: new Hidden([2]) });
        });
        test("a matcher in a property waits for a promise", async () => {
          const containing = text => expect.resolvesTo.stringContaining(text);
          await expect({ a: later("one"), b: 2 }).toEqual({ a: containing("one") });
          await expect({ a: later("one"), b: 2 }).not.toEqual({ a: containing("two") });
          await expect({ a: { b: [later("one")], c: 3 } }).toEqual({ a: { b: [containing("one")] } });
          await expect({ a: new Set([later("one")]), b: 2 }).toEqual({ a: new Set([containing("one")]) });
        });
        // The rows are what Jest 30.5.2 answers. arrayContaining() asks a tester with the item of the sample first.
        test("an asymmetric matcher is asked of the registered testers", () => {
          const passes = assert => {
            try {
              assert();
              return true;
            } catch {
              return false;
            }
          };
          const [item, longerItem] = [{ id: 1 }, { id: 1, required: "x" }];
          let count;
          expect.extend({
            toEqualWithItsTesters(received, expected) {
              const pass = this.equals(received, expected, this.customTesters);
              return { pass, message: () => "the two " + (pass ? "are equal" : "differ") };
            },
            toBeLike(received, sample) {
              expect(received).toEqual(sample);
              return { pass: true, message: () => "" };
            },
            toCountItsTesters() {
              count = this.customTesters.length;
              return { pass: true, message: () => "" };
            },
            toEqualByAList(received, expected) {
              return { pass: this.equals(received, expected, [() => undefined]), message: () => "the two differ" };
            },
          });
          expect({
            "toEqual() of a longer object": passes(() => expect([longerItem]).toEqual([item])),
            "toEqual() of a shorter object": passes(() => expect([item]).toEqual([longerItem])),
            "arrayContaining() with a longer item in the sample": passes(() =>
              expect({ a: [item] }).toEqual({ a: expect.arrayContaining([longerItem]) }),
            ),
            "arrayContaining() with a shorter item in the sample": passes(() =>
              expect({ a: [longerItem] }).toEqual({ a: expect.arrayContaining([item]) }),
            ),
            "a matcher with this.customTesters": passes(() => expect(longerItem).toEqualWithItsTesters(item)),
            "the same as an asymmetric matcher": passes(() =>
              expect({ a: longerItem }).toEqual({ a: expect.toEqualWithItsTesters(item) }),
            ),
            "expect().toEqual() in an asymmetric matcher": passes(() =>
              expect({ a: longerItem }).toEqual({ a: expect.toBeLike(item) }),
            ),
            "arrayContaining() under a list of this.equals()": passes(() =>
              expect({ a: [item] }).toEqualByAList({ a: expect.arrayContaining([longerItem]) }),
            ),
            "this.customTesters in an asymmetric matcher under a list":
              (expect({ a: 1 }).toEqualByAList({ a: expect.toCountItsTesters() }), count),
          }).toEqual({
            "toEqual() of a longer object": true,
            "toEqual() of a shorter object": false,
            "arrayContaining() with a longer item in the sample": true,
            "arrayContaining() with a shorter item in the sample": false,
            "a matcher with this.customTesters": true,
            "the same as an asymmetric matcher": true,
            "expect().toEqual() in an asymmetric matcher": true,
            "arrayContaining() under a list of this.equals()": true,
            "this.customTesters in an asymmetric matcher under a list": 2,
          });
        });
        test("a tester that is registered while a matcher compares stays", () => {
          const isOneEqual = tester => {
            try {
              expect(tester).toEqual(tester);
              return true;
            } catch {
              return false;
            }
          };
          /** A tester that takes no value for equal to itself, and that these register where the name says. */
          const testers = Object.fromEntries(
            ["inAsymmetricMatch", "inAProperty", "underAList", "byATesterOfAList"].map(name => {
              const tester = (a, b) => (a === tester && b === tester ? false : undefined);
              return [name, tester];
            }),
          );
          const registering = name => ({ asymmetricMatch: () => (expect.addEqualityTesters([testers[name]]), true) });
          expect.extend({
            toRegisterUnderAList(received, expected) {
              return { pass: this.equals(received, expected, [() => undefined]), message: () => "the two differ" };
            },
            toRegisterByATester(received, expected) {
              const list = [() => void expect.addEqualityTesters([testers.byATesterOfAList])];
              return { pass: this.equals(received, expected, list), message: () => "the two differ" };
            },
          });
          expect("one").toEqual(registering("inAsymmetricMatch"));
          expect({ a: 1 }).toEqual({ a: registering("inAProperty") });
          expect({ a: 1 }).toRegisterUnderAList({ a: registering("underAList") });
          expect({ a: 1 }).toRegisterByATester({ a: 1 });
          expect(Object.keys(testers).filter(name => isOneEqual(testers[name]))).toEqual([]);
        });
    `);
    expect(results).toEqual([
      "(pass) toEqual() takes an object with fewer properties",
      "(pass) a matcher in a property waits for a promise",
      "(pass) an asymmetric matcher is asked of the registered testers",
      "(pass) a tester that is registered while a matcher compares stays",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a registered bound copy of the two is asked like the two", async () => {
    const { results, exitCode } = await runTestFile(`
        ${registering([])}
        expect.addEqualityTesters([utils.iterableEquality.bind(undefined), utils.subsetEquality.bind(utils)]);
        test("a matcher in a member or in a property waits for a promise", async () => {
          const containing = text => expect.resolvesTo.stringContaining(text);
          await expect(new Set([later("one")])).toEqual(new Set([containing("one")]));
          await expect(new Set([later("one")])).not.toEqual(new Set([containing("two")]));
          await expect({ a: later("one"), b: 2 }).toEqual({ a: containing("one") });
          await expect({ a: later("one"), b: 2 }).not.toEqual({ a: containing("two") });
          expect(new Hidden([1, 2])).not.toEqual(new Hidden([1, 3]));
        });
    `);
    expect(results).toEqual(["(pass) a matcher in a member or in a property waits for a promise"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("the testers that a file registers are gone in the next file", async () => {
    const isSubsetEqual = `(() => {
      try {
        expect({ a: 1, b: 2 }).toEqual({ a: 1 });
        return true;
      } catch {
        return false;
      }
    })()`;
    const { results, exitCode } = await runTestFile({
      "a.test.js": `
        ${registering(["iterableEquality", "subsetEquality"])}
        test("the file that registers them", () => {
          expect(${isSubsetEqual}).toBe(true);
        });
      `,
      // An asymmetric matcher is the first to compare in this file.
      "b.test.js": `
        import { expect, test } from "bun:test";
        test("the next file", () => {
          expect({ a: 1 }).toEqual(expect.objectContaining({ a: 1 }));
          expect(${isSubsetEqual}).toBe(false);
        });
      `,
      "c.test.js": `
        import { expect, test } from "bun:test";
        test("the file after it", () => {
          expect(${isSubsetEqual}).toBe(false);
        });
      `,
    });
    expect(results).toEqual([
      "(pass) the file that registers them",
      "(pass) the next file",
      "(pass) the file after it",
    ]);
    expect(exitCode).toBe(0);
  });

  // Where those of Jest and of Vitest differ, the two are Jest's, as toEqual() and toMatchObject() are for the three.
  const rows = {
    "typed arrays": "undefined",
    "a Set of another realm": true,
    "a Set of another realm that differs": false,
    "an own symbol that differs": false,
    "an iterator that cannot be made": "undefined",
    "a symbol of the subset with another value": false,
    "a subset that inherits from Error.prototype": "undefined",
    "through this.equals(), bytes of two classes": true,
    "through this.equals(), a Set of another realm": true,
    "through this.equals(), an own symbol that differs": false,
    // Not true: each level holds another item. Either the stack is deep enough to find that, or it runs out.
    "iterables that differ 20000 levels in": "false or RangeError",
    "through this.equals(), iterables that differ 20000 levels in": "false or RangeError",
  };
  const printingRows = specifier => `
    import vm from "node:vm";
    import { expect, test } from ${JSON.stringify(specifier)};
    const [setOfOne, setOfTwo] = vm.runInNewContext("[new Set([1]), new Set([2])]");
    const key = Symbol("key");
    const tagged = value => ({ [key]: value, *[Symbol.iterator]() {} });
    const throwing = { [Symbol.iterator]() { throw new RangeError("no iterator"); } };
    class Nest {
      #item;
      constructor(item) { this.#item = item; }
      *[Symbol.iterator]() { yield this.#item; }
    }
    const nest = (depth, innermost) => {
      let value = innermost;
      while (depth--) value = new Nest(value);
      return value;
    };
    test("rows", () => {
      expect.extend({
        toPrintRows() {
          const { equals, utils: { iterableEquality, subsetEquality } } = this;
          const rows = {
            "typed arrays": () => iterableEquality(new Uint8Array([1]), new Uint8Array([2])),
            "a Set of another realm": () => iterableEquality(new Set([1]), setOfOne),
            "a Set of another realm that differs": () => iterableEquality(new Set([1]), setOfTwo),
            "an own symbol that differs": () => iterableEquality(tagged(1), tagged(2)),
            "an iterator that cannot be made": () => iterableEquality(throwing, throwing),
            "a symbol of the subset with another value": () => subsetEquality({ [key]: 1 }, { [key]: 2 }),
            "a subset that inherits from Error.prototype": () => subsetEquality({}, Object.create(Error.prototype)),
            "through this.equals(), bytes of two classes": () =>
              equals(Buffer.from([1, 2]), new Uint8Array([1, 2]), [iterableEquality]),
            "through this.equals(), a Set of another realm": () =>
              equals(new Set([1]), setOfOne, [iterableEquality]),
            "through this.equals(), an own symbol that differs": () => equals(tagged(1), tagged(2), [iterableEquality]),
            "iterables that differ 20000 levels in": () => iterableEquality(nest(20000, 1), nest(20000, 2)),
            "through this.equals(), iterables that differ 20000 levels in": () =>
              equals(nest(20000, 1), nest(20000, 2), [iterableEquality]),
          };
          const answers = Object.entries(rows).map(([name, run]) => {
            let answer;
            try {
              answer = run();
            } catch (error) {
              answer = error.constructor.name;
            }
            if (name.includes("20000") && (answer === false || answer === "RangeError")) answer = "false or RangeError";
            return [name, answer === undefined ? "undefined" : answer];
          });
          console.log(JSON.stringify(Object.fromEntries(answers)));
          return { pass: true, message: () => "" };
        },
      });
      expect(0).toPrintRows();
    });
  `;

  test.concurrent.each(["bun:test", "@jest/globals", "vitest"])("a test of %s gets them", async specifier => {
    const { stdout, results, exitCode } = await runTestFile(printingRows(specifier));
    expect(results).toEqual(["(pass) rows"]);
    expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual(rows);
    expect(exitCode).toBe(0);
  });
});
