/// <reference path="./expect-extend.types.d.ts" />
// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/expect-extend.test.js`
 *  `bunx vitest test/js/bun/test/expect-extend.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/expect-extend.test.js`
 */

import { bunEnv, bunExe, tempDir, withoutAggressiveGC } from "harness";
import test_interop from "./test-interop.js";
var { isBun, expect, describe, test, it } = await test_interop();

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
      const pass = "equals" in this;
      //const pass = this.equals(
      //  this.utils,
      //  Object.assign(matcherUtils, {
      //    iterableEquality,
      //    subsetEquality,
      //  }),
      //);
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

    class NamedA {
      x = 1;
    }
    class NamedB {
      x = 1;
    }
    class NamedEmpty {}
    const jestArguments = (expected, received) => [expected, received, "Expected", "Received", false];
    const printedDiff = (...args) => Bun.stripANSI(utils.printDiffOrStringify(...args));
    const markedLines = (expected, received) =>
      printedDiff(...jestArguments(expected, received))
        .split("\n")
        .filter(line => /^[-+]/.test(line));
    const counts = (expected, received) => [`- Expected  - ${expected}`, `+ Received  + ${received}`];

    // Expected values measured on jest-matcher-utils 30.5.2.
    test.each([
      [["apple", "apply"], 'Expected: "apple"\nReceived: "apply"'],
      [["abc", "xyz"], 'Expected: "abc"\nReceived: "xyz"'],
      [["a", "a"], 'Expected: "a"\nReceived: serializes to the same string'],
      [["", "a"], 'Expected: ""\nReceived: "a"'],
      [["a", ""], 'Expected: "a"\nReceived: ""'],
      [["", ""], 'Expected: ""\nReceived: serializes to the same string'],
      [['say "hi"', 'say "ho"'], 'Expected: "say \\"hi\\""\nReceived: "say \\"ho\\""'],
      [[1, 2], "Expected: 1\nReceived: 2"],
      [[1, 1], "Expected: 1\nReceived: serializes to the same string"],
      [[NaN, NaN], "Expected: NaN\nReceived: serializes to the same string"],
      [[0, -0], "Expected: 0\nReceived: -0"],
      [[1n, 2n], "Expected: 1n\nReceived: 2n"],
      [[true, false], "Expected: true\nReceived: false"],
      [[null, undefined], "Expected: null\nReceived: undefined"],
      [[undefined, undefined], "Expected: undefined\nReceived: serializes to the same string"],
      [["1", 1], 'Expected: "1"\nReceived: 1'],
      [[1, 1n], "Expected: 1\nReceived: 1n"],
      [[{}, []], "Expected: {}\nReceived: []"],
      [[{}, null], "Expected: {}\nReceived: null"],
      [[new Date(0), new Date(1)], "Expected: 1970-01-01T00:00:00.000Z\nReceived: 1970-01-01T00:00:00.001Z"],
      [[/a/, /b/], "Expected: /a/\nReceived: /b/"],
      [[new Error("a"), new Error("b")], "Expected: [Error: a]\nReceived: [Error: b]"],
      [[new Error("a\nb"), new Error("a\nc")], "Expected: [Error: a\nb]\nReceived: [Error: a\nc]"],
      [[Symbol("a"), Symbol("b")], "Expected: Symbol(a)\nReceived: Symbol(b)"],
      [[Symbol("a\nb"), Symbol("a\nc")], "Expected: Symbol(a\nb)\nReceived: Symbol(a\nc)"],
      [[expect.any(String), 1], "Expected: Any<String>\nReceived: 1"],
      [[1, expect.any(String)], "Expected: 1\nReceived: Any<String>"],
    ])("printDiffOrStringify(...%p) prints two lines", ([expected, received], text) => {
      expect(printedDiff(...jestArguments(expected, received))).toBe(text);
    });

    // Jest prints these on two lines too. The values are printed as `printExpected()` prints them, which isn't Jest's text.
    test.each([
      [[{ a: 1 }, { a: 1 }], "Expected: {\n  a: 1,\n}\nReceived: serializes to the same string"],
      [[{ a: 1 }, expect.any(Object)], "Expected: {\n  a: 1,\n}\nReceived: Any<Object>"],
      [["a\nb", "a\nb"], 'Expected: "a\\nb"\nReceived: serializes to the same string'],
      [["", "a\nb"], 'Expected: ""\nReceived: "a\\nb"'],
      [["a\nb", ""], 'Expected: "a\\nb"\nReceived: ""'],
      [[1, "a\nb"], 'Expected: 1\nReceived: "a\\nb"'],
      [["a\nb", { a: 1 }], 'Expected: "a\\nb"\nReceived: {\n  a: 1,\n}'],
      [[{ a: 1 }, [1]], "Expected: {\n  a: 1,\n}\nReceived: [ 1 ]"],
      [[expect.any(Number), { a: 1, b: 2 }], "Expected: Any<Number>\nReceived: {\n  a: 1,\n  b: 2,\n}"],
      [[function a() {}, function b() {}], "Expected: [Function: a]\nReceived: [Function: b]"],
    ])("printDiffOrStringify(...%p) prints two lines with Bun's text for the values", (args, text) => {
      expect(printedDiff(...jestArguments(...args))).toBe(text);
      const [expected, received] = args.map(value => Bun.stripANSI(utils.stringify(value)));
      const second = expected === received ? "serializes to the same string" : received;
      expect(text).toBe(`Expected: ${expected}\nReceived: ${second}`);
    });

    // Expected values measured on jest-matcher-utils 30.5.2, which prints the two count lines before the diff.
    test("printDiffOrStringify marks the lines that differ", () => {
      expect(markedLines("a\nb\nc", "a\nx\nc")).toEqual(["- b", "+ x", ...counts(1, 1)]);
      expect(markedLines("a\nb", "x\ny")).toEqual(["- a", "- b", "+ x", "+ y", ...counts(2, 2)]);
      expect(markedLines("a\nb", "c")).toEqual(["- a", "- b", "+ c", ...counts(2, 1)]);
      expect(markedLines("c", "a\nb")).toEqual(["- c", "+ a", "+ b", ...counts(1, 2)]);
      expect(markedLines({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['-   "b": 2,', '+   "b": 3,', ...counts(1, 1)]);
      expect(markedLines([1, 2, 3], [1, 3])).toEqual(["-   2,", ...counts(1, 0)]);
      expect(markedLines(new Map([["a", 1]]), new Map([["a", 2]]))).toEqual([
        '-   "a" => 1,',
        '+   "a" => 2,',
        ...counts(1, 1),
      ]);
      expect(markedLines(new Map(), new Map([["a", 1]]))).toEqual([
        "- Map {}",
        "+ Map {",
        '+   "a" => 1,',
        "+ }",
        ...counts(1, 3),
      ]);
      expect(markedLines(new Set([1]), new Set([2]))).toEqual(["-   1,", "+   2,", ...counts(1, 1)]);
      expect(markedLines(new Set([1]), new Set())).toEqual(["- Set {", "-   1,", "- }", "+ Set {}", ...counts(3, 1)]);
      expect(markedLines(new NamedA(), new NamedB())).toEqual(["- NamedA {", "+ NamedB {", ...counts(1, 1)]);
      expect(markedLines({ a: expect.any(String), b: 2 }, { a: 1, b: 2 })).toEqual([
        '-   "a": Any<String>,',
        '+   "a": 1,',
        ...counts(1, 1),
      ]);
    });

    // Jest's results. The diff printer of every matcher takes a last line for changed if only one side ends it with a line break.
    test.todo("printDiffOrStringify marks no line that both strings have", () => {
      expect(markedLines("a\n", "b\n")).toEqual(["- a", "+ b", ...counts(1, 1)]);
      expect(markedLines("a\nb", "a")).toEqual(["- b", ...counts(1, 0)]);
    });

    // jest-matcher-utils 30.5.2 prints a line diff for `expect.any(Object)` and `expect.objectContaining()` as `expected`.
    test.each([
      [[expect.any(Object), { a: 1 }], "Expected: Any<Object>\nReceived: {\n  a: 1,\n}"],
      [
        [expect.objectContaining({ a: 1 }), { a: 2 }],
        "Expected: ObjectContaining {\n  a: 1,\n}\nReceived: {\n  a: 2,\n}",
      ],
      [[expect.anything(), { a: 1 }], "Expected: Anything\nReceived: {\n  a: 1,\n}"],
    ])(
      "printDiffOrStringify(...%p) prints two lines for a matcher as expected, where diff() returns null",
      (args, text) => {
        expect(printedDiff(...jestArguments(...args))).toBe(text);
        expect(utils.diff(...args)).toBeNull();
      },
    );

    test("printDiffOrStringify prints two lines for strings that differ only in unpaired surrogates", () => {
      // Both are the same UTF-8, so the diff printer has no line to mark. jest-matcher-utils 30.5.2 marks the lines.
      const text = 'Expected: "a\\n\\ud800"\nReceived: "a\\n\\ud801"';
      expect(printedDiff("a\n\ud800", "a\n\ud801", "Expected", "Received", false)).toBe(text);
      expect(printedDiff("a\n\ud801", "a\n\ud800")).toBe(text);
    });

    test("printDiffOrStringify prints a line diff for strings that Jest doesn't compare character by character", () => {
      // jest-matcher-utils 30.5.2 looks for common substrings in strings of at most 20000 characters. The form is the same above that.
      const long = Buffer.alloc(20001, "x").toString();
      expect(
        printedDiff(`a\n${long}`, "a\nb", "Expected", "Received", false)
          .split("\n")
          .filter(line => /^[-+]/.test(line))
          .map(line => line.slice(0, 16)),
      ).toEqual(["- xxxxxxxxxxxxxx", "+ b", "- Expected  - 1", "+ Received  + 1"]);
      expect(printedDiff(long, "y", "Expected", "Received", false)).toBe(`Expected: "${long}"\nReceived: "y"`);
    });

    // Expected values measured on jest-matcher-utils 30.5.2.
    test("printDiffOrStringify prints the labels it is given", () => {
      expect(printedDiff(1, 2, "Expected value", "Received", false)).toBe("Expected value: 1\nReceived:       2");
      expect(printedDiff("apple", "apply", "Want", "Received value", false)).toBe(
        'Want:           "apple"\nReceived value: "apply"',
      );
      expect(printedDiff(1, 1, "Wanted", "Got", false)).toBe("Wanted: 1\nGot:    serializes to the same string");
      const countLines = (...args) =>
        printedDiff(...args)
          .split("\n")
          .filter(line => /^[-+] /.test(line))
          .slice(-2);
      expect(countLines("a\nb", "a\nc", "Expected value", "Received", false)).toEqual([
        "- Expected value  - 1",
        "+ Received        + 1",
      ]);
      expect(countLines({ a: 1 }, { a: 2 }, "Want", "Got it", false)).toEqual(["- Want    - 1", "+ Got it  + 1"]);
      expect(countLines({ a: 1 }, { a: 2 }, "Expected: not", "Received", false)).toEqual([
        "- Expected: not  - 1",
        "+ Received       + 1",
      ]);
      expect(countLines("a\nb", "a\nc", "Attendu", "Re\u00e7u", false)).toEqual([
        "- Attendu  - 1",
        "+ Re\u00e7u     + 1",
      ]);
      expect(countLines("a\nb", "a\nc", "\u671f\u5f85\u5024", "\u5b9f\u969b", false)).toEqual([
        "- \u671f\u5f85\u5024  - 1",
        "+ \u5b9f\u969b   + 1",
      ]);
      // Jest prints a line diff for two values of one line each. The diff printer has fixed labels for that form.
      expect(printedDiff({}, new NamedEmpty(), "Want", "Got it", false)).toBe("Want:   {}\nGot it: NamedEmpty {}");
      // The shorter label is padded by its count of UTF-16 code units, like `" ".repeat()` in Jest.
      expect(printedDiff(1, 2, "\u{1F600}", "abc", false)).toBe("\u{1F600}:  1\nabc: 2");
    });

    test("printDiffOrStringify reads Jest's arguments and Vitest's", () => {
      const pairs = [
        ["apple", "apply"],
        ["a\nb", "a\nc"],
        [1, 2],
        [{ a: 1 }, { a: 1 }],
        [
          { a: 1, b: 2 },
          { a: 1, b: 3 },
        ],
        [
          [1, 2, 3],
          [1, 3],
        ],
        [null, undefined],
      ];
      for (const [expected, received] of pairs) {
        const text = printedDiff(expected, received, "Expected", "Received", false);
        expect([
          printedDiff(received, expected),
          printedDiff(received, expected, undefined),
          printedDiff(received, expected, {}),
          printedDiff(received, expected, { aAnnotation: "Expected", bAnnotation: "Received", expand: false }),
          printedDiff(received, expected, null),
          // The other keys of Vitest's options do nothing.
          printedDiff(received, expected, { contextLines: 0, omitAnnotationLines: true, includeChangeCounts: false }),
        ]).toEqual([text, text, text, text, text, text]);
        expect(printedDiff(received, expected, { aAnnotation: "Want", bAnnotation: "Got" })).toBe(
          printedDiff(expected, received, "Want", "Got", false),
        );
      }
      expect(printedDiff(2, 1, { aAnnotation: "Wanted value" })).toBe("Wanted value: 1\nReceived:     2");
      expect(printedDiff(2, 1, { bAnnotation: "Got" })).toBe("Expected: 1\nGot:      2");
      // In Jest's call a missing label is the default one. Jest itself throws a TypeError here.
      expect(printedDiff(1, 2, "Want")).toBe("Want:     1\nReceived: 2");
      // A String object is a label, as in Jest, and not an options object.
      expect(printedDiff(1, 2, new String("Want"), new String("Got"), false)).toBe("Want: 1\nGot:  2");
      expect(printedDiff("a\nb", "a\nc", new String("Want"), "Got it", false).split("\n").slice(-2)).toEqual([
        "- Want    - 1",
        "+ Got it  + 1",
      ]);
      expect(printedDiff()).toBe("Expected: undefined\nReceived: serializes to the same string");
      expect(utils.printDiffOrStringify(1, 2)).toBeString();
    });

    test("printDiffOrStringify reads each argument and option once, in order", () => {
      const log = [];
      const logged = name => ({
        toString() {
          log.push(name);
          return name;
        },
      });
      const options = new Proxy(
        { aAnnotation: logged("Want"), bAnnotation: logged("Got"), expand: true },
        {
          get(target, key) {
            log.push(`options.${String(key)}`);
            return target[key];
          },
        },
      );
      const counted = (name, value) => ({
        get a() {
          log.push(name);
          return value;
        },
      });
      expect(printedDiff(counted("received", 2), counted("expected", 1), options).split("\n").slice(-2)).toEqual([
        "- Want  - 1",
        "+ Got   + 1",
      ]);
      expect(log).toEqual([
        "options.aAnnotation",
        "Want",
        "options.bAnnotation",
        "Got",
        "options.expand",
        "received",
        "expected",
      ]);

      // Two objects that print alike are printed for the diff, and then again for the two lines.
      log.length = 0;
      expect(printedDiff(counted("expected", 1), counted("received", 1), "Want", logged("Got"), false)).toBe(
        "Want: {\n  a: 1,\n}\nGot:  serializes to the same string",
      );
      expect(log).toEqual(["Got", "received", "expected", "expected", "received"]);
    });

    test("printDiffOrStringify rethrows an error thrown while it reads an argument", () => {
      const thrown = new Error("from the argument");
      const throwing = new Proxy(
        {},
        {
          ownKeys() {
            throw thrown;
          },
        },
      );
      // `printExpected()` and `printReceived()` print the values of the two lines, and call this.
      const unprintable = {
        [Symbol.for("nodejs.util.inspect.custom")]() {
          throw thrown;
        },
      };
      const label = {
        toString() {
          throw thrown;
        },
      };
      for (const args of [
        [throwing, {}, "Expected", "Received", false],
        [{}, throwing, "Expected", "Received", false],
        [unprintable, 1, "Expected", "Received", false],
        [1, unprintable, "Expected", "Received", false],
        [1, 2, "Expected", label, false],
        [1, 2, { aAnnotation: label }],
        [1, 2, { bAnnotation: label }],
        [
          1,
          2,
          {
            get expand() {
              throw thrown;
            },
          },
        ],
      ]) {
        expect(() => utils.printDiffOrStringify(...args)).toThrow(thrown);
      }
    });

    test("printDiffOrStringify is an own function that a matcher can detach or find already there", () => {
      expect(Object.getOwnPropertyDescriptor(utils, "printDiffOrStringify")).toEqual({
        value: expect.any(Function),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      const { printDiffOrStringify } = utils;
      expect([printDiffOrStringify.name, printDiffOrStringify.length]).toEqual(["printDiffOrStringify", 5]);
      expect(Bun.stripANSI(printDiffOrStringify.call(undefined, 1, 2, "Expected", "Received", false))).toBe(
        "Expected: 1\nReceived: 2",
      );
      // What a preload that adds the function of jest-matcher-utils does.
      utils.printDiffOrStringify ??= () => "from a preload";
      expect(utils.printDiffOrStringify).toBe(printDiffOrStringify);
    });

    test("a matcher's message can print a diff", () => {
      expect.extend({
        _toBeTheSameText(received, expected) {
          return {
            pass: received === expected,
            message: () =>
              this.utils.printDiffOrStringify(expected, received, "Expected", "Received", this.expand !== false),
          };
        },
      });
      let message;
      try {
        expect("a\nb")._toBeTheSameText("a\nc");
      } catch (error) {
        message = Bun.stripANSI(error.message);
      }
      expect(message).toBe("  a\n- c\n+ b\n\n- Expected  - 1\n+ Received  + 1");
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
                const { stringify, printExpected, printReceived, printDiffOrStringify } = this.utils;
                console.log(
                  JSON.stringify([
                    matcherHint("toX"),
                    matcherHint(".toX", "element", ""),
                    matcherHint("toX", "r", "e", { isNot: true, promise: "resolves", comment: "c", secondArgument: "s" }),
                    EXPECTED_COLOR("a"),
                    RECEIVED_COLOR("a"),
                    EXPECTED_COLOR(""),
                    stringify(1),
                    printExpected(1),
                    printReceived(2),
                    printDiffOrStringify(1, 2, "Expected", "Received", false),
                    printDiffOrStringify(1, 1, "Expected", "Received", false),
                    printDiffOrStringify("a\\nb", "a\\nc", "Want", "Got", false).split("\\n").slice(-2),
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
          "1",
          `${green}1${reset}`,
          `${red}2${reset}`,
          `Expected: ${green}1${reset}\nReceived: ${red}2${reset}`,
          `Expected: ${green}1${reset}\nReceived: serializes to the same string`,
          [`${green}- Want  - 1${reset}`, `${red}+ Got   + 1${reset}`],
        ],
        stderr: expect.any(String),
      });
      expect(exitCode).toBe(0);
    });

    // The reading comes from the call alone, so no kind of test or hook changes it.
    test.concurrent("printDiffOrStringify reads both calls alike in every kind of test", async () => {
      using dir = tempDir("matcher-utils-print-diff-runners", {
        "report.js": `
          import { expect } from "bun:test";
          let utils;
          expect.extend({
            _toGiveItsUtils() {
              utils = this.utils;
              return { pass: true };
            },
          });
          export function report(where) {
            expect()._toGiveItsUtils();
            const calls = (expected, received) => [
              utils.printDiffOrStringify(expected, received, "Expected", "Received", false),
              utils.printDiffOrStringify(received, expected),
              utils.printDiffOrStringify(received, expected, { aAnnotation: "Expected", bAnnotation: "Received" }),
            ];
            console.log(JSON.stringify([where, ...new Set([...calls(1, 2), ...calls("a\\nb", "a\\nc")])]));
          }
        `,
        "bun.test.js": `
          import { aroundEach, describe, test } from "bun:test";
          import { report } from "./report.js";
          const turn = () => new Promise(resolve => setImmediate(resolve));
          test("test", () => report("bun:test test"));
          test.for([[1]])("test.for row %d", () => report("bun:test test.for row"));
          test.extend({ value: 1 })("test.extend test", ({ value }) => report("bun:test test.extend test"));
          describe("around", () => {
            aroundEach(async runTest => {
              report("bun:test aroundEach hook");
              await runTest();
            });
            test("test", () => {});
          });
          describe.concurrent("concurrent", () => {
            test("test", async () => {
              await turn();
              report("bun:test concurrent test after an await");
            });
            test.for([[1]])("test.for row %d", async () => {
              await turn();
              report("bun:test concurrent test.for row after an await");
            });
          });
        `,
        "vitest.test.js": `
          import { test } from "vitest";
          import { report } from "./report.js";
          test("test", () => report("vitest test"));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const texts = ["Expected: 1\nReceived: 2", "  a\n- b\n+ c\n\n- Expected  - 1\n+ Received  + 1"];
      expect({
        reports: stdout
          .split("\n")
          .filter(line => line.startsWith("["))
          .map(line => JSON.parse(line))
          .sort(([a], [b]) => (a < b ? -1 : 1)),
        stderr,
      }).toEqual({
        reports: [
          ["bun:test aroundEach hook", ...texts],
          ["bun:test concurrent test after an await", ...texts],
          ["bun:test concurrent test.for row after an await", ...texts],
          ["bun:test test", ...texts],
          ["bun:test test.extend test", ...texts],
          ["bun:test test.for row", ...texts],
          ["vitest test", ...texts],
        ],
        stderr: expect.any(String),
      });
      expect(exitCode).toBe(0);
    });

    // Line counts measured on jest-matcher-utils 30.5.2 and Vitest 5.0.3: 16, 16 and 36. An AI agent gets 1 line of context, not 5.
    test.concurrent.each([
      ["false", { false: 16, omitted: 16, true: 36 }, "@@ -12,11 +12,11 @@"],
      ["1", { false: 8, omitted: 8, true: 36 }, "@@ -16,3 +16,3 @@"],
    ])("printDiffOrStringify prints every line only if expand is true, with AGENT=%s", async (agent, counts, hunk) => {
      using dir = tempDir("matcher-utils-print-diff-expand", {
        "expand.test.js": `
          import { expect, test } from "bun:test";
          test("expand", () => {
            expect.extend({
              _toPrintDiffs() {
                const { printDiffOrStringify } = this.utils;
                const expected = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["k" + String(i).padStart(2, "0"), i]));
                const received = { ...expected, k15: "changed" };
                const lines = text => text.split("\\n");
                const diffs = {
                  false: [
                    printDiffOrStringify(expected, received, "Expected", "Received", false),
                    printDiffOrStringify(received, expected, { expand: false }),
                  ],
                  omitted: [
                    printDiffOrStringify(expected, received, "Expected", "Received"),
                    printDiffOrStringify(received, expected),
                  ],
                  true: [
                    printDiffOrStringify(expected, received, "Expected", "Received", true),
                    printDiffOrStringify(received, expected, { expand: true }),
                  ],
                };
                console.log(
                  JSON.stringify({
                    counts: Object.fromEntries(Object.entries(diffs).map(([expand, texts]) => [expand, texts.map(text => lines(text).length)])),
                    hunks: Object.values(diffs).map(([text]) => lines(text).filter(line => line.startsWith("@@"))),
                  }),
                );
                return { pass: true };
              },
            });
            expect()._toPrintDiffs();
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "expand.test.js"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1", AGENT: agent },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        printed: stdout
          .split("\n")
          .filter(line => line.startsWith("{"))
          .map(line => JSON.parse(line))[0],
        stderr,
      }).toEqual({
        printed: {
          counts: {
            false: [counts.false, counts.false],
            omitted: [counts.omitted, counts.omitted],
            true: [counts.true, counts.true],
          },
          hunks: [[hunk], [hunk], []],
        },
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
