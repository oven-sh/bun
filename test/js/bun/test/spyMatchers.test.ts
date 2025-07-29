/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.
Copyright Contributors to the Jest project.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

import { describe, expect, jest, expect as jestExpect, test } from "bun:test";
import * as Immutable from "immutable";
import type { FunctionLike } from "jest-mock";

jestExpect.extend({
  optionalFn(fn?: unknown) {
    const pass = fn === undefined || typeof fn === "function";
    return { message: () => "expect either a function or undefined", pass };
  },
});

// Given a Jest mock function, return a minimal mock of a spy.
const createSpy = <T extends FunctionLike>(fn: jest.Mock<T>): jest.Mock<T> => {
  const spy = function () {};

  spy.calls = {
    all() {
      return fn.mock.calls.map(args => ({ args }));
    },
    count() {
      return fn.mock.calls.length;
    },
  };

  return spy as unknown as jest.Mock<T>;
};

describe("toHaveBeenCalled", () => {
  test("works only on spies or jest.fn", () => {
    const fn = function fn() {};

    expect(() => jestExpect(fn).toHaveBeenCalled()).toThrow();
  });

  test("passes when called", () => {
    const fn = jest.fn();
    fn("arg0", "arg1", "arg2");
    // jestExpect(createSpy(fn)).toHaveBeenCalled();
    jestExpect(fn).toHaveBeenCalled();
    expect(() => jestExpect(fn).not.toHaveBeenCalled()).toThrow();
  });

  test(".not passes when called", () => {
    const fn = jest.fn();
    // const spy = createSpy(fn);

    // jestExpect(spy).not.toHaveBeenCalled();
    jestExpect(fn).not.toHaveBeenCalled();
    // expect(() => jestExpect(spy).toHaveBeenCalled()).toThrow();
    expect(() => jestExpect(fn).toHaveBeenCalled()).toThrow();
  });

  test("fails with any argument passed", () => {
    const fn = jest.fn();

    fn();
    expect(() =>
      // @ts-expect-error: Testing runtime error
      jestExpect(fn).toHaveBeenCalled(555),
    ).toThrow();
  });

  test(".not fails with any argument passed", () => {
    const fn = jest.fn();

    expect(() =>
      // @ts-expect-error: Testing runtime error
      jestExpect(fn).not.toHaveBeenCalled(555),
    ).toThrow();
  });

  test("includes the custom mock name in the error message", () => {
    const fn = jest.fn().mockName("named-mock");

    fn();
    jestExpect(fn).toHaveBeenCalled();
    expect(() => jestExpect(fn).not.toHaveBeenCalled()).toThrow();
  });
});

describe("toHaveBeenCalledTimes", () => {
  test(".not works only on spies or jest.fn", () => {
    const fn = function fn() {};

    expect(() => jestExpect(fn).not.toHaveBeenCalledTimes(2)).toThrow();
  });

  test("only accepts a number argument", () => {
    const fn = jest.fn();
    fn();
    jestExpect(fn).toHaveBeenCalledTimes(1);

    for (const value of [{}, [], true, "a", new Map(), () => {}]) {
      expect(() =>
        // @ts-expect-error: Testing runtime error
        jestExpect(fn).toHaveBeenCalledTimes(value),
      ).toThrow();
    }
  });

  test(".not only accepts a number argument", () => {
    const fn = jest.fn();
    jestExpect(fn).not.toHaveBeenCalledTimes(1);

    for (const value of [{}, [], true, "a", new Map(), () => {}]) {
      expect(() =>
        // @ts-expect-error: Testing runtime error
        jestExpect(fn).not.toHaveBeenCalledTimes(value),
      ).toThrow();
    }
  });

  test("passes if function called equal to expected times", () => {
    const fn = jest.fn();
    fn();
    fn();

    // const spy = createSpy(fn);
    // jestExpect(spy).toHaveBeenCalledTimes(2);
    jestExpect(fn).toHaveBeenCalledTimes(2);

    // expect(() => jestExpect(spy).not.toHaveBeenCalledTimes(2)).toThrow();
    expect(() => jestExpect(fn).not.toHaveBeenCalledTimes(2)).toThrow();
  });

  test(".not passes if function called more than expected times", () => {
    const fn = jest.fn();
    fn();
    fn();
    fn();

    // const spy = createSpy(fn);
    // jestExpect(spy).toHaveBeenCalledTimes(3);
    // jestExpect(spy).not.toHaveBeenCalledTimes(2);

    jestExpect(fn).toHaveBeenCalledTimes(3);
    jestExpect(fn).not.toHaveBeenCalledTimes(2);

    expect(() => jestExpect(fn).toHaveBeenCalledTimes(2)).toThrow();
  });

  test(".not passes if function called less than expected times", () => {
    const fn = jest.fn();
    fn();

    // const spy = createSpy(fn);
    // jestExpect(spy).toHaveBeenCalledTimes(1);
    // jestExpect(spy).not.toHaveBeenCalledTimes(2);

    jestExpect(fn).toHaveBeenCalledTimes(1);
    jestExpect(fn).not.toHaveBeenCalledTimes(2);

    expect(() => jestExpect(fn).toHaveBeenCalledTimes(2)).toThrow();
  });

  test("includes the custom mock name in the error message", () => {
    const fn = jest.fn().mockName("named-mock");
    fn();

    expect(() => jestExpect(fn).toHaveBeenCalledTimes(2)).toThrow();
  });
});

