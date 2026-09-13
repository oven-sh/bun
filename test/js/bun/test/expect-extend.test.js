/// <reference path="./expect-extend.types.d.ts" />
// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/expect-extend.test.js`
 *  `bunx vitest test/js/bun/test/expect-extend.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/expect-extend.test.js`
 */

import { bunEnv, bunExe, withoutAggressiveGC } from "harness";
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

describe("MatcherContext", () => {
  const stripAnsi = (/** @type {string} */ text) => text.replace(/\x1b\[[0-9;]*m/g, "");
  const utilNames = ["stringify", "printExpected", "printReceived", "EXPECTED_COLOR", "RECEIVED_COLOR", "matcherHint"];

  /** @returns {any} the `this.utils` that a matcher sees */
  function getUtils() {
    let utils;
    expect.extend({
      _toExposeUtils() {
        utils = this.utils;
        return { pass: true };
      },
    });
    expect(0)._toExposeUtils();
    return utils;
  }

  // Jest gives a matcher plain functions, and published matchers call them without a receiver.
  // jest-extended starts every matcher with `const { printReceived, matcherHint } = this.utils`
  // and passes `this.equals` to its helpers as a callback.
  test("equals works without a receiver", () => {
    let results;
    expect.extend({
      _toUseDestructuredEquals(actual) {
        const { equals } = this;
        results = {
          same: equals(actual, { a: 1 }),
          different: equals(actual, { a: 2 }),
          asymmetric: equals(actual, { a: expect.any(Number) }),
          stable: this.equals === equals,
        };
        return { pass: true };
      },
    });

    expect({ a: 1 })._toUseDestructuredEquals();
    expect(results).toEqual({ same: true, different: false, asymmetric: true, stable: true });
  });

  test.skipIf(!isBun)("matchers from the jest-extended package run through expect.extend", async () => {
    // The package replaces the built-in matchers of the same name, so it runs in a child process.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { expect } from "bun:test";
          import matchers from "jest-extended";
          expect.extend(matchers);

          expect([1, 2]).toIncludeAllMembers([2]);
          expect({ a: 1 }).toContainEntry(["a", 1]);
          let message;
          try {
            expect("zz").toBeHexadecimal();
          } catch (e) {
            message = e.message;
          }
          console.log(JSON.stringify(message));
        `,
      ],
      env: bunEnv,
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ message: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      message:
        "expect(received).toBeHexadecimal()\n\n" +
        'expect(received).toBeHexadecimal()\n\nExpected value to be a hexadecimal, received:\n  "zz"',
      stderr: "",
      exitCode: 0,
    });
  });

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

    test("the failure message can use functions destructured from utils", () => {
      expect.extend({
        _toFailWithDestructuredUtils(actual, expected) {
          const { matcherHint, printExpected, printReceived, stringify } = this.utils;
          return {
            pass: false,
            message: () =>
              matcherHint("._toFailWithDestructuredUtils") +
              `\n\nExpected: ${printExpected(expected)}\nReceived: ${printReceived(actual)} (${stringify(actual)})`,
          };
        },
      });

      let message;
      try {
        expect("a")._toFailWithDestructuredUtils("b");
      } catch (e) {
        message = stripAnsi(e.message);
      }
      // bun:test puts its own signature line above the matcher's message. Jest does not.
      expect(message).toBe(
        (isBun ? "expect(received)._toFailWithDestructuredUtils(expected)\n\n" : "") +
          'expect(received)._toFailWithDestructuredUtils(expected)\n\nExpected: "b"\nReceived: "a" ("a")',
      );
    });

    test("every function works without a receiver", () => {
      const withReceiver = {};
      const withoutReceiver = {};
      expect.extend({
        _toCallUtilsWithoutReceiver(actual) {
          for (const name of utilNames) {
            const fn = this.utils[name];
            withReceiver[name] = this.utils[name](actual);
            withoutReceiver[name] = fn(actual);
          }
          return { pass: true };
        },
      });

      expect("toFoo")._toCallUtilsWithoutReceiver();
      expect(Object.keys(withoutReceiver)).toEqual(utilNames);
      expect(withoutReceiver).toEqual(withReceiver);
    });

    test("is a plain object that owns its functions", () => {
      const utils = getUtils();
      expect(Object.getPrototypeOf(utils)).toBe(Object.prototype);
      expect(Object.keys(utils)).toEqual(expect.arrayContaining(utilNames));
      const copy = { ...utils };
      expect(utilNames.map(name => typeof copy[name])).toEqual(utilNames.map(() => "function"));
    });

    describe("matcherHint", () => {
      const E = (/** @type {string} */ text) => `<E:${text}>`;
      const R = (/** @type {string} */ text) => `<R:${text}>`;
      const S = (/** @type {string} */ text) => `<S:${text}>`;

      // The expected values are the output of jest-matcher-utils 30.2.0 with colors off.
      /** @type {[any[], string][]} */
      const cases = [
        [["toFoo"], "expect(received).toFoo(expected)"],
        // A name with a period is the old format. jest-extended passes ".toX" and ".not.toX".
        [[".toFoo"], "expect(received).toFoo(expected)"],
        [[".not.toFoo"], "expect(received).not.toFoo(expected)"],
        [[".toFoo", "received", ""], "expect(received).toFoo()"],
        [[".not.toFoo", "received", ""], "expect(received).not.toFoo()"],
        [["a.b.c"], "expect(received)a.b.c(expected)"],
        // `received` and `expected` are labels.
        [["toFoo", "a", "b"], "expect(a).toFoo(b)"],
        [["toFoo", "", ""], "expect.toFoo()"],
        [["toFoo", "", "x"], "expect.toFoo(x)"],
        [["toFoo", 1, 2], "expect(1).toFoo(2)"],
        [["toFoo", null, null], "expect(null).toFoo(null)"],
        [["toFoo", undefined, undefined, {}], "expect(received).toFoo(expected)"],
        [["toFoo", undefined, undefined, { isNot: true }], "expect(received).not.toFoo(expected)"],
        [[".toFoo", undefined, undefined, { isNot: true }], "expect(received).not.toFoo(expected)"],
        [["toFoo", undefined, undefined, { promise: "resolves" }], "expect(received).resolves.toFoo(expected)"],
        [
          ["toFoo", undefined, undefined, { promise: "rejects", isNot: true }],
          "expect(received).rejects.not.toFoo(expected)",
        ],
        [
          [".toFoo", undefined, undefined, { promise: "rejects", isNot: true }],
          "expect(received).rejects.not.toFoo(expected)",
        ],
        [["toFoo", undefined, undefined, { isDirectExpectCall: true }], "expect.toFoo(expected)"],
        [["toFoo", "a", "b", { secondArgument: "c" }], "expect(a).toFoo(b, c)"],
        [["toFoo", "a", "", { secondArgument: "c" }], "expect(a).toFoo()"],
        [
          ["toFoo", undefined, undefined, { comment: "deep equality" }],
          "expect(received).toFoo(expected) // deep equality",
        ],
        [["toFoo", undefined, "", { comment: "deep equality" }], "expect(received).toFoo() // deep equality"],
        [
          ["toFoo", "a", "b", { receivedColor: R, expectedColor: E, secondArgument: "c", secondArgumentColor: S }],
          "expect(<R:a>).toFoo(<E:b>, <S:c>)",
        ],
        [["toFoo", 0, 0, { comment: 0, promise: 0, secondArgument: 0 }], "expect(0).0.toFoo(0) // 0"],
        [
          ["toFoo", undefined, undefined, { isNot: undefined, comment: undefined, promise: undefined }],
          "expect(received).toFoo(expected)",
        ],
      ];

      test("returns the one-line signature that Jest returns", () => {
        const utils = getUtils();
        expect(cases.map(([args]) => stripAnsi(utils.matcherHint(...args)))).toEqual(
          cases.map(([, expected]) => expected),
        );
      });

      test("a color option that is not a function is a TypeError", () => {
        const utils = getUtils();
        let error;
        try {
          utils.matcherHint("toFoo", "a", "b", { expectedColor: "green" });
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toBe(
          isBun ? "matcherHint: options.expectedColor must be a function" : "expectedColor is not a function",
        );
      });

      test.skipIf(!isBun)("colors the labels and joins adjacent dim text", async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
              import { expect } from "bun:test";
              expect.extend({
                _toPrintHints() {
                  const { matcherHint } = this.utils;
                  console.log(
                    JSON.stringify([
                      matcherHint(".not.toFoo", "received", ""),
                      matcherHint("toFoo", "a", "b", { isNot: true, secondArgument: "c", comment: "why" }),
                      matcherHint("toFoo", "a", "b", { receivedColor: text => "<" + text + ">" }),
                    ]),
                  );
                  return { pass: true };
                },
              });
              expect(0)._toPrintHints();
            `,
          ],
          env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        const [dim, red, green, reset] = ["\x1b[2m", "\x1b[31m", "\x1b[32m", "\x1b[0m"];
        expect({ hints: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
          hints: [
            `${dim}expect(${reset}${red}received${reset}${dim}).not.toFoo()${reset}`,
            `${dim}expect(${reset}${red}a${reset}${dim}).${reset}not${dim}.${reset}toFoo${dim}(${reset}${green}b${reset}${dim}, ${reset}${green}c${reset}${dim}) // why${reset}`,
            `${dim}expect(${reset}<a>${dim}).${reset}toFoo${dim}(${reset}${green}b${reset}${dim})${reset}`,
          ],
          stderr: "",
          exitCode: 0,
        });
      });
    });
  });
});
