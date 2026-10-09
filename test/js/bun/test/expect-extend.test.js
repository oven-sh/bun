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

    // What jest-matcher-utils 30.5.1 returns for the same arguments.
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

    test("matcherHint rejects what it cannot use", () => {
      expect(() => utils.matcherHint()).toThrow("the first argument (matcher name) must be a string");
      expect(() => utils.matcherHint(1)).toThrow("the first argument (matcher name) must be a string");
      expect(() => utils.matcherHint("toX", "r", "e", 1)).toThrow("options must be an object (or undefined)");
      for (const option of ["receivedColor", "expectedColor", "secondArgumentColor"]) {
        expect(() => utils.matcherHint("toX", "r", "e", { secondArgument: "s", [option]: 1 })).toThrow(
          new TypeError(`matcherHint: options.${option} must be a function`),
        );
      }
      // As in Jest, a color that is not needed is not looked at.
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

    test.each(["EXPECTED_COLOR", "RECEIVED_COLOR"])("%s colors text as it is", name => {
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