describe.each(["toHaveBeenLastCalledWith", "toHaveBeenNthCalledWith", "toHaveBeenCalledWith"] as const)(
  "%s",
  calledWith => {
    function isToHaveNth(calledWith: string): calledWith is "toHaveBeenNthCalledWith" {
      return calledWith === "toHaveBeenNthCalledWith";
    }

    test("works only on spies or jest.fn", () => {
      const fn = function fn() {};

      if (isToHaveNth(calledWith)) {
        expect(() => jestExpect(fn)[calledWith](3)).toThrow();
      } else {
        expect(() => jestExpect(fn)[calledWith]()).toThrow();
      }
    });

    test("works when not called", () => {
      const fn = jest.fn();

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn)).not[calledWith](1, "foo", "bar");
        jestExpect(fn).not[calledWith](1, "foo", "bar");

        expect(() => jestExpect(fn)[calledWith](1, "foo", "bar")).toThrow();
      } else {
        // jestExpect(createSpy(fn)).not[calledWith]("foo", "bar");
        jestExpect(fn).not[calledWith]("foo", "bar");

        expect(() => jestExpect(fn)[calledWith]("foo", "bar")).toThrow();
      }
    });

    test("works with no arguments", () => {
      const fn = jest.fn();
      fn();

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn))[calledWith](1);
        jestExpect(fn)[calledWith](1);
      } else {
        // jestExpect(createSpy(fn))[calledWith]();
        jestExpect(fn)[calledWith]();
      }
    });

    test("works with arguments that don't match", () => {
      const fn = jest.fn();
      fn("foo", "bar1");

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn)).not[calledWith](1, "foo", "bar");
        jestExpect(fn).not[calledWith](1, "foo", "bar");

        expect(() => jestExpect(fn)[calledWith](1, "foo", "bar")).toThrow();
      } else {
        // jestExpect(createSpy(fn)).not[calledWith]("foo", "bar");
        jestExpect(fn).not[calledWith]("foo", "bar");

        expect(() => jestExpect(fn)[calledWith]("foo", "bar")).toThrow();
      }
    });

    test("works with arguments that don't match in number of arguments", () => {
      const fn = jest.fn();
      fn("foo", "bar", "plop");

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn)).not[calledWith](1, "foo", "bar");
        jestExpect(fn).not[calledWith](1, "foo", "bar");

        expect(() => jestExpect(fn)[calledWith](1, "foo", "bar")).toThrow();
      } else {
        // jestExpect(createSpy(fn)).not[calledWith]("foo", "bar");
        jestExpect(fn).not[calledWith]("foo", "bar");

        expect(() => jestExpect(fn)[calledWith]("foo", "bar")).toThrow();
      }
    });

    test("works with arguments that don't match with matchers", () => {
      const fn = jest.fn();
      fn("foo", "bar");

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn)).not[calledWith](1, jestExpect.any(String), jestExpect.any(Number));
        jestExpect(fn).not[calledWith](1, jestExpect.any(String), jestExpect.any(Number));

        expect(() => jestExpect(fn)[calledWith](1, jestExpect.any(String), jestExpect.any(Number))).toThrow();
      } else {
        // jestExpect(createSpy(fn)).not[calledWith](jestExpect.any(String), jestExpect.any(Number));
        jestExpect(fn).not[calledWith](jestExpect.any(String), jestExpect.any(Number));

        expect(() => jestExpect(fn)[calledWith](jestExpect.any(String), jestExpect.any(Number))).toThrow();
      }
    });

    test("works with arguments that don't match with matchers even when argument is undefined", () => {
      const fn = jest.fn();
      fn("foo", undefined);

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn)).not[calledWith](1, "foo", jestExpect.any(String));
        jestExpect(fn).not[calledWith](1, "foo", jestExpect.any(String));

        expect(() => jestExpect(fn)[calledWith](1, "foo", jestExpect.any(String))).toThrow();
      } else {
        // jestExpect(createSpy(fn)).not[calledWith]("foo", jestExpect.any(String));
        jestExpect(fn).not[calledWith]("foo", jestExpect.any(String));

        expect(() => jestExpect(fn)[calledWith]("foo", jestExpect.any(String))).toThrow();
      }
    });

    test("works with arguments that don't match in size even if one is an optional matcher", () => {
      // issue 12463
      const fn = jest.fn();
      fn("foo");

      if (isToHaveNth(calledWith)) {
        jestExpect(fn).not[calledWith](1, "foo", jestExpect.optionalFn());
        expect(() => jestExpect(fn)[calledWith](1, "foo", jestExpect.optionalFn())).toThrow();
      } else {
        jestExpect(fn).not[calledWith]("foo", jestExpect.optionalFn());
        expect(() => jestExpect(fn)[calledWith]("foo", jestExpect.optionalFn())).toThrow();
      }
    });

    test("works with arguments that match", () => {
      const fn = jest.fn();
      fn("foo", "bar");

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn))[calledWith](1, "foo", "bar");
        jestExpect(fn)[calledWith](1, "foo", "bar");

        expect(() => jestExpect(fn).not[calledWith](1, "foo", "bar")).toThrow();
      } else {
        // jestExpect(createSpy(fn))[calledWith]("foo", "bar");
        jestExpect(fn)[calledWith]("foo", "bar");

        expect(() => jestExpect(fn).not[calledWith]("foo", "bar")).toThrow();
      }
    });

    test("works with arguments that match with matchers", () => {
      const fn = jest.fn();
      fn("foo", "bar");

      if (isToHaveNth(calledWith)) {
        // jestExpect(createSpy(fn))[calledWith](1, jestExpect.any(String), jestExpect.any(String));
        jestExpect(fn)[calledWith](1, jestExpect.any(String), jestExpect.any(String));

        expect(() => jestExpect(fn).not[calledWith](1, jestExpect.any(String), jestExpect.any(String))).toThrow();
      } else {
        // jestExpect(createSpy(fn))[calledWith](jestExpect.any(String), jestExpect.any(String));
        jestExpect(fn)[calledWith](jestExpect.any(String), jestExpect.any(String));

        expect(() => jestExpect(fn).not[calledWith](jestExpect.any(String), jestExpect.any(String))).toThrow();
      }
    });

    test("works with trailing undefined arguments", () => {
      const fn = jest.fn();
      fn("foo", undefined);

      if (isToHaveNth(calledWith)) {
        expect(() => jestExpect(fn)[calledWith](1, "foo")).toThrow();
      } else {
        expect(() => jestExpect(fn)[calledWith]("foo")).toThrow();
      }
    });

    test("works with trailing undefined arguments if requested by the match query", () => {
      const fn = jest.fn();
      fn("foo", undefined);

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, "foo", undefined);
        expect(() => jestExpect(fn).not[calledWith](1, "foo", undefined)).toThrow();
      } else {
        jestExpect(fn)[calledWith]("foo", undefined);
        expect(() => jestExpect(fn).not[calledWith]("foo", undefined)).toThrow();
      }
    });

    test("works with trailing undefined arguments when explicitly requested as optional by matcher", () => {
      // issue 12463
      const fn = jest.fn();
      fn("foo", undefined);

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, "foo", jestExpect.optionalFn());
        expect(() => jestExpect(fn).not[calledWith](1, "foo", jestExpect.optionalFn())).toThrow();
      } else {
        jestExpect(fn)[calledWith]("foo", jestExpect.optionalFn());
        expect(() => jestExpect(fn).not[calledWith]("foo", jestExpect.optionalFn())).toThrow();
      }
    });

    test("works with Map", () => {
      const fn = jest.fn();

      const m1 = new Map([
        [1, 2],
        [2, 1],
      ]);
      const m2 = new Map([
        [1, 2],
        [2, 1],
      ]);
      const m3 = new Map([
        ["a", "b"],
        ["b", "a"],
      ]);

      fn(m1);

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, m2);
        jestExpect(fn).not[calledWith](1, m3);

        expect(() => jestExpect(fn).not[calledWith](1, m2)).toThrow();
        expect(() => jestExpect(fn)[calledWith](1, m3)).toThrow();
      } else {
        jestExpect(fn)[calledWith](m2);
        jestExpect(fn).not[calledWith](m3);

        expect(() => jestExpect(fn).not[calledWith](m2)).toThrow();
        expect(() => jestExpect(fn)[calledWith](m3)).toThrow();
      }
    });

    test("works with Set", () => {
      const fn = jest.fn();

      const s1 = new Set([1, 2]);
      const s2 = new Set([1, 2]);
      const s3 = new Set([3, 4]);

      fn(s1);

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, s2);
        jestExpect(fn).not[calledWith](1, s3);

        expect(() => jestExpect(fn).not[calledWith](1, s2)).toThrow();
        expect(() => jestExpect(fn)[calledWith](1, s3)).toThrow();
      } else {
        jestExpect(fn)[calledWith](s2);
        jestExpect(fn).not[calledWith](s3);

        expect(() => jestExpect(fn).not[calledWith](s2)).toThrow();
        expect(() => jestExpect(fn)[calledWith](s3)).toThrow();
      }
    });

    test.todo("works with Immutable.js objects", () => {
      const fn = jest.fn();
      const directlyCreated = Immutable.Map([["a", { b: "c" }]]);
      const indirectlyCreated = Immutable.Map().set("a", { b: "c" });
      fn(directlyCreated, indirectlyCreated);

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, indirectlyCreated, directlyCreated);

        expect(() => jestExpect(fn).not[calledWith](1, indirectlyCreated, directlyCreated)).toThrow();
      } else {
        jestExpect(fn)[calledWith](indirectlyCreated, directlyCreated);

        expect(() => jestExpect(fn).not[calledWith](indirectlyCreated, directlyCreated)).toThrow();
      }
    });

    if (!isToHaveNth(calledWith)) {
      test("works with many arguments", () => {
        const fn = jest.fn();
        fn("foo1", "bar");
        fn("foo", "bar1");
        fn("foo", "bar");

        jestExpect(fn)[calledWith]("foo", "bar");

        expect(() => jestExpect(fn).not[calledWith]("foo", "bar")).toThrow();
      });

      test("works with many arguments that don't match", () => {
        const fn = jest.fn();
        fn("foo", "bar1");
        fn("foo", "bar2");
        fn("foo", "bar3");

        jestExpect(fn).not[calledWith]("foo", "bar");

        expect(() => jestExpect(fn)[calledWith]("foo", "bar")).toThrow();
      });
    }

    if (isToHaveNth(calledWith)) {
      test("works with three calls", () => {
        const fn = jest.fn();
        fn("foo1", "bar");
        fn("foo", "bar1");
        fn("foo", "bar");

        jestExpect(fn)[calledWith](1, "foo1", "bar");
        jestExpect(fn)[calledWith](2, "foo", "bar1");
        jestExpect(fn)[calledWith](3, "foo", "bar");

        expect(() => {
          jestExpect(fn).not[calledWith](1, "foo1", "bar");
        }).toThrow();
      });

      test("positive throw matcher error for n that is not positive integer", async () => {
        const fn = jest.fn();
        fn("foo1", "bar");

        expect(() => {
          jestExpect(fn)[calledWith](0, "foo1", "bar");
        }).toThrow();
      });

      test("positive throw matcher error for n that is not integer", async () => {
        const fn = jest.fn();
        fn("foo1", "bar");

        expect(() => {
          jestExpect(fn)[calledWith](0.1, "foo1", "bar");
        }).toThrow();
      });

      test("negative throw matcher error for n that is not integer", async () => {
        const fn = jest.fn();
        fn("foo1", "bar");

        expect(() => {
          jestExpect(fn).not[calledWith](Number.POSITIVE_INFINITY, "foo1", "bar");
        }).toThrow();
      });
    }

    test("includes the custom mock name in the error message", () => {
      const fn = jest.fn().mockName("named-mock");
      fn("foo", "bar");

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, "foo", "bar");

        expect(() => jestExpect(fn).not[calledWith](1, "foo", "bar")).toThrow();
      } else {
        jestExpect(fn)[calledWith]("foo", "bar");

        expect(() => jestExpect(fn).not[calledWith]("foo", "bar")).toThrow();
      }
    });

    test("works with objectContaining", () => {
      const fn = jest.fn();
      // Call the function twice with different objects and verify that the
      // correct comparison sample is still used (original sample isn't mutated)
      fn({ a: 1, b: 2, c: 4 });
      fn({ a: 3, b: 7, c: 4 });

      if (isToHaveNth(calledWith)) {
        jestExpect(fn)[calledWith](1, jestExpect.objectContaining({ b: 2 }));
        jestExpect(fn)[calledWith](2, jestExpect.objectContaining({ b: 7 }));
        jestExpect(fn)[calledWith](2, jestExpect.not.objectContaining({ b: 2 }));

        expect(() => jestExpect(fn)[calledWith](1, jestExpect.objectContaining({ b: 7 }))).toThrow();

        expect(() => jestExpect(fn).not[calledWith](1, jestExpect.objectContaining({ b: 2 }))).toThrow();

        expect(() => jestExpect(fn)[calledWith](1, jestExpect.not.objectContaining({ b: 2 }))).toThrow();
      } else {
        jestExpect(fn)[calledWith](jestExpect.objectContaining({ b: 7 }));
        jestExpect(fn)[calledWith](jestExpect.not.objectContaining({ b: 3 }));

        // The function was never called with this value.
        // Only {"b": 3} should be shown as the expected value in the snapshot
        // (no extra properties in the expected value).
        expect(() => jestExpect(fn)[calledWith](jestExpect.objectContaining({ b: 3 }))).toThrow();

        // Only {"b": 7} should be shown in the snapshot.
        expect(() => jestExpect(fn).not[calledWith](jestExpect.objectContaining({ b: 7 }))).toThrow();
      }

      if (calledWith === "toHaveBeenCalledWith") {
        // The first call had {b: 2}, so this passes.
        jestExpect(fn)[calledWith](jestExpect.not.objectContaining({ b: 7 }));

        // Only {"c": 4} should be shown in the snapshot.
        expect(() => jestExpect(fn)[calledWith](jestExpect.not.objectContaining({ c: 4 }))).toThrow();
      }
    });
  },
);

