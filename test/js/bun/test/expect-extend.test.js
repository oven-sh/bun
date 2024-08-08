/// <reference path="./expect-extend.types.d.ts" />
// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/expect-extend.test.js`
 *  `bunx vitest test/js/bun/test/expect-extend.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/expect-extend.test.js`
 */

import { withoutAggressiveGC } from "harness";
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