describe("toHaveReturned", () => {
  test(".not works only on jest.fn", () => {
    const fn = function fn() {};

    expect(() => jestExpect(fn).not.toHaveReturned()).toThrow();
  });

  test.todo("throw matcher error if received is spy", () => {
    const spy = createSpy(jest.fn());

    expect(() => jestExpect(spy).toHaveReturned()).toThrow();
  });

  test("passes when returned", () => {
    const fn = jest.fn(() => 42);
    fn();
    jestExpect(fn).toHaveReturned();
    expect(() => jestExpect(fn).not.toHaveReturned()).toThrow();
  });

  test("passes when undefined is returned", () => {
    const fn = jest.fn(() => undefined);
    fn();
    jestExpect(fn).toHaveReturned();
    expect(() => jestExpect(fn).not.toHaveReturned()).toThrow();
  });

  test("passes when at least one call does not throw", () => {
    const fn = jest.fn((causeError: boolean) => {
      if (causeError) {
        throw new Error("Error!");
      }

      return 42;
    });

    fn(false);

    try {
      fn(true);
    } catch {
      // ignore error
    }

    fn(false);

    jestExpect(fn).toHaveReturned();
    expect(() => jestExpect(fn).not.toHaveReturned()).toThrow();
  });

  test(".not passes when not returned", () => {
    const fn = jest.fn();

    jestExpect(fn).not.toHaveReturned();
    expect(() => jestExpect(fn).toHaveReturned()).toThrow();
  });

  test(".not passes when all calls throw", () => {
    const fn = jest.fn(() => {
      throw new Error("Error!");
    });

    try {
      fn();
    } catch {
      // ignore error
    }

    try {
      fn();
    } catch {
      // ignore error
    }

    jestExpect(fn).not.toHaveReturned();
    expect(() => jestExpect(fn).toHaveReturned()).toThrow();
  });

  test(".not passes when a call throws undefined", () => {
    const fn = jest.fn(() => {
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    });

    try {
      fn();
    } catch {
      // ignore error
    }

    jestExpect(fn).not.toHaveReturned();
    expect(() => jestExpect(fn).toHaveReturned()).toThrow();
  });

  test("fails with any argument passed", () => {
    const fn = jest.fn();

    fn();
    expect(() =>
      // @ts-expect-error: Testing runtime error
      jestExpect(fn).toHaveReturned(555),
    ).toThrow();
  });

  test(".not fails with any argument passed", () => {
    const fn = jest.fn();

    expect(() =>
      // @ts-expect-error: Testing runtime error
      jestExpect(fn).not.toHaveReturned(555),
    ).toThrow();
  });

  test("includes the custom mock name in the error message", () => {
    const fn = jest.fn(() => 42).mockName("named-mock");
    fn();
    jestExpect(fn).toHaveReturned();
    expect(() => jestExpect(fn).not.toHaveReturned()).toThrow();
  });

  test("incomplete recursive calls are handled properly", () => {
    // sums up all integers from 0 -> value, using recursion
    const fn: jest.Mock<(value: number) => number> = jest.fn(value => {
      if (value === 0) {
        // Before returning from the base case of recursion, none of the
        // calls have returned yet.
        jestExpect(fn).not.toHaveReturned();
        expect(() => jestExpect(fn).toHaveReturned()).toThrow();
        return 0;
      } else {
        return value + fn(value - 1);
      }
    });

    fn(3);
  });
});

describe("toHaveReturnedTimes", () => {
  test.todo("throw matcher error if received is spy", () => {
    const spy = createSpy(jest.fn());

    expect(() => jestExpect(spy).not.toHaveReturnedTimes(2)).toThrow();
  });

  test("only accepts a number argument", () => {
    const fn = jest.fn(() => 42);
    fn();
    jestExpect(fn).toHaveReturnedTimes(1);

    for (const value of [{}, [], true, "a", new Map(), () => {}]) {
      expect(() =>
        // @ts-expect-error: Testing runtime error
        jestExpect(fn).toHaveReturnedTimes(value),
      ).toThrow();
    }
  });

  test(".not only accepts a number argument", () => {
    const fn = jest.fn(() => 42);
    jestExpect(fn).not.toHaveReturnedTimes(2);

    for (const value of [{}, [], true, "a", new Map(), () => {}]) {
      expect(() =>
        // @ts-expect-error: Testing runtime error
        jestExpect(fn).not.toHaveReturnedTimes(value),
      ).toThrow();
    }
  });

  test("passes if function returned equal to expected times", () => {
    const fn = jest.fn(() => 42);
    fn();
    fn();

    jestExpect(fn).toHaveReturnedTimes(2);

    expect(() => jestExpect(fn).not.toHaveReturnedTimes(2)).toThrow();
  });

  test("calls that return undefined are counted as returns", () => {
    const fn = jest.fn(() => undefined);
    fn();
    fn();

    jestExpect(fn).toHaveReturnedTimes(2);

    expect(() => jestExpect(fn).not.toHaveReturnedTimes(2)).toThrow();
  });

  test(".not passes if function returned more than expected times", () => {
    const fn = jest.fn(() => 42);
    fn();
    fn();
    fn();

    jestExpect(fn).toHaveReturnedTimes(3);
    jestExpect(fn).not.toHaveReturnedTimes(2);

    expect(() => jestExpect(fn).toHaveReturnedTimes(2)).toThrow();
  });

  test(".not passes if function called less than expected times", () => {
    const fn = jest.fn(() => 42);
    fn();

    jestExpect(fn).toHaveReturnedTimes(1);
    jestExpect(fn).not.toHaveReturnedTimes(2);

    expect(() => jestExpect(fn).toHaveReturnedTimes(2)).toThrow();
  });

  test("calls that throw are not counted", () => {
    const fn = jest.fn((causeError: boolean) => {
      if (causeError) {
        throw new Error("Error!");
      }

      return 42;
    });

    fn(false);

    try {
      fn(true);
    } catch {
      // ignore error
    }

    fn(false);

    jestExpect(fn).not.toHaveReturnedTimes(3);

    expect(() => jestExpect(fn).toHaveReturnedTimes(3)).toThrow();
  });

  test("calls that throw undefined are not counted", () => {
    const fn = jest.fn((causeError: boolean) => {
      if (causeError) {
        // eslint-disable-next-line no-throw-literal
        throw undefined;
      }

      return 42;
    });

    fn(false);

    try {
      fn(true);
    } catch {
      // ignore error
    }

    fn(false);

    jestExpect(fn).toHaveReturnedTimes(2);

    expect(() => jestExpect(fn).not.toHaveReturnedTimes(2)).toThrow();
  });

  test("includes the custom mock name in the error message", () => {
    const fn = jest.fn(() => 42).mockName("named-mock");
    fn();
    fn();

    jestExpect(fn).toHaveReturnedTimes(2);

    expect(() => jestExpect(fn).toHaveReturnedTimes(1)).toThrow();
  });

  test("incomplete recursive calls are handled properly", () => {
    // sums up all integers from 0 -> value, using recursion
    const fn: jest.Mock<(value: number) => number> = jest.fn(value => {
      if (value === 0) {
        return 0;
      } else {
        const recursiveResult = fn(value - 1);

        if (value === 2) {
          // Only 2 of the recursive calls have returned at this point
          jestExpect(fn).toHaveReturnedTimes(2);
          expect(() => jestExpect(fn).not.toHaveReturnedTimes(2)).toThrow();
        }

        return value + recursiveResult;
      }
    });

    fn(3);
  });
});

describe.each(["toHaveLastReturnedWith", "toHaveNthReturnedWith", "toHaveReturnedWith"] as const)(
  "%s",
  returnedWith => {
    function isToHaveNth(returnedWith: string): returnedWith is "toHaveNthReturnedWith" {
      return returnedWith === "toHaveNthReturnedWith";
    }

    function isToHaveLast(returnedWith: string): returnedWith is "toHaveLastReturnedWith" {
      return returnedWith === "toHaveLastReturnedWith";
    }
    test("works only on spies or jest.fn", () => {
      const fn = function fn() {};

      // @ts-expect-error: Testing runtime error
      expect(() => jestExpect(fn)[returnedWith]()).toThrow();
    });

    test("works when not called", () => {
      const fn = jest.fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn).not[returnedWith](1, "foo");

        expect(() => jestExpect(fn)[returnedWith](1, "foo")).toThrow();
      } else {
        jestExpect(fn).not[returnedWith]("foo");

        expect(() => jestExpect(fn)[returnedWith]("foo")).toThrow();
      }
    });

    test("works with no arguments", () => {
      const fn = jest.fn();
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1);
      } else {
        jestExpect(fn)[returnedWith]();
      }
    });

    test("works with argument that does not match", () => {
      const fn = jest.fn(() => "foo");
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn).not[returnedWith](1, "bar");

        expect(() => jestExpect(fn)[returnedWith](1, "bar")).toThrow();
      } else {
        jestExpect(fn).not[returnedWith]("bar");

        expect(() => jestExpect(fn)[returnedWith]("bar")).toThrow();
      }
    });

    test("works with argument that does match", () => {
      const fn = jest.fn(() => "foo");
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1, "foo");

        expect(() => jestExpect(fn).not[returnedWith](1, "foo")).toThrow();
      } else {
        jestExpect(fn)[returnedWith]("foo");

        expect(() => jestExpect(fn).not[returnedWith]("foo")).toThrow();
      }
    });

    test("works with undefined", () => {
      const fn = jest.fn(() => undefined);
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1, undefined);

        expect(() => jestExpect(fn).not[returnedWith](1, undefined)).toThrow();
      } else {
        jestExpect(fn)[returnedWith](undefined);

        expect(() => jestExpect(fn).not[returnedWith](undefined)).toThrow();
      }
    });

    test("works with Map", () => {
      const m1 = new Map([
        [1, 2],
        [2, 1],
      ]);
      const m2 = new Map([
        [1, 2],
        [2, 1],
      ]);
      const m3 = new Map([
        ["a", "b"],
        ["b", "a"],
      ]);

      const fn = jest.fn(() => m1);
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1, m2);
        jestExpect(fn).not[returnedWith](1, m3);

        expect(() => jestExpect(fn).not[returnedWith](1, m2)).toThrow();
        expect(() => jestExpect(fn)[returnedWith](1, m3)).toThrow();
      } else {
        jestExpect(fn)[returnedWith](m2);
        jestExpect(fn).not[returnedWith](m3);

        expect(() => jestExpect(fn).not[returnedWith](m2)).toThrow();
        expect(() => jestExpect(fn)[returnedWith](m3)).toThrow();
      }
    });

    test("works with Set", () => {
      const s1 = new Set([1, 2]);
      const s2 = new Set([1, 2]);
      const s3 = new Set([3, 4]);

      const fn = jest.fn(() => s1);
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1, s2);
        jestExpect(fn).not[returnedWith](1, s3);

        expect(() => jestExpect(fn).not[returnedWith](1, s2)).toThrow();
        expect(() => jestExpect(fn)[returnedWith](1, s3)).toThrow();
      } else {
        jestExpect(fn)[returnedWith](s2);
        jestExpect(fn).not[returnedWith](s3);

        expect(() => jestExpect(fn).not[returnedWith](s2)).toThrow();
        expect(() => jestExpect(fn)[returnedWith](s3)).toThrow();
      }
    });

    test("works with Immutable.js objects directly created", () => {
      const directlyCreated = Immutable.Map([["a", { b: "c" }]]);
      const fn = jest.fn(() => directlyCreated);
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1, directlyCreated);

        expect(() => jestExpect(fn).not[returnedWith](1, directlyCreated)).toThrow();
      } else {
        jestExpect(fn)[returnedWith](directlyCreated);

        expect(() => jestExpect(fn).not[returnedWith](directlyCreated)).toThrow();
      }
    });

    test("works with Immutable.js objects indirectly created", () => {
      const indirectlyCreated = Immutable.Map().set("a", { b: "c" });
      const fn = jest.fn(() => indirectlyCreated);
      fn();

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn)[returnedWith](1, indirectlyCreated);

        expect(() => jestExpect(fn).not[returnedWith](1, indirectlyCreated)).toThrow();
      } else {
        jestExpect(fn)[returnedWith](indirectlyCreated);

        expect(() => jestExpect(fn).not[returnedWith](indirectlyCreated)).toThrow();
      }
    });

    test("a call that throws is not considered to have returned", () => {
      const fn = jest.fn(() => {
        throw new Error("Error!");
      });

      try {
        fn();
      } catch {
        // ignore error
      }

      if (isToHaveNth(returnedWith)) {
        // It doesn't matter what return value is tested if the call threw
        jestExpect(fn).not[returnedWith](1, "foo");
        jestExpect(fn).not[returnedWith](1, null);
        jestExpect(fn).not[returnedWith](1, undefined);

        expect(() => jestExpect(fn)[returnedWith](1, undefined)).toThrow();
      } else {
        // It doesn't matter what return value is tested if the call threw
        jestExpect(fn).not[returnedWith]("foo");
        jestExpect(fn).not[returnedWith](null);
        jestExpect(fn).not[returnedWith](undefined);

        expect(() => jestExpect(fn)[returnedWith](undefined)).toThrow();
      }
    });

    test("a call that throws undefined is not considered to have returned", () => {
      const fn = jest.fn(() => {
        // eslint-disable-next-line no-throw-literal
        throw undefined;
      });

      try {
        fn();
      } catch {
        // ignore error
      }

      if (isToHaveNth(returnedWith)) {
        // It doesn't matter what return value is tested if the call threw
        jestExpect(fn).not[returnedWith](1, "foo");
        jestExpect(fn).not[returnedWith](1, null);
        jestExpect(fn).not[returnedWith](1, undefined);

        expect(() => jestExpect(fn)[returnedWith](1, undefined)).toThrow();
      } else {
        // It doesn't matter what return value is tested if the call threw
        jestExpect(fn).not[returnedWith]("foo");
        jestExpect(fn).not[returnedWith](null);
        jestExpect(fn).not[returnedWith](undefined);

        expect(() => jestExpect(fn)[returnedWith](undefined)).toThrow();
      }
    });

    if (!isToHaveNth(returnedWith)) {
      describe("toHaveReturnedWith", () => {
        test("works with more calls than the limit", () => {
          const fn = jest.fn<() => string>();
          fn.mockReturnValueOnce("foo1");
          fn.mockReturnValueOnce("foo2");
          fn.mockReturnValueOnce("foo3");
          fn.mockReturnValueOnce("foo4");
          fn.mockReturnValueOnce("foo5");
          fn.mockReturnValueOnce("foo6");

          fn();
          fn();
          fn();
          fn();
          fn();
          fn();

          jestExpect(fn).not[returnedWith]("bar");

          expect(() => {
            jestExpect(fn)[returnedWith]("bar");
          }).toThrow();
        });

        test("incomplete recursive calls are handled properly", () => {
          // sums up all integers from 0 -> value, using recursion
          const fn: jest.Mock<(value: number) => number> = jest.fn(value => {
            if (value === 0) {
              // Before returning from the base case of recursion, none of the
              // calls have returned yet.
              // This test ensures that the incomplete calls are not incorrectly
              // interpreted as have returned undefined
              jestExpect(fn).not[returnedWith](undefined);
              expect(() => jestExpect(fn)[returnedWith](undefined)).toThrow();

              return 0;
            } else {
              return value + fn(value - 1);
            }
          });

          fn(3);
        });
      });
    }

    if (isToHaveNth(returnedWith)) {
      describe("toHaveNthReturnedWith", () => {
        test("works with three calls", () => {
          const fn = jest.fn<() => string>();
          fn.mockReturnValueOnce("foo1");
          fn.mockReturnValueOnce("foo2");
          fn.mockReturnValueOnce("foo3");
          fn();
          fn();
          fn();

          jestExpect(fn)[returnedWith](1, "foo1");
          jestExpect(fn)[returnedWith](2, "foo2");
          jestExpect(fn)[returnedWith](3, "foo3");

          expect(() => {
            jestExpect(fn).not[returnedWith](1, "foo1");
            jestExpect(fn).not[returnedWith](2, "foo2");
            jestExpect(fn).not[returnedWith](3, "foo3");
          }).toThrow();
        });

        test("should replace 1st, 2nd, 3rd with first, second, third", async () => {
          const fn = jest.fn<() => string>();
          fn.mockReturnValueOnce("foo1");
          fn.mockReturnValueOnce("foo2");
          fn.mockReturnValueOnce("foo3");
          fn();
          fn();
          fn();

          expect(() => {
            jestExpect(fn)[returnedWith](1, "bar1");
            jestExpect(fn)[returnedWith](2, "bar2");
            jestExpect(fn)[returnedWith](3, "bar3");
          }).toThrow();

          expect(() => {
            jestExpect(fn).not[returnedWith](1, "foo1");
            jestExpect(fn).not[returnedWith](2, "foo2");
            jestExpect(fn).not[returnedWith](3, "foo3");
          }).toThrow();
        });

        test("positive throw matcher error for n that is not positive integer", async () => {
          const fn = jest.fn(() => "foo");
          fn();

          expect(() => {
            jestExpect(fn)[returnedWith](0, "foo");
          }).toThrow();
        });

        test("should reject nth value greater than number of calls", async () => {
          const fn = jest.fn(() => "foo");
          fn();
          fn();
          fn();

          expect(() => {
            jestExpect(fn)[returnedWith](4, "foo");
          }).toThrow();
        });

        test("positive throw matcher error for n that is not integer", async () => {
          const fn = jest.fn<(a: string) => string>(() => "foo");
          fn("foo");

          expect(() => {
            jestExpect(fn)[returnedWith](0.1, "foo");
          }).toThrow();
        });

        test("negative throw matcher error for n that is not number", async () => {
          const fn = jest.fn<(a: string) => string>(() => "foo");
          fn("foo");

          expect(() => {
            // @ts-expect-error: Testing runtime error
            jestExpect(fn).not[returnedWith]();
          }).toThrow();
        });

        test("incomplete recursive calls are handled properly", () => {
          // sums up all integers from 0 -> value, using recursion
          const fn: jest.Mock<(value: number) => number> = jest.fn(value => {
            if (value === 0) {
              return 0;
            } else {
              const recursiveResult = fn(value - 1);

              if (value === 2) {
                // Only 2 of the recursive calls have returned at this point
                jestExpect(fn).not[returnedWith](1, 6);
                jestExpect(fn).not[returnedWith](2, 3);
                jestExpect(fn)[returnedWith](3, 1);
                jestExpect(fn)[returnedWith](4, 0);

                expect(() => jestExpect(fn)[returnedWith](1, 6)).toThrow();
                expect(() => jestExpect(fn)[returnedWith](2, 3)).toThrow();
                expect(() => jestExpect(fn).not[returnedWith](3, 1)).toThrow();
                expect(() => jestExpect(fn).not[returnedWith](4, 0)).toThrow();
              }

              return value + recursiveResult;
            }
          });

          fn(3);
        });
      });
    }

    if (isToHaveLast(returnedWith)) {
      describe("toHaveLastReturnedWith", () => {
        test("works with three calls", () => {
          const fn = jest.fn<() => string>();
          fn.mockReturnValueOnce("foo1");
          fn.mockReturnValueOnce("foo2");
          fn.mockReturnValueOnce("foo3");
          fn();
          fn();
          fn();

          jestExpect(fn)[returnedWith]("foo3");

          expect(() => {
            jestExpect(fn).not[returnedWith]("foo3");
          }).toThrow();
        });

        test("incomplete recursive calls are handled properly", () => {
          // sums up all integers from 0 -> value, using recursion
          const fn: jest.Mock<(value: number) => number> = jest.fn(value => {
            if (value === 0) {
              // Before returning from the base case of recursion, none of the
              // calls have returned yet.
              jestExpect(fn).not[returnedWith](0);
              expect(() => jestExpect(fn)[returnedWith](0)).toThrow();
              return 0;
            } else {
              return value + fn(value - 1);
            }
          });

          fn(3);
        });
      });
    }

    test("includes the custom mock name in the error message", () => {
      const fn = jest.fn().mockName("named-mock");

      if (isToHaveNth(returnedWith)) {
        jestExpect(fn).not[returnedWith](1, "foo");

        expect(() => jestExpect(fn)[returnedWith](1, "foo")).toThrow();
      } else {
        jestExpect(fn).not[returnedWith]("foo");

        expect(() => jestExpect(fn)[returnedWith]("foo")).toThrow();
      }
    });
  },
);
