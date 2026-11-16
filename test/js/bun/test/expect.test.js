// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/expect.test.js`
 *  `bunx vitest test/js/bun/test/expect.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/expect.test.js`
 */

import { stripVTControlCharacters } from "node:util";
// import these functions typed with the bun:test types,
// so this test can also be used to detect issues with the "bun:test" type definitions
import test_interop from "./test-interop.js";
var { isBun, test, it, describe, expect, jest, vi, mock, bunTest, spyOn } = await test_interop();
const isJest = !vi;
const isVitest = vi && !isBun;
const hasJestExtended = !isVitest;

const test_skipIf = (/** @type {boolean} */ cond) => (cond ? test.skip : test);

/** Helper function which just type-casts to any */
const ANY = (/** @type {any} */ arg) => arg;

/** `"passes"` or `"fails"`. An error that is not the failure of a matcher is thrown on. */
const outcomeOf = async (/** @type {() => unknown} */ assertion) => {
  try {
    await assertion();
    return "passes";
  } catch (error) {
    if (isBun && !stripVTControlCharacters(String(ANY(error)?.message)).startsWith("expect(received).")) throw error;
    return "fails";
  }
};

describe("expect()", () => {
  if (typeof Bun !== "undefined") {
    test("()", () => {
      const { withoutAggressiveGC } = require("harness");

      withoutAggressiveGC(() => {
        expect();

        for (let i = 0; i < 5000; i++) {
          expect();
        }
      });
    });
  }

  const expectFailure = (/** @type {() => unknown} */ asyncFn) => {
    return expect(async () => {
      try {
        await asyncFn();
      } catch (e) {
        throw new Error(stripVTControlCharacters(/** @type {any} */ (e).message));
      }
    });
  };
  describe("toBe()", () => {
    let obj = {};
    it.each([
      [0, 0.0],
      [+0, +0],
      [0, +0],
      [-0, -0],
      [1, 1],
      [1, 1.0],
      [NaN, NaN],
      [Infinity, Infinity],
      [obj, obj],
      [Symbol.for("a"), Symbol.for("a")],
    ])("expect(%p).toBe(%p) == true", (a, b) => {
      expect(a).toBe(b);
      expect(b).toBe(a);
    });
    it.each([
      [0, false],
      [0, ""],
      [0, -0],
      [+0, -0],
      [1, 2],
      [1, true],
      [1, "1"],
      [Infinity, -Infinity],
      ["foo", "Foo"],
      ["foo", "bar"],
      ["", " "],
      ["", " "],
      ["", true],
      [{}, {}], //
      [new Set(), new Set()], //
      [function a() {}, function a() {}], //
      [Symbol.for("a"), Symbol.for("b")],
      [Symbol("a"), Symbol("a")],
    ])("expect(%p).toBe(%p) == false", (a, b) => {
      expect(a).not.toBe(b);
      expect(b).not.toBe(a);
    });
  });

  test("rejects", async () => {
    await expect(Promise.reject(4)).rejects.toBe(4);
    await expect(Promise.reject(4)).rejects.not.toBe(5);
    await expect(Promise.reject(4.2)).rejects.toBeCloseTo(4.2, 5);
    await expect(Promise.reject(3)).rejects.not.toBeCloseTo(4.2, 5);
    await expect(Promise.reject({ a: 1, b: 2 })).rejects.toMatchObject({ a: 1 });
    await expect(Promise.reject({ a: 1, b: 2 })).rejects.not.toMatchObject({ c: 1 });
    await expect(Promise.reject(new Error("rejectMessage"))).rejects.toMatchObject({ message: "rejectMessage" });
    await expect(Promise.reject(new Error())).rejects.toThrow();

    // not receiving a rejected promise -> should throw
    if (isBun) {
      // Should fail with "Received promise resolved instead of rejected"
      await expectFailure(() => expect(Promise.resolve(4)).rejects.toBe(4)).toThrow();
      // Should fail with "Matcher error: received value must be a promise or a function returning a promise"
      await expectFailure(() => expect(4).rejects.toBe(4)).toThrow();
    }

    // Different task
    await expect(
      new Promise((_, reject) => {
        setTimeout(() => reject(1), 0);
      }),
    ).rejects.toBe(1);
  });

  test("resolves", async () => {
    await expect(Promise.resolve(4)).resolves.toBe(4);
    await expect(Promise.resolve(4)).resolves.not.toBe(5);
    await expect(Promise.resolve(4.2)).resolves.toBeCloseTo(4.2, 5);
    await expect(Promise.resolve(3)).resolves.not.toBeCloseTo(4.2, 5);
    await expect(Promise.resolve({ a: 1, b: 2 })).resolves.toMatchObject({ a: 1 });
    await expect(Promise.resolve({ a: 1, b: 2 })).resolves.not.toMatchObject({ c: 1 });
    await expect(
      Promise.resolve(() => {
        throw new Error();
      }),
    ).resolves.toThrow();
    await expect(Promise.resolve(new Error())).resolves.toThrow();

    // not receiving a resolved promise -> should throw
    if (isBun) {
      // @ts-expect-error: Should fail with "Received promise rejected instead of resolve"
      await expectFailure(() => expect(Promise.reject(4)).resolves.toBe(4)).toThrow();
      // Should fail with "Matcher error: received value must be a promise or a function returning a promise"
      await expectFailure(() => expect(4).resolves.toBe(4)).toThrow();
    }

    // Different task
    await expect(
      new Promise(resolve => {
        setTimeout(() => resolve(1), 0);
      }),
    ).resolves.toBe(1);
  });

  test("resolves.toThrow() on a value that is neither a function nor an error", async () => {
    const didNotThrow = isVitest
      ? "expected promise to throw an error, but it didn't"
      : "Received function did not throw";
    for (const value of [5, undefined, null, "text", { message: "text" }]) {
      await expect(Promise.resolve(value)).resolves.not.toThrow();
      await expect(Promise.resolve(value)).resolves.not.toThrow("text");
      await expect((async () => expect(Promise.resolve(value)).resolves.toThrow())()).rejects.toThrow(didNotThrow);
      await expect((async () => expect(Promise.resolve(value)).resolves.toThrow("text"))()).rejects.toThrow(
        didNotThrow,
      );
    }
  });

  describe("an expect() that is kept in a variable", () => {
    test(".not negates every time it is read", () => {
      const kept = expect(1);
      kept.not.toBe(2);
      kept.not.toBe(3);
      expect(() => kept.not.toBe(1)).toThrow();
      kept.not.toBe(4);

      const negated = expect(1).not;
      negated.toBe(2);
      negated.toBe(3);
      expect(() => negated.toBe(1)).toThrow();
    });

    test(".not negates after a matcher without it", () => {
      const kept = expect(1);
      kept.toBe(1);
      kept.not.toBe(2);
      kept.not.toBe(3);
    });

    test(".resolves.not and .rejects.not negate every time they are read", async () => {
      const resolves = expect(Promise.resolve(1)).resolves;
      await resolves.not.toBe(2);
      await resolves.not.toBe(3);
      await expect((async () => resolves.not.toBe(1))()).rejects.toThrow();

      const rejects = expect(Promise.reject(1)).rejects;
      await rejects.not.toBe(2);
      await rejects.not.toBe(3);
      await expect((async () => rejects.not.toBe(1))()).rejects.toThrow();
    });

    // Vitest replaces the promise in the kept expect() with what it resolved to, so the second .resolves throws.
    test_skipIf(isVitest)(".resolves and .rejects can be read again", async () => {
      const fulfilled = expect(Promise.resolve(1));
      await fulfilled.resolves.toBe(1);
      await fulfilled.resolves.not.toBe(2);
      await fulfilled.resolves.not.toBe(3);

      const rejected = expect(Promise.reject(1));
      await rejected.rejects.toBe(1);
      await rejected.rejects.not.toBe(2);
      await rejected.rejects.not.toBe(3);
    });

    test("a custom matcher sees isNot every time", () => {
      /** @type {boolean[]} */
      const seen = [];
      expect.extend({
        toRecordIsNot() {
          seen.push(this.isNot);
          return { pass: !this.isNot, message: () => "" };
        },
      });
      const kept = ANY(expect(1));
      kept.not.toRecordIsNot();
      kept.not.toRecordIsNot();
      expect(seen).toEqual([true, true]);
    });

    // Vitest reads .not after the matcher has run.
    test_skipIf(isVitest)(".not that is read while a matcher runs leaves that matcher alone", async () => {
      /** @type {any} */
      let kept;
      expect.extend({
        toAnswer(_received, /** @type {boolean} */ pass) {
          kept.not;
          return { pass, message: () => "expect(received).toAnswer()" };
        },
        async toAnswerLater(_received, /** @type {boolean} */ pass) {
          kept.not;
          await null;
          return { pass, message: () => "expect(received).toAnswerLater()" };
        },
      });
      const answer = (/** @type {boolean} */ pass) => ANY(expect).toAnswer(pass);
      const text = (/** @type {string} */ value) =>
        Object.assign(new String(value), { toString: () => (kept.not, value) });
      const called = jest.fn(() => 1);
      called(1);
      const resolved = jest.fn(async () => 1);
      await resolved();

      /** @type {Record<string, (pass: boolean) => unknown>} Each reads `kept.not`, and should pass if `pass` is true. */
      const rows = {
        toEqual: pass => (kept = expect(1)).toEqual(answer(pass)),
        toHaveBeenCalledWith: pass => (kept = expect(called)).toHaveBeenCalledWith(answer(pass)),
        toHaveBeenLastCalledWith: pass => (kept = expect(called)).toHaveBeenLastCalledWith(answer(pass)),
        toHaveBeenNthCalledWith: pass => (kept = expect(called)).toHaveBeenNthCalledWith(1, answer(pass)),
        toHaveReturnedWith: pass => (kept = expect(called)).toHaveReturnedWith(answer(pass)),
        toHaveLastReturnedWith: pass => (kept = expect(called)).toHaveLastReturnedWith(answer(pass)),
        toHaveNthReturnedWith: pass => (kept = expect(called)).toHaveNthReturnedWith(1, answer(pass)),
        "a then getter": pass =>
          (kept = expect({
            get then() {
              kept.not;
              return (/** @type {(value: boolean) => void} */ resolve) => resolve(pass);
            },
          })).resolves.toBe(true),
        "a received function": pass => (kept = expect(async () => (kept.not, pass))).resolves.toBe(true),
        "a received function that is pending": pass =>
          (kept = expect(async () => (kept.not, await null, pass))).resolves.toBe(true),
        ...(isBun && {
          toSatisfy: pass => (kept = expect(1)).toSatisfy(() => (kept.not, pass)),
          toStartWith: pass => (kept = expect("a")).toStartWith(text(pass ? "a" : "b")),
          toHaveBeenCalledExactlyOnceWith: pass =>
            (kept = expect(called)).toHaveBeenCalledExactlyOnceWith(answer(pass)),
          toHaveResolvedWith: pass => (kept = expect(resolved)).toHaveResolvedWith(answer(pass)),
          toHaveLastResolvedWith: pass => (kept = expect(resolved)).toHaveLastResolvedWith(answer(pass)),
          "pass and fail": pass => (kept = expect(1))[pass ? "pass" : "fail"](text("message")),
          "a matcher that waits": pass => (kept = expect(1)).toEqual(ANY(expect).toAnswerLater(pass)),
          "a custom matcher that waits": pass => (kept = expect(1)).toAnswerLater(pass),
        }),
      };

      for (const [name, run] of Object.entries(rows)) {
        expect({ name, true: await outcomeOf(() => run(true)), false: await outcomeOf(() => run(false)) }).toEqual({
          name,
          true: "passes",
          false: "fails",
        });
      }
    });

    test_skipIf(!isBun)(".not that is read while a matcher runs negates the next one", async () => {
      const kept = expect(1);
      kept.toSatisfy(() => (kept.not, true));
      kept.toBe(2);

      const resolves = expect(async () => (resolves.not, 1)).resolves;
      await resolves.toBe(1);
      await resolves.toBe(2);
    });

    test_skipIf(!isBun)(".resolves that is read while a matcher runs leaves that matcher alone", () => {
      const kept = expect("a");
      kept.toMatchInlineSnapshot(ANY(Object.assign(new String(), { toString: () => (kept.resolves, '"a"') })));
    });
  });

  // https://github.com/oven-sh/bun/issues/18857
  describe("resolves and rejects on a thenable", () => {
    /** @returns {PromiseLike<any>} */
    const thenable = (/** @type {"resolve" | "reject"} */ how, /** @type {unknown} */ value) => ({
      then(resolve, reject) {
        /** @type {any} */ (how === "resolve" ? resolve : reject)(value);
        return /** @type {any} */ (undefined);
      },
    });

    test("settles with what then() passes to its callbacks", async () => {
      await expect(thenable("resolve", "done")).resolves.toBe("done");
      await expect(thenable("resolve", 4)).resolves.not.toBe(5);
      await expect(thenable("resolve", { a: 1, b: 2 })).resolves.toMatchObject({ a: 1 });
      await expect(thenable("reject", 4)).rejects.toBe(4);
      await expect(thenable("reject", 4)).rejects.not.toBe(5);
      await expect(thenable("reject", new Error("thenable error"))).rejects.toThrow("thenable error");

      await expect({
        then(/** @type {(value: string) => void} */ resolve) {
          setTimeout(() => resolve("later"), 0);
        },
      }).resolves.toBe("later");
    });

    test("finds then() wherever a property lookup does", async () => {
      class Inherited {
        then(/** @type {(value: string) => void} */ resolve) {
          resolve("inherited");
        }
      }
      await expect(new Inherited()).resolves.toBe("inherited");
      await expect(Object.create(thenable("resolve", "prototype"))).resolves.toBe("prototype");
      await expect(
        new Proxy({}, { get: (_, key) => (key === "then" ? thenable("resolve", "proxy").then : undefined) }),
      ).resolves.toBe("proxy");
    });

    test("calls then() once, with the thenable as this", async () => {
      const then = jest.fn((/** @type {(value: string) => void} */ resolve) => resolve("called"));
      const value = { then };
      await expect(value).resolves.toBe("called");
      expect(then).toHaveBeenCalledTimes(1);
      expect(then.mock.contexts).toEqual([value]);
    });

    test_skipIf(!isBun)("fails when the thenable settles the other way, or then is not callable", async () => {
      await expectFailure(() => expect(thenable("resolve", 4)).rejects.toBe(4)).toThrow(
        "Expected promise that rejects\nReceived promise that resolved: {",
      );
      await expectFailure(() => expect(thenable("reject", 4)).resolves.toBe(4)).toThrow(
        "Expected promise that resolves\nReceived promise that rejected: {",
      );
      for (const value of [{ then: 4 }, { then: null }, { then: {} }, { a: 4 }, [], "then", 4, null, undefined]) {
        await expectFailure(() => expect(value).resolves.toBe(value)).toThrow("Expected promise\nReceived: ");
        await expectFailure(() => expect(value).rejects.toBe(value)).toThrow("Expected promise\nReceived: ");
      }
    });

    // Skipped on Jest, which calls then() directly instead of awaiting the thenable.
    test_skipIf(isJest)("adopts the thenable as await does", async () => {
      const error = new Error("thrown by then()");
      await expect({
        then() {
          throw error;
        },
      }).rejects.toBe(error);
      // Only the first call of either callback counts.
      await expect({
        then(/** @type {(value: number) => void} */ resolve, /** @type {(reason: number) => void} */ reject) {
          resolve(1);
          reject(2);
          resolve(3);
          throw error;
        },
      }).resolves.toBe(1);
      await expect(thenable("resolve", thenable("resolve", "nested"))).resolves.toBe("nested");
      await expect(thenable("resolve", thenable("reject", "nested"))).rejects.toBe("nested");
      await expect(thenable("resolve", Promise.resolve("promise"))).resolves.toBe("promise");
      await expect(thenable("reject", thenable("resolve", "not adopted"))).rejects.toHaveProperty("then");
      await expect(Object.assign(() => {}, thenable("resolve", "function"))).resolves.toBe("function");
    });

    test_skipIf(!isBun)("reads then once, and a getter that throws is a rejection", async () => {
      const get = jest.fn(() => thenable("resolve", "getter").then);
      await expect(Object.defineProperty({}, "then", { get })).resolves.toBe("getter");
      expect(get).toHaveBeenCalledTimes(1);

      const error = new Error("thrown by the getter");
      const throws = {
        get then() {
          throw error;
        },
      };
      await expect(throws).rejects.toBe(error);
      await expectFailure(() => expect(throws).resolves.toBe(1)).toThrow("Received promise that rejected");
    });

    test_skipIf(!isBun)("expect.resolvesTo and expect.rejectsTo", () => {
      expect({ a: thenable("resolve", "one") }).toEqual({ a: expect.resolvesTo.stringContaining("one") });
      expect({ a: thenable("reject", "two") }).toEqual({ a: expect.rejectsTo.stringContaining("two") });
      expect({ a: thenable("resolve", "one") }).not.toEqual({ a: expect.rejectsTo.stringContaining("one") });
      expect({ a: { then: 1 } }).not.toEqual({ a: expect.resolvesTo.anything() });
    });

    // Like Bun.$ and Bun.sql. Runs in a child process because the test timeout can't end the wait if one never starts.
    test_skipIf(!isBun)("a Promise subclass that starts its work in then()", async () => {
      const { bunEnv, bunExe } = require("harness");
      const src = `
        const { expect } = require("bun:test");
        class Lazy extends Promise {
          static get [Symbol.species]() {
            return Promise;
          }
          static create(how) {
            let start;
            const lazy = new Lazy((resolve, reject) => {
              start = () => (how === "resolve" ? resolve : reject)("started");
            });
            lazy.start = start;
            return lazy;
          }
          then(onFulfilled, onRejected) {
            this.start();
            return super.then(onFulfilled, onRejected);
          }
        }
        await expect(Lazy.create("resolve")).resolves.toBe("started");
        await expect(Lazy.create("reject")).rejects.toBe("started");
        await expect(Bun.$\`exit 0\`.quiet()).resolves.toMatchObject({ exitCode: 0 });
        await expect(Bun.$\`exit 7\`.quiet()).rejects.toMatchObject({ exitCode: 7 });
        console.log("ok");
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
        stdout: "ok\n",
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  test("resolves and rejects call then() of a pending Promise subclass", async () => {
    class Lazy extends Promise {
      thenCalls = 0;
      then(onFulfilled, onRejected) {
        this.thenCalls++;
        return super.then(onFulfilled, onRejected);
      }
    }
    for (const outcome of ["resolves", "rejects"]) {
      const { promise, resolve, reject } = Promise.withResolvers.call(Lazy);
      setTimeout(outcome === "resolves" ? resolve : reject, 0, 1);
      await expect(promise)[outcome].toBe(1);
      expect(promise.thenCalls).toBe(1);
    }

    const { promise, resolve } = Promise.withResolvers.call(Lazy);
    setTimeout(resolve, 0);
    await expect(() => promise).not.toThrow();
    expect(promise.thenCalls).toBe(1);
  });

  test("can call without an argument", () => {
    expect().toBe(undefined);
  });

  test("toStrictEqual() vs toEqual()", () => {
    expect([1, , 3]).toEqual([1, , 3]);
    expect({}).toEqual({});
    expect({}).toStrictEqual({});
    expect({}).toEqual({ a: undefined });
    expect({ a: undefined }).toEqual({});
    expect({}).not.toStrictEqual({ a: undefined });
    expect({ a: undefined }).not.toStrictEqual({});

    class C {
      hi = 34;
    }
    class D {
      hi = 34;
    }
    let c = new C();
    let d = new D();

    expect(d).toEqual(c);
    expect(d).not.toStrictEqual(c);
    // @ts-expect-error
    expect({ a: 1, b: undefined }).toEqual({ a: 1 });
    // @ts-expect-error
    expect({ a: 1 }).toEqual({ a: 1, b: undefined });
    expect({ a: 1, b: undefined }).toEqual({ a: 1, b: undefined });

    expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 });
    expect({ a: 1 }).not.toStrictEqual({ a: 1, b: undefined });
    expect({ a: 1, b: undefined }).toStrictEqual({ a: 1, b: undefined });

    expect({ a: 1, b: null }).not.toEqual({ a: 1 });
    expect({ a: 1 }).not.toEqual({ a: 1, b: null });
    expect({ a: 1, b: null }).toEqual({ a: 1, b: null });

    expect({ a: 1 }).not.toEqual({ a: true });
    expect({ a: 1 }).not.toEqual({ a: "1" });
    expect({ a: 1 }).not.toEqual({ a: 1, b: 2 });
    expect({ a: 1, b: 2 }).not.toEqual({ a: 1 });
    expect({ a: 1 }).not.toStrictEqual({ a: true });
    expect({ a: 1 }).not.toStrictEqual({ a: "1" });
    expect({ a: 1 }).not.toStrictEqual({ a: 1, b: 2 });
    expect({ a: 1, b: 2 }).not.toStrictEqual({ a: 1 });
    expect({ a: 1 }).toStrictEqual({ a: 1 });

    expect([1, undefined, 3]).toEqual([1, undefined, 3]);
    expect([1, undefined, 3]).toStrictEqual([1, undefined, 3]);
    expect([1, undefined, 3]).not.toEqual([1, 2, 3]);
    expect([1, undefined, 3]).not.toStrictEqual([1, 2, 3]);
    expect([1, undefined, 3]).not.toEqual([1, 2]);
    expect([1, undefined, 3]).not.toStrictEqual([1, 2]);
    expect([1, undefined, 3]).not.toEqual([1]);
    expect([1, undefined, 3]).not.toStrictEqual([1]);
    expect([1, undefined, 3]).not.toEqual([]);
    expect([1, undefined, 3]).not.toStrictEqual([]);
    expect([1, undefined, 3]).not.toEqual([1, 3]);
    expect([1, undefined, 3]).not.toStrictEqual([1, 3]);

    expect([1, null, 3]).toEqual([1, null, 3]);
    expect([1, null, 3]).toStrictEqual([1, null, 3]);
    expect([1, null, 3]).not.toEqual([1, 2, 3]);
    expect([1, null, 3]).not.toStrictEqual([1, 2, 3]);
    expect([1, null, 3]).not.toEqual([1, 2]);
    expect([1, null, 3]).not.toStrictEqual([1, 2]);
    expect([1, null, 3]).not.toEqual([1]);
    expect([1, null, 3]).not.toStrictEqual([1]);
    expect([1, null, 3]).not.toEqual([]);
    expect([1, null, 3]).not.toStrictEqual([]);
    expect([1, null, 3]).not.toEqual([1, 3]);
    expect([1, null, 3]).not.toStrictEqual([1, 3]);

    expect([, 1]).toEqual([, 1]);
    expect([, 1]).toStrictEqual([, 1]);
    expect([, 1]).not.toEqual([1]);
    expect([1]).not.toEqual([, 1]);
    expect([, 1]).not.toStrictEqual([1]);
    expect([1]).not.toStrictEqual([, 1]);
    expect([, 1]).toEqual([undefined, 1]);
    expect([, 1]).not.toStrictEqual([undefined, 1]);
    expect([, 1]).not.toEqual([null, 1]);
    expect([, 1]).not.toStrictEqual([null, 1]);
    expect([undefined, 1]).toEqual([, 1]);
    expect([undefined, 1]).not.toStrictEqual([, 1]);
    expect([null, 1]).not.toEqual([, 1]);
    expect([null, 1]).not.toStrictEqual([, 1]);
    expect([undefined, 1]).toEqual([undefined, 1]);
    expect([undefined, 1]).toStrictEqual([undefined, 1]);

    expect([0, , 2]).toEqual([0, undefined, 2]);
    expect([, "boo2"]).toEqual([undefined, "boo2"]);
    expect([, "boo"]).toEqual([, "boo"]);
    expect([, 1]).toEqual([undefined, 1]);

    const s1 = Symbol("test1");
    const s2 = Symbol("test2");

    let a = ANY({ a: 1, b: 2 });
    let b = ANY({ a: 1, b: 2 });
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = null;
    expect(a).not.toEqual(b);
    class F extends String {
      constructor() {
        super();
      }
    }

    let f = new F();
    let j = new String("hello");
    expect(f).not.toEqual(j);
    class LaCroix {
      constructor(/** @type {string} */ flavor) {
        this.flavor = flavor;
      }
    }
    expect(new LaCroix("pamplemousse")).not.toStrictEqual({
      flavor: "pamplemousse",
    });
    expect(new LaCroix("pamplemousse")).toEqual({ flavor: "pamplemousse" });

    expect([, 1]).not.toStrictEqual([undefined, 1]);

    expect([0, , 2]).toEqual([0, undefined, 2]);
    expect([, "boo2"]).toEqual([undefined, "boo2"]);
    expect([, "boo"]).toEqual([, "boo"]);
    expect([, 1]).toEqual([undefined, 1]);
  });

  describe("toEqual() with DOM types", () => {
    test("URLSearchParams", () => {
      expect(new URLSearchParams("a=1")).not.toEqual(new URLSearchParams("b=1"));
      expect(new URLSearchParams("a=1")).toEqual(new URLSearchParams("a=1"));
      expect(new URLSearchParams("a=1&b=2")).not.toEqual(new URLSearchParams("a=1&"));
    });

    if (isBun) {
      test("URL", () => {
        expect(new URL("https://example.com")).toEqual(new URL("https://example.com"));
        expect(new URL("http://wat")).not.toStrictEqual(new URL("http://huh"));
      });
    }

    test("Headers", () => {
      expect(new Headers({ "a": "1" })).toEqual(new Headers({ "a": "1" }));
      expect(new Headers({ "a": "1" })).not.toEqual(new Headers({ "b": "1" }));
      expect(new Headers({ "a": "1" })).not.toEqual(new Headers({ "a": "2" }));
      expect(new Headers({ "a": "1" })).not.toEqual(new Headers({ "a": "1", "b": "2" }));
    });

    // TODO: FormData
    // It would need to compare Blob, which is tricky.
  });

  describe("BigInt", () => {
    it("compares correctly (literal)", () => {
      expect(42n).toBe(42n);
    });

    it("compares correctly (object)", () => {
      expect(BigInt(42n)).toBe(BigInt(42n));
      expect(42n).toBe(BigInt(42n));
      if (isBun) expect(BigInt(Bun.inspect(42n).substring(0, 2))).toBe(BigInt(42n));
      expect(BigInt(42n).valueOf()).toBe(BigInt(42n));
    });
  });

  function f1() {
    return "hello!";
  }
  function f2() {
    return "hey!";
  }
  test("deepEquals regex", () => {
    expect(/a/imu).toEqual(/a/imu);
    expect(/a/imu).not.toEqual(/ab/imu);

    expect(new RegExp("s", "g")).toEqual(new RegExp("s", "g"));
    expect(new RegExp("s", "g")).not.toEqual(new RegExp("s", "i"));
  });

  test("deepEquals and deleted properties", () => {
    var obj1 = { a: 1 };
    var obj2 = {};
    expect(obj1).not.toStrictEqual(obj2);
    expect(obj2).not.toStrictEqual(obj1);
    expect(obj1).not.toEqual(obj2);
    expect(obj2).not.toEqual(obj1);
    delete obj1.a;
    expect(obj1).toStrictEqual(obj2);
    expect(obj2).toStrictEqual(obj1);
    expect(obj1).toEqual(obj2);
    expect(obj2).toEqual(obj1);

    var obj3 = { a: 1, b: 3, c: 4 };
    var obj4 = { a: 1, b: 3 };
    expect(obj3).not.toStrictEqual(obj4);
    expect(obj4).not.toStrictEqual(obj3);
    expect(obj3).not.toEqual(obj4);
    expect(obj4).not.toEqual(obj3);
    delete obj3.c;
    expect(obj3).toStrictEqual(obj4);
    expect(obj4).toStrictEqual(obj3);
    expect(obj3).toEqual(obj4);
    expect(obj4).toEqual(obj3);
    delete obj3.b;
    expect(obj3).not.toStrictEqual(obj4);
    expect(obj4).not.toStrictEqual(obj3);
    expect(obj3).not.toEqual(obj4);
    expect(obj4).not.toEqual(obj3);
    delete obj3.a;
    expect(obj3).not.toStrictEqual(obj4);
    expect(obj4).not.toStrictEqual(obj3);
    expect(obj3).not.toEqual(obj4);
    expect(obj4).not.toEqual(obj3);
    delete obj4.a;
    expect(obj3).not.toStrictEqual(obj4);
    expect(obj4).not.toStrictEqual(obj3);
    expect(obj3).not.toEqual(obj4);
    expect(obj4).not.toEqual(obj3);
    delete obj4.b;
    expect(obj3).toStrictEqual(obj4);
    expect(obj4).toStrictEqual(obj3);
    expect(obj3).toEqual(obj4);
    expect(obj4).toEqual(obj3);

    var obj5 = {};
    var obj6 = {};
    expect(obj5).toStrictEqual(obj6);
    expect(obj6).toStrictEqual(obj5);
    expect(obj5).toEqual(obj6);
    expect(obj6).toEqual(obj5);
    delete obj5.a;
    expect(obj5).toStrictEqual(obj6);
    expect(obj6).toStrictEqual(obj5);
    expect(obj5).toEqual(obj6);
    expect(obj6).toEqual(obj5);
    obj5.a = 1;
    expect(obj5).not.toStrictEqual(obj6);
    expect(obj6).not.toStrictEqual(obj5);
    expect(obj5).not.toEqual(obj6);
    expect(obj6).not.toEqual(obj5);
    obj6.a = 1;
    expect(obj5).toStrictEqual(obj6);
    expect(obj6).toStrictEqual(obj5);
    expect(obj5).toEqual(obj6);
    expect(obj6).toEqual(obj5);
    delete obj6.a;
    expect(obj5).not.toStrictEqual(obj6);
    expect(obj6).not.toStrictEqual(obj5);
    expect(obj5).not.toEqual(obj6);
    expect(obj6).not.toEqual(obj5);
    delete obj5.a;
    expect(obj5).toStrictEqual(obj6);
    expect(obj6).toStrictEqual(obj5);
    expect(obj5).toEqual(obj6);
    expect(obj6).toEqual(obj5);

    var obj7 = { a: 1, b: 1 };
    var obj8 = { b: 1 };
    expect(obj7).not.toStrictEqual(obj8);
    expect(obj8).not.toStrictEqual(obj7);
    expect(obj7).not.toEqual(obj8);
    expect(obj8).not.toEqual(obj7);
    delete obj7.a;
    expect(obj7).toStrictEqual(obj8);
    expect(obj8).toStrictEqual(obj7);
    expect(obj7).toEqual(obj8);
    expect(obj8).toEqual(obj7);
    delete obj7.b;
    expect(obj7).not.toStrictEqual(obj8);
    expect(obj8).not.toStrictEqual(obj7);
    expect(obj7).not.toEqual(obj8);
    expect(obj8).not.toEqual(obj7);
    delete obj8.b;
    expect(obj7).toStrictEqual(obj8);
    expect(obj8).toStrictEqual(obj7);
    expect(obj7).toEqual(obj8);
    expect(obj8).toEqual(obj7);
  });

  test("deepEquals and deleted indexes", () => {
    var a1 = [1];
    var a2 = [];
    expect(a1).not.toStrictEqual(a2);
    expect(a2).not.toStrictEqual(a1);
    expect(a1).not.toEqual(a2);
    expect(a2).not.toEqual(a1);
    delete a1[0];
    expect(a1).not.toStrictEqual(a2);
    expect(a2).not.toStrictEqual(a1);
    expect(a1).toEqual(a2);
    expect(a2).toEqual(a1);

    var a3 = [];
    var a4 = [];
    expect(a3).toStrictEqual(a4);
    expect(a4).toStrictEqual(a3);
    expect(a3).toEqual(a4);
    expect(a4).toEqual(a3);
    delete a3[0];
    expect(a3).toStrictEqual(a4);
    expect(a4).toStrictEqual(a3);
    expect(a3).toEqual(a4);
    expect(a4).toEqual(a3);
    a3[0] = 1;
    expect(a3).not.toStrictEqual(a4);
    expect(a4).not.toStrictEqual(a3);
    expect(a3).not.toEqual(a4);
    expect(a4).not.toEqual(a3);
    a4[0] = 1;
    expect(a3).toStrictEqual(a4);
    expect(a4).toStrictEqual(a3);
    expect(a3).toEqual(a4);
    expect(a4).toEqual(a3);
    delete a4[0];
    expect(a3).not.toStrictEqual(a4);
    expect(a4).not.toStrictEqual(a3);
    expect(a3).not.toEqual(a4);
    expect(a4).not.toEqual(a3);
    delete a3[0];
    expect(a3).toStrictEqual(a4);
    expect(a4).toStrictEqual(a3);
    expect(a3).toEqual(a4);
    expect(a4).toEqual(a3);
  });

  test("deepEquals works with accessors", () => {
    {
      let l1 = [1, undefined, 2];
      let l2 = [1, undefined, 2];
      Object.defineProperty(l1, 6, { get: () => 1 });
      Object.defineProperty(l2, 6, { get: () => 1 });
      expect(l1).toEqual(l2);
      expect(l1).toStrictEqual(l2);
    }
    {
      let l1 = [1, , 2];
      let l2 = [1, undefined, 2];
      Object.defineProperty(l1, 6, { get: () => 1 });
      Object.defineProperty(l2, 6, { get: () => 2 });
      expect(l1).toEqual(l2);
      expect(l1).not.toStrictEqual(l2);
    }
    {
      let l1 = [1, , 2];
      let l2 = [1, , 2];
      Object.defineProperty(l1, "hi", { get: () => 4 });
      Object.defineProperty(l2, "hi", { get: () => 5 });
      expect(l1).toEqual(l2);
      expect(l1).toStrictEqual(l2);
    }

    {
      let l1 = [1, , 2];
      let l2 = [1, , 2];
      Object.defineProperty(l1, "hi", { set: () => 4 });
      Object.defineProperty(l2, "hi", { set: () => 5 });
      expect(l1).toEqual(l2);
      expect(l1).toStrictEqual(l2);
    }

    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, 6, { get: () => 1 });
      Object.defineProperty(o2, 6, { get: () => 1 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, 6, { get: () => 1 });
      Object.defineProperty(o2, 6, { get: () => 2 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, "hi", { get: () => 4 });
      Object.defineProperty(o2, "hi", { get: () => 5 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, "hi", { set: () => 4 });
      Object.defineProperty(o2, "hi", { set: () => 5 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
  });

  test("deepEquals bugfix #11370", () => {
    // Two objects with equal number of properties, but left object has
    // undefined keys and right object has keys that don't exist
    // in left object.

    expect({ b: undefined }).not.toEqual({ a: 1 });
    expect({ b: 1 }).not.toEqual({ a: undefined });
    // @ts-expect-error
    expect({ b: undefined }).toEqual({ a: undefined });
    expect({ b: undefined }).not.toStrictEqual({ a: 1 });
    expect({ b: 1 }).not.toStrictEqual({ a: undefined });
    expect({ b: undefined }).not.toStrictEqual({ a: undefined });
    // @ts-expect-error
    expect({ c: undefined, a: 1, b: undefined }).toEqual({ a: 1 });
    // @ts-expect-error
    expect({ a: 1 }).toEqual({ c: undefined, a: 1, b: undefined });
    expect({ c: undefined, a: 1, b: undefined }).not.toStrictEqual({ a: 1 });
    // @ts-expect-error
    expect({ a: 1, b: undefined }).toEqual({ a: 1, c: undefined });
    // @ts-expect-error
    expect({ a: 1, c: undefined }).toEqual({ a: 1, b: undefined });
    expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1, c: undefined });
  });

  // Doesn't work on jest because of https://github.com/jestjs/jest/issues/10788
  if (isBun) {
    test("deepEquals works with proxies", () => {
      /** Helper identity function that just prevents implicit-any type errors */
      const _ = (/** @type {ProxyHandler<any>} */ arg) => arg;

      {
        let p1 = new Proxy({ a: 1, b: 2 }, {});
        let p2 = new Proxy({ a: 1, b: 2 }, {});
        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
        let p3 = new Proxy({ a: 1, b: 2 }, {});
        let p4 = new Proxy({ a: 1, b: 3 }, {});
        expect(p3).not.toEqual(p4);
        expect(p3).not.toStrictEqual(p4);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => t[k] });
        let p1 = new Proxy(t1, h1);
        let t2 = { a: 1, b: 2 };
        let h2 = _({ get: (t, k) => 0 });
        let p2 = new Proxy(t2, h2);
        expect(p1).not.toEqual(p2);
        expect(p1).not.toStrictEqual(p2);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => t[k] + 2 });
        let p1 = new Proxy(t1, h1);
        let t2 = { a: 1, b: 2 };
        let h2 = _({ get: (t, k) => t[k] + 2 });
        let p2 = new Proxy(t2, h2);
        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => t[k] + 2 });
        let p1 = new Proxy(t1, h1);
        let t2 = { a: 1, b: 2 };
        let h2 = _({ get: (t, k) => t[k] + 3 });
        let p2 = new Proxy(t2, h2);
        expect(p1).not.toEqual(p2);
        expect(p1).not.toStrictEqual(p2);
      }
      {
        // same handlers, different targets
        let t1 = { a: 1, b: 2 };
        let t2 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => t[k] + 2 });
        let p1 = new Proxy(t1, h1);
        let p2 = new Proxy(t2, h1);
        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
      }
      {
        // same targets, different handlers
        let t1 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => t[k] + 2 });
        let h2 = _({ get: (t, k) => t[k] + 3 });
        let p1 = new Proxy(t1, h1);
        let p2 = new Proxy(t1, h2);
        expect(p1).not.toEqual(p2);
        expect(p1).not.toStrictEqual(p2);
      }
      {
        // property with object
        let t1 = { a: { b: 3 } };
        let h1 = _({ get: (t, k) => t[k] });
        let p1 = new Proxy(t1, h1);

        let t2 = { a: { b: 3 } };
        let h2 = _({ get: (t, k) => t[k] });
        let p2 = new Proxy(t2, h2);

        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);

        let t3 = { a: { b: 3 } };
        let h3 = _({ get: (t, k) => t[k] });
        let p3 = new Proxy(t3, h3);

        let t4 = { a: { b: 4 } };
        let h4 = _({ get: (t, k) => t[k] });
        let p4 = new Proxy(t4, h4);

        expect(p3).not.toEqual(p4);
        expect(p3).not.toStrictEqual(p4);
      }
      {
        // proxy object equals itself
        let t1 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => t[k] + 2 });
        let p1 = new Proxy(t1, h1);
        expect(p1).toEqual(p1);
        expect(p1).toStrictEqual(p1);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = _({ get: (t, k) => k });
        let p1 = new Proxy(t1, h1);

        let t2 = { a: 1, b: 2 };
        let h2 = _({ get: (t, k) => k });
        let p2 = new Proxy(t2, h2);

        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
      }
    });

    // JSC::isArray() can throw for a Proxy (revoked, or with a throwing trap), so
    // expect.any(Array), toMatchObject, and toHaveProperty must check for an
    // exception right after it. A missing check aborts a debug build under
    // BUN_JSC_validateExceptionChecks=1 (a no-op on release builds).
    test("expect.any(Array)/toMatchObject/toHaveProperty check the isArray() exception for Proxy values", async () => {
      const { bunEnv, bunExe } = require("harness");
      const src = `
        const { expect } = require("bun:test");
        try { expect(new Proxy({}, {})).toEqual(expect.any(Array)); } catch {}
        try { expect(new Proxy([], {})).toEqual(expect.any(Array)); } catch {}
        try { expect(new Proxy([], {})).toMatchObject([]); } catch {}
        try { expect([]).toMatchObject(new Proxy([], {})); } catch {}
        try { expect(new Proxy([], {})).toMatchObject(new Proxy([], {})); } catch {}
        try { expect({ a: 1 }).toHaveProperty(new Proxy(["a"], {})); } catch {}
        try { expect({ a: 1 }).toHaveProperty(new Proxy(new Set(["a"]), {})); } catch {}
        const rp = Proxy.revocable({}, {}); rp.revoke();
        try { expect(rp.proxy).toEqual(expect.any(Array)); } catch {}
        console.log("ok");
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
        stdout: "ok\n",
        exitCode: 0,
        signalCode: null,
      });
    });
  }

  test("deepEquals works with sets/maps/dates/strings", () => {
    const f = Symbol.for("foo");

    let a = new Set();
    a.add([1, 2, 3]);
    a.add("hello");
    a.add({ a: 1 });
    a.add(89);

    let b = new Set();
    b.add(89);
    b.add({ a: 1 });
    b.add("hello");
    b.add([1, 2, 3]);

    expect(a).toEqual(b);
    expect(b).toEqual(a);
    expect(b).toEqual(b);

    let obj = {};
    var c = new Set();
    obj.c = c;
    obj.x = obj;
    c.add(obj);
    expect(obj).toEqual(obj);

    let o1 = { a: new Set() };
    o1.a.add(o1);
    expect(o1).toEqual(o1);

    let o2 = new Set();
    let o3 = {};
    o3.x = o3;
    o2.add(o3);
    expect(o2).toEqual(o2);

    var d = new Date();
    var e = new Date(d);
    ANY(e)[f] = "hello";

    expect(d).toEqual(e);
    expect(e).toEqual(d);

    class Date2 extends Date {
      constructor() {
        // @ts-ignore
        super(...arguments);
      }
    }

    class Date3 extends Date2 {
      constructor() {
        super(...arguments);
      }
    }

    let d2 = new Date2();
    let e2 = new Date(d2);
    ANY(d2)[f] = "hello";
    expect(d2).toEqual(e2);
    expect(e2).toEqual(d2);

    let d3 = new Date3();
    let e3 = new Date(d3);
    ANY(d3)[f] = "hello";
    expect(d3).toEqual(e3);
    expect(e3).toEqual(d3);

    let d4 = new Date();
    let e4 = new Date3(d4);
    ANY(d4)[f] = "hello";
    expect(d4).toEqual(e4);
    expect(e4).toEqual(d4);

    let d5 = new Date2();
    let e5 = new Date3(d5);
    ANY(d5)[f] = "hello";
    expect(d5).toEqual(e5);
    expect(e5).toEqual(d5);

    expect(new String("a")).not.toEqual(new String("b"));

    var s1 = new String("a");
    var s2 = new String("a");
    ANY(s1)[f] = "hello";
    expect(s1).toEqual(s2);

    class String2 extends String {
      constructor() {
        super(...arguments);
      }
    }

    class String3 extends String2 {
      constructor() {
        super(...arguments);
      }
    }

    let string4 = {};
    string4.__proto__ = String3.prototype;

    var s3 = new String2("a");
    var s4 = new String2("a");
    ANY(s3)[f] = "hello";
    expect(s3).toEqual(s4);

    var s5 = new String("a");
    var s6 = new String3("a");
    expect(s6).not.toEqual(s5);
    expect(s5).not.toEqual(s6);

    var s7 = new String2("a");
    var s8 = new String3("a");
    expect(s7).not.toEqual(s8);
    expect(s8).not.toEqual(s7);

    var s9 = new String2("a");
    // @ts-ignore
    var s10 = new string4.constructor("a");
    expect(s9).not.toEqual(s10);
    expect(s10).not.toEqual(s9);

    class F2 extends Function {}
    class F3 extends F2 {}

    var f1 = new Function();
    var f2 = new F2();
    var f3 = new F3();
    expect(f1).not.toEqual(f2);
    expect(f2).not.toEqual(f1);
    expect(f2).not.toEqual(f3);
    expect(f3).not.toEqual(f2);
  });

  describe("deepEquals with asymmetric matchers", () => {
    it("should accept any string", () => {
      expect({ name: "alice" }).toEqual({ name: expect.any(String) });
      expect({ name: "bob" }).toEqual({ name: expect.any(String) });
      expect({ name: "charlie" }).toEqual({ name: expect.any(String) });
    });

    it("should accept any number", () => {
      expect({ age: 42 }).toEqual({ age: expect.any(Number) });
      expect({ age: 69 }).toEqual({ age: expect.any(Number) });
      expect({ age: 73 }).toEqual({ age: expect.any(Number) });
    });

    it("should accept any boolean", () => {
      expect({ active: false }).toEqual({ active: expect.any(Boolean) });
      expect({ active: true }).toEqual({ active: expect.any(Boolean) });
    });

    it("should not match the wrong constructors", () => {
      function f() {
        return 32;
      }
      Object.defineProperty(f, "name", { value: "String" });
      expect({ a: "123" }).toEqual({ a: expect.any(String) });
      expect({ a: "123" }).not.toEqual({ a: expect.any(f) });

      function g() {
        return 32;
      }
      Object.defineProperty(g, "name", { value: "BigInt" });
      expect({ a: 123n }).toEqual({ a: expect.any(BigInt) });
      expect({ a: 123n }).not.toEqual({ a: expect.any(g) });
    });

    it("gives a matcher undefined for an element that the other array does not have", () => {
      const seen = [];
      expect.extend({
        toBeRecorded(value) {
          seen.push(value);
          return { pass: false, message: () => "" };
        },
      });
      const matchers = [
        expect.stringContaining("a"),
        expect.stringMatching(/a/),
        expect.any(String),
        expect.any(Symbol),
        expect.any(BigInt),
        expect.any(Boolean),
        expect.any(Number),
        expect.any(Array),
        expect.any(Object),
        expect.any(Promise),
        expect.any(Date),
        expect.anything(),
        expect.arrayContaining([1]),
        expect.objectContaining({ a: 1 }),
        expect.closeTo(1),
        // @ts-expect-error
        expect.toBeRecorded(),
      ];
      for (const matcher of matchers) {
        expect([,]).not.toEqual([matcher]);
        expect([[,]]).not.toEqual(expect.arrayContaining([[matcher]]));
        expect({ a: [["x"]] }).not.toMatchObject({ a: expect.arrayContaining([["x", matcher]]) });
      }
      expect([,]).toEqual([expect.not.stringContaining("a")]);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter(value => value !== undefined)).toEqual([]);
    });

    it("gives a matcher the value of a getter at an index", () => {
      const array = [1];
      Object.defineProperty(array, 1, { get: () => "x", enumerable: true });
      expect(array).toEqual([1, expect.anything()]);
      expect(array).toEqual([1, expect.any(String)]);
      expect(array).toEqual([1, expect.stringContaining("x")]);
      expect(array).not.toEqual([1, expect.stringContaining("y")]);
      expect([array]).toEqual(expect.arrayContaining([[1, expect.stringContaining("x")]]));
    });

    if (isBun) {
      it("does not crash on an element that the other array does not have", async () => {
        const { bunEnv, bunExe } = require("harness");
        const src = `
          import { expect } from "bun:test";
          const getter = Object.defineProperty([], 0, { get: () => "x", enumerable: true });
          for (const matcher of [expect.stringContaining("a"), expect.any(String), expect.arrayContaining([1])]) {
            try { expect([,]).toEqual([matcher]); } catch {}
            try { expect([]).toEqual(expect.arrayContaining([[matcher]])); } catch {}
            try { expect(getter).toEqual([matcher]); } catch {}
            try { expect({ a: [["x"]] }).toMatchObject({ a: expect.arrayContaining([["x", matcher]]) }); } catch {}
          }
          console.log("ok");
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", src],
          env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
          stdout: "ok\n",
          exitCode: 0,
          signalCode: null,
        });
      });
    }
  });

  test.each([[undefined], [0], [400], [NaN], [Infinity], [-Infinity]])(
    "toBeCloseTo() compares the signs of infinities, precision %p",
    precision => {
      for (const infinity of [Infinity, -Infinity]) {
        expect(infinity).toBeCloseTo(infinity, precision);
        expect(() => expect(infinity).not.toBeCloseTo(infinity, precision)).toThrow(
          isBun ? /Received difference: (\x1b\[31m)?0\b/ : undefined,
        );
        expect(infinity).not.toBeCloseTo(-infinity, precision);
        expect(() => expect(infinity).toBeCloseTo(-infinity, precision)).toThrow(
          isBun ? /Received difference: (\x1b\[31m)?inf\b/ : undefined,
        );
      }
    },
  );

  test("toThrow() leaves a promise that was rejected before the call to whoever handles it", async () => {
    const handledInTheCall = Promise.reject(new Error("handled in the call"));
    expect(() => void handledInTheCall.catch(() => {})).not.toThrow();

    const handledAfterTheCall = Promise.reject(new Error("handled after the call"));
    expect(() => {}).not.toThrow();
    expect(() => expect(() => {}).not.toThrow()).not.toThrow();
    await expect(handledAfterTheCall).rejects.toThrow("handled after the call");
  });

  test("toThrow asymmetric matchers", () => {
    expect(() => {
      const err = new Error("foo");
      err.code = "ERR_BAR";
      throw err;
    }).toThrow(expect.objectContaining({ code: "ERR_BAR" }));

    expect(() => {
      const err = new TypeError("foo");
      err.code = "ERR_BAZ";
      throw err;
    }).not.toThrow(expect.objectContaining({ code: "ERR_BAR", name: "TypeError" }));

    expect(() => {
      const err = new TypeError("foo");
      err.code = "ERR_BAZ";
      throw err;
    }).toThrow(expect.objectContaining({ code: "ERR_BAZ", name: "TypeError" }));

    expect(() => {
      const err = new TypeError("foo");
      err.code = "ERR_BAZ";
      throw err;
    }).toThrow(expect.objectContaining({ code: "ERR_BAZ", name: "TypeError" }));
  });

  test_skipIf(!isBun)("toThrow(expected) and .not.toThrow(expected) can both fail", async () => {
    const outcomes = async (/** @type {unknown} */ thrown, /** @type {RegExp} */ expected) => {
      const thrower = () => {
        throw thrown;
      };
      return {
        toThrow: await outcomeOf(() => expect(thrower).toThrow(expected)),
        notToThrow: await outcomeOf(() => expect(thrower).not.toThrow(expected)),
      };
    };
    expect({
      thrownWithoutMessage: await outcomes({ code: 1 }, /undefined/),
      regExpWithoutTest: await outcomes(new Error("foo"), Object.assign(/foo/, { test: undefined })),
    }).toEqual({
      thrownWithoutMessage: { toThrow: "fails", notToThrow: "fails" },
      regExpWithoutTest: { toThrow: "fails", notToThrow: "fails" },
    });
  });

  test("toThrow", () => {
    expect(() => {
      throw new Error("hello");
    }).toThrow("hello");

    var err = new Error("bad");
    expect(() => {
      throw err;
    }).toThrow(err);

    expect(() => {
      throw new Error("good");
    }).toThrow();

    expect(() => {
      throw new Error("foo");
    }).toThrow(/oo/);

    expect(() =>
      expect(() => {
        throw new Error("bar");
      }).toThrow(/baz/),
    ).toThrow("/baz/");

    // If matching the message against the RegExp throws, that error propagates
    // instead of being read as the match result.
    for (const not of [false, true]) {
      const re = /bar/;
      re.test = () => {
        throw new Error("from test()");
      };
      expect(() => {
        const e = expect(() => {
          throw new Error("bar");
        });
        (not ? e.not : e).toThrow(re);
      }).toThrow("from test()");
    }

    expect(() => {
      return true;
    }).not.toThrow();

    expect(() => {
      return true;
    }).not.toThrow(err);

    const weirdThings = [
      () => /watttt/g,
      () => BigInt(123),
      () => -42,
      () => NaN,
      () => Infinity,
      () => -Infinity,
      () => undefined,
      () => null,
      () => true,
      () => false,
      () => 0,
      () => 1,
      () => "",
      () => "hello",
      () => {},
      () => [],
      () => new Date(),
      () => new Error(),
      () => new RegExp("foo"),
      () => new Map(),
      () => new Set(),
      () => Promise.resolve(),
      vi && (() => Promise.reject(Symbol("123"))), // on jest it causes an UnhandledPromiseRejection
      () => Symbol("123"),
    ];
    for (const weirdThing of weirdThings) {
      if (weirdThing) {
        expect(() => {
          throw weirdThing();
        }).toThrow();
      }
    }

    if (!isJest) {
      err.message = "null";
      expect(() => {
        throw null;
      }).toThrow(err);
    }
  });

  if (isBun) {
    test(".not.toThrow(Class) reports a thrown string, symbol or BigInt that Symbol.hasInstance accepts", async () => {
      const { bunEnv, bunExe } = require("harness");
      const src = `
        import { expect } from "bun:test";
        class Anything {
          static [Symbol.hasInstance]() {
            return true;
          }
        }
        const report = async run => {
          try {
            await run();
            console.log("passed");
          } catch (e) {
            console.log(e.message.split("\\n").filter(Boolean).slice(1).join(" | "));
          }
        };
        const thrower = thrown => () => {
          throw thrown;
        };
        for (const thrown of ["boom", Symbol("boom"), 10n ** 30n, {}, { message: "an object" }, new TypeError("an error")]) {
          await report(() => expect(thrower(thrown)).not.toThrow(Anything));
        }
        await report(() => expect(Promise.reject("boom")).rejects.not.toThrow(Anything));
        await report(() => expect(thrower("boom")).not.toThrow(RangeError));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.split("\n"), stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
        stdout: [
          'Expected constructor: not Anything | Received value: "boom"',
          "Expected constructor: not Anything | Received value: Symbol(boom)",
          "Expected constructor: not Anything | Received value: 1000000000000000000000000000000n",
          "Expected constructor: not Anything | Received value: {}",
          'Expected constructor: not Anything | Received message: "an object"',
          'Expected constructor: not Anything | Received message: "an error"',
          'Expected constructor: not Anything | Received value: "boom"',
          "passed",
          "",
        ],
        exitCode: 0,
        signalCode: null,
      });
    });
  }

  test("deepEquals derived strings and strings", () => {
    let a = new String("hello");
    let b = "hello";
    expect(a).toEqual(a);
    expect(b).toEqual(b);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    class F extends String {
      constructor() {
        super();
      }
    }

    let f = new F();
    expect(f).toEqual(f);
    expect(f).not.toEqual(b);
    expect(b).not.toEqual(f);

    let j = new String("hello");
    expect(f).not.toEqual(j);

    class G extends String {
      constructor() {
        super();
        this.x = 0;
      }
    }

    let g = new G();
    expect(g).not.toEqual(f);
    expect(f).not.toEqual(g);
    expect(g).toEqual(g);
    expect(g).not.toEqual(b);
    expect(b).not.toEqual(g);
    expect(g).not.toEqual(a);
  });

  test("deepEquals and typed arrays", () => {
    expect(new Uint8Array([0, 255])).not.toEqual(new Uint8ClampedArray([0, 255]));
    expect(new Int8Array([0, -1])).not.toEqual(new Uint8Array([0, 255]));
    expect(new Float32Array([0])).not.toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  test("deepEquals throw getters", () => {
    let a = {
      get x() {
        throw new Error("a");
      },
    };

    let b = {
      get x() {
        return 3;
      },
    };

    try {
      expect(a).not.toEqual(b);
    } catch (e) {
      expect(ANY(e).message).toContain("a");
    }

    class B {
      get x() {
        throw new Error("b");
      }
    }

    class C {
      get x() {
        return 3;
      }
    }

    expect(() => {
      expect(new B()).not.toEqual(new C());
    }).toThrow();

    let o = [
      {
        get x() {
          throw new Error("c");
        },
      },
    ];

    let p = [
      {
        get x() {
          return 3;
        },
      },
    ];

    try {
      expect(o).not.toEqual(p);
    } catch (e) {
      expect(ANY(e).message).toContain("c");
    }

    const s = Symbol("s");
    let q = {
      get x() {
        throw new Error("d");
      },
    };
    ANY(q)[s] = 3;

    let r = {
      get x() {
        return 3;
      },
    };
    ANY(r)[s] = 3;

    try {
      expect(q).not.toEqual(r);
    } catch (e) {
      expect(ANY(e).message).toContain("d");
    }
  });

  test("deepEquals large object", () => {
    let o = ANY({});
    for (let i = 0; i < 65; i++) {
      o["bun" + i] = i;
    }
    expect(o).toEqual(o);
    let b = ANY({});
    for (let i = 0; i < 63; i++) {
      b["bun" + i] = i;
    }
    expect(b).toEqual(b);
    expect(o).not.toEqual(b);
    expect(b).not.toEqual(o);

    let c = { d: [Array(o)] };
    let d = { d: [Array(b)] };
    expect(c).toEqual(c);
    expect(d).toEqual(d);
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);

    let e = { d: [Array(o), Array(o)] };
    let f = { d: [Array(b), Array(b)] };
    expect(e).toEqual(e);
    expect(f).toEqual(f);
    expect(e).not.toEqual(f);
    expect(f).not.toEqual(e);

    let p = ANY([]);
    p[0] = {};
    for (let i = 0; i < 1000; i++) {
      p[0]["bun" + i] = i;
    }
    let q = ANY([]);
    q[0] = {};
    for (let i = 0; i < 1000; i++) {
      q[0]["bun" + i] = i;
    }
    expect(p).toEqual(p);
    expect(q).toEqual(q);

    q[0].bun789 = 788;
    expect(p).not.toEqual(q);
    expect(q).not.toEqual(p);

    let r = ANY({ d: {} });
    let s = ANY({ d: {} });
    for (let i = 0; i < 1000; i++) {
      r.d["bun" + i] = i;
      s.d["bun" + i] = i;
    }

    expect(r).toEqual(r);
    expect(s).toEqual(s);

    r.d.bun790 = 791;
    expect(r).not.toEqual(s);
    expect(s).not.toEqual(r);

    let t = ANY([]);
    t[5] = {};
    let u = ANY([]);
    u[5] = {};
    for (let i = 0; i < 1000; i++) {
      t[5]["bun" + i] = i;
    }
    for (let i = 0; i < 30; i++) {
      u[5]["bun" + i] = i;
    }
    expect(t).toEqual(t);
    expect(u).toEqual(u);
    expect(t).not.toEqual(u);
    expect(u).not.toEqual(t);

    let v = ANY({ j: {} });
    let w = ANY({ j: {} });
    for (let i = 0; i < 1000; i++) {
      v.j["bun" + i] = i;
      w.j["bun" + i] = i;
    }

    expect(v).toEqual(v);
    expect(w).toEqual(w);

    v.j.bun999 = 1000;
    expect(v).not.toEqual(w);
    expect(w).not.toEqual(v);
    expect(v).toEqual(v);

    v.j.bun999 = 999;
    w.j.bun0 = 1;
    expect(v).not.toEqual(w);
    expect(w).not.toEqual(v);
    expect(v).toEqual(v);
    expect(w).toEqual(w);
  });

  // Allocation-heavy by design (GC stress for #14256); measured at ~4 minutes
  // under a debug+ASAN build, far past the 5s default per-test timeout.
  test("deepEquals Set/Map stress test", () => {
    const arr1 = [];
    const arr2 = [];
    const arr3 = [];
    const arr4 = [];

    for (let i = 0; i < 150; i++) {
      arr1[i] = [i];
      arr2[i] = [i];
      arr3[i] = [i, [i]];
      arr4[i] = [i, [i]];
    }

    for (let i = 0; i < 2000; i++) {
      let outerSet = new Set(arr1);
      let innerSet = new Set(arr2);
      Bun.deepEquals(outerSet, innerSet);
    }

    for (let i = 0; i < 1000; i++) {
      let outerMap = new Map(arr3);
      let innerMap = new Map(arr4);
      Bun.deepEquals(outerMap, innerMap);
    }
  }, 480_000);

  test("deepEquals - Date", () => {
    let d = new Date();
    expect(d).toEqual(d);
    let b = d;
    expect(b).toEqual(d);
    d.setFullYear(1998);
    expect(b).toEqual(d);
    expect(b).not.toEqual(new Date());

    var date = new Date();
    date.setFullYear(1995);
    expect(new Date()).not.toEqual(date);
  });

  test("deepEquals toString and functions", () => {
    expect({ toString: f1 }).toEqual({
      toString: f1,
    });
    expect({ toString: f1 }).not.toEqual({
      toString: f2,
    });

    expect(f1).toEqual(f1);
    expect(f1).not.toEqual(f2);
  });

  test("deepEquals set and map", () => {
    let e = new Map();
    e.set("a", 1);
    e.set("b", 2);
    e.set("c", 3);
    e.set(8, 6);

    let d = new Map();
    d.set("a", 1);
    d.set("b", 2);
    d.set("c", 3);
    d.set(8, 6);

    expect(e).toEqual(d);
    expect(d).toEqual(e);

    let f = new Map();
    f.set("a", 1);
    f.set("b", 2);
    f.set("c", 3);
    f.set(8, 7);
    expect(e).not.toEqual(f);

    let g = new Map();
    g.set({ a: { b: { c: 89 } } }, 1);

    let h = new Map();
    h.set({ a: { b: { c: 89 } } }, 1);
    expect(g).toEqual(h);

    let i = new Map();
    i.set({ a: { b: { c: 89 } } }, 1);
    i.set({ a: { b: { c: 89 } } }, 1);
    expect(g).not.toEqual(i);

    let j = new Map();
    j.set({ a: { b: { c: 89 } } }, 1);
    j.set({ a: { b: { c: 89 } } }, 1);
    expect(i).toEqual(j);

    let p = new Map();
    p.set({ a: { b: { c: 90 } } }, 1);
    expect(p).not.toEqual(g);

    let q = new Map();
    q.set({ a: { b: { c: 90 } } }, { a: { b: 45 } });

    let r = new Map();
    r.set({ a: { b: { c: 90 } } }, { a: { b: 45 } });
    expect(q).toEqual(r);

    let s = new Map();
    s.set({ a: { b: { c: 90 } } }, { a: { b: 49 } });
    expect(q).not.toEqual(s);

    const u = { a: 1, b: 2 };

    let a = new Set();
    a.add({ a: 1 });
    a.add([1, 2, 3]);
    a.add("hello");
    a.add(89);

    let b = new Set();
    b.add({ a: 1 });
    b.add("hello");
    b.add([1, 2, 3]);
    b.add(89);
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    let c = new Set();
    c.add(89);
    c.add("hello");
    c.add({ a: 1 });
    c.add([1, 2, 3, 4]);
    expect(a).not.toEqual(c);
  });

  test("deepEquals - symbols", () => {
    const x = [5, 6];
    x[99] = 7;

    const y = [5, 6];
    y[99] = 7;

    expect(x).toEqual(y);

    const s1 = Symbol("test1");
    const s2 = Symbol("test2");

    /** @type {any} */
    const o = { a: 1 };
    o[s1] = 45;
    o[99] = 99;
    o[s2] = 3;

    /** @type {any} */
    const k = { a: 1 };
    k[99] = 99;
    k[s2] = 3;
    k[s1] = 45;

    expect(o).toEqual(k);
  });

  test("deepEquals should not segfault", () => {
    const obj = { ...Object.fromEntries(Object.entries([1, 2, 3, 4])), length: 4 };
    expect(() => {
      expect(obj).toEqual([1, 2, 3, 4]);
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect([1, 2, 3, 4]).toEqual(obj);
    }).toThrow();
  });

  test_skipIf(isJest)("deepEquals URLs", () => {
    const equals = [
      [
        [new URL("https://example.com"), new URL("https://example.com")],
        [new URL("https://example.com"), new URL("https://example.com/")],
        [Object.fromEntries(Object.entries(new URL("https://example.com"))), new URL("https://example.com/")],
      ],
    ];
    const not = [
      [new URL("https://example.com"), new URL("https://example.com/1")],
      [new URL("https://example.com"), new URL("https://example.com/1")],
    ];

    for (let [first, second] of equals) {
      expect(first).toEqual(second);
      expect(second).toEqual(first);

      expect(first).toStrictEqual(second);
      expect(second).toStrictEqual(first);
    }

    for (let [first, second] of not) {
      expect(first).not.toEqual(second);
      expect(second).not.toEqual(first);

      expect(first).not.toStrictEqual(second);
      expect(second).not.toStrictEqual(first);
    }

    expect(Object.fromEntries(Object.entries(new URL("https://example.com")))).not.toStrictEqual(
      new URL("https://example.com/"),
    );
  });

  test("toEqual objects and arrays", () => {
    {
      let obj = { 0: 4, 1: 3, length: 2 };
      expect(Array.from(obj)).toEqual([4, 3]);
      expect(Array.from(obj)).toStrictEqual([4, 3]);
    }
    {
      let obj = { 0: 4, 1: 3, length: 4 };
      expect(Array.from(obj)).toEqual([4, 3]);
      expect(Array.from(obj)).not.toStrictEqual([4, 3]);
      // @ts-expect-error
      expect(Array.from(obj)).toEqual([4, 3, undefined, undefined]);
      // @ts-expect-error
      expect(Array.from(obj)).toStrictEqual([4, 3, undefined, undefined]);
      // @ts-expect-error
      expect(Array.from(obj)).toEqual([4, 3, , ,]);
      expect(Array.from(obj)).not.toStrictEqual([4, 3, , ,]);
    }
    {
      let a1 = [1, undefined, 3, , 4, null];
      let a2 = [1, undefined, 3, , 4, null, , ,];
      expect(a1).toEqual(a2);
      expect(a1).not.toStrictEqual(a2);
      expect(a2).toEqual(a1);
      expect(a2).not.toStrictEqual(a1);
    }
    {
      let a1 = [, , , , , , , , , , , ,];
      let a2 = [undefined];
      expect(a1).toEqual(a2);
      expect(a1).not.toStrictEqual(a2);
      expect(a2).toEqual(a1);
      expect(a2).not.toStrictEqual(a1);
    }
    {
      const a = [1];
      const b = [1];
      expect(a).toEqual(b);
      Object.preventExtensions(b);
      expect(a).toEqual(b);
      Object.preventExtensions(a);
      expect(a).toEqual(b);
    }
    {
      let o1 = { 1: 4, 6: 3 };
      let o2 = { 1: 4, 6: 3 };
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { 1: 4, 6: 2 };
      let o2 = { 1: 4, 6: 3 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, 3: 0 };
      let o2 = { a: 1, 3: 0 };
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: 1, 3: 0 };
      let o2 = { a: 1, 3: 1 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }
    {
      let o1 = { a: {}, 4: { b: 3, c: { 9: 2 } } };
      let o2 = { a: {}, 4: { b: 3, c: { 9: 2 } } };
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: {}, 4: { b: 3, c: { 9: 2 } } };
      let o2 = { a: {}, 4: { b: 3, c: { 9: 3 } } };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, b: 2, c: 3 };
      let o2 = { a: 1, b: 2, c: 3, 0: 1 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, b: 2, c: 3, 0: 1 };
      let o2 = { a: 1, b: 2, c: 3 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    expect("hello").toEqual("hello");
    const s1 = Symbol("test1");
    const s2 = Symbol("test2");

    expect({ a: 1, b: 2 }).toEqual({ b: 2, a: 1 });
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect({ a: 1, b: 2 }).not.toEqual({ b: 2, a: 1, c: 3 });
    expect([1, 2, 3]).not.toEqual([1, 2, 3, 4]);
    expect({ a: 1, b: 2, c: 3 }).not.toEqual({ a: 1, b: 2 });
    expect([1, 2, 3, 4]).not.toEqual([1, 2, 3]);

    /** @type {any} */ let a;
    /** @type {any} */ let b;
    /** @type {any} */ let c;
    /** @type {any} */ let d;

    a = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    b = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    a[0].a = 2;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    c = { [Symbol("test")]: 1 };
    d = { [Symbol("test")]: 1 };
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);

    a = { [s1]: 1 };
    a[s1] = 1;
    b = { [s2]: 1 };
    b[s2] = 1;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 2;
    expect(a).not.toEqual(b);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 2;
    expect(a).toEqual(b);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 3;
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = { a: 2, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    expect(a).not.toEqual(b);

    // do the same tests for arrays
    a = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    b = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    a[0].a = 2;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 2;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 2;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 3;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = [2, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    expect(a).not.toEqual(b);

    // do the same tests for objects and arrays with null and undefined
    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = undefined;
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = null;
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = null;
    expect(a).toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = undefined;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = undefined;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = null;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = null;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = undefined;
    expect(a).toEqual(b);

    // similar tests for indexed objects
    a = { 0: 1, 1: 2, 2: 3 };
    b = { 0: 1, 1: 2, 2: 3 };
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = { 0: 1, 1: 2, 2: 3 };
    b = { 0: 1, 1: 2, 2: 3 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 3;
    expect(a).not.toEqual(b);

    a = { 0: 1, 1: 3, 2: 3 };
    b = { 0: 1, 1: 2, 2: 3 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 2;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3, 4];
    expect(a).not.toEqual(b);

    a = [1, 2, 3, 4];
    b = [1, 2, 3];
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2, c: 3 };
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2, c: 3 };
    b = { a: 1, b: 2 };
    expect(a).not.toEqual(b);

    const array1 = [1, 2, 3];
    expect(array1).toEqual(expect.arrayContaining([]));
    expect(array1).toEqual(expect.arrayContaining([1, 2]));
    expect(array1).not.toEqual(expect.arrayContaining([1, 2, 4]));

    const array2 = [{ a: 1, b: 2 }, { a: { a: 1 } }];
    expect(array2).toEqual(expect.arrayContaining([{ a: 1, b: 2 }]));
    expect(array2).toEqual(expect.arrayContaining([{ a: { a: 1 } }]));
    expect(array2).not.toEqual(expect.arrayContaining([{ a: 2, b: 3 }]));
  });

  test("toEqual ArrayBuffer with SharedArrayBuffer", () => {
    const ab1 = new SharedArrayBuffer(1);
    expect(ab1).toEqual(new SharedArrayBuffer(1));
    expect(ab1).not.toEqual(new ArrayBuffer(1));
  });

  test("toEqual detached ArrayBuffer is not equal to a zero-length ArrayBuffer", () => {
    function detached() {
      const buf = new ArrayBuffer(4);
      buf.transfer();
      return buf;
    }
    expect(detached()).not.toEqual(new ArrayBuffer(0));
    expect(detached()).not.toEqual(detached());
    expect(detached()).not.toStrictEqual(new ArrayBuffer(0));
    expect({ x: detached() }).not.toEqual({ x: new ArrayBuffer(0) });
  });

  test("symbol based keys in arrays are processed correctly", () => {
    const mySymbol = Symbol("test");

    /** @type {any} */
    const actual1 = [];
    actual1[mySymbol] = 3;

    /** @type {any} */
    const actual2 = [];
    actual2[mySymbol] = 4;

    /** @type {any} */
    const expected = [];
    expected[mySymbol] = 3;

    expect(actual2).not.toEqual(expected);
    expect(actual1).toEqual(expected);
  });

  test("non-enumerable members should be skipped during equal", () => {
    const actual = {
      x: 3,
    };
    Object.defineProperty(actual, "test", {
      enumerable: false,
      value: 5,
    });
    expect(actual).toEqual({ x: 3 });
  });

  test("non-enumerable symbolic members should be skipped during equal", () => {
    const actual = {
      x: 3,
    };
    const mySymbol = Symbol("test");
    Object.defineProperty(actual, mySymbol, {
      enumerable: false,
      value: 5,
    });
    expect(actual).toEqual({ x: 3 });
  });

  test("properties with the same circularity are equal", () => {
    const a = {};
    a.x = a;
    const b = {};
    b.x = b;
    expect(a).toEqual(b);
    expect(b).toEqual(a);

    const c = {
      x: a,
    };
    const d = {
      x: b,
    };

    expect(d).toEqual(c);
    expect(c).toEqual(d);
  });

  test("toEqual() - arrays", () => {
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect([1, 2, 3, 4]).not.toEqual([1, 2, 3]);
  });

  test("toEqual() - private class fields", () => {
    class A {
      #three = 3;
      set three(value) {
        this.#three = value;
      }

      get three() {
        return this.#three;
      }
    }

    class B {
      #three = 3;
      set three(value) {
        this.#three = value;
      }

      get three() {
        return this.#three;
      }
    }

    let a1 = new A();
    let a2 = new A();
    a1.three = 4;
    expect(a1).toEqual(a2);
    expect(a2).toEqual(a1);

    let a3 = ANY(new A());
    let a4 = ANY(new A());
    a3.three = 4;
    // use indexed properties for slow path
    a3[1] = 2;
    a4[1] = 2;
    expect(a3).toEqual(a4);
    expect(a4).toEqual(a3);

    let b1 = ANY(new B());
    let a5 = ANY(new A());
    expect(b1).toEqual(a5);
    expect(a5).toEqual(b1);

    b1.three = 4;
    expect(b1).toEqual(a5);
    expect(a5).toEqual(b1);

    b1[1] = 2;
    expect(b1).not.toEqual(a5);
    expect(a5).not.toEqual(b1);

    a5[1] = 2;
    expect(b1).toEqual(a5);
    expect(a5).toEqual(b1);
  });

  test("properties with different circularity are not equal", () => {
    const a = {};
    a.x = { y: a };
    const b = {};
    const bx = {};
    b.x = bx;
    bx.y = bx;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    const c = {};
    c.x = a;
    const d = {};
    d.x = b;
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);
  });

  test("are not equal if circularity is not on the same property", () => {
    const a = {};
    const b = {};
    a.a1 = a;
    b.a1 = {};
    b.a1.a1 = a;

    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    const c = {};
    c.x = { x: c };
    const d = {};
    d.x = d;

    expect(d).not.toEqual(c);
    expect(c).not.toEqual(d);
  });

  test("random isEqual tests", () => {
    expect(1).toEqual(1);
    expect(1).not.toEqual(2);
    expect(1).not.toEqual("1");
    expect(1).not.toEqual(true);
    expect(1).not.toEqual(false);
    expect(1).not.toEqual(null);
    expect(1).not.toEqual(undefined);
    expect(1).not.toEqual({});
    expect(1).not.toEqual([]);
    expect(1).not.toEqual([1]);
    expect(1).not.toEqual([1, 2]);
    expect(1).not.toEqual([1, 2, 3]);
    expect(1).not.toEqual([1, 2, 3, 4]);
    expect(1).not.toEqual([1, 2, 3, 4, 5]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // test toEquals for objects with getters and setters

    expect([]).toEqual([]);
    expect([1]).toEqual([1]);
    expect([1, 2]).toEqual([1, 2]);
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect({}).toEqual({});
    expect({}).not.toEqual([]);
    expect([]).not.toEqual({});

    const obj = {
      get a() {
        return 1;
      },
    };
    expect(obj).toEqual({ a: 1 });
    expect({ a: 1 }).toEqual(obj);
    expect(obj).not.toEqual({ a: 2 });
    expect({ a: 2 }).not.toEqual(obj);

    {
      let a = new Set();
      a.add([1, 2, 3]);
      a.add("hello");
      a.add({ a: 1 });
      a.add(89);
      let b = new Set();
      b.add(89);
      b.add({ a: 1 });
      b.add("hello");
      b.add([1, 2, 3]);
      expect(a).toEqual(b);
      expect(b).toEqual(a);
      let c = new Set();
      c.add(89);
      c.add("helo");
      c.add({ a: 1 });
      c.add([1, 2, 3]);
      expect(a).not.toEqual(c);
    }

    {
      let a = new Map();
      a.set(1, 89);
      a.set("hello", 2);
      a.set({ a: 1 }, 3);
      a.set([1, 2, 3], 4);
      let b = new Map();
      b.set(1, 89);
      b.set("hello", 2);
      b.set({ a: 1 }, 3);
      b.set([1, 2, 3], 4);
      expect(a).toEqual(b);
      expect(b).toEqual(a);
      let c = new Map();
      c.set({ a: 1 }, 3);
      c.set(1, 80);
      c.set([1, 2, 3], 4);
      c.set("hello", 2);
      expect(a).not.toEqual(c);
    }

    {
      let a = new Set();
      a.add(89);
      a.add("hello");
      a.add({ a: 1 });
      a.add([1, 2, 3]);
      a.add(a);
      let b = new Set();
      b.add(89);
      b.add("hello");
      b.add(b);
      b.add({ a: 1 });
      b.add([1, 2, 3]);
      expect(a).toEqual(b);
      expect(b).toEqual(a);
    }
  });
  test("toHaveProperty() - emojis", () => {
    expect({ "👍": "thumbs up" }).toHaveProperty("👍", "thumbs up");
    expect({ "👩‍👩‍👧‍👧": "family" }).toHaveProperty("👩‍👩‍👧‍👧", "family");
    expect({ "😶‍🌫️": "fog" }).toHaveProperty("😶‍🌫️", "fog");
    expect({ "👩‍❤️‍👨": "couple" }).toHaveProperty("👩‍❤️‍👨", "couple");
    expect({ "👩‍❤️‍👨‍👨‍👧‍👧": "family" }).toHaveProperty("👩‍❤️‍👨‍👨‍👧‍👧", "family");
    expect({ "👩‍❤️‍👨‍👨‍👧": "family" }).toHaveProperty("👩‍❤️‍👨‍👨‍👧", "family");
    expect({ "👩‍❤️‍👨‍👨‍👧": "family" }).not.toHaveProperty("👩‍❤️‍👨‍👨‍👧‍👧", "family");

    // emojis in array
    expect(["👍", "👎"]).toHaveProperty("0", "👍");
    expect(["👍", "👎"]).toHaveProperty("1", "👎");
    expect(["👍", "👎"]).not.toHaveProperty("0", "👎");
    expect(["👍", "👎"]).not.toHaveProperty("1", "👍");
    expect(["👩‍❤️‍👨‍👨‍👧‍👧"]).toHaveProperty("0", "👩‍❤️‍👨‍👨‍👧‍👧");
    expect(["👩‍❤️‍👨‍👨‍👧‍👧"]).toHaveProperty([0], "👩‍❤️‍👨‍👨‍👧‍👧");
    expect(["😶‍🌫️"]).toHaveProperty([0], "😶‍🌫️");
  });

  test("toHaveProperty() - dot and bracket notation edge cases", () => {
    expect({ a: 1 }).not.toHaveProperty(".");
    expect({ a: 1 }).not.toHaveProperty("]");
    expect({ a: 1 }).not.toHaveProperty("[");
    expect({ a: 1 }).not.toHaveProperty("[]");
    expect({ a: 1 }).not.toHaveProperty("[[]]");
    expect({ a: 1 }).not.toHaveProperty("[[");
    expect({ a: 1 }).not.toHaveProperty("]]");
    expect({ a: 1 }).not.toHaveProperty("[]]");
    expect({ a: 1 }).not.toHaveProperty("[[]");
    expect({ a: 1 }).not.toHaveProperty(".]");
    expect({ a: 1 }).not.toHaveProperty(".[");
    expect({ "": 1 }).toHaveProperty("[.", 1);
    expect({ a: 1 }).not.toHaveProperty("[.");
    expect({ a: 1 }).not.toHaveProperty("].");
    expect({ a: 1 }).not.toHaveProperty("].[");
    expect({ a: 1 }).not.toHaveProperty("].]");
    expect({ a: 1 }).not.toHaveProperty("[.]");
    expect({ a: 1 }).not.toHaveProperty("[.[");

    expect([1]).toHaveProperty("[0]", 1);
    expect([1]).toHaveProperty("[0][", 1);
    expect([1]).toHaveProperty("[0]]", 1);
    expect([1]).toHaveProperty("[0][[", 1);
    expect([1]).toHaveProperty("[][[[0]", 1);
    expect([1]).toHaveProperty("[][[[]][[][][.0", 1);
    expect([1]).toHaveProperty("[][[[]][[][][.[][[][[[][][0", 1);
    expect([1]).not.toHaveProperty("......1.............", 1);
    expect([1]).not.toHaveProperty("......0.............", 1);
    expect([1]).not.toHaveProperty(".0", 1);
    expect([1]).not.toHaveProperty("0.", 1);
    expect([{ "": 1 }]).toHaveProperty("0.", 1);
    expect({ "": { "": 1 } }).toHaveProperty(".", 1);
    expect({ "": { "": { "": 1 } } }).toHaveProperty("..", 1);
    expect({ "": { "": { "": 1 } } }).not.toHaveProperty(".", 1);
    expect({ "": { "": { "": 1 } } }).not.toHaveProperty("...", 1);
    expect({ "": { "": { "": 1 } } }).not.toHaveProperty("....", 1);
    expect([1]).toHaveProperty("0.[[[][][]][[[][[]]]]", 1);
    expect([1]).not.toHaveProperty("[0].", 1);
    expect([1]).toHaveProperty("0", 1);
    expect([1]).toHaveProperty("[].0", 1);
    expect([1]).toHaveProperty("[.0", 1);
    expect([1]).toHaveProperty("].0", 1);
    expect([1]).toHaveProperty("0[]][[[]", 1);
    expect([1]).toHaveProperty("[[]][[[][][0", 1);
    expect([1]).toHaveProperty("0", 1);
    expect([1]).toHaveProperty("0.[", 1);
    expect([1]).not.toHaveProperty("0........[", 1);
    expect([1]).not.toHaveProperty("0..[", 1);
    expect([1]).not.toHaveProperty(".0", 1);
    expect([1]).toHaveProperty("[].0", 1);
    expect([1]).not.toHaveProperty("[]..0", 1);
    expect([1]).toHaveProperty("[.][.[[.]]]]].[.[].].]]]]].].].0", 1);
    expect([1]).not.toHaveProperty("[.][.[[.]]]]].[.[].].]]0]]].].].", 1);
    expect([1]).toHaveProperty("[.][.[[.]]]]].[.[].].]]0]]].].]", 1);
    expect([1]).not.toHaveProperty("[.][.[[..]]]]].[.[].].]]0]]].].]", 1);
    expect([1]).toHaveProperty("[.][.[[.]]]]].[.[].].0.]]]]].].]", 1);
    expect([1]).not.toHaveProperty("[.][.[[.]]]]].[.[].].0.]]] ]].].]", 1);
    expect([1]).not.toHaveProperty("0      ", 1);
    expect([1]).not.toHaveProperty("   0      ", 1);
    expect([1]).not.toHaveProperty("   0[]      ", 1);
    expect([1]).not.toHaveProperty("   0]      ", 1);
    expect([1]).not.toHaveProperty(" .[0]", 1);

    expect({ "": 1 }).not.toHaveProperty(".", 1);
    expect({ "": 1 }).not.toHaveProperty("]", 1);
    expect({ "": 1 }).not.toHaveProperty("[", 1);
    expect({ "": 1 }).toHaveProperty("", 1);

    expect({ "": 1 }).not.toHaveProperty("..", 1);
    expect({ "": { "": 1 } }).not.toHaveProperty("..", 1);
    expect([{ "": 1 }]).toHaveProperty("0.", 1);
    expect([{ "": 1 }]).not.toHaveProperty(".0.", 1);
    expect({ "": [1] }).toHaveProperty(".0", 1);
    expect({ "": [1] }).not.toHaveProperty("..0", 1);
    expect([{ "": 1 }]).not.toHaveProperty("0..", 1);
    expect([{ "": { "": 1 } }]).toHaveProperty("0..", 1);

    expect([1]).not.toHaveProperty("[0].", 1);
    expect([1]).not.toHaveProperty("[0][0]", 1);
    expect({ a: [1] }).toHaveProperty("a[[[[[[[[[0]]]", 1);
    expect({ "[[[": 0 }).not.toHaveProperty("[[[", 0);
  });

  test.each([undefined, null])("toHaveProperty() - the path goes on below a property that is %p", end => {
    for (const [object, path] of [
      [{ a: end }, "a.b"],
      [{ a: end }, "a.b.c"],
      [{ a: end }, "a[0]"],
      [{ a: end }, "a."],
      [{ a: end }, "a..b"],
      [{ "": end }, ".b"],
      [{ a: end }, ["a", "b"]],
      [{ a: { b: end } }, "a.b.c"],
      [{ a: [end] }, "a[0].b"],
      [Object.create({ a: end }), "a.b"],
    ]) {
      expect(object).not.toHaveProperty(path);
      expect(object).not.toHaveProperty(path, undefined);
      expect(() => expect(object).toHaveProperty(path)).toThrow("Unable to find property");
    }
    expect({ a: end }).toHaveProperty("a", end);
    expect({ a: { b: end } }).toHaveProperty("a.b", end);
  });

  test("toHaveProperty() - with string or array", () => {
    const a = new Array(["a", "b", "c"]);
    expect(a).toHaveProperty("0.1", "b");
    const b = new Array("a", "b", "c");
    expect({ a: { b: { c: 1 } } }).toHaveProperty(b);
    const c = {
      a: { b: 1 },
      "a.b": 2,
    };
    const d = new Array("a.b");
    expect(c).toHaveProperty(d, 2);
    const houseForSale = {
      bath: true,
      bedrooms: 4,
      kitchen: {
        amenities: ["oven", "stove", "washer"],
        area: 20,
        wallColor: "white",
        "nice.oven": true,
      },
      livingroom: {
        amenities: [
          {
            couch: [
              ["large", { dimensions: [20, 20] }],
              ["small", { dimensions: [10, 10] }],
            ],
          },
        ],
      },
      sunroom: "yes",
      "ceiling.height": 20,
      "entrance.window": 3,
      entrance: { window: 5 },
    };
    expect(houseForSale).toHaveProperty("entrance.window", 5);
    expect(houseForSale).toHaveProperty(["entrance", "window"], 5);
    expect(houseForSale).toHaveProperty(["entrance.window"], 3);
    expect(houseForSale).toHaveProperty("bath");
    expect(houseForSale).not.toHaveProperty("jacuzzi");
    // expect(houseForSale).toHaveProperty("jacuzzi");
    // expect(houseForSale).not.toHaveProperty("bath");
    expect(houseForSale).toHaveProperty("bath", true);
    expect(houseForSale).not.toHaveProperty("bath", false);
    // expect(houseForSale).toHaveProperty("bath", false);
    // expect(houseForSale).not.toHaveProperty("bath", true);
    expect(houseForSale).toHaveProperty("bedrooms", 4);
    expect(houseForSale).toHaveProperty(["sunroom"], "yes");
    expect(houseForSale).toHaveProperty("kitchen.area", 20);
    expect(houseForSale).toHaveProperty("kitchen.amenities", ["oven", "stove", "washer"]);
    expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 21);
    expect(houseForSale).toHaveProperty(["kitchen", "area"], 20);
    expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 29);
    expect(houseForSale).toHaveProperty(["kitchen", "amenities"], ["oven", "stove", "washer"]);
    expect(houseForSale).toHaveProperty("kitchen.amenities[2]", "washer");
    expect(houseForSale).toHaveProperty(["kitchen", "amenities", 1], "stove");
    expect(houseForSale).toHaveProperty(["kitchen", "amenities", 0], "oven");
    expect(houseForSale).toHaveProperty("livingroom.amenities[0].couch[0][1].dimensions[0]", 20);
    expect(houseForSale).toHaveProperty(["kitchen", "nice.oven"]);
    expect(houseForSale).not.toHaveProperty(["kitchen", "open"]);
    expect(houseForSale).toHaveProperty(["ceiling.height"], 20);
    expect({ a: { b: 1 } }).toHaveProperty("a.b");
    expect({ a: [2, 3, 4] }).toHaveProperty("a.0");
    expect({ a: [2, 3, 4] }).toHaveProperty("a.1");
    expect({ a: [2, 3, 4] }).toHaveProperty("a.2");
    expect({ a: [2, 3, 4] }).toHaveProperty("a[1]");
    expect([2, 3, 4]).toHaveProperty("1");
    expect([2, 3, 4]).toHaveProperty("[1]");
    expect([2, [6, 9], 4]).toHaveProperty("1.1");
    expect([2, [6, 9], 4]).toHaveProperty("1[1]");
    expect([2, [6, 9], 4]).toHaveProperty("[1].1");
    expect([2, [6, 9], 4]).toHaveProperty("[1][1]");
    expect([2, [6, 9], 4]).toHaveProperty([0], 2);
    expect({ a: { b: 1 } }).toHaveProperty("a.b");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a.2.1.b");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a[2][1].b");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a[2][1]");
    expect({ a: [1, 2, [3, { b: 1 }]] }).not.toHaveProperty("a[2][1].c");
    expect("test").toHaveProperty("length");
    expect({}).toHaveProperty("constructor");
    expect({}).toHaveProperty("constructor.name");
    expect({}).toHaveProperty("constructor.name", "Object");
    expect(new Date()).toHaveProperty("getTime");
  });

  test("toHaveProperty() - all", () => {
    expect({ a: 1 }).toHaveProperty("a");
    expect({ a: 1 }).toHaveProperty("a", 1);
    expect({ a: 1 }).not.toHaveProperty("b");
    expect({ a: 1 }).not.toHaveProperty("a", 2);

    // test with object with property "a" with all types of values (including undefined)
    expect({ a: undefined }).toHaveProperty("a");
    expect({ a: null }).toHaveProperty("a");
    expect({ a: 0 }).toHaveProperty("a");
    expect({ a: false }).toHaveProperty("a");
    expect({ a: "" }).toHaveProperty("a");
    expect({ a: {} }).toHaveProperty("a");
    expect({ a: [] }).toHaveProperty("a");
    expect({ a: () => {} }).toHaveProperty("a");

    // test with object with property "a" with all types of values (including undefined)
    expect({ a: undefined }).toHaveProperty("a", undefined);
    expect({ a: null }).toHaveProperty("a", null);
    expect({ a: 0 }).toHaveProperty("a", 0);
    expect({ a: false }).toHaveProperty("a", false);
    expect({ a: "" }).toHaveProperty("a", "");
    expect({ a: {} }).toHaveProperty("a", {});
    expect({ a: [] }).toHaveProperty("a", []);
    expect({ a: () => {} }).not.toHaveProperty("a", () => {});

    // test with object with property "a" with all types of values (including undefined)

    expect({ a: undefined }).not.toHaveProperty("a", null);
    expect({ a: null }).not.toHaveProperty("a", undefined);
    expect({ a: 0 }).not.toHaveProperty("a", null);
    expect({ a: false }).not.toHaveProperty("a", null);
    expect({ a: "" }).not.toHaveProperty("a", null);
    expect({ a: {} }).not.toHaveProperty("a", null);
    expect({ a: [] }).not.toHaveProperty("a", null);
    expect({ a: () => {} }).not.toHaveProperty("a", null);

    expect({ a: undefined }).not.toHaveProperty("a", 0);
    expect({ a: null }).not.toHaveProperty("a", 0);
    expect({ a: 0 }).not.toHaveProperty("a", 1);
    expect({ a: false }).not.toHaveProperty("a", 0);
    expect({ a: "" }).not.toHaveProperty("a", 0);
    expect({ a: {} }).not.toHaveProperty("a", 0);
    expect({ a: [] }).not.toHaveProperty("a", 0);
    expect({ a: () => {} }).not.toHaveProperty("a", 0);

    expect({ a: undefined }).not.toHaveProperty("a", false);
    expect({ a: null }).not.toHaveProperty("a", false);
    expect({ a: 0 }).not.toHaveProperty("a", false);
    expect({ a: false }).not.toHaveProperty("a", true);
    expect({ a: "" }).not.toHaveProperty("a", false);
    expect({ a: {} }).not.toHaveProperty("a", false);
    expect({ a: [] }).not.toHaveProperty("a", false);
    expect({ a: () => {} }).not.toHaveProperty("a", false);

    expect({ a: undefined }).not.toHaveProperty("a", "");
    expect({ a: null }).not.toHaveProperty("a", "");
    expect({ a: 0 }).not.toHaveProperty("a", "");
    expect({ a: false }).not.toHaveProperty("a", "");
    expect({ a: "" }).not.toHaveProperty("a", "a");
    expect({ a: {} }).not.toHaveProperty("a", "");
    expect({ a: [] }).not.toHaveProperty("a", "");
    expect({ a: () => {} }).not.toHaveProperty("a", "");

    expect({ a: undefined }).not.toHaveProperty("a", {});
    expect({ a: null }).not.toHaveProperty("a", {});
    expect({ a: 0 }).not.toHaveProperty("a", {});
    expect({ a: false }).not.toHaveProperty("a", {});
    expect({ a: "" }).not.toHaveProperty("a", {});
    expect({ a: {} }).not.toHaveProperty("a", { a: 1 });
    expect({ a: [] }).not.toHaveProperty("a", {});
    expect({ a: () => {} }).not.toHaveProperty("a", {});

    // test object with property "a" with value set, map, string
    // @ts-expect-error
    expect({ a: new Map([{ a: 1 }, { b: 2 }, { c: 3 }]) }).toHaveProperty("a", new Map([{ c: 3 }, { b: 2 }, { a: 1 }]));
    expect({ a: new Set([1, 2, 3]) }).toHaveProperty("a", new Set([3, 2, 1]));
    expect({ a: new String("a") }).toHaveProperty("a", new String("a"));
    expect({ a: new String("a") }).not.toHaveProperty("a", "a");
    expect({ a: new String("a") }).not.toHaveProperty("a", "b");
    expect({ a: new String("a") }).not.toHaveProperty("a", new String("b"));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Number(1));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Boolean(true));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Boolean(false));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Object());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Function());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Date());
    expect({ a: new String("a") }).not.toHaveProperty("a", new RegExp("."));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Error());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Promise(() => {}));
    expect({ a: new String("a") }).not.toHaveProperty("a", new WeakSet());
    expect({ a: new String("a") }).not.toHaveProperty("a", new WeakMap());
    expect({ a: new String("a") }).not.toHaveProperty("a", Symbol("a"));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Int8Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint8Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint8ClampedArray());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Int16Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint16Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Int32Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint32Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Float32Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Float64Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new BigInt64Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new BigUint64Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new ArrayBuffer(1));
    expect({ a: new String("a") }).not.toHaveProperty("a", new SharedArrayBuffer(1));
    expect({ a: new String("a") }).not.toHaveProperty("a", new DataView(new ArrayBuffer(1)));

    // test property equality with sets, maps, objects, arrays, and String
    // @ts-expect-error
    expect({ a: new Map([{ a: 1 }, { b: 2 }, { c: 3 }]) }).toHaveProperty("a", new Map([{ a: 1 }, { b: 2 }, { c: 3 }]));
    expect({ a: new Set([1, 2, 3]) }).toHaveProperty("a", new Set([1, 2, 3]));
    expect({ a: { a: 1, b: 2, c: 3 } }).toHaveProperty("a", { a: 1, b: 2, c: 3 });
    expect({ a: [1, 2, 3] }).toHaveProperty("a", [1, 2, 3]);
    expect({ a: "a" }).toHaveProperty("a", "a");
    expect({ a: new String("a") }).toHaveProperty("a", new String("a"));
    expect({ a: new String("a") }).not.toHaveProperty("a", "a");
  });

  test.todo("toHaveProperty() - null or undefined", () => {
    expect(() => expect(null).toHaveProperty("length")).toThrow();
    expect(() => expect(null).not.toHaveProperty("length")).toThrow();
    expect(() => expect(undefined).toHaveProperty("length")).toThrow();
    expect(() => expect(undefined).not.toHaveProperty("length")).toThrow();
  });

  test("matchers treat a missing argument as undefined", () => {
    expect(undefined).toBe();
    expect(1).not.toBe();
    expect(undefined).toEqual();
    expect(undefined).toStrictEqual();
    expect([undefined]).toContain();
    expect([1]).not.toContain();
    expect([undefined]).toContainEqual();
    expect({ undefined: 1 }).toContainKey();
    expect({ a: undefined }).toContainValue();
    expect(1).toBeCloseTo(1, undefined);
    expect().pass(undefined);
    expect().not.fail(undefined);
    for (const name of ["if", "skipIf", "todoIf", "failingIf", "concurrentIf", "serialIf"]) {
      expect(test[name]()).toBeFunction();
    }

    const results = [];
    expect.extend({
      toCallEqualsWithOneArgument(received) {
        results.push(this.equals(received));
        return { pass: true, message: () => "" };
      },
    });
    expect(undefined).toCallEqualsWithOneArgument();
    expect(1).toCallEqualsWithOneArgument();
    expect(results).toEqual([true, false]);
  });

  test("resolves and rejects look at the promise before the matcher looks at its arguments", () => {
    expect(() => expect(1).resolves.toBeGreaterThan()).toThrow("Expected promise");
    expect(() => expect(1).rejects.toHaveProperty()).toThrow("Expected promise");
  });

  test("expect.not, resolvesTo and rejectsTo work on an object that inherits from expect", () => {
    expect("b").toEqual(Object.create(expect).not.stringContaining("a"));
    expect(Promise.resolve("a")).toEqual(Object.create(expect).resolvesTo.stringContaining("a"));
    expect(Promise.reject("a")).toEqual(Object.create(expect).rejectsTo.stringContaining("a"));
  });

  test("toBe()", () => {
    const a = 1;
    const b = 1;
    expect(a).toBe(a);
    expect(a).toBe(b);
    expect(a).toBe(1);
    expect(1).toBe(a);
    expect(b).toBe(a);

    const c = { a: 1 };
    const d = { a: 1 };
    expect(c).toBe(c);
    expect(c).not.toBe(d);
    expect(c).not.toBe({ a: 1 });
    expect({ a: 1 }).not.toBe(c);
    expect(d).not.toBe(c);

    expect(1).toBe(1);
    // expect(1).not.toBe(1);

    expect(1).not.toBe(2);
    expect(1).not.toBe("1");
    expect("hello test").toBe("hello test");
    expect("hello test").not.toBe("hello test2");
  });

  test("toHaveLength()", () => {
    expect({ length: Number.MAX_SAFE_INTEGER }).toHaveLength(Number.MAX_SAFE_INTEGER);
    expect("123").toHaveLength(3);
    expect([1, 2, 3]).toHaveLength(3);
    expect([1, 2, 3]).not.toHaveLength(2);
    expect("123").not.toHaveLength(2);
    expect({ length: 3 }).toHaveLength(3);
    expect({ length: 3 }).not.toHaveLength(2);
    expect({ length: 3 }).not.toHaveLength(Number.MAX_SAFE_INTEGER);
    expect({ length: Number.MAX_SAFE_INTEGER }).not.toHaveLength(Number.MAX_SAFE_INTEGER - 1);
    expect({ length: 3.3 }).not.toHaveLength(3);
    expect("123").not.toHaveLength(-0);
  });

  if (isBun) {
    test("toHaveLength() extended", () => {
      // Headers
      expect(new Headers()).toHaveLength(0);
      expect(new Headers({ a: "1" })).toHaveLength(1);

      // FormData
      const form = new FormData();
      expect(form).toHaveLength(0);
      form.append("a", "1");
      expect(form).toHaveLength(1);

      // URLSearchParams
      expect(new URLSearchParams()).toHaveLength(0);
      expect(new URLSearchParams("a=1")).toHaveLength(1);
      expect(new URLSearchParams([["a", "1"]])).toHaveLength(1);

      // files
      const thisFile = Bun.file(__filename);
      const thisFileSize = thisFile.size;

      expect(thisFile).toHaveLength(thisFileSize);
      expect(thisFile).toHaveLength(Bun.file(__filename).size);

      // empty file should have length 0
      expect(Bun.file(tmpFile(true))).toHaveLength(0);

      // if a file doesn't exist, it should throw (not return 0 size)
      expect(() => expect(Bun.file(tmpFile(false))).toHaveLength(0)).toThrow();

      // Blob
      expect(new Blob(ANY([1, 2, 3]))).toHaveLength(3);
      expect(new Blob()).toHaveLength(0);

      // Set
      expect(new Set()).toHaveLength(0);
      expect(new Set([1, 2, 3])).toHaveLength(3);

      // Map
      expect(new Map()).toHaveLength(0);
      expect(new Map([["a", 1]])).toHaveLength(1);

      // WeakMap
      expect(new WeakMap([[globalThis, 1]])).toHaveLength(1);
    });
  }

  test.each([
    ["hello", "h"],
    ["hello", ""],
    ["hello", "hello"],
    [new String("hello"), "h"],
    ["emoji: 😃", "😃"],
    ["😄", "😄"],
    ["", ""],
    [[1, 2, 3], 1],
    // toContain uses === like Jest (Array.prototype.indexOf), so -0 and +0 match.
    [[-0], 0],
    [[0], -0],
    [new Float64Array([-0]), 0],
    [
      {
        *[Symbol.iterator]() {
          yield -0;
        },
      },
      0,
    ],
    [["a", "b", "c"], "c"],
    [[null, undefined], undefined],
    [[1n, "abc", null, -1n, undefined], -1n],
    [[Symbol.for("a")], Symbol.for("a")],
    [new Set([1, 2, 3]), 1],
    [new Set(["a", "b", "c"]), "c"],
    [new Uint8Array([1, 2, 3]), 1],
    [new BigInt64Array([1n, 2n, 3n]), 2n],
    [
      {
        *[Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      },
      3,
    ],
  ])("expect(%p).toContain(%p)", (value, expected) => {
    expect(value).toContain(expected);
  });

  test.each([
    ["hello", "a"],
    ["hello", "hello?"],
    [new String("hello"), "a"],
    [new String("hello"), "hello?"],
    [new String("hello"), "hello"],
    [new String("hello"), "llo"],
    [new String("hello"), ""],
    ["emoji: 😃", "😄"],
    [[1, 2, 3], -1],
    // toContain uses === like Jest (Array.prototype.indexOf), so NaN never matches.
    [[NaN], NaN],
    [new Float64Array([NaN]), NaN],
    [new Set([NaN]), NaN],
    [[1, 2, 3], 1n],
    [["a", "b", "c"], "d"],
    [[Symbol.for("a")], Symbol("a")],
    [new Set([1, 2, 3]), 6],
    [new Set(["a", "b", "c"]), "f"],
    [new Uint8Array([1, 2, 3]), 0],
    [new BigInt64Array([1n, 2n, 3n]), 1],
    [
      {
        *[Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      },
      6,
    ],
  ])("expect(%p).not.toContain(%p)", (value, expected) => {
    expect(value).not.toContain(expected);
  });

  test.each([
    ["hello", "h"],
    [new String("hello"), "h"],
    ["emoji: 😃", "😃"],
    ["😄", "😄"],
    [new String("😄"), "😄"],
    [[1, 2, 3], 1],
    [[{ a: 1 }, { b: 2 }, { c: 3 }], { c: 3 }],
    [[{}], {}],
    [["a", "b", "c"], "c"],
    [
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      [7, 8, 9],
    ],
    [[null, undefined], undefined],
    [[1n, "abc", null, -1n, undefined], -1n],
    [[Symbol.for("a")], Symbol.for("a")],
    [new Set([1, 2, 3]), 1],
    ...[!isJest ? [new Set([[], { a: 1 }, new Headers()]), new Headers()] : []],
    [new Set(["a", "b", "c"]), "c"],
    [new Set([new Map([[1, 2]])]), new Map([[1, 2]])],
    [new Uint8Array([1, 2, 3]), 1],
    [new BigInt64Array([1n, 2n, 3n]), 2n],
    [
      {
        *[Symbol.iterator]() {
          yield new Map();
          yield {
            a: 1,
            b: new Map(),
          };
          yield null;
        },
      },
      {
        a: 1,
        b: new Map(),
      },
    ],
  ])("expect(%p).toContainEqual(%p)", (value, expected) => {
    expect(value).toContainEqual(expected);
  });

  test.each([
    ["hello", "a"],
    ["hello", "hello?"],
    ["hello", "hello"],
    ["hello", "llo"],
    ["hello", ""],
    ["", ""],
    [new String(""), new String("")],
    [new String("hello"), "a"],
    [new String("hello"), "hello?"],
    [new String("hello"), "hello"],
    [new String("hello"), "llo"],
    [new String("hello"), ""],
    ["😄", new String("😄")],
    ["1", new String("1")],
    ["emoji: 😃", "😄"],
    [[1, 2, 3], -1],
    [[{ a: 1 }, { b: 2 }, { c: 3 }], { c: 1 }],
    [[], {}],
    [[{}, { a: 1 }], { d: 4 }],
    [[1, 2, 3], 1n],
    [["a", "b", "c"], "d"],
    [[Symbol.for("a")], Symbol("a")],
    [new Set([1, 2, 3]), 6],
    [new Set([{ a: 1 }, { b: 2 }, { c: 3 }]), { d: 4 }],
    [new Set([]), {}],
    [new Set(["a", "b", "c"]), "f"],
    [new Uint8Array([1, 2, 3]), 0],
    [new BigInt64Array([1n, 2n, 3n]), 1],
    [
      {
        *[Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      },
      6,
    ],
    [
      {
        *[Symbol.iterator]() {
          yield [1, 2, 3];
        },
      },
      [1, 2, 4],
    ],
    [
      {
        *[Symbol.iterator]() {},
      },
      {},
    ],
  ])("expect(%p).not.toContainEqual(%p)", (value, expected) => {
    expect(value).not.toContainEqual(expected);
  });

  test("toContainKey", () => {
    const o = { a: "foo", b: "bar", c: "baz" };
    expect(o).toContainKey("a");
    expect(o).toContainKey("b");
    expect(o).toContainKey("c");
    expect(o).not.toContainKey("z");
    expect(o).not.toContainKey({ a: "foo" });
    expect(() => {
      expect(undefined).not.toContainKey(["id"]);
    }).toThrow(isBun ? "Expected value must be an object\nReceived: undefined" : "undefined is not an object");
  });

  test("toContainAllKeys", () => {
    expect({ a: "hello", b: "world" }).toContainAllKeys(["a", "b"]);
    expect({ a: "hello", b: "world" }).toContainAllKeys(["b", "a"]);
    expect({ 1: "hello", b: "world" }).toContainAllKeys(["1", "b"]);
    expect({ a: "hello", b: "world" }).not.toContainAllKeys(["c"]);
    expect({ a: "hello", b: "world" }).not.toContainAllKeys(["a"]);
    expect({ "": "hello", b: "world" }).toContainAllKeys(["", "b"]);

    expect([1, 2, 3]).toContainAllKeys(["0", "1", "2"]);
    expect([1, 2, 3]).not.toContainAllKeys(["0", "1", "2", "3"]);
  });

  test("toContainAnyKeys", () => {
    expect({ a: "hello", b: "world" }).toContainAnyKeys(["a"]);
    expect({ a: "hello", b: "world" }).toContainAnyKeys(["a", "c"]);
    expect({ 1: "test", 2: "test2" }).toContainAnyKeys([1]);
    expect({ a: "hello", b: "world" }).toContainAnyKeys(["b"]);
    expect({ a: "hello", b: "world" }).toContainAnyKeys(["b", "c"]);
    expect({ a: "hello", b: "world" }).not.toContainAnyKeys(["c"]);

    // Non-object values should not crash
    expect(null).not.toContainAnyKeys(["a", "b"]);
    expect(undefined).not.toContainAnyKeys(["a", "b"]);
    expect(42).not.toContainAnyKeys(["a", "b"]);
    expect("string").not.toContainAnyKeys(["a", "b"]);
    expect(true).not.toContainAnyKeys(["a", "b"]);
    expect(false).not.toContainAnyKeys(["a", "b"]);
    expect(Symbol("test")).not.toContainAnyKeys(["a", "b"]);
    expect(BigInt(123)).not.toContainAnyKeys(["a", "b"]);

    // Arrays should work with numeric string keys
    expect([1, 2, 3]).toContainAnyKeys(["0", "1"]);
    expect([1, 2, 3]).not.toContainAnyKeys(["a", "b"]);

    // Functions are objects
    const fn = () => {};
    fn.customProp = "test";
    expect(fn).toContainAnyKeys(["customProp"]);
    expect(fn).not.toContainAnyKeys(["otherProp"]);

    // Object.create(null)
    const objWithoutProto = Object.create(null);
    objWithoutProto.a = 1;
    expect(objWithoutProto).toContainAnyKeys(["a", "b"]);
    expect(objWithoutProto).not.toContainAnyKeys(["b", "c"]);
  });

  test("toContainKeys", () => {
    expect({ a: "foo", b: "bar", c: "baz" }).toContainKeys(["a", "b"]);
    expect({ a: "foo", b: "bar", c: "baz" }).toContainKeys(["a", "b", "c"]);
    expect({ a: "foo", 1: "test" }).toContainKeys(["a", 1]);
    expect({ a: "foo", b: "bar", c: "baz" }).not.toContainKeys(["a", "b", "e"]);
    expect({ a: "foo", b: "bar", c: "baz" }).not.toContainKeys(["z"]);

    // Non-object values
    expect(undefined).not.toContainKeys(["id"]);
    expect(null).not.toContainKeys(["id"]);
    expect("").toContainKeys([]);
    expect("").not.toContainKeys(["id"]);
    expect(false).toContainKeys([]);
    expect(false).not.toContainKeys(["id"]);
    expect(42).toContainKeys([]);
    expect(42).not.toContainKeys(["id"]);
    expect(true).toContainKeys([]);
    expect(true).not.toContainKeys(["id"]);
    expect(Symbol("test")).toContainKeys([]);
    expect(Symbol("test")).not.toContainKeys(["id"]);
    expect(BigInt(123)).toContainKeys([]);
    expect(BigInt(123)).not.toContainKeys(["id"]);

    // Arrays with numeric string keys
    expect([1, 2, 3]).toContainKeys(["0", "1"]);
    expect([1, 2, 3]).not.toContainKeys(["0", "1", "3"]);

    expect(() => {
      expect(undefined).toContainKeys(["id"]);
    }).toThrow(/(Received:)(.*undefined)/);
    expect(() => {
      expect(null).toContainKeys(["id"]);
    }).toThrow(/(Received:)(.*null)/);
  });

  test("toContainValue", () => {
    const shallow = { hello: "world" };
    const deep = { message: shallow };
    const deepArray = { message: [shallow] };
    const o = { a: "foo", b: [1, "hello", true], c: "baz" };

    expect(shallow).toContainValue("world");
    expect({ foo: false }).toContainValue(false);
    expect(deep).toContainValue({ hello: "world" });
    expect(deepArray).toContainValue([{ hello: "world" }]);

    expect(o).toContainValue("foo");
    expect(o).toContainValue([1, "hello", true]);
    expect(o).not.toContainValue("qux");

    expect(shallow).not.toContainValue("foo");
    expect(deep).not.toContainValue({ foo: "bar" });
    expect(deepArray).not.toContainValue([{ foo: "bar" }]);
  });

  test("toContainValues", () => {
    const shallow = {
      hello: "world",
      foo: 0,
      bar: false,
    };
    const deep = {
      message: shallow,
      donald: "duck",
    };
    const deepArray = {
      message: [shallow],
      donald: "duck",
    };

    expect(shallow).toContainValues(["world", false]);
    expect(deep).toContainValues([{ hello: "world", foo: 0, bar: false }, "duck"]);
    expect(deepArray).toContainValues(["duck", [{ hello: "world", foo: 0, bar: false }]]);

    let o = {
      a: "foo",
      b: "bar",
      c: "baz",
      d: [{ a: "hii", b: "hello" }],
      e: [1, 2],
      f: 100,
      g: 20n,
      h: 20.5,
    };
    expect(o).toContainValues([100]);
    expect(o).toContainValues(["foo", [{ a: "hii", b: "hello" }]]);
    expect(o).toContainValues(["foo", [1, 2]]);
    expect(o).toContainValues(["foo"]);
    expect(o).toContainValues([20n]);
    expect(o).toContainValues([20.5]);
    expect(o).toContainValues(["foo"]);
    expect(o).toContainValues(["foo", [{ a: "hii", b: "hello" }]]);
    expect(o).toContainValues(["baz", "bar", "foo"]);
    expect(o).toContainValues(["baz", "bar", "foo", [1, 2]]);
    expect(o).not.toContainValues(["qux", "foo"]);

    expect(shallow).not.toContainValues(["foo", 0]);
    expect(deep).not.toContainValues(["duck", { foo: "bar" }]);
    expect(deepArray).not.toContainValues(["duck", [{ foo: "bar" }]]);

    let data = { a: "foo", b: "bar", c: "baz" };
    expect(data).toContainValues(["foo"]);
    expect(data).toContainValues([]);
    expect(data).toContainValues(["baz", "bar", "foo"]);
    expect(data).not.toContainValues(["qux", "foo"]);
  });

  test("toContainAllValues", () => {
    let o = { a: "foo", b: "bar", c: "baz" };
    expect(o).toContainAllValues(["foo", "bar", "baz"]);
    expect(o).toContainAllValues(["baz", "bar", "foo"]);
    expect(o).not.toContainAllValues(["bar", "foo"]);

    o = {
      a: "foo",
      b: "bar",
      c: "baz",
      d: [{ a: "hii", b: "hello" }],
      e: [1, 2],
      f: 100,
      g: 20n,
      h: 20.5,
    };
    expect(o).toContainAllValues(["foo", "bar", "baz", [{ a: "hii", b: "hello" }], [1, 2], 100, 20n, 20.5]);
    expect(o).not.toContainAllValues(["foo", [{ a: "hii", b: "hello" }]]);

    const shallow = {
      hello: "world",
      foo: 0,
      bar: false,
    };
    const deep = {
      message: shallow,
      donald: "duck",
    };
    const deepArray = {
      message: [shallow],
      donald: "duck",
    };

    expect(shallow).toContainAllValues(["world", 0, false]);
    expect(shallow).not.toContainAllValues(["world", false]);
    expect(deep).toContainAllValues([{ hello: "world", foo: 0, bar: false }, "duck"]);
    expect(deepArray).toContainAllValues(["duck", [{ hello: "world", foo: 0, bar: false }]]);

    //NOT
    expect(shallow).not.toContainAllValues(["foo", 0]);
    expect(deep).not.toContainAllValues(["duck", { foo: "bar" }]);
    expect(deepArray).not.toContainAllValues(["duck", [{ foo: "bar" }]]);
  });

  test("toContainAnyValues", () => {
    let o = { a: "foo", b: "bar", c: "baz" };
    expect(o).toContainAnyValues(["qux", "foo"]);
    expect(o).toContainAnyValues(["qux", "bar"]);
    expect(o).toContainAnyValues(["qux", "baz"]);
    expect(o).toContainAnyValues(["foo"]);
    expect(o).toContainAnyValues(["foo", "fax"]);
    expect(o).toContainAnyValues(["qux", "bar"]);
    expect(o).toContainAnyValues(["qux", "baz", "rod"]);
    expect(o).not.toContainAnyValues(["qux"]);
    expect(o).not.toContainAnyValues(["bui", "mur"]);

    o = {
      a: "foo",
      b: "bar",
      c: "baz",
      d: [{ a: "hii", b: "hello" }],
      e: [1, 2],
      f: 100,
      g: 20n,
      h: 20.5,
    };
    expect(o).toContainAnyValues(["foo"]);
    expect(o).toContainAnyValues([[{ a: "hii", b: "hello" }]]);
    expect(o).toContainAnyValues([[1, 2]]);
    expect(o).toContainAnyValues([100]);
    expect(o).toContainAnyValues([20n]);
    expect(o).toContainAnyValues([20.5]);
  });

  test("toBeTruthy()", () => {
    expect("test").toBeTruthy();
    expect(true).toBeTruthy();
    expect(1).toBeTruthy();
    expect({}).toBeTruthy();
    expect([]).toBeTruthy();
    expect(() => {}).toBeTruthy();
    // expect(() => {}).not.toBeTruthy();
    expect(0.5).toBeTruthy();
    expect(new Map()).toBeTruthy();

    expect("").not.toBeTruthy();
    expect(0).not.toBeTruthy();
    expect(-0).not.toBeTruthy();
    expect(NaN).not.toBeTruthy();
    expect(0n).not.toBeTruthy();
    expect(0.0e1).not.toBeTruthy();
    expect(false).not.toBeTruthy();
    expect(null).not.toBeTruthy();
    expect(undefined).not.toBeTruthy();
  });

  test("toBeUndefined()", () => {
    expect(undefined).toBeUndefined();
    expect(() => expect(undefined).not.toBeUndefined()).toThrow();
    expect(null).not.toBeUndefined();
    expect(0).not.toBeUndefined();
    expect("hello defined").not.toBeUndefined();
  });

  test("toBeNull()", () => {
    expect(null).toBeNull();
    // expect(null).not.toBeNull();

    expect(undefined).not.toBeNull();
    expect(0).not.toBeNull();
    expect("hello not null").not.toBeNull();
  });

  test("toBeDefined()", () => {
    expect(0).toBeDefined();
    expect("hello defined").toBeDefined();
    expect(null).toBeDefined();
    // expect(null).not.toBeDefined();

    expect(undefined).not.toBeDefined();
  });

  test("toBeFalsy()", () => {
    expect("").toBeFalsy();
    expect(0).toBeFalsy();
    expect(-0).toBeFalsy();
    expect(NaN).toBeFalsy();
    expect(0n).toBeFalsy();
    expect(false).toBeFalsy();
    expect(null).toBeFalsy();
    expect(undefined).toBeFalsy();
    expect(() => expect("").not.toBeFalsy()).toThrow();
    expect(() => expect(0).not.toBeFalsy()).toThrow();
    expect(() => expect(-0).not.toBeFalsy()).toThrow();
    expect(() => expect(NaN).not.toBeFalsy()).toThrow();
    expect(() => expect(0n).not.toBeFalsy()).toThrow();
    expect(() => expect(false).not.toBeFalsy()).toThrow();
    expect(() => expect(null).not.toBeFalsy()).toThrow();
    expect(() => expect(undefined).not.toBeFalsy()).toThrow();

    expect("hello not falsy").not.toBeFalsy();
    expect(1).not.toBeFalsy();
    expect(true).not.toBeFalsy();
    expect({}).not.toBeFalsy();
    expect([]).not.toBeFalsy();
    expect(() => {}).not.toBeFalsy();
    expect(() => expect("hello not falsy").toBeFalsy()).toThrow();
    expect(() => expect(1).toBeFalsy()).toThrow();
    expect(() => expect(true).toBeFalsy()).toThrow();
    expect(() => expect({}).toBeFalsy()).toThrow();
    expect(() => expect([]).toBeFalsy()).toThrow();
    expect(() => expect(() => {}).toBeFalsy()).toThrow();
  });

  test("toBeGreaterThan()", () => {
    expect(3n).toBeGreaterThan(2);
    expect(Number.MAX_VALUE).not.toBeGreaterThan(Number.MAX_VALUE);
    expect(1).not.toBeGreaterThan(BigInt(Number.MAX_VALUE));
    expect(1).not.toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(1).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.MAX_SAFE_INTEGER).not.toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Infinity).toBeGreaterThan(-Infinity);
    expect(-Infinity).not.toBeGreaterThan(Infinity);

    expect(NaN).not.toBeGreaterThan(NaN);
    expect(NaN).not.toBeGreaterThan(-Infinity);

    expect(10).toBeGreaterThan(9);
    expect(10).not.toBeGreaterThan(10);
    expect(10).not.toBeGreaterThan(11);
    expect(10).not.toBeGreaterThan(Infinity);
    expect(10).toBeGreaterThan(-Infinity);
    expect(10).not.toBeGreaterThan(NaN);
    expect(10).toBeGreaterThan(0);
    expect(10).toBeGreaterThan(-0);
    expect(10).toBeGreaterThan(0.1);
    expect(10).toBeGreaterThan(-0.1);
    expect(10).toBeGreaterThan(0.9);
    expect(10).toBeGreaterThan(-0.9);
    expect(10).toBeGreaterThan(1);
    expect(10).toBeGreaterThan(-1);
    // switch the order
    expect(9).not.toBeGreaterThan(10);
    expect(10).not.toBeGreaterThan(10);
    expect(11).toBeGreaterThan(10);
    expect(Infinity).toBeGreaterThan(10);
    expect(-Infinity).not.toBeGreaterThan(10);
    expect(NaN).not.toBeGreaterThan(10);
    expect(0).not.toBeGreaterThan(10);
    expect(-0).not.toBeGreaterThan(10);
    expect(0.1).not.toBeGreaterThan(10);
    expect(-0.1).not.toBeGreaterThan(10);
    expect(0.9).not.toBeGreaterThan(10);
    expect(-0.9).not.toBeGreaterThan(10);
    expect(1).not.toBeGreaterThan(10);
    expect(-1).not.toBeGreaterThan(10);

    // same tests but use bigints
    expect(10n).toBeGreaterThan(9n);
    expect(10n).not.toBeGreaterThan(10n);
    expect(10n).not.toBeGreaterThan(11n);
    expect(10n).not.toBeGreaterThan(Infinity);
    expect(10n).toBeGreaterThan(-Infinity);
    expect(10n).not.toBeGreaterThan(NaN);
    expect(10n).toBeGreaterThan(0n);
    expect(10n).toBeGreaterThan(-0n);
    expect(10n).toBeGreaterThan(1n);
    expect(10n).toBeGreaterThan(-1n);
    // switch the order
    expect(9n).not.toBeGreaterThan(10n);
    expect(10n).not.toBeGreaterThan(10n);
    expect(11n).toBeGreaterThan(10n);
    expect(Infinity).toBeGreaterThan(10n);
    expect(-Infinity).not.toBeGreaterThan(10n);
    expect(NaN).not.toBeGreaterThan(10n);
    expect(0n).not.toBeGreaterThan(10n);
    expect(-0n).not.toBeGreaterThan(10n);
    expect(1n).not.toBeGreaterThan(10n);
    expect(-1n).not.toBeGreaterThan(10n);

    // use bigints and numbers
    expect(10n).toBeGreaterThan(9);
    expect(10n).not.toBeGreaterThan(10);
    expect(10n).not.toBeGreaterThan(11);
    expect(10n).not.toBeGreaterThan(Infinity);
    expect(10n).toBeGreaterThan(-Infinity);
    expect(10n).not.toBeGreaterThan(NaN);
    expect(10n).toBeGreaterThan(0);
    expect(10n).toBeGreaterThan(-0);
    expect(10n).toBeGreaterThan(0.1);
    expect(10n).toBeGreaterThan(-0.1);
    expect(10n).toBeGreaterThan(0.9);
    expect(10n).toBeGreaterThan(-0.9);
    expect(10n).toBeGreaterThan(1);
    expect(10n).toBeGreaterThan(-1);
    // switch the order
    expect(9n).not.toBeGreaterThan(10);
    expect(10n).not.toBeGreaterThan(10);
    expect(11n).toBeGreaterThan(10);
    expect(Infinity).toBeGreaterThan(10n);
    expect(-Infinity).not.toBeGreaterThan(10n);
    expect(NaN).not.toBeGreaterThan(10n);
    expect(0n).not.toBeGreaterThan(10);
    expect(-0n).not.toBeGreaterThan(10);
    expect(1n).not.toBeGreaterThan(10);
    expect(-1n).not.toBeGreaterThan(10);

    expect(1n).not.toBeGreaterThan(1);
    expect(1n).not.toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(1n).not.toBeGreaterThan(Number.MAX_VALUE);
    expect(1).not.toBeGreaterThan(1n);
    expect(Number.MAX_SAFE_INTEGER).toBeGreaterThan(1n);
    expect(Number.MAX_VALUE).toBeGreaterThan(1n);

    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeGreaterThan(1n);
    expect(BigInt(Number.MAX_VALUE)).toBeGreaterThan(1n);
    expect(1n).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1n).not.toBeGreaterThan(BigInt(Number.MAX_VALUE));

    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeGreaterThan(1);
    expect(BigInt(Number.MAX_VALUE)).toBeGreaterThan(1);
    expect(1).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  test("toBeGreaterThanOrEqual()", () => {
    expect(Number.MAX_VALUE).toBeGreaterThanOrEqual(Number.MAX_VALUE);
    expect(1).not.toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1).not.toBeGreaterThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1).not.toBeGreaterThanOrEqual(BigInt(Number.MAX_VALUE));
    expect(Number.MAX_SAFE_INTEGER).toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeGreaterThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Infinity).toBeGreaterThanOrEqual(-Infinity);
    expect(-Infinity).not.toBeGreaterThanOrEqual(Infinity);

    expect(NaN).not.toBeGreaterThanOrEqual(NaN);
    expect(NaN).not.toBeGreaterThanOrEqual(-Infinity);

    expect(10).toBeGreaterThanOrEqual(9);
    expect(10).toBeGreaterThanOrEqual(10);
    expect(10).not.toBeGreaterThanOrEqual(11);
    expect(10).not.toBeGreaterThanOrEqual(Infinity);
    expect(10).toBeGreaterThanOrEqual(-Infinity);
    expect(10).not.toBeGreaterThanOrEqual(NaN);
    expect(10).toBeGreaterThanOrEqual(0);
    expect(10).toBeGreaterThanOrEqual(-0);
    expect(10).toBeGreaterThanOrEqual(0.1);
    expect(10).toBeGreaterThanOrEqual(-0.1);
    expect(10).toBeGreaterThanOrEqual(0.9);
    expect(10).toBeGreaterThanOrEqual(-0.9);
    expect(10).toBeGreaterThanOrEqual(1);
    expect(10).toBeGreaterThanOrEqual(-1);
    // switch the order
    expect(9).not.toBeGreaterThanOrEqual(10);
    expect(10).toBeGreaterThanOrEqual(10);
    expect(11).toBeGreaterThanOrEqual(10);
    expect(Infinity).toBeGreaterThanOrEqual(10);
    expect(-Infinity).not.toBeGreaterThanOrEqual(10);
    expect(NaN).not.toBeGreaterThanOrEqual(10);
    expect(0).not.toBeGreaterThanOrEqual(10);
    expect(-0).not.toBeGreaterThanOrEqual(10);
    expect(0.1).not.toBeGreaterThanOrEqual(10);
    expect(-0.1).not.toBeGreaterThanOrEqual(10);
    expect(0.9).not.toBeGreaterThanOrEqual(10);
    expect(-0.9).not.toBeGreaterThanOrEqual(10);
    expect(1).not.toBeGreaterThanOrEqual(10);
    expect(-1).not.toBeGreaterThanOrEqual(10);

    // same tests but use bigints
    expect(10n).toBeGreaterThanOrEqual(9n);
    expect(10n).toBeGreaterThanOrEqual(10n);
    expect(10n).not.toBeGreaterThanOrEqual(11n);
    expect(10n).not.toBeGreaterThanOrEqual(Infinity);
    expect(10n).toBeGreaterThanOrEqual(-Infinity);
    expect(10n).not.toBeGreaterThanOrEqual(NaN);
    expect(10n).toBeGreaterThanOrEqual(0n);
    expect(10n).toBeGreaterThanOrEqual(-0n);
    expect(10n).toBeGreaterThanOrEqual(1n);
    expect(10n).toBeGreaterThanOrEqual(-1n);
    // switch the order
    expect(9n).not.toBeGreaterThanOrEqual(10n);
    expect(10n).toBeGreaterThanOrEqual(10n);
    expect(11n).toBeGreaterThanOrEqual(10n);
    expect(Infinity).toBeGreaterThanOrEqual(10n);
    expect(-Infinity).not.toBeGreaterThanOrEqual(10n);
    expect(NaN).not.toBeGreaterThanOrEqual(10n);
    expect(0n).not.toBeGreaterThanOrEqual(10n);
    expect(-0n).not.toBeGreaterThanOrEqual(10n);
    expect(1n).not.toBeGreaterThanOrEqual(10n);
    expect(-1n).not.toBeGreaterThanOrEqual(10n);

    // use bigints and numbers
    expect(10n).toBeGreaterThanOrEqual(9);
    expect(10n).toBeGreaterThanOrEqual(10);
    expect(10n).not.toBeGreaterThanOrEqual(11);
    expect(10n).not.toBeGreaterThanOrEqual(Infinity);
    expect(10n).toBeGreaterThanOrEqual(-Infinity);
    expect(10n).not.toBeGreaterThanOrEqual(NaN);
    expect(10n).toBeGreaterThanOrEqual(0);
    expect(10n).toBeGreaterThanOrEqual(-0);
    expect(10n).toBeGreaterThanOrEqual(0.1);
    expect(10n).toBeGreaterThanOrEqual(-0.1);
    expect(10n).toBeGreaterThanOrEqual(0.9);
    expect(10n).toBeGreaterThanOrEqual(-0.9);
    expect(10n).toBeGreaterThanOrEqual(1);
    expect(10n).toBeGreaterThanOrEqual(-1);
    // switch the order
    expect(9n).not.toBeGreaterThanOrEqual(10);
    expect(10n).toBeGreaterThanOrEqual(10);
    expect(11n).toBeGreaterThanOrEqual(10);
    expect(Infinity).toBeGreaterThanOrEqual(10n);
    expect(-Infinity).not.toBeGreaterThanOrEqual(10n);
    expect(NaN).not.toBeGreaterThanOrEqual(10n);
    expect(0n).not.toBeGreaterThanOrEqual(10);
    expect(-0n).not.toBeGreaterThanOrEqual(10);
    expect(1n).not.toBeGreaterThanOrEqual(10);
    expect(-1n).not.toBeGreaterThanOrEqual(10);

    expect(1n).toBeGreaterThanOrEqual(1);
    expect(1n).not.toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1n).not.toBeGreaterThanOrEqual(Number.MAX_VALUE);
    expect(1).toBeGreaterThanOrEqual(1n);
    expect(Number.MAX_SAFE_INTEGER).toBeGreaterThanOrEqual(1n);
    expect(Number.MAX_VALUE).toBeGreaterThanOrEqual(1n);

    expect(1).not.toBeGreaterThanOrEqual(BigInt(Number.MAX_VALUE));
  });

  test("toBeLessThan()", () => {
    expect(3n).not.toBeLessThan(2);
    expect(Number.MAX_VALUE).not.toBeLessThan(Number.MAX_VALUE);
    expect(1).toBeLessThan(BigInt(Number.MAX_VALUE));
    expect(1).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(1).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.MAX_SAFE_INTEGER).not.toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Number.MAX_VALUE).not.toBeLessThan(BigInt(Number.MAX_VALUE));

    expect(NaN).not.toBeLessThan(NaN);
    expect(NaN).not.toBeLessThan(-Infinity);

    expect(10).not.toBeLessThan(9);
    expect(10).not.toBeLessThan(10);
    expect(10).toBeLessThan(11);
    expect(10).toBeLessThan(Infinity);
    expect(10).not.toBeLessThan(-Infinity);
    expect(10).not.toBeLessThan(NaN);
    expect(10).not.toBeLessThan(0);
    expect(10).not.toBeLessThan(-0);
    expect(10).not.toBeLessThan(0.1);
    expect(10).not.toBeLessThan(-0.1);
    expect(10).not.toBeLessThan(0.9);
    expect(10).not.toBeLessThan(-0.9);
    expect(10).not.toBeLessThan(1);
    expect(10).not.toBeLessThan(-1);
    // switch the order
    expect(9).toBeLessThan(10);
    expect(10).not.toBeLessThan(10);
    expect(11).not.toBeLessThan(10);
    expect(Infinity).not.toBeLessThan(10);
    expect(-Infinity).toBeLessThan(10);
    expect(NaN).not.toBeLessThan(10);
    expect(0).toBeLessThan(10);
    expect(-0).toBeLessThan(10);
    expect(0.1).toBeLessThan(10);
    expect(-0.1).toBeLessThan(10);
    expect(0.9).toBeLessThan(10);
    expect(-0.9).toBeLessThan(10);
    expect(1).toBeLessThan(10);
    expect(-1).toBeLessThan(10);

    // same tests but use bigints
    expect(10n).not.toBeLessThan(9n);
    expect(10n).not.toBeLessThan(10n);
    expect(10n).toBeLessThan(11n);
    expect(10n).toBeLessThan(Infinity);
    expect(10n).not.toBeLessThan(-Infinity);
    expect(10n).not.toBeLessThan(NaN);
    expect(10n).not.toBeLessThan(0n);
    expect(10n).not.toBeLessThan(-0n);
    expect(10n).not.toBeLessThan(1n);
    expect(10n).not.toBeLessThan(-1n);
    // switch the order
    expect(9n).toBeLessThan(10n);
    expect(10n).not.toBeLessThan(10n);
    expect(11n).not.toBeLessThan(10n);
    expect(Infinity).not.toBeLessThan(10n);
    expect(-Infinity).toBeLessThan(10n);
    expect(NaN).not.toBeLessThan(10n);
    expect(0n).toBeLessThan(10n);
    expect(-0n).toBeLessThan(10n);
    expect(1n).toBeLessThan(10n);
    expect(-1n).toBeLessThan(10n);

    // use bigints and numbers
    expect(10n).not.toBeLessThan(9);
    expect(10n).not.toBeLessThan(10);
    expect(10n).toBeLessThan(11);
    expect(10n).toBeLessThan(Infinity);
    expect(10n).not.toBeLessThan(-Infinity);
    expect(10n).not.toBeLessThan(NaN);
    expect(10n).not.toBeLessThan(0);
    expect(10n).not.toBeLessThan(-0);
    expect(10n).not.toBeLessThan(0.1);
    expect(10n).not.toBeLessThan(-0.1);
    expect(10n).not.toBeLessThan(0.9);
    expect(10n).not.toBeLessThan(-0.9);
    expect(10n).not.toBeLessThan(1);
    expect(10n).not.toBeLessThan(-1);
    // switch the order
    expect(9n).toBeLessThan(10);
    expect(10n).not.toBeLessThan(10);
    expect(11n).not.toBeLessThan(10);
    expect(Infinity).not.toBeLessThan(10n);
    expect(-Infinity).toBeLessThan(10n);
    expect(NaN).not.toBeLessThan(10n);
    expect(0n).toBeLessThan(10);
    expect(-0n).toBeLessThan(10);
    expect(1n).toBeLessThan(10);
    expect(-1n).toBeLessThan(10);

    expect(1n).not.toBeLessThan(1);
    expect(1n).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(1n).toBeLessThan(Number.MAX_VALUE);
    expect(1).not.toBeLessThan(1n);
    expect(Number.MAX_SAFE_INTEGER).not.toBeLessThan(1n);
    expect(Number.MAX_VALUE).not.toBeLessThan(1n);

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(1n);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThan(1n);
    expect(1n).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1n).toBeLessThan(BigInt(Number.MAX_VALUE));

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(1);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThan(1);
    expect(1).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  test("toBeLessThanOrEqual()", () => {
    expect(3n).not.toBeLessThanOrEqual(2);
    expect(Number.MAX_VALUE).toBeLessThanOrEqual(Number.MAX_VALUE);
    expect(1).toBeLessThanOrEqual(BigInt(Number.MAX_VALUE));
    expect(1).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Number.MAX_VALUE).toBeLessThanOrEqual(BigInt(Number.MAX_VALUE));
    expect(BigInt(Number.MAX_VALUE)).toBeLessThanOrEqual(Number.MAX_VALUE);

    expect(NaN).not.toBeLessThanOrEqual(NaN);
    expect(NaN).not.toBeLessThanOrEqual(-Infinity);

    expect(10).not.toBeLessThanOrEqual(9);
    expect(10).toBeLessThanOrEqual(10);
    expect(10).toBeLessThanOrEqual(11);
    expect(10).toBeLessThanOrEqual(Infinity);
    expect(10).not.toBeLessThanOrEqual(-Infinity);
    expect(10).not.toBeLessThanOrEqual(NaN);
    expect(10).not.toBeLessThanOrEqual(0);
    expect(10).not.toBeLessThanOrEqual(-0);
    expect(10).not.toBeLessThanOrEqual(0.1);
    expect(10).not.toBeLessThanOrEqual(-0.1);
    expect(10).not.toBeLessThanOrEqual(0.9);
    expect(10).not.toBeLessThanOrEqual(-0.9);
    expect(10).not.toBeLessThanOrEqual(1);
    expect(10).not.toBeLessThanOrEqual(-1);
    // switch the order
    expect(9).toBeLessThanOrEqual(10);
    expect(10).toBeLessThanOrEqual(10);
    expect(11).not.toBeLessThanOrEqual(10);
    expect(Infinity).not.toBeLessThanOrEqual(10);
    expect(-Infinity).toBeLessThanOrEqual(10);
    expect(NaN).not.toBeLessThanOrEqual(10);
    expect(0).toBeLessThanOrEqual(10);
    expect(-0).toBeLessThanOrEqual(10);
    expect(0.1).toBeLessThanOrEqual(10);
    expect(-0.1).toBeLessThanOrEqual(10);
    expect(0.9).toBeLessThanOrEqual(10);
    expect(-0.9).toBeLessThanOrEqual(10);
    expect(1).toBeLessThanOrEqual(10);
    expect(-1).toBeLessThanOrEqual(10);

    // same tests but use bigints
    expect(10n).not.toBeLessThanOrEqual(9n);
    expect(10n).toBeLessThanOrEqual(10n);
    expect(10n).toBeLessThanOrEqual(11n);
    expect(10n).toBeLessThanOrEqual(Infinity);
    expect(10n).not.toBeLessThanOrEqual(-Infinity);
    expect(10n).not.toBeLessThanOrEqual(NaN);
    expect(10n).not.toBeLessThanOrEqual(0n);
    expect(10n).not.toBeLessThanOrEqual(-0n);
    expect(10n).not.toBeLessThanOrEqual(1n);
    expect(10n).not.toBeLessThanOrEqual(-1n);
    // switch the order
    expect(9n).toBeLessThanOrEqual(10n);
    expect(10n).toBeLessThanOrEqual(10n);
    expect(11n).not.toBeLessThanOrEqual(10n);
    expect(Infinity).not.toBeLessThanOrEqual(10n);
    expect(-Infinity).toBeLessThanOrEqual(10n);
    expect(NaN).not.toBeLessThanOrEqual(10n);
    expect(0n).toBeLessThanOrEqual(10n);
    expect(-0n).toBeLessThanOrEqual(10n);
    expect(1n).toBeLessThanOrEqual(10n);
    expect(-1n).toBeLessThanOrEqual(10n);

    // use bigints and numbers
    expect(10n).not.toBeLessThanOrEqual(9);
    expect(10n).toBeLessThanOrEqual(10);
    expect(10n).toBeLessThanOrEqual(11);
    expect(10n).toBeLessThanOrEqual(Infinity);
    expect(10n).not.toBeLessThanOrEqual(-Infinity);
    expect(10n).not.toBeLessThanOrEqual(NaN);
    expect(10n).not.toBeLessThanOrEqual(0);
    expect(10n).not.toBeLessThanOrEqual(-0);
    expect(10n).not.toBeLessThanOrEqual(0.1);
    expect(10n).not.toBeLessThanOrEqual(-0.1);
    expect(10n).not.toBeLessThanOrEqual(0.9);
    expect(10n).not.toBeLessThanOrEqual(-0.9);
    expect(10n).not.toBeLessThanOrEqual(1);
    expect(10n).not.toBeLessThanOrEqual(-1);
    // switch the order
    expect(9n).toBeLessThanOrEqual(10);
    expect(10n).toBeLessThanOrEqual(10);
    expect(11n).not.toBeLessThanOrEqual(10);
    expect(Infinity).not.toBeLessThanOrEqual(10n);
    expect(-Infinity).toBeLessThanOrEqual(10n);
    expect(NaN).not.toBeLessThanOrEqual(10n);
    expect(0n).toBeLessThanOrEqual(10);
    expect(-0n).toBeLessThanOrEqual(10);
    expect(1n).toBeLessThanOrEqual(10);
    expect(-1n).toBeLessThanOrEqual(10);

    expect(1n).toBeLessThanOrEqual(1);
    expect(1n).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1n).toBeLessThanOrEqual(Number.MAX_VALUE);
    expect(1).toBeLessThanOrEqual(1n);
    expect(Number.MAX_SAFE_INTEGER).not.toBeLessThanOrEqual(1n);
    expect(Number.MAX_VALUE).not.toBeLessThanOrEqual(1n);

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThanOrEqual(1n);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThanOrEqual(1n);
    expect(1n).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1n).toBeLessThanOrEqual(BigInt(Number.MAX_VALUE));

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThanOrEqual(1);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThanOrEqual(1);
    expect(1).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
  });

  describe("toMatchObject", () => {
    if (isBun) {
      test("with Bun.deepMatch", () => {
        expect(Bun.deepMatch({ a: 1, b: 2 }, { a: 1 })).toBe(false);
        expect(Bun.deepMatch({ a: 1 }, { a: 1, b: 2 })).toBe(true);
      });
      test("Bun.deepMatch compares an object that occurs twice with each of its patterns", () => {
        const shared = { v: 1 };
        expect(Bun.deepMatch({ a: { v: 1 }, b: { v: 2 } }, { a: shared, b: shared })).toBe(false);
        expect(Bun.deepMatch({ a: shared, b: shared }, { a: { v: 1 }, b: { v: 2 } })).toBe(false);
        expect(Bun.deepMatch({ a: shared, b: shared }, { a: { v: 1 }, b: { v: 1 } })).toBe(true);
      });
    }
    test("compares an object that occurs twice with each of its patterns", () => {
      const shared = { v: 1 };
      expect({ a: shared, b: shared }).not.toMatchObject({ a: { v: 1 }, b: { v: 2 } });
      expect({ a: { v: 1 }, b: { v: 2 } }).not.toMatchObject({ a: shared, b: shared });
      expect({ a: shared, b: shared }).toMatchObject({ a: { v: 1 }, b: { v: 1 } });
      expect({ a: shared, b: [shared, { c: shared }] }).not.toMatchObject({ a: {}, b: [{}, { c: { v: 2 } }] });
    });
    test("ends on cycles", () => {
      const received = { v: 1, other: { v: 2 } };
      received.self = received;
      received.other.back = received;
      const same = { v: 1, other: { v: 2 } };
      same.self = same;
      same.other.back = same;
      expect(received).toMatchObject(same);
      const different = { v: 1, other: { v: 2 } };
      different.self = different;
      different.other.back = { v: 3 };
      expect(received).not.toMatchObject(different);
    });
    test("an object that occurs twice shows, in each place, what the pattern there says", () => {
      const number = expect.any(Number);
      const shared = { id: 123.5, k: 2.5 };
      const pattern = { id: number };
      expect({ a: shared, b: shared }).toMatchInlineSnapshot(
        { a: pattern, b: pattern },
        `
{
  "a": {
    "id": Any<Number>,
    "k": 2.5,
  },
  "b": {
    "id": Any<Number>,
    "k": 2.5,
  },
}
`,
      );
      expect({ a: shared, b: shared, c: [shared, shared] }).toMatchInlineSnapshot(
        { a: { id: number }, b: { k: number }, c: [{ id: number, k: number }, {}] },
        `
{
  "a": {
    "id": Any<Number>,
    "k": 2.5,
  },
  "b": {
    "id": 123.5,
    "k": Any<Number>,
  },
  "c": [
    {
      "id": Any<Number>,
      "k": Any<Number>,
    },
    {
      "id": 123.5,
      "k": 2.5,
    },
  ],
}
`,
      );
      const cycle = { id: 1.5 };
      cycle.self = cycle;
      const cyclicPattern = { id: number };
      cyclicPattern.self = cyclicPattern;
      expect(cycle).toMatchInlineSnapshot(
        cyclicPattern,
        `
{
  "id": Any<Number>,
  "self": [Circular],
}
`,
      );
      expect(shared).toEqual({ id: 123.5, k: 2.5 });
    });
    test("the copy of an array keeps the holes at its end", () => {
      const received = [1.5, 2];
      received.length = 4;
      const pattern = [expect.any(Number), 2];
      pattern.length = 4;
      expect({ received }).toMatchInlineSnapshot(
        { received: pattern },
        `
{
  "received": [
    Any<Number>,
    2,
    undefined,
    undefined,
  ],
}
`,
      );
    });
    test("leaves the received object as it is", () => {
      class Point {
        x = 1;
        get y() {
          return 2;
        }
      }
      const received = Object.freeze({
        a: 1,
        nested: Object.freeze({ b: "x", list: Object.freeze([1, Object.freeze({ c: 2 })]) }),
        point: new Point(),
        wrong: 1,
      });
      const before = structuredClone({ ...received, point: { ...received.point } });
      const matching = {
        a: expect.any(Number),
        nested: { b: expect.any(String), list: [expect.any(Number), { c: expect.anything() }] },
        point: { x: expect.any(Number), y: expect.any(Number) },
      };
      expect(received).toMatchObject(matching);
      expect(() => expect(received).not.toMatchObject(matching)).toThrow();
      let message = "";
      try {
        expect(received).toMatchObject({ ...matching, wrong: 2 });
      } catch (error) {
        message = Bun.stripANSI(error.message);
      }
      // Properties that matched an asymmetric matcher are left out of the diff.
      expect(message.split("\n").filter(line => /^[-+] /.test(line))).toEqual([
        '-   "point": {',
        '+   "point": Point {',
        '-   "wrong": 2,',
        '+   "wrong": 1,',
        "- Expected  - 2",
        "+ Received  + 2",
      ]);
      expect({ ...received, point: { ...received.point } }).toEqual(before);
      expect(Object.keys(received.point)).toEqual(["x"]);
    });
    test("leaves the expected object as it is when the matcher is on the received side", () => {
      const matcher = expect.any(String);
      const received = { a: matcher };
      const expected = { a: "hello" };
      expect(received).toMatchObject(expected);
      expect(received.a).toBe(matcher);
      expect(expected.a).toBe("hello");
    });
    test_skipIf(!isBun)("leaves what is not a plain object or array as it is", () => {
      class List extends Array {}
      List.prototype[5] = "inherited";
      function fn() {}
      const bytes = new Uint8Array([1, 2]);
      const bigints = new BigInt64Array([1n, 2n]);
      const array = [1, 2];
      const list = List.of(1);
      const event = new Event("x");
      const error = new TypeError("boom");
      for (const missing of [{}, { missing: 1 }]) {
        const matches = !("missing" in missing);
        for (const [received, expected] of [
          [bytes, { 0: expect.any(Number) }],
          [bigints, { 0: expect.any(BigInt) }],
          [array, { length: expect.any(Number) }],
          [list, { 5: expect.any(String) }],
          [event, { isTrusted: expect.any(Boolean), timeStamp: expect.any(Number) }],
          [fn, { name: expect.any(String) }],
          [error, { message: expect.any(String) }],
        ]) {
          if (matches) expect(received).toMatchObject(expected);
          else expect(() => expect(received).toMatchObject({ ...expected, ...missing })).toThrow("toMatchObject");
          expect(() => expect(received).not.toMatchObject(expected)).toThrow("toMatchObject");
        }
        expect(bytes[0]).toBe(1);
        expect(bigints[0]).toBe(1n);
        expect(Object.keys(array)).toEqual(["0", "1"]);
        expect(list.length).toBe(1);
        expect(event.isTrusted).toBe(false);
        expect(Object.keys(event)).toEqual(["isTrusted"]);
        expect(Object.getOwnPropertyDescriptor(fn, "name")).toEqual({
          value: "fn",
          writable: false,
          enumerable: false,
          configurable: true,
        });
        expect(error.message).toBe("boom");
      }
    });
    test_skipIf(!isBun)("the diff prints the message of an Error, not the matcher it matched", () => {
      const error = Object.assign(new TypeError("boom: no such file"), { code: "ENOENT" });
      let message = "";
      try {
        expect({ error, n: 1 }).toMatchObject({ error: { message: expect.any(String) }, n: 2 });
      } catch (thrown) {
        message = Bun.stripANSI(ANY(thrown).message);
      }
      expect(message.split("\n").filter(line => /^\+ {3}/.test(line))).toEqual([
        '+   "error": [TypeError: boom: no such file],',
        '+   "n": 1,',
      ]);
    });
    if (isBun) {
      /** The message of the assertion that fails in `assertion`, without colors. Any other error is thrown again. */
      const failureOf = (/** @type {() => void} */ assertion) => {
        try {
          assertion();
        } catch (error) {
          const message = Bun.stripANSI(ANY(error).message);
          if (!message.startsWith("expect(received)")) throw error;
          return message;
        }
        throw new Error("expected the assertion to fail");
      };
      /**
       * The lines that the diff in `message` marks, and the two counts below them.
       * With `AGENT=1` the diff keeps one unmarked line next to a marked one and folds the others.
       */
      const marked = (/** @type {string} */ message) => message.split("\n").filter(line => /^[-+] /.test(line));

      test("prints an object whose class has a getter that reads a private field", () => {
        class Tagged {
          #name = "T";
          a = 1;
          b = 2;
          get [Symbol.toStringTag]() {
            return this.#name;
          }
        }
        const number = expect.any(Number);
        const tagged = Object.freeze(new Tagged());
        const pattern = Object.freeze({ a: number, b: 3 });
        const ofTagged = [
          "expect(received).toMatchObject(expected)",
          "",
          "- {",
          "+ T ",
          "+ Tagged {",
          '    "a": Any<Number>,',
          '-   "b": 3,',
          '+   "b": 2,',
          "  }",
          "",
          "- Expected  - 2",
          "+ Received  + 3",
          "",
        ];
        expect(failureOf(() => expect(tagged).toMatchObject(pattern)).split("\n")).toEqual(ofTagged);
        // The comparison ends at `b`, the first property that differs. The diff asks the matcher that it did not reach.
        expect(failureOf(() => expect(tagged).toMatchObject({ b: 3, a: number })).split("\n")).toEqual(ofTagged);
        expect(failureOf(() => expect(tagged).not.toMatchObject({ a: number }))).toBe(
          'expect(received).not.toMatchObject(expected)\n\nExpected: not {\n  "a": Any<Number>,\n}\n',
        );
        expect(Reflect.ownKeys(tagged)).toEqual(["a", "b"]);
        expect(tagged.a).toBe(1);
        expect(tagged.b).toBe(2);
        expect(pattern.a).toBe(number);

        // A matcher that the tag of an object matched does not stand in for the tag: the object is named as it is.
        const last = Symbol("zz");
        expect(
          failureOf(() =>
            expect({ [Symbol.toStringTag]: "Foo", [last]: 1 }).toMatchObject({
              [Symbol.toStringTag]: expect.any(String),
              [last]: 2,
            }),
          ).split("\n"),
        ).toEqual([
          "expect(received).toMatchObject(expected)",
          "",
          "- {",
          "+ Foo ",
          "+ Foo {",
          "    [Symbol(Symbol.toStringTag)]: Any<String>,",
          "-   [Symbol(zz)]: 2,",
          "+   [Symbol(zz)]: 1,",
          "  }",
          "",
          "- Expected  - 2",
          "+ Received  + 3",
          "",
        ]);

        const { Database } = require("bun:sqlite");
        using database = new Database(":memory:");
        const statement = database.query("select 1 as a");
        const array = expect.any(Array);
        const ownKeys = Reflect.ownKeys(statement);
        // The own properties of a statement are functions with internal names. Their lines are left out.
        const failure = (/** @type {object} */ expected) =>
          failureOf(() => expect(statement).toMatchObject(expected))
            .split("\n")
            .filter(line => !/^\+ (  "|Received)/.test(line));
        // `columnNames` is a getter of the class, and so is the tag, which is the text of the query.
        const ofStatement = [
          "expect(received).toMatchObject(expected)",
          "",
          "- {",
          '+ "select 1 as a" ',
          "+ Statement {",
          '    "columnNames": Any<Array>,',
          '-   "paramsCount": 5,',
          "  }",
          "",
          "- Expected  - 2",
          "",
        ];
        expect(failure({ columnNames: array, paramsCount: 5 })).toEqual(ofStatement);
        expect(failure({ paramsCount: 5, columnNames: array })).toEqual(ofStatement);
        expect(failureOf(() => expect(statement).not.toMatchObject({ columnNames: array }))).toBe(
          'expect(received).not.toMatchObject(expected)\n\nExpected: not {\n  "columnNames": Any<Array>,\n}\n',
        );
        expect(Reflect.ownKeys(statement)).toEqual(ownKeys);
        expect(statement.columnNames).toEqual(["a"]);
      });

      test("prints a link back to the root as a circular reference, once for each child", () => {
        const tree = (/** @type {number} */ count, /** @type {boolean} */ throughMeta) => {
          /** @type {{ id: number, name: string, children: { id: number }[] }} */
          const root = { id: 0, name: "root", children: [] };
          for (let id = 1; id <= count; id++) {
            root.children.push(
              Object.freeze(throughMeta ? { id, meta: Object.freeze({ parent: root }) } : { id, parent: root }),
            );
          }
          Object.freeze(root.children);
          return Object.freeze(root);
        };
        const failure = (/** @type {ReturnType<typeof tree>} */ root) =>
          failureOf(() =>
            expect(root).toMatchObject({
              children: root.children.map(() => ({ id: expect.any(Number) })),
              name: "other",
            }),
          );
        const direct = tree(2, false);
        // The `id` of a child matched: its line is the same on both sides, and the diff does not mark it.
        expect(marked(failure(direct))).toEqual([
          '+       "parent": [Circular],',
          '+       "parent": [Circular],',
          '-   "name": "other",',
          '+   "id": 0,',
          '+   "name": "root",',
          "- Expected  - 1",
          "+ Received  + 4",
        ]);
        // The same text when `name`, which differs, comes before the children.
        expect(
          failureOf(() =>
            expect(direct).toMatchObject({
              name: "other",
              children: direct.children.map(() => ({ id: expect.any(Number) })),
            }),
          ),
        ).toBe(failure(direct));
        expect(direct.children[0].id).toBe(1);
        expect(direct.children[1].id).toBe(2);
        // The pattern does not name `meta`, the object that holds the link.
        expect(marked(failure(tree(2, true)))).toEqual([
          '+       "meta": {',
          '+         "parent": [Circular],',
          "+       },",
          '+       "meta": {',
          '+         "parent": [Circular],',
          "+       },",
          '-   "name": "other",',
          '+   "id": 0,',
          '+   "name": "root",',
          "- Expected  - 1",
          "+ Received  + 8",
        ]);
        for (const throughMeta of [false, true]) {
          const [small, large] = [6, 12].map(count => failure(tree(count, throughMeta)));
          expect(small.split("[Circular]")).toHaveLength(6 + 1);
          expect(large.split("[Circular]")).toHaveLength(12 + 1);
          // Each child adds the same lines, so twice the children is less than twice the text.
          expect(large.length).toBeLessThan(2 * small.length);
        }
      });

      test("shows a matcher below a chain of objects that the comparison met before", () => {
        // Each item holds the item before it and `items` holds them all, so the comparison meets every item but the last again.
        const chain = (/** @type {number} */ length, /** @type {unknown} */ firstId) => {
          /** @type {{ id: unknown, before?: object }[]} */
          const items = [{ id: firstId }];
          for (let id = 1; id < length; id++) items.push({ id, before: items[id - 1] });
          return items;
        };
        const number = expect.any(Number);
        const onlyWrong = ['-   "wrong": 2,', '+   "wrong": 1,', "- Expected  - 1", "+ Received  + 1"];
        // The first item is printed below every item. Its `id` is the matcher each time, so the diff marks no item.
        for (const length of [2, 3, 24]) {
          const received = { items: chain(length, 0), wrong: 1 };
          const message = failureOf(() => expect(received).toMatchObject({ items: chain(length, number), wrong: 2 }));
          expect({ length, marked: marked(message) }).toEqual({ length, marked: onlyWrong });
          expect(received.items[0].id).toBe(0);
        }
        // The same with a link from the first item to the last one, which makes the chain a cycle.
        const cycle = (/** @type {unknown} */ firstId) => {
          const items = chain(6, firstId);
          items[0].before = items[5];
          return items;
        };
        const message = failureOf(() =>
          expect({ items: cycle(0), wrong: 1 }).toMatchObject({ items: cycle(number), wrong: 2 }),
        );
        expect(marked(message)).toEqual(onlyWrong);
      });

      test("shows the matcher that a property of a Headers, a URL, an Event or a CryptoHasher matched", () => {
        const number = expect.any(Number);
        const string = expect.any(String);
        const holders = {
          event: Object.freeze(new Event("x")),
          hasher: Object.freeze(new Bun.CryptoHasher("sha1")),
          headers: Object.freeze(Object.assign(new Headers(), { id: "v1" })),
          message: Object.freeze(new MessageEvent("message", { data: "hello" })),
          url: Object.freeze(new URL("https://example.com/a")),
        };
        const ownKeys = () => Object.values(holders).map(holder => Reflect.ownKeys(holder));
        const before = ownKeys();
        const pattern = Object.freeze({
          event: Object.freeze({ timeStamp: number }),
          hasher: Object.freeze({ algorithm: string }),
          headers: Object.freeze({ id: string }),
          message: Object.freeze({ data: string }),
          url: Object.freeze({ href: string }),
          wrong: 2,
        });
        // A MessageEvent has its own layout. The four other rows that matched are the same line on both sides.
        expect(
          failureOf(() => expect(Object.freeze({ ...holders, wrong: 1 })).toMatchObject(pattern)).split("\n"),
        ).toEqual([
          "expect(received).toMatchObject(expected)",
          "",
          "  {",
          '-   "event": {',
          '+   "event": Event Event {',
          '+     "isTrusted": false,',
          '      "timeStamp": Any<Number>,',
          "    },",
          '-   "hasher": {',
          '+   "hasher": CryptoHasher CryptoHasher {',
          '      "algorithm": Any<String>,',
          "    },",
          '-   "headers": {',
          '+   "headers": Headers Headers {',
          '      "id": Any<String>,',
          "    },",
          '-   "message": {',
          '-     "data": Any<String>,',
          '+   "message": MessageEvent {',
          '+     type: "message",',
          "+     data: Any<String>, ",
          "    },",
          '-   "url": {',
          '+   "url": URL URL {',
          '      "href": Any<String>,',
          "    },",
          '-   "wrong": 2,',
          '+   "wrong": 1,',
          "  }",
          "",
          "- Expected  - 7",
          "+ Received  + 9",
          "",
        ]);
        expect(ownKeys()).toEqual(before);
        expect(holders.hasher.algorithm).toBe("sha1");
        expect(holders.headers.id).toBe("v1");
        expect(holders.message.data).toBe("hello");
        expect(holders.url.href).toBe("https://example.com/a");
        expect(pattern.headers.id).toBe(string);

        // The lines of a MessageEvent go by its real type, also where a matcher matched the type, so its data is there.
        expect(
          marked(
            failureOf(() =>
              expect(new MessageEvent("message", { data: "x" })).toMatchObject({ type: string, data: "y" }),
            ),
          ),
        ).toEqual([
          "- {",
          '-   "data": "y",',
          '-   "type": Any<String>,',
          "+ MessageEvent {",
          '+   type: "message",',
          '+   data: "x", ',
          "- Expected  - 3",
          "+ Received  + 3",
        ]);
        // The matcher that the message of an ErrorEvent matched is in its place.
        expect(
          marked(
            failureOf(() =>
              expect(new ErrorEvent("error", { message: "m", error: 1 })).toMatchObject({ message: string, error: 2 }),
            ),
          ),
        ).toEqual([
          "- {",
          '-   "error": 2,',
          '-   "message": Any<String>,',
          "+ ErrorEvent {",
          '+   type: "error",',
          "+   message: Any<String>, ",
          "+   error: 1",
          "- Expected  - 3",
          "+ Received  + 4",
        ]);

        // A Map, a Set and a FormData print their entries, and an entry is not the object that matched.
        const form = new FormData();
        form.append("append", "entry");
        const entries = failureOf(() =>
          expect({ form, map: new Map([["k", { size: 1 }]]), set: new Set([{ size: 1 }]), wrong: 1 }).toMatchObject({
            form: { append: expect.any(Function) },
            map: { size: number },
            set: { size: number },
            wrong: 2,
          }),
        );
        expect(entries.split("\n").filter(line => /^\+ +"(append|size)"/.test(line))).toEqual([
          '+     "append": "entry",',
          '+       "size": 1,',
          '+       "size": 1,',
        ]);
      });

      test("a getter runs on the received object, also in the props of a React element", () => {
        const number = expect.any(Number);
        const string = expect.any(String);
        const sum = Object.freeze({
          a: 1,
          get total() {
            return this.a + 1;
          },
          wrong: 1,
        });
        expect(marked(failureOf(() => expect(sum).toMatchObject({ a: number, wrong: 2 })))).toEqual([
          '-   "wrong": 2,',
          '+   "total": 2,',
          '+   "wrong": 1,',
          "- Expected  - 1",
          "+ Received  + 2",
        ]);
        expect(sum.a).toBe(1);

        const element = (
          /** @type {string | object} */ type,
          /** @type {object} */ props,
          /** @type {string | null} */ key = null,
        ) => Object.freeze({ $$typeof: Symbol.for("react.element"), type, key, ref: null, props });
        /** The lines of `received` in the diff of `{ e: received, wrong: 1 }` with `{ e: pattern, wrong: 2 }`. */
        const printed = (/** @type {object} */ received, /** @type {object} */ pattern) =>
          failureOf(() => expect({ e: received, wrong: 1 }).toMatchObject({ e: pattern, wrong: 2 }))
            .split("\n")
            .filter(line => line.startsWith("+   ") && !line.startsWith('+   "wrong"'));
        const item = Object.freeze({
          id: "c1",
          get label() {
            return this.id + "?";
          },
        });
        const list = Object.freeze({
          id: "a1",
          get label() {
            return this.id + "!";
          },
          children: Object.freeze([element("li", item), element("li", Object.freeze({ id: "c2" }))]),
        });
        const pattern = Object.freeze({ props: { id: string, children: [{ props: { id: string } }, {}] } });
        // The printer writes no space before the last prop of an element, as Bun 1.4.2 does. These lines do not test that.
        expect(printed(element("ul", list), pattern)).toEqual([
          '+   "e": <ul id=Any<String>label="a1!">',
          '+     <li id=Any<String>label="c1?" />',
          '+     <li id="c2" />',
          "+   </ul>,",
        ]);
        expect(list.id).toBe("a1");
        expect(item.id).toBe("c1");
        expect(pattern.props.id).toBe(string);
        // The element and its props are two objects. Each shows what its own pattern matched.
        expect(
          printed(element("input", { type: "text", key: "prop" }, "k1"), { key: string, props: { type: string } }),
        ).toEqual(['+   "e": <input key=Any<String> type=Any<String>key="prop" />,']);
        // A single child, and a prop that is an element or an object, show what they matched as well.
        expect(
          printed(element("p", { id: "a1", children: element("b", { id: "c1" }) }), {
            props: { children: { props: { id: string } } },
          }),
        ).toEqual(['+   "e": <p id="a1">', "+     <b id=Any<String> />", "+   </p>,"]);
        expect(
          printed(element("p", { icon: element("i", { id: "c1" }), style: { color: "red", width: 1 } }), {
            props: { icon: { props: { id: string } }, style: { color: string } },
          }),
        ).toEqual([
          '+   "e": <p icon=<i id=Any<String> />style={',
          '+       "color": Any<String>,',
          '+       "width": 1,',
          "+     } />,",
        ]);
      });

      test("keeps the matchers and the objects of its rows while a getter collects garbage", () => {
        const names = Array.from({ length: 40 }, (_, i) => "row" + String(i).padStart(2, "0"));
        let collections = 0;
        const received = {
          // Sorts first, so it runs before a row is printed.
          get aaa() {
            Bun.gc(true);
            collections++;
            // A cell that the collection freed goes to the next matcher or object of its size.
            return Array.from({ length: 100 }, () => [expect.any(Boolean), { id: "other", label: "other" }]).length;
          },
          // Each read gives a new object, so only the rows hold the one that the comparison read.
          get nested() {
            return { id: 7, label: "fresh" };
          },
          wrong: 1,
        };
        // The pattern does not name the property next to each row. The diff marks its line, so it folds no row.
        for (const [i, name] of names.entries()) Object.assign(received, { [name]: i, [name + "x"]: i });
        // Each read of the pattern gives a matcher that nothing else holds.
        const pattern = {};
        for (const name of names) {
          Object.defineProperty(pattern, name, { enumerable: true, get: () => expect.any(Number) });
        }
        Object.defineProperty(pattern, "nested", { enumerable: true, get: () => ({ id: expect.any(Number) }) });
        pattern.wrong = 2;

        const lines = failureOf(() => expect(received).toMatchObject(pattern)).split("\n");
        expect(collections).toBe(1);
        expect(lines.filter(line => /"(row\d\d|id|label)": /.test(line))).toEqual([
          '      "id": Any<Number>,',
          '+     "label": "fresh",',
          ...names.map(name => `    "${name}": Any<Number>,`),
        ]);
      });
    }
    if (isBun) {
      // https://github.com/oven-sh/bun/issues/9089
      describe("when the match fails, the diff does not flag a matcher that passed", () => {
        /** The lines that the diff in the message of `error` marks with `-` or `+`. */
        const flaggedLinesOf = (/** @type {unknown} */ error) => {
          const message = Bun.stripANSI(ANY(error).message);
          expect(message).toMatch(/^expect\(received\)\.(resolves\.|rejects\.)?toMatchObject\(expected\)\n/);
          return message.split("\n").filter(line => /^[-+] {3}/.test(line));
        };
        const flaggedLines = (/** @type {any} */ received, /** @type {any} */ expected) => {
          try {
            expect(received).toMatchObject(expected);
          } catch (e) {
            return flaggedLinesOf(e);
          }
          throw new Error("toMatchObject did not throw");
        };
        /** The lines of the diff that it does not mark. */
        const unmarkedLines = (/** @type {any} */ received, /** @type {any} */ expected) => {
          try {
            expect(received).toMatchObject(expected);
          } catch (e) {
            return Bun.stripANSI(ANY(e).message)
              .split("\n")
              .filter(line => /^ {2,}\S/.test(line));
          }
          throw new Error("toMatchObject did not throw");
        };
        /** The message that `assertion` throws, with no colors. */
        const thrownMessage = (/** @type {() => unknown} */ assertion) => {
          try {
            assertion();
          } catch (e) {
            return Bun.stripANSI(ANY(e).message);
          }
          throw new Error("the assertion did not throw");
        };
        /**
         * A built-in matcher that tells the test when it is asked: `expect.any()` of a class whose `Symbol.hasInstance`
         * is `answer`. After the first mismatch the diff asks built-in matchers only, and starts no function of
         * `expect.extend()`. It prints as `Any<Asked>`.
         */
        const askedOf = (/** @type {(value: any) => unknown} */ answer, not = false) => {
          class Asked {
            static [Symbol.hasInstance](/** @type {unknown} */ value) {
              return answer(value);
            }
          }
          return (not ? expect.not : expect).any(Asked);
        };
        const epoch = new Date(0);

        test("after the first mismatch, in each key order", () => {
          const onlyA = ['-   "a": Any<Date>,', '+   "a": "foobar",'];
          expect(
            flaggedLines(
              { a: "foobar", b: epoch, c: "hello" },
              { a: expect.any(Date), b: expect.any(Date), c: "hello" },
            ),
          ).toEqual(onlyA);
          expect(
            flaggedLines(
              { b: epoch, a: "foobar", c: "hello" },
              { b: expect.any(Date), a: expect.any(Date), c: "hello" },
            ),
          ).toEqual(onlyA);
          expect(
            flaggedLines(
              { c: "hello", a: "foobar", b: epoch },
              { c: expect.stringContaining("ell"), a: "wrong", b: expect.any(Date) },
            ),
          ).toEqual(['-   "a": "wrong",', '+   "a": "foobar",']);
        });

        describe("for each kind of matcher, as the only matcher of the pattern, in each key order", () => {
          let calls = 0;
          expect.extend({
            toBeANumberHere(/** @type {unknown} */ received) {
              calls++;
              return { pass: typeof received === "number", message: () => "" };
            },
          });
          // A function for each, so that no matcher keeps a state from the other key order.
          test.each([
            ["expect.any()", 5, () => expect.any(Number)],
            ["expect.anything()", 5, () => expect.anything()],
            ["expect.stringContaining()", "text", () => expect.stringContaining("ex")],
            ["expect.stringMatching()", "text", () => expect.stringMatching(/^te/)],
            ["expect.closeTo()", 0.1 + 0.2, () => expect.closeTo(0.3, 5)],
            ["expect.not.any()", 5, () => expect.not.any(String)],
            ["expect.not.anything()", null, () => ANY(expect.not).anything()],
            ["expect.not.stringContaining()", "text", () => expect.not.stringContaining("no")],
            ["expect.not.stringMatching()", "text", () => expect.not.stringMatching(/^no/)],
            ["expect.not.closeTo()", 1, () => expect.not.closeTo(0.3, 5)],
          ])("%s", (_, value, matcher) => {
            const onlyA = ['-   "a": 2,', '+   "a": 1,'];
            // With the matcher first, the comparison asks it. With the matcher last, the diff does.
            expect(flaggedLines({ m: value, a: 1 }, { m: matcher(), a: 2 })).toEqual(onlyA);
            expect(flaggedLines({ a: 1, m: value }, { a: 2, m: matcher() })).toEqual(onlyA);
          });

          // A matcher of expect.extend() is a function of the user. expect.objectContaining() and
          // expect.arrayContaining() compare what they hold with what the received value holds, and that comparison
          // asks each matcher and each asymmetricMatch() method in either of the two. The comparison asks all of these.
          // The diff asks none of them, so after the mismatch the line of the matcher stays flagged, as it is with no
          // diff walk.
          const counted = (answer = true) => askedOf(() => (calls++, answer));
          test.each([
            ["expect.objectContaining()", { c: 1, d: 2 }, () => expect.objectContaining({ c: counted() }), undefined],
            ["expect.arrayContaining()", [1, 2], () => expect.arrayContaining([counted()]), undefined],
            [
              "expect.not.objectContaining()",
              { c: 1 },
              () => expect.not.objectContaining({ c: counted(false) }),
              undefined,
            ],
            ["expect.not.arrayContaining()", [1, 2], () => expect.not.arrayContaining([counted(false)]), undefined],
            ["expect.objectContaining() that holds nothing", { c: new Date(0) }, () => expect.objectContaining({}), ""],
            ["expect.arrayContaining() that holds nothing", [1], () => expect.arrayContaining([]), ""],
            ["a matcher of expect.extend()", 5, () => ANY(expect).toBeANumberHere(), "toBeANumberHere []"],
            [
              "expect.not with a matcher of expect.extend()",
              "text",
              () => ANY(expect.not).toBeANumberHere(),
              "not toBeANumberHere []",
            ],
            [
              "expect.toSatisfy()",
              5,
              () => ANY(expect).toSatisfy((/** @type {unknown} */ value) => (calls++, value === 5)),
              undefined,
            ],
          ])("%s is asked by the comparison alone", (_, value, matcher, printed) => {
            calls = 0;
            expect(flaggedLines({ m: value, a: 1 }, { m: matcher(), a: 2 })).toEqual(['-   "a": 2,', '+   "a": 1,']);
            const byTheComparison = calls;
            // `printed` is empty where the matcher holds nothing that counts.
            expect(byTheComparison > 0).toBe(printed !== "");
            const flagged = flaggedLines({ a: 1, m: value, last: 1 }, { a: 2, m: matcher(), last: expect.any(Number) });
            expect(calls).toBe(byTheComparison);
            // The line of `last` is not flagged: the diff asks the matcher there.
            expect(flagged.filter(line => line.includes('"last"'))).toEqual([]);
            expect(flagged.filter(line => line.startsWith('-   "m": ') || line.startsWith('+   "m": '))).toHaveLength(
              2,
            );
            if (printed) expect(flagged).toContain(`-   "m": ${printed},`);
          });
        });

        test("in an array and in a nested object", () => {
          expect(flaggedLines([1, epoch, "x"], [expect.any(String), expect.any(Date), "x"])).toEqual([
            "-   Any<String>,",
            "+   1,",
          ]);
          expect(
            flaggedLines(
              { outer: { a: 1, b: "x" }, ok: 42 },
              { outer: { a: 2, b: expect.any(String) }, ok: expect.any(Number) },
            ),
          ).toEqual(['-     "a": 2,', '+     "a": 1,']);
          expect(flaggedLines({ 0: "x", 5: epoch }, { 0: "y", 5: expect.any(Date) })).toEqual([
            '-   "0": "y",',
            '+   "0": "x",',
          ]);
        });

        describe("at a key that the received value lacks", () => {
          /** @type {unknown[]} */
          let asked = [];
          const acceptsAnything = () => askedOf(value => (asked.push(value), true));

          test("a matcher after it is not flagged", () => {
            expect(flaggedLines({ b: epoch }, { a: 1, b: expect.any(Date) })).toEqual(['-   "a": 1,']);
          });

          // The match fails at such a key, and the comparison asks no matcher there. So the diff asks none, and the
          // line stays flagged. Jest asks the matcher about undefined.
          test.each([
            ["as the only mismatch", { a: 1 }, () => ({ a: 1, b: expect.any(String) }), ['-   "b": Any<String>,']],
            [
              "a matcher that accepts undefined",
              { a: 1 },
              () => ({ a: 2, b: expect.not.stringContaining("zz") }),
              ['-   "a": 2,', '-   "b": StringNotContaining "zz",', '+   "a": 1,'],
            ],
            [
              "a matcher that accepts anything",
              { a: 1 },
              () => ({ a: 2, b: acceptsAnything() }),
              ['-   "a": 2,', '-   "b": Any<Asked>,', '+   "a": 1,'],
            ],
            [
              "in a nested object",
              { a: 1, n: {} },
              () => ({ a: 2, n: { b: expect.not.stringContaining("zz") } }),
              [
                '-   "a": 2,',
                '-   "n": {',
                '-     "b": StringNotContaining "zz",',
                "-   },",
                '+   "a": 1,',
                '+   "n": {},',
              ],
            ],
            [
              "past the end of a shorter array",
              [1],
              () => [2, expect.not.stringContaining("zz")],
              ["-   2,", '-   StringNotContaining "zz",', "+   1,"],
            ],
            [
              "inside an object of the pattern",
              { a: 1 },
              () => ({ a: 2, n: { b: expect.any(Number) } }),
              ['-   "a": 2,', '-   "n": {', '-     "b": Any<Number>,', "-   },", '+   "a": 1,'],
            ],
          ])("a matcher there is not asked: %s", (_, received, pattern, flagged) => {
            asked = [];
            expect(flaggedLines(received, pattern())).toEqual(flagged);
            expect(asked).toEqual([]);
          });

          test("a matcher at a key that holds undefined is asked", () => {
            asked = [];
            expect(flaggedLines({ a: 1, b: undefined }, { a: 2, b: acceptsAnything() })).toEqual([
              '-   "a": 2,',
              '+   "a": 1,',
            ]);
            expect(asked).toEqual([undefined]);
          });
        });

        test("for the values of Jest's own test of this diff", () => {
          // Jest does not print `c`, which the pattern does not name.
          expect(
            flaggedLines(
              { a: "b", c: "d", [Symbol.for("jest")]: "jest" },
              { a: "c", [Symbol.for("jest")]: expect.any(String) },
            ),
          ).toEqual(['-   "a": "c",', '+   "a": "b",', '+   "c": "d",']);
        });

        test("in each kind of object, in each key order", () => {
          class Point {
            x = 1;
            y = 2;
          }
          const onlyY = ['-   "y": 3,', '+   "y": 2,'];
          const xAndY = ['-   "x": Any<Number>,', '-   "y": 3,', '+   "x": 1,', '+   "y": 2,'];
          for (const [make, flagged, afterTheMismatch] of [
            [() => ({ x: 1, y: 2 }), onlyY],
            [() => Object.assign(Object.create(null), { x: 1, y: 2 }), onlyY],
            [() => new Point(), onlyY],
            [() => Object.assign([], { 0: 1, 1: 2 }), ["-   3,", "+   2,"]],
            // The diff asks at a key of a plain object, a class instance and an array. A read at a key of an object
            // of the runtime can be a native getter, so there the matcher after the mismatch stays flagged.
            [() => Object.assign(new Headers(), { x: 1, y: 2 }), onlyY, xAndY],
            [() => Object.assign(new URL("http://localhost/"), { x: 1, y: 2 }), onlyY, xAndY],
            [
              () => Object.assign(new Event("x"), { x: 1, y: 2 }),
              ['+   "isTrusted": false,', ...onlyY],
              [...xAndY.slice(0, 2), '+   "isTrusted": false,', ...xAndY.slice(2)],
            ],
            // These print no line for `x`, so both key orders flag the matcher.
            [() => Object.assign(new Error("e"), { x: 1, y: 2 }), undefined],
            [() => Object.assign(new Map(), { x: 1, y: 2 }), undefined],
            [() => Object.assign(new Date(0), { x: 1, y: 2 }), undefined],
          ]) {
            const pattern = Array.isArray(make()) ? [expect.any(Number), 3] : { x: expect.any(Number), y: 3 };
            const matcherFirst = flaggedLines(make(), pattern);
            expect(matcherFirst).toEqual(flagged ?? ['-   "x": Any<Number>,', '-   "y": 3,']);
            if (Array.isArray(pattern)) continue;
            expect(flaggedLines(make(), { y: 3, x: expect.any(Number) })).toEqual(afterTheMismatch ?? matcherFirst);
          }
        });

        test("after two DOM nodes that are not equal", () => {
          class Node {
            nodeType = 1;
            nodeName = "DIV";
            isEqualNode() {
              return false;
            }
          }
          // Only `isEqualNode()` tells the two nodes apart, so the match fails and the diff has no line to flag.
          expect(flaggedLines({ node: new Node(), b: epoch }, { node: new Node(), b: expect.any(Date) })).toEqual([]);
        });

        test("with two DOM nodes that are equal after the mismatch", () => {
          class Node {
            nodeType = 1;
            nodeName = "DIV";
            isEqualNode() {
              return true;
            }
          }
          // The equal nodes do not turn the failed match into one that passed.
          expect(
            flaggedLines({ a: 1, node: new Node(), b: epoch }, { a: 2, node: new Node(), b: expect.any(Date) }),
          ).toEqual(['-   "a": 2,', '+   "a": 1,']);
        });

        test("when the arrays differ in length or in keys", () => {
          expect(flaggedLines([1, 2], [expect.any(Number), 2, 3])).toEqual(["-   3,"]);
          expect(flaggedLines([1, 2, 3], [expect.any(Number), 2])).toEqual(["+   3,"]);
          // The diff does not print `extra`, the only difference, so it has no line to flag.
          expect(flaggedLines(Object.assign([epoch], { extra: 1 }), [expect.any(Date)])).toEqual([]);
          // The lengths differ and the key counts do not: only the length says that these do not match.
          expect(flaggedLines([epoch, ,], [expect.any(Date)])).toEqual(["+   undefined,"]);
          expect([1, ,]).not.toMatchObject([1]);

          // Once the lengths differ, the walk does not list the keys of the received array.
          let listed = 0;
          const received = new Proxy([epoch, 2, 3], {
            ownKeys(target) {
              listed++;
              return Reflect.ownKeys(target);
            },
          });
          expect(flaggedLines(received, [expect.any(Date), 2])).toEqual(["-   Any<Date>,", "-   2,"]);
          expect(listed).toBe(0);

          // An array matches an object with the same index keys, and the two print in two ways. So the diff flags the
          // line of a matcher that passed at an index, and the print of the array shows the matcher there. It does so
          // in each key order.
          const lines = [
            '-   "a": 2,',
            '-   "list": {',
            '-     "0": Any<Number>,',
            '-     "1": "x",',
            "-   },",
            '+   "a": 1,',
            '+   "list": [',
            "+     Any<Number>,",
            '+     "x",',
            "+   ],",
          ];
          expect(flaggedLines({ a: 1, list: [5, "x"] }, { a: 2, list: { 0: expect.any(Number), 1: "x" } })).toEqual(
            lines,
          );
          expect(
            flaggedLines({ list: [5, "x"], a: 1 }, { list: { 0: expect.any(Number), 1: "x" }, a: 2 }).toSorted(),
          ).toEqual(lines.toSorted());
        });

        test("inside an object that a getter makes anew on each read", () => {
          let reads = 0;
          const received = {
            first: 1,
            get nested() {
              reads++;
              return { id: 7, wrong: 1, after: 3 };
            },
            last: 2,
          };
          const number = expect.any(Number);
          expect(
            flaggedLines(received, { first: number, nested: { id: number, wrong: 2, after: number }, last: number }),
          ).toEqual(['-     "wrong": 2,', '+     "wrong": 1,']);
          // The diff asks the matcher on `after` about the object that the comparison read.
          expect(reads).toBe(1);
        });

        test("when the two values are not the same for the diff as for the comparison", () => {
          let reads = 0;
          const received = {
            first: 1,
            get nested() {
              return reads++ ? "gone" : { wrong: 1 };
            },
            last: 1,
          };
          // The comparison asked the matcher on `first`, and the diff asks the one on `last`.
          expect(
            flaggedLines(received, { first: expect.any(Number), nested: { wrong: 2 }, last: expect.any(String) }),
          ).toEqual([
            '-   "last": Any<String>,',
            '-   "nested": {',
            '-     "wrong": 2,',
            "-   },",
            '+   "last": 1,',
            '+   "nested": "gone",',
          ]);

          // A getter that keeps its value moves its key behind the others. No matcher is shown as passed unasked.
          const lazy = {
            get a() {
              delete this.a;
              this.a = 2;
              return 2;
            },
            m: expect.any(String),
            n: expect.any(String),
          };
          expect(flaggedLines({ a: 1, m: 1, n: 1 }, lazy)).toEqual([
            '-   "a": 2,',
            '-   "m": Any<String>,',
            '-   "n": Any<String>,',
            '+   "a": 1,',
            '+   "m": 1,',
            '+   "n": 1,',
          ]);

          // The pattern loses the key of the mismatch before the diff looks at it.
          reads = 0;
          const inner = {
            get a() {
              if (reads++) delete inner.a;
              return 2;
            },
            m: expect.any(String),
          };
          const number = expect.any(Number);
          expect(
            flaggedLines({ first: 1, nested: { a: 1, m: 1 }, last: 1 }, { first: number, nested: inner, last: number }),
          ).toEqual(['-     "m": Any<String>,', '+     "a": 1,', '+     "m": 1,']);
        });

        test("when the walk meets the same two objects again", () => {
          const inner = { x: 1, when: epoch };
          const pattern = { x: 2, when: expect.any(Date) };
          expect(flaggedLines({ first: inner, second: inner }, { first: pattern, second: pattern })).toEqual([
            '-     "x": 2,',
            '+     "x": 1,',
            '-     "x": 2,',
            '+     "x": 1,',
          ]);
          // One pattern for two objects, and only the second of them differs.
          expect(
            flaggedLines({ first: { x: 2, when: epoch }, second: inner }, { first: pattern, second: pattern }),
          ).toEqual(['-     "x": 2,', '+     "x": 1,']);

          const received = { a: 1, when: epoch };
          const expected = { a: 2, when: expect.any(Date) };
          Object.assign(received, { self: received });
          Object.assign(expected, { self: expected });
          expect(flaggedLines(received, expected)).toEqual(['-   "a": 2,', '+   "a": 1,']);
        });

        test("asks each matcher once where the two values lead back to themselves", () => {
          /** @type {string[]} */
          const asked = [];
          const byName = (/** @type {string} */ name) => askedOf(() => (asked.push(name), true));
          // The object that differs holds the two roots.
          const received = { before: 1, inner: { x: 1, root: ANY(undefined) }, after: 1 };
          const pattern = { before: byName("before"), inner: { x: 2, root: ANY(undefined) }, after: byName("after") };
          received.inner.root = received;
          pattern.inner.root = pattern;
          expect(flaggedLines(received, pattern)).toEqual(['-     "x": 2,', '+     "x": 1,']);
          expect(asked).toEqual(["before", "after"]);
        });

        test("with a received value that leads around to itself", () => {
          let asked = 0;
          const ring = (/** @type {number} */ length, /** @type {unknown} */ ts) => {
            const nodes = Array.from({ length }, (_, id) => ({ id, ts: ts ?? id, next: ANY(undefined) }));
            nodes.forEach((node, index) => (node.next = nodes[(index + 1) % length]));
            return nodes[0];
          };
          // The received ring has one node more, so each time around it meets another node of the pattern: 12 pairs.
          // The diff goes into each pair once, and asks its matcher once.
          const flagged = flaggedLines(
            { list: ring(4) },
            {
              list: ring(
                3,
                askedOf(() => (asked++, true)),
              ),
            },
          );
          expect(flagged.map(line => line.replace(/ +/g, " "))).toEqual([
            '- "next": [Circular],',
            '+ "next": {',
            '+ "id": 3,',
            '+ "next": [Circular],',
            '+ "ts": Any<Asked>,',
            "+ },",
          ]);
          expect(asked).toBe(12);
        });

        test("when a matcher puts other objects into the pattern", () => {
          for (const width of [33, 41, 57]) {
            // An object literal of a size that few others have: a new one takes the memory of one that went away.
            const names = Array.from({ length: width }, (_, index) => `p${index}: 0`);
            const wide = new Function("m", `return { ${names.join(", ")}, m };`);
            /** @type {Record<string, unknown>} */
            const pattern = { a: 2 };
            /** @type {Record<string, unknown>} */
            const received = { a: 1, b: 1 };
            // The diff asks this matcher, and the question puts other objects into the pattern.
            pattern.b = askedOf(() => {
              for (let index = 0; index < 16; index++) pattern["c" + index] = null;
              Bun.gc(true);
              for (let index = 0; index < 16; index++) pattern["c" + index] = wide(expect.any(String));
              return true;
            });
            for (let index = 0; index < 16; index++) {
              pattern["c" + index] = wide(1);
              received["c" + index] = wide("x");
            }
            // The diff has read the first objects and found no matcher in them. It asks the matchers of the others.
            expect(flaggedLines(received, pattern)).toEqual(['-   "a": 2,', '+   "a": 1,']);
          }
        });

        test("with a received value that has no end", () => {
          class Endless {
            get m() {
              return 1;
            }
            get next() {
              return new Endless();
            }
          }
          const around = { m: expect.any(Number), next: ANY(undefined) };
          around.next = around;
          // The stack runs out before the diff has asked every matcher. The message is still the one of the assertion.
          expect(flaggedLines({ a: 1, deep: new Endless() }, { a: 2, deep: around })).toEqual([
            '-   "a": 2,',
            '-   "deep": {',
            '-     "m": Any<Number>,',
            '-     "next": [Circular],',
            "-   },",
            '+   "a": 1,',
            '+   "deep": Endless {},',
          ]);
        });

        test("after a matcher in the received value or an asymmetricMatch() object did not match", () => {
          expect(flaggedLines({ a: expect.any(Date), b: epoch }, { a: "foobar", b: expect.any(Date) })).toEqual([
            '-   "a": "foobar",',
            '+   "a": Any<Date>,',
          ]);
          expect(
            flaggedLines({ a: 1, b: epoch }, { a: { asymmetricMatch: () => false }, b: expect.any(Date) }),
          ).toEqual(['-   "a": {', '-     "asymmetricMatch": [Function],', "-   },", '+   "a": 1,']);
        });

        test("prints a matcher in the received value and an asymmetricMatch() object the same in each key order", () => {
          // Neither gets a row from the comparison, so the diff asks neither after the mismatch. If the comparison
          // starts to give them rows, the diff has to ask them too, or the key order decides what this prints.
          const answers = () => ({ asymmetricMatch: (/** @type {unknown} */ value) => value === 5 });
          for (const [received, pattern] of [
            [{ b: expect.any(Number) }, { b: 5 }],
            [{ b: 5 }, { b: answers() }],
            [{ b: answers() }, { b: 5 }],
          ]) {
            const mismatchLast = flaggedLines({ ...received, a: 1 }, { ...pattern, a: 2 });
            expect(mismatchLast).toContain('-   "a": 2,');
            expect(flaggedLines({ a: 1, ...received }, { a: 2, ...pattern })).toEqual(mismatchLast);
          }
        });

        test("goes into two objects with an asymmetricMatch key where the comparison does", () => {
          // The two objects have one shape, so the comparison calls no asymmetricMatch(). It looks inside them.
          const received = () => ({ asymmetricMatch: () => true, n: 5 });
          const pattern = () => ({ asymmetricMatch: expect.any(Function), n: expect.any(Number) });
          const onlyA = ['-   "a": 2,', '+   "a": 1,'];
          expect(flaggedLines({ o: received(), a: 1 }, { o: pattern(), a: 2 })).toEqual(onlyA);
          expect(flaggedLines({ a: 1, o: received() }, { a: 2, o: pattern() })).toEqual(onlyA);
        });

        test("with a matcher inside two objects that asymmetricMatch() answered for", () => {
          // The comparison does not go into the two objects, so nothing asked the matcher on `x`.
          const answers = { asymmetricMatch: () => true };
          expect(flaggedLines({ a: { ...answers, x: "text" }, b: 1 }, { a: { x: expect.any(Number) }, b: 2 })).toEqual([
            '-     "x": Any<Number>,',
            '+     "asymmetricMatch": [Function],',
            '+     "x": "text",',
            '-   "b": 2,',
            '+   "b": 1,',
          ]);
          expect(flaggedLines({ a: { x: "text" }, b: 1 }, { a: { ...answers, x: expect.any(Number) }, b: 2 })).toEqual([
            '-     "asymmetricMatch": [Function],',
            '-     "x": Any<Number>,',
            '+     "x": "text",',
            '-   "b": 2,',
            '+   "b": 1,',
          ]);

          // Nor does the diff ask it, with the mismatch before the two objects or after them.
          let asked = 0;
          const askedInside = () => askedOf(() => (asked++, true));
          for (const [received, pattern] of [
            [{ ...answers, x: 5 }, { x: askedInside() }],
            [{ x: 5 }, { ...answers, x: askedInside() }],
          ]) {
            flaggedLines({ a: 1, pair: received }, { a: 2, pair: pattern });
            flaggedLines({ pair: received, a: 1 }, { pair: pattern, a: 2 });
          }
          expect(asked).toBe(0);
        });

        test("through .resolves and .rejects", async () => {
          const received = { a: "foobar", b: epoch };
          const expected = { a: expect.any(Date), b: expect.any(Date) };
          for (const assert of [
            () => expect(Promise.resolve(received)).resolves.toMatchObject(expected),
            () => expect(Promise.reject(received)).rejects.toMatchObject(expected),
          ]) {
            let error;
            try {
              await assert();
            } catch (e) {
              error = e;
            }
            expect(flaggedLinesOf(error)).toEqual(['-   "a": Any<Date>,', '+   "a": "foobar",']);
          }
        });

        // Outside a test `expect.soft()` throws at once.
        test("through expect.soft", async () => {
          const { bunEnv, bunExe } = require("harness");
          const src = `
            const { expect } = require("bun:test");
            try {
              expect.soft({ a: "foobar", b: new Date(0) }).toMatchObject({ a: expect.any(Date), b: expect.any(Date) });
            } catch (error) {
              console.log(JSON.stringify(Bun.stripANSI(error.message).split("\\n").filter(line => /^[-+] {3}/.test(line))));
            }
          `;
          await using proc = Bun.spawn({
            cmd: [bunExe(), "-e", src],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
            stdout: '["-   \\"a\\": Any<Date>,","+   \\"a\\": \\"foobar\\","]\n',
            exitCode: 0,
            signalCode: null,
          });
        });

        test("and leaves both values as they were", () => {
          const tags = ["a", "b"];
          const received = Object.freeze({
            name: "alice",
            id: 7,
            tags,
            get when() {
              return epoch;
            },
          });
          const expected = {
            name: "bob",
            id: expect.any(Number),
            tags: [expect.any(String), "b"],
            when: expect.any(Date),
          };
          expect(flaggedLines(received, expected)).toEqual(['-   "name": "bob",', '+   "name": "alice",']);
          expect(received.id).toBe(7);
          expect(tags[0]).toBe("a");
          expect(typeof Object.getOwnPropertyDescriptor(received, "when")?.get).toBe("function");
          expect(Object.isFrozen(received)).toBe(true);
        });

        describe("and to find them", () => {
          const count = { reads: { before: 0, after: 0 }, calls: { before: 0, after: 0 } };
          const countedAs = (/** @type {"before" | "after"} */ position) =>
            askedOf(() => (count.calls[position]++, true));
          const makeReceived = (/** @type {unknown} */ differs) => ({
            get before() {
              count.reads.before++;
              return 1;
            },
            differs,
            get after() {
              count.reads.after++;
              return 1;
            },
          });
          const expected = {
            before: countedAs("before"),
            differs: "bob",
            after: countedAs("after"),
          };
          const counted = (/** @type {() => void} */ run) => {
            count.reads = { before: 0, after: 0 };
            count.calls = { before: 0, after: 0 };
            run();
            return count;
          };

          test("asks each matcher that passes once, and reads the value for it once", () => {
            expect(
              counted(() =>
                expect(flaggedLines(makeReceived("alice"), expected)).toEqual([
                  '-   "differs": "bob",',
                  '+   "differs": "alice",',
                ]),
              ),
            ).toEqual({ reads: { before: 1, after: 1 }, calls: { before: 1, after: 1 } });
            expect(counted(() => expect(makeReceived("bob")).toMatchObject(expected))).toEqual({
              reads: { before: 1, after: 1 },
              calls: { before: 1, after: 1 },
            });

            // `expect.stringMatching()` with a `g` flag gives another answer each time.
            expect(flaggedLines({ a: "x", b: 1 }, { a: expect.stringMatching(/x/g), b: 2 })).toEqual([
              '-   "b": 2,',
              '+   "b": 1,',
            ]);
            let asked = 0;
            class Never {
              static [Symbol.hasInstance]() {
                asked++;
                return false;
              }
            }
            expect(flaggedLines({ a: 1, b: 2 }, { a: expect.any(Never), b: expect.any(Number) })).toEqual([
              '-   "a": Any<Never>,',
              '+   "a": 1,',
            ]);
            // The comparison leaves a record of the matcher that said no, so the diff does not ask that one again.
            expect(asked).toBe(1);
          });

          test("does not ask the matcher at the mismatch again", async () => {
            // `expect.stringMatching()` with a `g` flag gives another answer each time it is asked. Here it says yes
            // for `a`, then no for `b`. A second question about `b` would get a yes, and the diff would flag no line.
            const everyOtherTime = expect.stringMatching(/x/g);
            expect(flaggedLines({ a: "x", b: "x" }, { a: everyOtherTime, b: everyOtherTime })).toEqual([
              '-   "b": StringMatching /x/g,',
              '+   "b": "x",',
            ]);

            // A matcher that says yes one time for each value. The comparison asked it, and it said no.
            /** @type {string[]} */
            const spent = ["token"];
            const usedOnce = askedOf(value => {
              const pass = !spent.includes(value);
              spent.push(value);
              return pass;
            });
            expect(flaggedLines({ token: "token", last: 1 }, { token: usedOnce, last: 1 })).toEqual([
              '-   "token": Any<Asked>,',
              '+   "token": "token",',
            ]);
            expect(spent).toEqual(["token", "token"]);

            // After the mismatch the diff does not ask a regular expression with a `g` flag at all: a question moves
            // where it matches next. So a call that is tried again gets the answers that it gets with no diff.
            let attempts = 0;
            await expect
              .poll(() => ({ ready: ++attempts >= 2, name: "x" }), { interval: 1 })
              .toMatchObject({ ready: true, name: expect.stringMatching(/x/g) });
            expect(attempts).toBe(2);
            for (const flags of ["g", "y", "gi"]) {
              expect(
                flaggedLines({ a: 1, b: "x" }, { a: 2, b: expect.stringMatching(new RegExp("x", flags)) }),
              ).toEqual(['-   "a": 2,', `-   "b": StringMatching /x/${flags},`, '+   "a": 1,', '+   "b": "x",']);
            }
          });

          test("does not ask the matcher at the mismatch again, in an object that a getter makes anew", async () => {
            let asked = 0;
            class Never {
              static [Symbol.hasInstance]() {
                asked++;
                return false;
              }
            }
            let reads = 0;
            const received = {
              get made() {
                reads++;
                return { b: 1 };
              },
            };
            expect(flaggedLines(received, { made: { b: expect.any(Never) } })).toEqual([
              '-     "b": Any<Never>,',
              '+     "b": 1,',
            ]);
            // The comparison reads the object, and the print reads it. The diff takes the one of the comparison.
            expect({ asked, reads }).toEqual({ asked: 1, reads: 2 });

            const made = (/** @type {() => object} */ make) => ({
              first: "x",
              get made() {
                return make();
              },
            });
            const everyOtherTime = expect.stringMatching(/x/g);
            expect(
              flaggedLines(
                made(() => ({ b: "x" })),
                { first: everyOtherTime, made: { b: everyOtherTime } },
              ),
            ).toEqual(['-     "b": StringMatching /x/g,', '+     "b": "x",']);

            let attempts = 0;
            await expect
              .poll(
                () => {
                  const ready = ++attempts >= 2;
                  return made(() => ({ ready, name: "x" }));
                },
                { interval: 1 },
              )
              .toMatchObject({ made: { ready: true, name: expect.stringMatching(/x/g) } });
            expect(attempts).toBe(2);
          });

          test("asks a matcher that said no about another object that has the same pattern", () => {
            /** @type {number[]} */
            const asked = [];
            // One object of the pattern for each item. Its matcher says no for the first item.
            const row = {
              id: askedOf(value => (asked.push(value), value % 2 === 0)),
              name: expect.any(String),
            };
            expect(
              flaggedLines(
                [
                  { id: 1, name: "a" },
                  { id: 2, name: "b" },
                  { id: 4, name: 3 },
                ],
                [row, row, row],
              ),
            ).toEqual(['-     "id": Any<Asked>,', '+     "id": 1,', '-     "name": Any<String>,', '+     "name": 3,']);
            expect(asked).toEqual([1, 2, 4]);
          });

          describe("where the diff shows no row", () => {
            let asked = 0;
            const askedAtAKey = () => askedOf(() => (asked++, true));
            const withKeys = (/** @type {object} */ holder) => Object.assign(holder, { a: 1, code: 5 });
            // The printer shows a row at a key of an object and at an index of an array. At a key of one of these it
            // shows none, so the diff asks no matcher there: the answer would change no line.
            test.each([
              ["an Error", () => withKeys(new Error("x"))],
              ["a function", () => withKeys(() => {})],
              ["a class", () => withKeys(class {})],
              ["a Map", () => withKeys(new Map())],
              ["a Set", () => withKeys(new Set())],
              ["a WeakMap", () => withKeys(new WeakMap())],
              ["a WeakSet", () => withKeys(new WeakSet())],
              ["a Date", () => withKeys(new Date(0))],
              ["a RegExp", () => withKeys(/x/)],
              ["a Promise", () => withKeys(Promise.resolve(1))],
              ["a typed array", () => withKeys(new Uint8Array(2))],
              ["an ArrayBuffer", () => withKeys(new ArrayBuffer(2))],
              ["a DataView", () => withKeys(new DataView(new ArrayBuffer(2)))],
              ["a String object", () => withKeys(new String("s"))],
              ["a Proxy", () => new Proxy({ a: 1, code: 5 }, {})],
              ["an arguments object", () => withKeys(new Function("return arguments")())],
              [
                "an arguments object of a strict function",
                () => withKeys(new Function('"use strict"; return arguments')()),
              ],
              [
                "an arguments object that a closure reads",
                () => withKeys(new Function("a", "(() => a)(); return arguments")(1)),
              ],
              ["a mock function", () => withKeys(jest.fn())],
              ["an array, where the key is no index", () => withKeys([1])],
            ])("at a key of %s", (_, make) => {
              asked = 0;
              const pattern = () => ({ a: 2, code: askedAtAKey() });
              // As the received value, under a key of it, and under a key where the comparison went into it.
              flaggedLines(make(), pattern());
              flaggedLines({ a: 1, holder: make() }, { a: 2, holder: pattern() });
              flaggedLines({ holder: make() }, { holder: pattern() });
              expect(asked).toBe(0);
              // The comparison asks the matcher here, and the printer shows no row for it. If the printer starts to show
              // one for this kind of object, the diff has to ask there too.
              const shown = unmarkedLines(make(), { code: askedAtAKey(), a: 2 });
              expect(shown.filter(line => line.includes("Any<Asked>"))).toEqual([]);
            });

            // The diff asks at a key of a plain object, a class instance and an array, and at a key of no other kind.
            // At some of these the printer does show a row. A read there can be a native getter, which the diff does not
            // call, so the line of a matcher after the mismatch stays flagged there.
            test.each([
              ["a Headers", () => withKeys(new Headers())],
              ["a URL", () => withKeys(new URL("http://localhost/"))],
              ["an Event", () => withKeys(new Event("x"))],
              ["a Response", () => withKeys(new Response("x"))],
              ["a Request", () => withKeys(new Request("http://localhost/"))],
              ["a Blob", () => withKeys(new Blob(["x"]))],
              ["a FormData", () => withKeys(new FormData())],
              ["a URLSearchParams", () => withKeys(new URLSearchParams("x=1"))],
              ["a Number object", () => withKeys(new Number(1))],
              ["a WeakRef", () => withKeys(new WeakRef({}))],
            ])("at a key of %s, after the mismatch", (_, make) => {
              asked = 0;
              const pattern = () => ({ a: 2, code: askedAtAKey() });
              flaggedLines(make(), pattern());
              flaggedLines({ a: 1, holder: make() }, { a: 2, holder: pattern() });
              flaggedLines({ holder: make() }, { holder: pattern() });
              expect(asked).toBe(0);
            });

            test("the printer shows a row at a key of a plain object", () => {
              // The check above finds a row where there is one.
              expect(unmarkedLines({ code: 5, a: 1 }, { code: askedAtAKey(), a: 2 })).toContain(
                '    "code": Any<Asked>,',
              );
            });

            test("after a matcher that said no at a key of an Error", () => {
              asked = 0;
              // The comparison asked both matchers. The message has what it has without the diff's own questions.
              const received = Object.assign(new Error("x"), { a: 1, code: 5 });
              expect(flaggedLines(received, { a: askedAtAKey(), code: expect.any(String) })).toEqual([
                '-   "a": Any<Asked>,',
                '-   "code": Any<String>,',
              ]);
              expect(asked).toBe(1);
            });
          });

          test("runs no getter of the pattern at a key that the received value lacks", () => {
            const reads = { own: 0, inherited: 0, trap: 0, index: 0 };
            const above = Object.create(Object.prototype, {
              above: { enumerable: true, get: () => (reads.inherited++, expect.any(Number)) },
            });
            const pattern = Object.create(above, {
              a: { enumerable: true, value: 2 },
              own: { enumerable: true, get: () => (reads.own++, expect.any(Number)) },
            });
            flaggedLines({ a: 1 }, pattern);
            const proxy = new Proxy(
              { a: 2, m: expect.any(Number) },
              {
                get(target, key, receiver) {
                  if (key === "m") reads.trap++;
                  return Reflect.get(target, key, receiver);
                },
              },
            );
            flaggedLines({ a: 1 }, proxy);
            const list = [1];
            Object.defineProperty(list, 1, { enumerable: true, get: () => (reads.index++, expect.any(Number)) });
            flaggedLines({ a: 1, list: [1] }, { a: 2, list });
            // The comparison reads the pattern at no key that the received value lacks, and so does the diff.
            // The message prints the own keys of the pattern, which reads each once.
            expect(reads).toEqual({ own: 1, inherited: 0, trap: 1, index: 1 });
          });

          test("at each kind of mismatch", () => {
            class Node {
              nodeType = 1;
              nodeName = "DIV";
              isEqualNode() {
                return false;
              }
            }
            class Holder {
              #kept;
              constructor(/** @type {unknown} */ kept) {
                this.#kept = kept;
              }
            }
            const withDiffers = (/** @type {unknown} */ differs) => ({ ...expected, differs });
            const { differs: _, ...withoutDiffers } = Object.getOwnPropertyDescriptors(makeReceived("alice"));
            for (const [received, pattern] of [
              [makeReceived("alice"), expected],
              [Object.defineProperties({}, withoutDiffers), expected],
              [makeReceived("alice"), withDiffers(expect.any(Number))],
              [makeReceived(expect.any(Number)), expected],
              [makeReceived("alice"), withDiffers({ asymmetricMatch: () => false })],
              [makeReceived({ inner: 1 }), withDiffers({ inner: 2 })],
              [makeReceived([1]), withDiffers([1, 2])],
              [makeReceived(Object.assign([1], { extra: 1 })), withDiffers([1])],
              [makeReceived(new Node()), withDiffers(new Node())],
              [makeReceived(new Holder(1)), withDiffers(new Holder(2))],
              [
                Object.defineProperty(makeReceived(undefined), "differs", {
                  enumerable: true,
                  get: () => ({ inner: 1 }),
                }),
                withDiffers({ inner: 2 }),
              ],
            ]) {
              expect(counted(() => flaggedLines(received, pattern))).toEqual({
                reads: { before: 1, after: 1 },
                calls: { before: 1, after: 1 },
              });
            }
          });

          test("in nested objects before and after the mismatch", () => {
            const before = countedAs("before");
            const after = countedAs("after");
            const received = { a: { b: { c: 1, when: 1 } }, b: { c: 1, when: 1 }, z: { b: { c: 1, when: 1 } } };
            const pattern = {
              a: { b: { c: 1, when: before } },
              b: { c: 2, when: after },
              z: { b: { c: 1, when: after } },
            };
            expect(counted(() => flaggedLines(received, pattern)).calls).toEqual({
              before: 1,
              after: 2,
            });
          });

          test("does not list an object that is on both sides", () => {
            let reads = 0;
            const shared = {
              get inner() {
                reads++;
                return { when: 1 };
              },
            };
            const readsOf = (/** @type {() => void} */ run) => {
              reads = 0;
              run();
              return reads;
            };
            const onlyA = ['-   "a": 2,', '+   "a": 1,'];
            // The same two values fail toEqual with the same print, and toEqual has no second walk.
            const printed = readsOf(() =>
              expect(thrownMessage(() => expect({ a: 1, s: shared }).toEqual({ a: 2, s: shared }))).toStartWith(
                "expect(received).toEqual(expected)\n",
              ),
            );
            expect(printed).toBeGreaterThan(0);
            for (const [received, pattern] of [
              [
                { a: 1, s: shared },
                { a: 2, s: shared },
              ],
              [
                { s: shared, a: 1 },
                { s: shared, a: 2 },
              ],
            ]) {
              expect(readsOf(() => expect(flaggedLines(received, pattern)).toEqual(onlyA))).toBe(printed);
            }
          });

          test("counts the assertions in a matcher once", () => {
            expect.extend({
              toPassWithAnAssertion(/** @type {unknown} */ received) {
                expect(received).toBe(1);
                return { pass: true, message: () => "" };
              },
            });
            // One in the matcher, two in `flaggedLines` and the one below.
            expect.assertions(4);
            expect(flaggedLines({ a: 1, b: 1 }, { a: ANY(expect).toPassWithAnAssertion(), b: 2 })).toEqual([
              '-   "b": 2,',
              '+   "b": 1,',
            ]);
          });

          test("asks nothing after the first mismatch when no diff is printed", () => {
            expect(counted(() => expect(makeReceived("alice")).not.toMatchObject(expected))).toEqual({
              reads: { before: 1, after: 0 },
              calls: { before: 1, after: 0 },
            });
            expect(
              counted(() =>
                expect(Bun.deepMatch({ before: 1, differs: "bob", after: 1 }, makeReceived("alice"))).toBe(false),
              ),
            ).toEqual({ reads: { before: 1, after: 0 }, calls: { before: 0, after: 0 } });
            expect(counted(() => expect(makeReceived("alice")).not.toEqual(expect.objectContaining(expected)))).toEqual(
              { reads: { before: 1, after: 0 }, calls: { before: 1, after: 0 } },
            );
            expect(
              counted(() =>
                expect(thrownMessage(() => expect(makeReceived("alice")).toMatchSnapshot(expected))).toStartWith(
                  "expect(received).toMatchSnapshot(propertyMatchers)\n\nExpected propertyMatchers to match properties from received object\n",
                ),
              ).calls,
            ).toEqual({ before: 1, after: 0 });

            const throwsAfter = {
              a: 1,
              get b() {
                throw new Error("thrown by the getter");
              },
            };
            expect(throwsAfter).not.toMatchObject({ a: 2, b: 1 });
          });

          test("asks nothing after the first mismatch when the pattern has no matcher", () => {
            // The comparison reads `before`. The diff prints both, and there is nothing to ask for.
            expect(
              counted(() =>
                expect(flaggedLines(makeReceived("alice"), { before: 1, differs: "bob", after: 1 })).toEqual([
                  '-   "differs": "bob",',
                  '+   "differs": "alice",',
                ]),
              ),
            ).toEqual({ reads: { before: 2, after: 1 }, calls: { before: 0, after: 0 } });
            const throwsAfter = {
              a: 1,
              get b() {
                throw new Error("thrown by the getter");
              },
            };
            expect(flaggedLines(throwsAfter, { a: 2, b: 1 })).toHaveLength(4);

            // The pattern can also hold objects and arrays. The diff sees, without a getter, that none of them is a
            // matcher, so it reads the received value to print it and for nothing else.
            let reads = 0;
            const received = {
              a: 1,
              get nested() {
                reads++;
                return { id: [1] };
              },
            };
            expect(flaggedLines(received, { a: 2, nested: { id: [1] } })).toEqual(['-   "a": 2,', '+   "a": 1,']);
            expect(reads).toBe(1);

            // The same for a pattern of plain objects that leads around to itself.
            reads = 0;
            /** @type {any} */
            const parent = { id: [1] };
            parent.child = { parent };
            flaggedLines(received, { a: 2, nested: parent });
            expect(reads).toBe(1);
          });

          test("reads a received value once more only where the pattern can lead to a matcher", () => {
            let reads = 0;
            const nested = (/** @type {() => unknown} */ value) => ({
              a: 1,
              get nested() {
                reads++;
                return value();
              },
              when: 1,
            });
            class Kept {
              id = 1;
            }
            const number = expect.any(Number);
            for (const [value, pattern, expected] of [
              // A plain object with no matcher. The diff sees that with no getter, and only the print reads the value.
              [() => ({ id: [1] }), { id: [1] }, 1],
              // One with a matcher. The diff reads the value to ask the matcher, and the print shows what it read.
              [() => ({ id: [1] }), { id: [number] }, 1],
              // An object that the diff cannot see into with no getter. It goes the way of the comparison there,
              // and finds no matcher. Then the print reads the value.
              [() => new Kept(), new Kept(), 2],
              // A typed array holds numbers and no matcher.
              [() => new Uint8Array([1, 2]), new Uint8Array([1, 2]), 1],
            ]) {
              reads = 0;
              expect(flaggedLines(nested(ANY(value)), { a: 2, nested: pattern, when: number })).toEqual([
                '-   "a": 2,',
                '+   "a": 1,',
              ]);
              expect(reads).toBe(expected);
            }
          });

          test("goes into an array of the pattern that has another prototype", () => {
            let asked = 0;
            // The comparison lists the keys that an array takes from its prototype, so the diff does too.
            const prototype = Object.assign(Object.create(Array.prototype), {
              1: askedOf(() => (asked++, true)),
            });
            const pattern = Object.setPrototypeOf([1], prototype);
            flaggedLines({ a: 1, list: [1, 5] }, { a: 2, list: pattern });
            expect(asked).toBe(1);
          });

          test("with a pattern that is too deep to look through", () => {
            const chain = (/** @type {number} */ depth) => {
              let value = {};
              for (let index = 0; index < depth; index++) value = { next: value };
              return value;
            };
            // Neither the look for matchers nor the print of the diff has the stack for it. The print says so, as it does with no matcher to look for.
            expect(() => expect({ a: 1, deep: chain(50_000) }).toMatchObject({ a: 2, deep: chain(50_000) })).toThrow(
              RangeError,
            );
          });

          test("finds a matcher wherever the pattern holds it", () => {
            const number = () => expect.any(Number);
            const key = Symbol("key");
            const many = (/** @type {unknown} */ last) =>
              Object.fromEntries([...Array.from({ length: 200 }, (_, index) => [`k${index}`, index]), ["last", last]]);
            const withoutFirst = (/** @type {unknown} */ n) => {
              const object = { first: 1, n };
              delete ANY(object).first;
              return object;
            };
            class Kept {
              n;
              constructor(/** @type {unknown} */ n) {
                this.n = n;
              }
            }
            const onlyA = ['-   "a": 2,', '+   "a": 1,'];
            for (const [received, pattern] of [
              [{ n: 1 }, { n: number() }],
              [
                [1, "s"],
                [number(), "s"],
              ],
              [
                [{ n: 1 }, { n: 2 }],
                [{ n: 1 }, { n: number() }],
              ],
              [
                [1.5, 2, 1],
                [1.5, 2, number()],
              ],
              [
                [, 1],
                [, number()],
              ],
              // A frozen array keeps its items in another store, which the look for matchers does not read.
              [[1], Object.freeze([number()])],
              [
                { 0: 1, 1: 2 },
                { 0: 1, 1: number() },
              ],
              [{ [key]: 1 }, { [key]: number() }],
              [{ n: 1 }, Object.freeze({ n: number() })],
              [many(1), many(number())],
              [withoutFirst(1), withoutFirst(number())],
              [{ n: 1 }, Object.assign(Object.create(null), { n: number() })],
              [new Kept(1), new Kept(number())],
              [
                { n: 1 },
                {
                  get n() {
                    return number();
                  },
                },
              ],
            ]) {
              expect(flaggedLines({ a: 1, o: received }, { a: 2, o: pattern })).toEqual(onlyA);
              expect(flaggedLines({ o: received, a: 1 }, { o: pattern, a: 2 })).toEqual(onlyA);
            }
          });

          test("asks no containing matcher, whatever it holds and whatever it is asked about", () => {
            const onlyA = ['-   "a": 2,', '+   "a": 1,'];
            class Point {
              x = 1;
            }
            for (const [received, matcher] of [
              [{ x: 1 }, expect.objectContaining({ x: 1 })],
              [{ x: 1, at: new Date(0) }, expect.objectContaining({ at: expect.any(Date) })],
              [{ x: expect.any(Number) }, expect.objectContaining({ x: 1 })],
              [new Point(), expect.objectContaining({ x: expect.any(Number) })],
              [[{ x: 1 }, [2.5]], expect.arrayContaining([{ x: expect.any(Number) }, [2.5]])],
              [[1], expect.arrayContaining(Object.freeze([1]))],
              [Object.freeze([1]), expect.arrayContaining([1])],
              [{ x: 1 }, expect.not.objectContaining({ x: expect.any(String) })],
            ]) {
              // The comparison asks it and it passes. After the mismatch its line stays flagged, and the line of the
              // matcher after it does not.
              expect(flaggedLines({ b: received, a: 1 }, { b: matcher, a: 2 })).toEqual(onlyA);
              const flagged = flaggedLines({ a: 1, b: received, z: 1 }, { a: 2, b: matcher, z: expect.any(Number) });
              expect(flagged.slice(0, 2)).toEqual(['-   "a": 2,', expect.stringMatching(/^-   "b": /)]);
              expect(flagged.filter(line => line.includes('"z"'))).toEqual([]);
            }
          });

          test("takes each answer of the comparison, also in two objects that it came to through a typed array", () => {
            const onlyA = ['-   "a": 2,', '+   "a": 1,'];
            // The comparison reads a key of a typed array, and goes into the two objects there. The diff shows no row in
            // a typed array and does not go into it. It comes to the two objects at `shown`.
            const through = (/** @type {object} */ held) => Object.assign(new Uint8Array(1), { held });
            const pair = (/** @type {unknown} */ matcher, /** @type {unknown} */ value = 5) => {
              const shared = { s: value };
              const sharedPattern = { s: matcher };
              return [
                { holder: through(shared), shown: shared, a: 1 },
                { holder: through(sharedPattern), shown: sharedPattern, a: 2 },
              ];
            };
            // A matcher that passed there is not asked again.
            let asked = 0;
            expect(flaggedLines(...pair(askedOf(() => (asked++, true))))).toEqual(onlyA);
            expect(asked).toBe(1);
            // A matcher that the diff does not ask keeps the row that the comparison made.
            let calls = 0;
            expect.extend({
              toBeFiveThere(/** @type {unknown} */ received) {
                calls++;
                return { pass: received === 5, message: () => "" };
              },
            });
            expect(flaggedLines(...pair(ANY(expect).toBeFiveThere()))).toEqual(onlyA);
            expect(flaggedLines(...pair(expect.stringMatching(/x/g), "x"))).toEqual(onlyA);
            expect(calls).toBe(1);
            // A matcher that said no there is not asked a second time, which would say yes.
            asked = 0;
            const [received, pattern] = pair(askedOf(() => ++asked > 1));
            delete ANY(received).a;
            delete ANY(pattern).a;
            expect(flaggedLines(received, pattern)).toEqual(['-     "s": Any<Asked>,', '+     "s": 5,']);
            expect(asked).toBe(1);
          });

          test("gives up where getters make new objects with no end", () => {
            let reads = 0;
            // Each read of `next` and of `other` makes a new object, down to a depth that no walk comes to the end of.
            class Lazy {
              constructor(/** @type {number} */ left) {
                this.left = left;
              }
              get m() {
                return 1;
              }
              get next() {
                reads++;
                return this.left ? new Lazy(this.left - 1) : undefined;
              }
              get other() {
                reads++;
                return this.left ? new Lazy(this.left - 1) : undefined;
              }
            }
            /** @type {any} */
            const around = { m: expect.any(Number), next: null, other: null };
            around.next = around.other = around;
            // The comparison ends at `a`. The diff follows the pattern around for a limited number of steps, and then
            // prints what it prints with no walk.
            expect(flaggedLines({ a: 1, deep: new Lazy(40) }, { a: 2, deep: around }).slice(0, 2)).toEqual([
              '-   "a": 2,',
              '-   "deep": {',
            ]);
            expect(reads).toBeLessThan(100_000);
          });

          test("goes into each object of the pattern one time at no cost", () => {
            const records = () => Array.from({ length: 4200 }, (_, i) => ({ i }));
            // A pattern with an object of its own for each record has no limit.
            expect(
              flaggedLines({ a: 1, list: records() }, { a: 2, list: records().map(() => ({ i: expect.any(Number) })) }),
            ).toEqual(['-   "a": 2,', '+   "a": 1,']);
            // One object of the pattern for all of them is what a pattern that leads around looks like. The diff goes
            // 4,096 times more into an object that it was in, and then prints what it prints with no walk.
            const one = { i: expect.any(Number) };
            expect(flaggedLines({ a: 1, list: records() }, { a: 2, list: records().map(() => one) })).toHaveLength(
              2 + 2 * 4200,
            );
          });

          test("reads no getter of an object of the runtime", async () => {
            const { tempDir } = require("harness");
            const { join } = require("node:path");
            // The getter of `body` makes a stream of the text. The getter of `size` keeps the 0 of a file that is not there.
            const response = new Response("hello");
            flaggedLines(response, { status: 500, body: expect.anything() });
            flaggedLines({ a: 1, response }, { a: 2, response: { body: expect.anything() } });
            expect(Bun.inspect(response)).toBe(Bun.inspect(new Response("hello")));
            using dir = tempDir("expect-diff-reads-no-getter", {});
            const file = Bun.file(join(String(dir), "later.txt"));
            flaggedLines(file, { name: "another", size: expect.any(Number) });
            flaggedLines({ a: 1, file }, { a: 2, file: { size: expect.any(Number) } });
            await Bun.write(join(String(dir), "later.txt"), "12345");
            expect(file.size).toBe(5);
          });

          test("lists no key of the pattern beside an object that it reads no key of", () => {
            let listed = 0;
            const counts = () =>
              new Proxy(
                { size: expect.any(Number) },
                {
                  ownKeys(target) {
                    listed++;
                    return Reflect.ownKeys(target);
                  },
                },
              );
            // The diff reads no key of a Map, so it does not go into the pattern beside one. Beside a plain object it
            // lists the keys of the pattern one time.
            flaggedLines({ a: 1, m: new Map() }, { a: 2, m: counts() });
            const besideAMap = listed;
            listed = 0;
            flaggedLines({ a: 1, m: { size: 0 } }, { a: 2, m: counts() });
            expect(listed).toBe(besideAMap + 1);
          });

          test("when the pattern throws as the diff lists its keys", () => {
            let listed = 0;
            const pattern = new Proxy(
              { a: expect.any(Number), b: 2, c: expect.any(Number) },
              {
                ownKeys(target) {
                  // The comparison lists the keys, then the diff does, then the print does.
                  if (++listed === 2) throw new Error("thrown by ownKeys");
                  return Reflect.ownKeys(target);
                },
              },
            );
            // The message is still the one of the failed match. It has the matcher that the comparison asked, on `a`,
            // and not the one on `c`. The received lines are all flagged, because a Proxy prints on one line.
            expect(flaggedLines({ a: 1, b: 1, c: 1 }, pattern)).toEqual([
              '+   "a": Any<Number>,',
              '+   "b": 1,',
              '+   "c": 1,',
            ]);
            expect(listed).toBe(3);
          });

          test("asks only a matcher of the pattern after the first mismatch", () => {
            let asked = 0;
            const countsTheQuestion = () => askedOf(() => (asked++, true));
            const method = {
              asymmetricMatch() {
                asked++;
                return true;
              },
            };
            // Neither leaves a row in the diff, so neither is asked for it.
            expect(flaggedLines({ a: 1, b: 1 }, { a: 2, b: method })).toHaveLength(6);
            expect(flaggedLines({ a: 1, b: method }, { a: 2, b: 1 })).toHaveLength(6);
            expect(flaggedLines({ a: 1, b: countsTheQuestion() }, { a: 2, b: 1 })).toHaveLength(4);
            expect(asked).toBe(0);

            // Nor does a matcher inside two DOM nodes: isEqualNode() answers for all that they hold. The comparison
            // calls it where it comes to the two nodes, and the diff does not.
            let compared = 0;
            class Node {
              nodeType = 1;
              nodeName = "DIV";
              when;
              constructor(/** @type {unknown} */ when) {
                this.when = when;
              }
              isEqualNode() {
                compared++;
                return true;
              }
            }
            flaggedLines({ a: 1, b: new Node(1) }, { a: 2, b: new Node(countsTheQuestion()) });
            expect({ asked, compared }).toEqual({ asked: 0, compared: 0 });
            flaggedLines({ b: new Node(1), a: 1 }, { b: new Node(countsTheQuestion()), a: 2 });
            expect({ asked, compared }).toEqual({ asked: 0, compared: 1 });

            // Nor does a matcher in a private field, which no line of the diff shows.
            class Holder {
              #hidden;
              shown;
              constructor(/** @type {unknown} */ hidden, /** @type {unknown} */ shown) {
                this.#hidden = hidden;
                this.shown = shown;
              }
            }
            expect(
              flaggedLines(
                { a: 1, b: new Holder(1, 1) },
                { a: 2, b: new Holder(countsTheQuestion(), expect.any(Number)) },
              ),
            ).toEqual(['-   "a": 2,', '+   "a": 1,']);
            expect(asked).toBe(0);
          });

          test("throws the failed match when a getter or a matcher after the mismatch throws", () => {
            class Throws {
              static [Symbol.hasInstance]() {
                throw new Error("thrown by Symbol.hasInstance");
              }
            }
            const onlyAAndB = (/** @type {string} */ b, /** @type {string} */ received) => [
              '-   "a": 2,',
              `-   "b": ${b},`,
              '+   "a": 1,',
              `+   "b": ${received},`,
            ];
            // What a matcher throws costs that matcher its row, and no other: `last` is not flagged.
            for (const [matcher, printed] of [
              [expect.any(Throws), "Any<Throws>"],
              [expect.not.any(Throws), "NotAny<Throws>"],
            ]) {
              expect(
                flaggedLines(
                  { first: 1, a: 1, b: 1, last: 1 },
                  { first: expect.any(Number), a: 2, b: matcher, last: expect.any(Number) },
                ),
              ).toEqual(onlyAAndB(printed, "1"));
            }
            // The diff reads `b` to ask the matcher about it. What the getter throws does the same.
            const throwsOnRead = {
              a: 1,
              get b() {
                throw new Error("thrown by the getter");
              },
              last: 1,
            };
            const flagged = flaggedLines(throwsOnRead, { a: 2, b: expect.any(Number), last: expect.any(Number) });
            expect(flagged).toHaveLength(4);
            expect(flagged.slice(0, 2)).toEqual(['-   "a": 2,', '-   "b": Any<Number>,']);
          });

          test("starts no function of expect.extend() after the mismatch, and waits for nothing", async () => {
            const begun = { waits: 0, returnsItsPromise: 0, returnsAPromise: 0, bound: 0, answers: 0 };
            const later = () => new Promise(() => {});
            expect.extend({
              async toWait() {
                begun.waits++;
                await later();
                return { pass: true, message: () => "" };
              },
              // Async with no `await` of its own. What it returns is still pending.
              async toReturnItsPromise() {
                begun.returnsItsPromise++;
                return later();
              },
              toReturnAPromise() {
                begun.returnsAPromise++;
                return later();
              },
              toBeBound: async function () {
                begun.bound++;
                await later();
                return { pass: true, message: () => "" };
              }.bind(null),
              toAnswer() {
                begun.answers++;
                return { pass: true, message: () => "" };
              },
            });
            const matchers = () => [
              ANY(expect).toWait(),
              ANY(expect).toReturnItsPromise(),
              ANY(expect).toReturnAPromise(),
              ANY(expect).toBeBound(),
              ANY(expect).toAnswer(),
              ANY(expect.not).toAnswer(),
            ];
            let answered = 0;
            const answersItself = () => ({
              asymmetricMatch() {
                answered++;
                return true;
              },
            });
            // The diff asks no expect.objectContaining() and no expect.arrayContaining(). Their comparison asks each
            // matcher and each asymmetricMatch() method in what they hold, and in what the received value holds.
            const holders = [
              (/** @type {unknown} */ held) => [{ c: 1 }, expect.objectContaining({ c: held })],
              (/** @type {unknown} */ held) => [[1], expect.arrayContaining([held])],
              (/** @type {unknown} */ held) => [{ c: 1 }, expect.not.objectContaining({ c: held })],
              (/** @type {unknown} */ held) => [
                { c: [{ d: 1 }] },
                expect.objectContaining({ c: expect.arrayContaining([expect.objectContaining({ d: held })]) }),
              ],
              (/** @type {unknown} */ held) => [
                { b: 1, c: 1, d: [1] },
                expect.objectContaining({ b: 1, c: held, d: [1] }),
              ],
              (/** @type {unknown} */ held) => [{ c: held }, expect.objectContaining({ c: 1 })],
              (/** @type {unknown} */ held) => [[{ c: held }], expect.arrayContaining([{ c: 1 }])],
            ];
            // Each call throws at once: `flaggedLines` fails if toMatchObject returns a promise. `b` stays flagged,
            // as it is with no diff walk, at the key and in each holder.
            for (const matcher of matchers()) {
              const atTheKey = flaggedLines({ a: 1, b: 1 }, { a: 2, b: matcher });
              expect(atTheKey.filter(line => line.startsWith('-   "'))).toHaveLength(2);
            }
            for (const hold of holders) {
              for (const held of [...matchers(), answersItself()]) {
                const [received, holder] = hold(held);
                const flagged = flaggedLines({ a: 1, b: received }, { a: 2, b: holder });
                expect(flagged.slice(0, 2)).toEqual(['-   "a": 2,', expect.stringMatching(/^-   "b": /)]);
              }
            }
            // A matcher in the received value is not asked after the mismatch either.
            expect(flaggedLines({ a: 1, b: ANY(expect).toWait() }, { a: 2, b: 1 })).toEqual([
              '-   "a": 2,',
              '-   "b": 1,',
              '+   "a": 1,',
              '+   "b": toWait [],',
            ]);
            expect(answered).toBe(0);
            expect(begun).toEqual({ waits: 0, returnsItsPromise: 0, returnsAPromise: 0, bound: 0, answers: 0 });

            // expect.resolvesTo and expect.rejectsTo read a promise: they can have to wait for it, and they mark it as
            // handled. The diff asks none of them. A pending promise and a thenable stay as they are.
            const pending = new Promise(() => {});
            let thens = 0;
            const thenable = {
              then() {
                thens++;
              },
            };
            for (const [value, printed] of [
              [pending, "Promise {}"],
              [thenable, undefined],
            ]) {
              for (const matcher of [expect.resolvesTo.any(Number), expect.not.resolvesTo.any(Number)]) {
                const flagged = flaggedLines({ a: 1, b: value }, { a: 2, b: matcher });
                expect(flagged.slice(0, 2)).toEqual([
                  '-   "a": 2,',
                  expect.stringMatching(/^-   "b": promise resolved to /),
                ]);
                if (printed) expect(flagged).toContain(`+   "b": ${printed},`);
              }
            }
            for (const [received, holder] of [
              [{ c: pending }, expect.objectContaining({ c: expect.resolvesTo.any(Number) })],
              [{ c: pending }, expect.not.objectContaining({ c: expect.resolvesTo.any(Number) })],
              [[pending], expect.not.arrayContaining([expect.resolvesTo.any(Number)])],
              [{ c: thenable }, expect.objectContaining({ c: expect.resolvesTo.any(Number) })],
            ]) {
              const flagged = flaggedLines({ a: 1, b: received }, { a: 2, b: holder });
              expect(flagged.slice(0, 2)).toEqual(['-   "a": 2,', expect.stringMatching(/^-   "b": /)]);
            }
            await new Promise(resolve => setImmediate(resolve));
            expect(thens).toBe(0);
            expect(flaggedLines({ a: 1, b: expect.resolvesTo.any(Number) }, { a: 2, b: pending })).toEqual([
              '-   "a": 2,',
              '-   "b": Promise {},',
              '+   "a": 1,',
              '+   "b": promise resolved to Any<Number>,',
            ]);

            let error;
            // The matcher on `b` is asked before the mismatch, so the call waits for it. It does not wait for `c`.
            const settles = Promise.withResolvers();
            const call = ANY(
              expect({ b: settles.promise, a: 1, c: pending }).toMatchObject({
                b: expect.resolvesTo.any(Number),
                a: 2,
                c: expect.resolvesTo.any(Number),
              }),
            );
            expect(call).toBeInstanceOf(Promise);
            settles.resolve(1);
            try {
              await call;
            } catch (e) {
              error = e;
            }
            expect(flaggedLinesOf(error)).toEqual([
              '-   "a": 2,',
              '+   "a": 1,',
              '-   "c": promise resolved to Any<Number>,',
              '+   "c": Promise {},',
            ]);

            // A matcher that the call waited for before the mismatch is called once.
            let started = 0;
            expect.extend({
              async toPassLater() {
                started++;
                await Promise.resolve();
                return { pass: true, message: () => "" };
              },
            });
            try {
              await expect({ a: 1, b: 1, c: 1 }).toMatchObject({
                a: ANY(expect).toPassLater(),
                b: 2,
                c: expect.any(Number),
              });
              error = undefined;
            } catch (e) {
              error = e;
            }
            expect(flaggedLinesOf(error)).toEqual(['-   "b": 2,', '+   "b": 1,']);
            expect(started).toBe(1);
          });

          test("asks no matcher of expect.resolvesTo or expect.rejectsTo after the mismatch", () => {
            const rejected = Promise.reject(new Error("rejected"));
            rejected.catch(() => {});
            const resolved = Promise.resolve(1);
            const onlyA = ['-   "a": 2,', '+   "a": 1,'];
            // The comparison asks such a matcher. The diff does not, also not about a promise that has settled or
            // about what is no promise: its line stays flagged, as it is with no diff walk.
            for (const [value, matcher, printed] of [
              [resolved, expect.resolvesTo.any(Number), "promise resolved to Any<Number>"],
              [rejected, expect.rejectsTo.any(Error), "promise rejected to Any<Error>"],
              [resolved, expect.not.resolvesTo.any(String), "promise resolved to NotAny<String>"],
              [rejected, expect.not.rejectsTo.any(String), "promise rejected to NotAny<String>"],
              [5, expect.not.resolvesTo.any(String), "promise resolved to NotAny<String>"],
            ]) {
              expect(flaggedLines({ b: value, a: 1 }, { b: matcher, a: 2 })).toEqual(onlyA);
              expect(flaggedLines({ a: 1, b: value }, { a: 2, b: matcher }).slice(0, 2)).toEqual([
                '-   "a": 2,',
                `-   "b": ${printed},`,
              ]);
              // Nor does it ask a matcher that holds one of them.
              for (const [held, holder] of [
                [{ c: value }, expect.objectContaining({ c: matcher })],
                [[value], expect.arrayContaining([matcher])],
              ]) {
                expect(flaggedLines({ a: 1, b: held }, { a: 2, b: holder }).slice(0, 2)).toEqual([
                  '-   "a": 2,',
                  expect.stringMatching(/^-   "b": /),
                ]);
              }
              // A matcher in the received value is not asked.
              expect(flaggedLines({ a: 1, b: matcher }, { a: 2, b: value })).toHaveLength(4);
            }
          });

          // In a child process, where a rejection that nothing handles reaches the `unhandledRejection` listener.
          test("leaves each promise as it is, also one that has rejected", async () => {
            const { bunEnv, bunExe } = require("harness");
            const src = `
              const { expect } = require("bun:test");
              const unhandled = [];
              process.on("unhandledRejection", reason => unhandled.push(reason.message));
              const rejects = expect.rejectsTo.any(Error);
              const rejected = name => Promise.reject(new Error(name));
              const fail = (received, pattern) => {
                try {
                  expect(received).toMatchObject(pattern);
                } catch {}
              };
              fail({ a: 1, b: rejected("rejectsTo") }, { a: 2, b: rejects });
              fail({ a: 1, b: rejected("resolvesTo") }, { a: 2, b: expect.resolvesTo.any(Number) });
              fail({ a: 1, b: rejected("not.rejectsTo") }, { a: 2, b: expect.not.rejectsTo.any(String) });
              fail({ a: 1, b: { c: rejected("objectContaining") } }, { a: 2, b: expect.objectContaining({ c: rejects }) });
              fail({ a: 1, b: [rejected("arrayContaining")] }, { a: 2, b: expect.arrayContaining([rejects]) });
              fail({ a: 1, b: rejects }, { a: 2, b: rejected("with the matcher in the received value") });
              fail({ a: 1, b: rejected("with no matcher") }, { a: 2, b: 1 });
              // A promise that is pending when the diff is made.
              const rejectLater = [];
              const pending = name => new Promise((_, reject) => rejectLater.push(() => reject(new Error(name))));
              fail({ a: 1, b: pending("pending, rejectsTo") }, { a: 2, b: rejects });
              fail({ a: 1, b: pending("pending, resolvesTo") }, { a: 2, b: expect.resolvesTo.any(Number) });
              fail({ a: 1, b: { c: pending("pending, objectContaining") } }, { a: 2, b: expect.objectContaining({ c: rejects }) });
              for (const reject of rejectLater) reject();
              await new Promise(resolve => setImmediate(resolve));
              console.log(JSON.stringify(unhandled));
            `;
            await using proc = Bun.spawn({
              cmd: [bunExe(), "-e", src],
              env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
              stdout: "pipe",
              stderr: "pipe",
            });
            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            expect({ stdout: JSON.parse(stdout), stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
              // The diff asks no matcher that reads a promise, so nothing handles these rejections, as with no diff walk.
              stdout: [
                "rejectsTo",
                "resolvesTo",
                "not.rejectsTo",
                "objectContaining",
                "arrayContaining",
                "with the matcher in the received value",
                "with no matcher",
                "pending, rejectsTo",
                "pending, resolvesTo",
                "pending, objectContaining",
              ],
              exitCode: 0,
              signalCode: null,
            });
          });

          test("for each attempt of expect.poll", async () => {
            // Each attempt that fails makes its message, as a matcher of Jest does when it throws. Vitest asks a
            // matcher beside the key that differs only when it reports the error, so it asks `after` once here.
            let attempts = 0;
            count.reads = { before: 0, after: 0 };
            count.calls = { before: 0, after: 0 };
            await expect
              .poll(() => makeReceived(++attempts < 4 ? "alice" : "bob"), { interval: 1 })
              .toMatchObject(expected);
            expect({ attempts, count }).toEqual({
              attempts: 4,
              count: { reads: { before: 4, after: 4 }, calls: { before: 4, after: 4 } },
            });
          });
        });

        // Received values and patterns over them, from a fixed seed. EXPECT_DIFF_SEED and EXPECT_DIFF_CASES look further.
        // `leafOf` makes the pattern of a value that is no object, and `around` can put a matcher around the pattern of
        // an object or an array.
        const generate = (
          /** @type {(value: unknown, roll: number) => any} */ leafOf,
          /** @type {(node: any, pattern: any, roll: number) => any} */ around = (_, pattern) => pattern,
        ) => {
          let seed = Number(process.env.EXPECT_DIFF_SEED ?? 9089);
          const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
          const below = (/** @type {number} */ limit) => Math.floor(random() * limit);
          const pick = (/** @type {any[]} */ list) => list[below(list.length)];
          class Point {}

          // A received value is a tree of { leaf }, { items } and { keys } nodes, so that a getter can make it anew.
          const received = (/** @type {number} */ depth) => {
            if (depth === 0 || random() < 0.35) return { leaf: pick([1, 2, "s", "t", true, null]) };
            if (random() < 0.25) return { items: Array.from({ length: 1 + below(3) }, () => received(depth - 1)) };
            const keys = new Map();
            for (let count = 1 + below(4); count > 0; count--) keys.set("k" + below(6), received(depth - 1));
            const prototype = pick([Object.prototype, Object.prototype, Point.prototype, null]);
            return { keys, prototype, fresh: random() < 0.3 };
          };
          const valueOf = (/** @type {any} */ node) => {
            if ("leaf" in node) return node.leaf;
            if (node.items) return node.items.map(valueOf);
            const object = Object.create(node.prototype);
            for (const [key, child] of node.keys) {
              if (child.fresh) Object.defineProperty(object, key, { enumerable: true, get: () => valueOf(child) });
              else object[key] = valueOf(child);
            }
            return object;
          };
          // A pattern is a tree over it: { same }, { differs }, { matcher, passes, value }, { items } and { keys }.
          const patternFor = (/** @type {any} */ node) => {
            const roll = random();
            if ("leaf" in node) return leafOf(node.leaf, roll);
            if (roll < 0.08) return { differs: pick([1, "zzz", { other: 1 }, [9]]) };
            if (node.items) {
              const items = node.items.map(patternFor);
              // An array of another length never matches. The diff still shows the matchers in it that pass.
              const length = random();
              if (length < 0.1) items.pop();
              else if (length < 0.2) items.push({ same: 1 });
              return around(node, { items }, random());
            }
            const keys = new Map();
            for (const [key, child] of node.keys) if (random() < 0.85) keys.set(key, patternFor(child));
            // No matcher passes at a key that the received value lacks.
            if (random() < 0.1) keys.set("extra", { ...leafOf(1, random()), passes: false });
            return around(node, { keys, prototype: node.prototype, getters: random() < 0.15 }, random());
          };
          const build = (/** @type {any} */ node, /** @type {string} */ order) => {
            if ("same" in node) return node.same;
            if ("differs" in node) return node.differs;
            if (node.matcher) return node.matcher((/** @type {any} */ held) => build(held, order));
            if (node.items) return node.items.map((/** @type {any} */ child) => build(child, order));
            const names = [...node.keys.keys()];
            if (order === "reversed") names.reverse();
            if (order === "rotated") names.push(...names.splice(0, 1));
            const object = Object.create(node.prototype);
            for (const name of names) {
              const child = node.keys.get(name);
              if (node.getters) {
                Object.defineProperty(object, name, { enumerable: true, get: () => build(child, order) });
              } else object[name] = build(child, order);
            }
            return object;
          };
          /** @returns {Generator<[() => unknown, (order: string) => unknown]>} */
          function* pairs() {
            for (let cases = Number(process.env.EXPECT_DIFF_CASES ?? 400); cases > 0; cases--) {
              let tree = received(3);
              if ("leaf" in tree) tree = { keys: new Map([["root", tree]]), prototype: Object.prototype, fresh: false };
              const pattern = patternFor(tree);
              if (pattern.keys || pattern.items) yield [() => valueOf(tree), order => build(pattern, order)];
            }
          }
          return { pairs, pick };
        };

        test("for generated values, in each key order, with each matcher asked once at most", () => {
          /** @type {Map<number, number>} */
          const asks = new Map();
          const answersAs = (/** @type {number} */ id, /** @type {boolean} */ pass, not = false) =>
            askedOf(() => (asks.set(id, (asks.get(id) ?? 0) + 1), pass), not);
          let ids = 0;
          const { pairs, pick } = generate((value, roll) => {
            if (roll < 0.4) return { same: value };
            if (roll < 0.5) return { differs: pick([7, "zzz", false]) };
            const id = ids++;
            if (roll < 0.65) return { matcher: () => answersAs(id, true) };
            if (roll < 0.75) return { matcher: () => answersAs(id, false) };
            if (roll < 0.85) return { matcher: () => (value === null ? expect.anything() : expect.any(Symbol)) };
            if (roll < 0.93) return { matcher: () => answersAs(id, false, true) };
            return { matcher: () => (value === null ? ANY(expect.not).anything() : expect.anything()) };
          });
          const flagged = (/** @type {() => unknown} */ value, /** @type {unknown} */ pattern) => {
            asks.clear();
            let lines = null;
            try {
              expect(value()).toMatchObject(ANY(pattern));
            } catch (error) {
              lines = flaggedLinesOf(error);
            }
            // The comparison and the diff together ask a matcher once.
            expect([...asks.values()].filter(count => count > 1)).toEqual([]);
            return lines;
          };

          let failed = 0;
          // Some thousand assertions: a collection after each of them is most of the time of this test.
          require("harness").withoutAggressiveGC(() => {
            for (const [value, patternIn] of pairs()) {
              const lines = flagged(value, patternIn("written"));
              if (lines === null) continue;
              failed++;
              // The key order of the pattern decides where the comparison stops, and not what the diff flags.
              expect(flagged(value, patternIn("reversed"))).toEqual(lines);
              expect(flagged(value, patternIn("rotated"))).toEqual(lines);
              // The print of the received value shows a matcher only where it passed. Where the diff does not pair that
              // line with the line of the pattern, it flags both.
              const expected = new Set(lines.filter(line => line.startsWith("-")).map(line => line.slice(1)));
              expect(
                lines.filter(line => line.startsWith("+") && line.includes("Any") && !expected.has(line.slice(1))),
              ).toEqual([]);
            }
          });
          expect(failed).toBeGreaterThan(50);
        });

        test("for generated values, starts no function of the user that the comparison did not start", () => {
          let started = 0;
          expect.extend({
            toBeStartedWhenItPasses() {
              started++;
              return { pass: true, message: () => "" };
            },
            toBeStartedWhenItFails() {
              started++;
              return { pass: false, message: () => "" };
            },
          });
          const answersItself = (/** @type {boolean} */ answer) => ({
            asymmetricMatch() {
              started++;
              return answer;
            },
          });
          const { pairs, pick } = generate(
            (value, roll) => {
              if (roll < 0.3) return { same: value };
              if (roll < 0.4) return { differs: pick([7, "zzz", false]) };
              if (roll < 0.55) return { matcher: () => ANY(expect).toBeStartedWhenItPasses() };
              if (roll < 0.65) return { matcher: () => ANY(expect).toBeStartedWhenItFails() };
              if (roll < 0.8) return { matcher: () => answersItself(roll < 0.75) };
              if (roll < 0.9) return { matcher: () => expect.anything() };
              return { matcher: () => expect.arrayContaining([ANY(expect).toBeStartedWhenItPasses()]) };
            },
            // A containing matcher around what the pattern holds there.
            (node, pattern, roll) => {
              if (roll >= 0.25) return pattern;
              const containing = node.items ? expect.arrayContaining : expect.objectContaining;
              return { matcher: (/** @type {(held: any) => any} */ build) => containing(build(pattern)) };
            },
          );
          const startedBy = (/** @type {() => void} */ assertion) => {
            started = 0;
            let threw = false;
            try {
              assertion();
            } catch {
              threw = true;
            }
            return { started, threw };
          };
          let failed = 0;
          require("harness").withoutAggressiveGC(() => {
            for (const [value, patternIn] of pairs()) {
              const { started: byTheFailedCall, threw } = startedBy(() =>
                expect(value()).toMatchObject(ANY(patternIn("written"))),
              );
              if (!threw) continue;
              failed++;
              // The same two values once more, where the match fails and no diff is made.
              expect(startedBy(() => expect(value()).not.toMatchObject(ANY(patternIn("written"))))).toEqual({
                started: byTheFailedCall,
                threw: false,
              });
            }
          });
          expect(failed).toBeGreaterThan(50);
        });
      });
    }
    test("with expect matcher", () => {
      const f = Symbol.for("foo");
      const b = Symbol.for("bar");

      class Number2 extends Number {
        constructor(/** @type {unknown} */ value) {
          super(value);
        }
      }
      class Number3 extends Number2 {
        constructor(/** @type {unknown} */ value) {
          super(value);
        }
      }

      class Boolean2 extends Boolean {
        constructor(/** @type {unknown} */ value) {
          super(value);
        }
      }
      expect({ [f]: 2 }).toMatchObject({ [f]: 2 });
      expect({ [f]: 2 }).toMatchObject({ [f]: expect.anything() });
      expect({ [f]: new Date() }).toMatchObject({ [f]: expect.any(Date) });
      expect({ [f]: new Date() }).not.toMatchObject({ [f]: expect.any(RegExp) });
      expect({ [f]: 3 }).not.toMatchObject({ [f]: 5 });
      expect({ [f]: 3 }).not.toMatchObject({ [b]: 3 });
      expect({}).toMatchObject({});
      expect([5]).toMatchObject([5]);
      expect([5]).not.toMatchObject([4]);
      expect(() => {
        // @ts-expect-error
        expect({}).toMatchObject();
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(true).toMatchObject(true);
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(true).toMatchObject(true);
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(1).toMatchObject(1);
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect("a").toMatchObject("a");
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(null).toMatchObject(null);
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(undefined).toMatchObject(undefined);
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(Symbol()).toMatchObject(Symbol());
      }).toThrow();
      expect(() => {
        // @ts-expect-error
        expect(BigInt(1)).toMatchObject(BigInt(1));
      }).toThrow();
      expect([]).toMatchObject([]);
      expect([1]).toMatchObject([1]);
      expect([1, 2]).toMatchObject([1, 2]);
      expect(() => {
        expect([1]).toMatchObject([1, 2]);
      }).toThrow();
      expect(() => {
        expect([1, 2]).toMatchObject([1]);
      }).toThrow();
      expect([]).toMatchObject({});
      expect([1]).toMatchObject({});
      expect([1, 2]).toMatchObject({ 0: 1, 1: 2 });
      expect([1, 2]).not.toMatchObject({ 0: 2 });
      expect(() => {
        expect({}).toMatchObject([]);
      }).toThrow();
      expect({ a: 1 }).toMatchObject({});
      expect({ a: 1 }).toMatchObject({ a: expect.anything() });
      expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
      expect({ a: 1, b: 2 }).toMatchObject({ a: 1, b: 2 });
      expect({ a: 1, b: 2 }).toMatchObject({ b: 2 });
      expect({ a: 1, b: 2 }).toMatchObject({ b: 2, a: 1 });
      expect({ a: 1, b: 2 }).toMatchObject({ a: 1, b: 2 });
      expect({}).not.toMatchObject({ a: 1 });
      expect({ a: 89 }).not.toMatchObject({ b: 90 });
      expect({ a: 1, b: 2 }).not.toMatchObject({ a: 1, b: 3 });
      expect({ a: 1, b: 2 }).not.toMatchObject({ a: 1, b: 2, c: 4 });
      expect({ a: new Date(), b: "jj" }).not.toMatchObject({ b: expect.any(Number) });
      expect({ a: "123" }).not.toMatchObject({ a: expect.stringContaining("4") });
      class DString extends String {
        constructor(/** @type {string} */ str) {
          super(str);
        }
      }
      expect({ a: "hello world" }).toMatchObject({ a: expect.stringContaining("wor") });
      expect({ a: "hello world" }).not.toMatchObject({ a: expect.stringContaining("wol") });
      expect({ a: "hello String" }).toMatchObject({ a: expect.stringContaining(new String("Str")) });
      expect({ a: "hello String" }).not.toMatchObject({ a: expect.stringContaining(new String("Strs")) });
      expect({ a: "hello derived String" }).toMatchObject({ a: expect.stringContaining(new DString("riv")) });
      expect({ a: "hello derived String" }).not.toMatchObject({ a: expect.stringContaining(new DString("rivd")) });
      expect({ a: "hello world" }).toMatchObject({ a: expect.stringMatching("wor") });
      expect({ a: "hello world" }).not.toMatchObject({ a: expect.stringMatching("word") });
      expect({ a: "hello world" }).toMatchObject({ a: "hello world" });
      expect({ a: "hello world" }).toMatchObject({ a: expect.stringMatching(/wor/) });
      expect({ a: "hello world" }).not.toMatchObject({ a: expect.stringMatching(/word/) });
      expect({ a: expect.stringMatching("wor") }).toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching("word") }).not.toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching(/wor/) }).toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching(/word/) }).not.toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching(/word/) }).toMatchObject({ a: "hello word" });
      expect({ a: [1, 2, 3] }).toMatchObject({ a: [1, 2, 3] });
      expect({ a: [1, 2, 3] }).toMatchObject({ a: [1, 2, 3] });
      expect({ a: [1, 2, 4] }).not.toMatchObject({ a: [1, 2, 3] });

      expect({ a: [1, 2, 3] }).toMatchObject({ a: expect.arrayContaining([1, 2]) });
      expect({ a: [1, 2, 3] }).not.toMatchObject({ a: expect.arrayContaining([4]) });
      expect({ a: ["hello", "world"] }).toMatchObject({ a: expect.arrayContaining([]) });
      expect({ a: ["hello", "world"] }).toMatchObject({ a: expect.arrayContaining(["world"]) });
      expect({ a: ["hello", "world"] }).not.toMatchObject({ a: expect.arrayContaining(["hello", "mars"]) });

      expect([]).toMatchObject([]);
      expect([]).toMatchObject({});
      expect({}).not.toMatchObject([]);
      expect({ a: 1 }).toMatchObject({});
      expect({ a: 1 }).toMatchObject({ a: 1 });

      expect({ a: 1 }).toMatchObject({ a: expect.anything() });
      expect({ a: null }).not.toMatchObject({ a: expect.anything() });
      expect({ a: undefined }).not.toMatchObject({ a: expect.anything() });

      expect({ a: new Date() }).toMatchObject({ a: expect.any(Date) });
      expect({ a: new Date() }).not.toMatchObject({ a: expect.any(RegExp) });
      expect({ a: new RegExp("a", "g") }).toMatchObject({ a: expect.any(RegExp) });
      expect({ a: /a/g }).toMatchObject({ a: expect.any(RegExp) });

      expect({
        first: new Boolean2(false),
        a: {
          4: [3, 2, 2],
          j: new Date(),
          b: {
            c: {
              num: 1,
              d: {
                e: {
                  bigint: 123n,
                  f: {
                    g: {
                      h: {
                        i: new Number3(2),
                        bool: true,
                      },
                      compare: "compare",
                    },
                  },
                  ignore1: 234,
                  ignore2: {
                    ignore3: 23421,
                    ignore4: {
                      ignore5: {
                        ignore6: "hello",
                        ignore7: "done",
                      },
                    },
                  },
                },
              },
              string1: "hello",
              string2: "hello",
              string3: "hello",
            },
          },
        },
      }).toMatchObject({
        first: expect.any(Boolean2),
        a: {
          4: [3, 2, expect.any(Number)],

          j: expect.any(Date),
          b: {
            c: {
              num: expect.any(Number),
              string1: expect.anything(),
              string2: expect.stringContaining("ll"),
              string3: expect.stringMatching(/ll/),
              d: {
                e: {
                  bigint: expect.any(BigInt),
                  f: {
                    g: {
                      compare: "compare",
                      h: {
                        i: expect.any(Number3),
                        bool: expect.any(Boolean),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      /** @type {any} */
      var a1 = [1];
      a1[f] = 99;
      expect(a1).not.toMatchObject([1]);
      expect([1]).not.toMatchObject(a1);
      expect({ 1: 1 }).not.toMatchObject(a1);
      expect(a1).not.toMatchObject({ 1: 1 });
      expect(a1).toMatchObject(a1);
    });
  });

  describe("toMatch()", () => {
    const tests = [
      {
        label: "reguler expression",
        value: "123",
        matched: /123/,
      },
      {
        label: "reguler expression object",
        value: "123",
        matched: new RegExp("123"),
      },
      {
        label: "substring",
        value: "123",
        matched: "12",
      },
      {
        label: "substring emojis",
        value: "👍👎",
        matched: "👍",
      },
      {
        label: "substring UTF-16",
        value: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂",
        matched: "🥲 ☺️ 😊",
      },
    ];
    for (const { label, value, matched } of tests) {
      test(label, () => expect(value).toMatch(matched));
    }
  });

  test_skipIf(isJest)("toBeNaN()", () => {
    expect(NaN).toBeNaN();
    expect(() => expect(NaN).not.toBeNaN()).toThrow();
    expect(0).not.toBeNaN();
    expect("hello not NaN").not.toBeNaN();
  });

  describe("toBeEmpty()", () => {
    const values = [
      {
        label: `""`,
        value: "",
      },
      {
        label: `[]`,
        value: [],
      },
      {
        label: `{}`,
        value: {},
      },
      {
        label: `new Set()`,
        value: new Set(),
      },
      {
        label: `new Map()`,
        value: new Map(),
      },
      {
        label: `new String()`,
        value: new String(),
      },
      {
        label: `new Array()`,
        value: new Array(),
      },
      {
        label: `new Uint8Array()`,
        value: new Uint8Array(),
      },
      {
        label: `new Object()`,
        value: new Object(),
      },
      {
        label: `Buffer.from("")`,
        value: Buffer.from(""),
      },
      ...(isBun
        ? [
            {
              label: `new Headers()`,
              value: new Headers(),
            },
            {
              label: `new URLSearchParams()`,
              value: new URLSearchParams(),
            },
            {
              label: `new FormData()`,
              value: new FormData(),
            },
          ]
        : []),
      {
        label: `(function* () {})()`,
        value: (function* () {})(),
      },
    ];
    if (isBun) {
      values.push({
        label: `Bun.file()`,
        value: Bun.file(tmpFile(true)),
      });
    }
    for (const { label, value } of values) {
      test(label, () => {
        expect(value).toBeEmpty();
      });
    }
  });

  describe("not.toBeEmpty()", () => {
    /** @type {any[]} */
    const values = [
      {
        label: `" "`,
        value: " ",
      },
      {
        label: `[""]`,
        value: [""],
      },
      {
        label: `[undefined]`,
        value: [undefined],
      },
      {
        label: `{ "": "" }`,
        value: { "": "" },
      },
      {
        label: `new Set([""])`,
        value: new Set([""]),
      },
      {
        label: `new Map([["", ""]])`,
        value: new Map([["", ""]]),
      },
      {
        label: `new String(" ")`,
        value: new String(" "),
      },
      {
        label: `new Array(1)`,
        value: new Array(1),
      },
      {
        label: `new Uint8Array(1)`,
        value: new Uint8Array(1),
      },
      {
        label: `Buffer.from(" ")`,
        value: Buffer.from(" "),
      },
      ...(isBun
        ? [
            {
              label: `new Headers({...})`,
              value: new Headers({
                a: "b",
                c: "d",
              }),
            },
            {
              label: `URL.searchParams`,
              value: new URL("https://example.com?d=e&f=g").searchParams,
            },
            {
              label: `FormData`,
              value: (() => {
                var a = new FormData();
                a.append("a", "b");
                a.append("c", "d");
                return a;
              })(),
            },
          ]
        : []),
      {
        label: `generator function`,
        value: (function* () {
          yield "123";
        })(),
      },
    ];
    if (isBun) {
      values.push({
        label: `Bun.file()`,
        value: Bun.file(__filename),
      });
    }
    for (const { label, value } of values) {
      test(label, () => {
        expect(value).not.toBeEmpty();
      });
    }
  });

  test("toBeEmptyObject()", () => {
    // Map and Set are not considered as object in jest-extended
    // https://github.com/jestjs/jest/blob/main/packages/jest-get-type/src/index.ts#L26
    expect(new Map().set("a", 1)).not.toBeEmptyObject();
    expect(new Map()).not.toBeEmptyObject();
    expect(new Set()).not.toBeEmptyObject();
    expect(new Set().add("1")).not.toBeEmptyObject();
    expect([]).toBeEmptyObject();
    expect({}).toBeEmptyObject();
    expect([1, 2]).not.toBeEmptyObject();
    expect({ a: "hello" }).not.toBeEmptyObject();
    expect(true).not.toBeEmptyObject();
    expect("notAnObject").not.toBeEmptyObject();

    const object1 = {};

    Object.defineProperty(object1, "property1", {
      value: 42,
    });

    // Object.keys for non-enumerable properties returns an empty array
    // jest-extended returns true for non enumerable object
    expect(object1).toBeEmptyObject();

    // jest-extended return false for Symbol
    expect(Symbol("a")).not.toBeEmptyObject();
    expect(Symbol()).not.toBeEmptyObject();

    // jest-extended return false for Date
    expect(new Date()).not.toBeEmptyObject();

    // jest-extended return false for RegExp
    expect(/(foo|bar)/g).not.toBeEmptyObject();
  });

  test("toBeNil()", () => {
    expect(null).toBeNil();
    expect(undefined).toBeNil();
    expect(false).not.toBeNil();
    expect(0).not.toBeNil();
    expect("").not.toBeNil();
    expect([]).not.toBeNil();
    expect(true).not.toBeNil();
    expect({}).not.toBeNil();
  });

  test_skipIf(isJest)("toBeTypeOf()", () => {
    expect("Bun! 🫓").toBeTypeOf("string");
    expect(0).toBeTypeOf("number");
    expect(true).toBeTypeOf("boolean");
    expect([]).toBeTypeOf("object");
    expect({}).toBeTypeOf("object");
    expect(null).toBeTypeOf("object");
    expect(undefined).toBeTypeOf("undefined");
    expect(() => {}).toBeTypeOf("function");
    expect(function () {}).toBeTypeOf("function");
    expect(async () => {}).toBeTypeOf("function");
    expect(async function () {}).toBeTypeOf("function");
    expect(function* () {}).toBeTypeOf("function");
    expect(class {}).toBeTypeOf("function");
    expect(new Array()).toBeTypeOf("object");
    expect(BigInt(5)).toBeTypeOf("bigint");
    expect(/(foo|bar)/g).toBeTypeOf("object");
    expect(new RegExp("(foo|bar)", "g")).toBeTypeOf("object");
    expect(new Date()).toBeTypeOf("object");

    expect("Bun!").not.toBeTypeOf("number");
    expect(0).not.toBeTypeOf("string");
    expect(true).not.toBeTypeOf("number");
    expect([]).not.toBeTypeOf("string");
    expect({}).not.toBeTypeOf("number");
    expect(null).not.toBeTypeOf("string");
    expect(undefined).not.toBeTypeOf("boolean");
    expect(() => {}).not.toBeTypeOf("string");
    expect(function () {}).not.toBeTypeOf("boolean");
    expect(async () => {}).not.toBeTypeOf("object");
    expect(class {}).not.toBeTypeOf("bigint");
    expect(/(foo|bar)/g).not.toBeTypeOf("string");
    expect(new RegExp("(foo|bar)", "g")).not.toBeTypeOf("number");
    expect(new Date()).not.toBeTypeOf("string");
  });

  test("toBeBoolean()", () => {
    expect(true).toBeBoolean();
    expect(false).toBeBoolean();
    expect(0).not.toBeBoolean();
    expect(1).not.toBeBoolean();
    expect("").not.toBeBoolean();
    expect({}).not.toBeBoolean();
  });

  test("toBeTrue()", () => {
    if (!hasJestExtended) return;
    expect(true).toBeTrue();
    expect(false).not.toBeTrue();
    expect(0).not.toBeTrue();
    expect(1).not.toBeTrue();
    expect("").not.toBeTrue();
    expect({}).not.toBeTrue();
  });

  test("toBeFalse()", () => {
    expect(false).toBeFalse();
    expect(true).not.toBeFalse();
    expect(0).not.toBeFalse();
    expect(1).not.toBeFalse();
    expect("").not.toBeFalse();
    expect({}).not.toBeFalse();
  });

  test("toBeNumber()", () => {
    expect(0).toBeNumber();
    expect(1).toBeNumber();
    expect(1.23).toBeNumber();
    expect(Infinity).toBeNumber();
    expect(-Infinity).toBeNumber();
    expect(NaN).toBeNumber();
    expect("").not.toBeNumber();
    expect({}).not.toBeNumber();
  });

  test("toBeInteger()", () => {
    expect(0).toBeInteger();
    expect(1).toBeInteger();
    expect(1.23).not.toBeInteger();
    expect(Infinity).not.toBeInteger();
    expect(-Infinity).not.toBeInteger();
    expect(NaN).not.toBeInteger();
    expect("").not.toBeInteger();
    expect({}).not.toBeInteger();
  });

  test("toBeObject()", () => {
    expect({}).toBeObject();
    expect(class A {}).toBeObject();
    expect([]).toBeObject();
    expect(new Set()).toBeObject();
    expect(new Map()).toBeObject();
    expect(new Array(0)).toBeObject();
    expect({ e: 1, e2: 2 }).toBeObject();
    expect("notAnObject").not.toBeObject();
    expect(1).not.toBeObject();
    expect(NaN).not.toBeObject();
    expect(undefined).not.toBeObject();
  });

  test("toBeFinite()", () => {
    expect(0).toBeFinite();
    expect(1).toBeFinite();
    expect(1.23).toBeFinite();
    expect(Infinity).not.toBeFinite();
    expect(-Infinity).not.toBeFinite();
    expect(NaN).not.toBeFinite();
    expect("").not.toBeFinite();
    expect({}).not.toBeFinite();
  });

  test("toBePositive()", () => {
    expect(1).toBePositive();
    expect(1.23).toBePositive();
    expect(Infinity).not.toBePositive();
    expect(0).not.toBePositive();
    expect(-Infinity).not.toBePositive();
    expect(NaN).not.toBePositive();
    expect("").not.toBePositive();
    expect({}).not.toBePositive();
  });

  test("toBeNegative()", () => {
    expect(-1).toBeNegative();
    expect(-1.23).toBeNegative();
    expect(-Infinity).not.toBeNegative();
    expect(0).not.toBeNegative();
    expect(Infinity).not.toBeNegative();
    expect(NaN).not.toBeNegative();
    expect("").not.toBeNegative();
    expect({}).not.toBeNegative();
  });

  test("toBeWithin()", () => {
    expect(0).toBeWithin(0, 1);
    expect(3.14).toBeWithin(3, 3.141);
    expect(-25).toBeWithin(-100, 0);
    expect(0).not.toBeWithin(1, 2);
    expect(3.14).not.toBeWithin(3.1, 3.14);
    expect(99).not.toBeWithin(99, 99);
    expect(100).not.toBeWithin(99, 100);
    expect(NaN).not.toBeWithin(0, 1);
    // expect("").not.toBeWithin(0, 1);
    expect({}).not.toBeWithin(0, 1);
    expect(Infinity).not.toBeWithin(-Infinity, Infinity);
  });

  test("toEqualIgnoringWhitespace()", () => {
    expect("hello world").toEqualIgnoringWhitespace("hello world");
    expect(" hello world ").toEqualIgnoringWhitespace("hello world");
    expect(" h e l l o w o r l d ").toEqualIgnoringWhitespace("hello world");
    expect("  hello\nworld  ").toEqualIgnoringWhitespace("hello\nworld");
    expect(`h
    e
    l
    l
    o`).toEqualIgnoringWhitespace("hello");
    expect(`Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec nec posuere felis. Aliquam tincidunt elit a nunc hendrerit maximus. Morbi semper tristique lectus, eget ullamcorper velit ullamcorper non. Aenean nibh augue, ultrices id ornare quis, eleifend id metus. Aliquam erat volutpat. Proin maximus, ligula at consequat venenatis, sapien odio auctor mi, sit amet placerat augue odio et orci. Vivamus tempus hendrerit tortor, et interdum est semper malesuada. Ut venenatis iaculis felis eget euismod. Suspendisse sed nisi eget massa fringilla rhoncus non quis enim. Mauris feugiat pellentesque justo, at sagittis augue sollicitudin vel. Pellentesque porttitor consequat mi nec varius. Praesent aliquet at justo nec finibus. Donec ut lorem eu ex dignissim pulvinar at sit amet sem. Ut fringilla sit amet dolor vitae convallis. Ut faucibus a purus sit amet fermentum.
    Sed sit amet tortor magna. Pellentesque laoreet lorem at pulvinar efficitur. Nulla dictum nibh ac gravida semper. Duis tempus elit in ipsum feugiat porttitor.`).toEqualIgnoringWhitespace(
      `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec nec posuere felis. Aliquam tincidunt elit a nunc hendrerit maximus. Morbi semper tristique lectus, eget ullamcorper velit ullamcorper non. Aenean nibh augue, ultrices id ornare quis, eleifend id metus. Aliquam erat volutpat. Proin maximus, ligula at consequat venenatis, sapien odio auctor mi, sit amet placerat augue odio et orci. Vivamus tempus hendrerit tortor, et interdum est semper malesuada. Ut venenatis iaculis felis eget euismod. Suspendisse sed nisi eget massa fringilla rhoncus non quis enim. Mauris feugiat pellentesque justo, at sagittis augue sollicitudin vel. Pellentesque porttitor consequat mi nec varius. Praesent aliquet at justo nec finibus. Donec ut lorem eu ex dignissim pulvinar at sit amet sem. Ut fringilla sit amet dolor vitae convallis. Ut faucibus a purus sit amet fermentum. Sed sit amet tortor magna. Pellentesque laoreet lorem at pulvinar efficitur. Nulla dictum nibh ac gravida semper. Duis tempus elit in ipsum feugiat porttitor.`,
    );

    expect("hello world").not.toEqualIgnoringWhitespace("hello world!");
    expect(() => {
      // @ts-expect-error
      expect({}).not.toEqualIgnoringWhitespace({});
    }).toThrow();
  });

  test("toBeSymbol()", () => {
    expect(Symbol()).toBeSymbol();
    expect(Symbol("")).toBeSymbol();
    expect(Symbol.iterator).toBeSymbol();
    expect("").not.toBeSymbol();
    expect({}).not.toBeSymbol();
  });

  test("toBeFunction()", () => {
    expect(() => {}).toBeFunction();
    expect(function () {}).toBeFunction();
    expect(async function () {}).toBeFunction();
    expect(async () => {}).toBeFunction();
    expect(function* () {}).toBeFunction();
    expect(async function* () {}).toBeFunction();
    expect("").not.toBeFunction();
    expect({}).not.toBeFunction();
    expect(null).not.toBeFunction();
  });

  test("toBeDate()", () => {
    expect(new Date()).toBeDate();
    expect(new Date(0)).toBeDate();
    expect(new Date("2021-01-01")).toBeDate();
    expect("2021-01-01").not.toBeDate();
    expect({}).not.toBeDate();
    expect(null).not.toBeDate();
  });

  test("toBeValidDate()", () => {
    expect(new Date()).toBeValidDate();
    expect(new Date(-1)).toBeValidDate();
    expect("2021-01-01").not.toBeValidDate();
    expect({}).not.toBeValidDate();
    expect(null).not.toBeValidDate();
  });

  test("toBeString()", () => {
    expect("").toBeString();
    expect("123").toBeString();
    expect(new String()).toBeString();
    expect(new String("123")).toBeString();
    expect(123).not.toBeString();
    expect({}).not.toBeString();
  });

  test("toInclude()", () => {
    expect("123").toInclude("1");
    expect("abc").toInclude("abc");
    expect(" 123 ").toInclude(" ");
    expect("").toInclude("");
    expect("bob").not.toInclude("alice");
  });

  test("toStartWith()", () => {
    expect("123").toStartWith("1");
    expect("abc").toStartWith("abc");
    expect(" 123 ").toStartWith(" ");
    expect(" ").toStartWith("");
    expect("").toStartWith("");
    expect("bob").not.toStartWith("alice");
  });

  test("toEndWith()", () => {
    expect("123").toEndWith("3");
    expect("abc").toEndWith("abc");
    expect(" 123 ").toEndWith(" ");
    expect(" ").toEndWith("");
    expect("").toEndWith("");
    expect("bob").not.toEndWith("alice");
  });

  describe("asymmetric matchers", () => {
    test("expect.any", () => {
      class Thing {}

      expect(expect.any(String)).toEqual("jest");
      expect(expect.any(Number)).toEqual(1);
      expect(expect.any(Function)).toEqual(() => {});
      expect(expect.any(Boolean)).toEqual(true);
      expect(expect.any(BigInt)).toEqual(1n);
      expect(expect.any(Symbol)).toEqual(Symbol());
      expect(expect.any(Object)).toEqual({});
      expect(expect.any(Array)).toEqual([]);
      expect(expect.any(Thing)).toEqual(new Thing());
    });

    test("failure messages print expect.any() with the class name", () => {
      class Thing {}
      const printed = [Thing, Map, URL, AbortSignal, Response].map(constructor => {
        try {
          expect(1).toEqual(expect.any(constructor));
        } catch (error) {
          return /Any<\w*>/.exec(stripVTControlCharacters(error.message))?.[0];
        }
      });
      expect(printed).toEqual(["Any<Thing>", "Any<Map>", "Any<URL>", "Any<AbortSignal>", "Any<Response>"]);
    });

    test("expect.any(Object) matches typeof === 'object'", () => {
      // https://github.com/jestjs/jest/blob/main/packages/expect/src/asymmetricMatchers.ts
      // Jest: `if (this.sample == Object) return typeof other == 'object';`
      class Thing {}

      // typeof x === 'object'
      expect(null).toEqual(expect.any(Object));
      expect({}).toEqual(expect.any(Object));
      expect([]).toEqual(expect.any(Object));
      expect(new Thing()).toEqual(expect.any(Object));
      expect(new Date()).toEqual(expect.any(Object));
      expect(new Map()).toEqual(expect.any(Object));
      expect(/re/).toEqual(expect.any(Object));

      // typeof x !== 'object'
      expect(undefined).not.toEqual(expect.any(Object));
      expect(1).not.toEqual(expect.any(Object));
      expect("s").not.toEqual(expect.any(Object));
      expect(true).not.toEqual(expect.any(Object));
      expect(1n).not.toEqual(expect.any(Object));
      expect(Symbol()).not.toEqual(expect.any(Object));
      expect(() => {}).not.toEqual(expect.any(Object));
      expect(function f() {}).not.toEqual(expect.any(Object));
      expect(async () => {}).not.toEqual(expect.any(Object));
      expect(Thing).not.toEqual(expect.any(Object));

      // nested in toEqual / objectContaining
      expect({ a: null }).toEqual({ a: expect.any(Object) });
      expect({ a: () => {} }).not.toEqual({ a: expect.any(Object) });
      expect({ a: () => {} }).not.toEqual(expect.objectContaining({ a: expect.any(Object) }));

      // toHaveBeenCalledWith
      const fn = jest.fn();
      fn(null);
      expect(fn).toHaveBeenCalledWith(expect.any(Object));
      const fn2 = jest.fn();
      fn2(() => {});
      expect(fn2).not.toHaveBeenCalledWith(expect.any(Object));
    });

    test("expect.any on primitive wrapper classes", () => {
      expect(expect.any(String)).toEqual(new String("jest"));
      expect(expect.any(Number)).toEqual(new Number(1));
      expect(expect.any(Function)).toEqual(new Function("() => {}"));
      expect(expect.any(Boolean)).toEqual(new Boolean(true));
      expect(expect.any(BigInt)).toEqual(Object(1n));
      expect(expect.any(Symbol)).toEqual(Object(Symbol()));
    });

    //test('Any.toAsymmetricMatcher()', () => {
    //  expect(expect.any(Number).toAsymmetricMatcher()).toBe('Any<Number>');
    //});

    //test('Any.toAsymmetricMatcher() with function name', () => {
    //  for (const [name, fn] of /** @type {const} */ ([
    //    ['someFunc', function someFunc() {}],
    //    ['$someFunc', function $someFunc() {}],
    //    [
    //      '$someFunc2',
    //      (function () {
    //        function $someFunc2() {}
    //        Object.defineProperty($someFunc2, 'name', {value: ''});
    //        return $someFunc2;
    //      })(),
    //    ],
    //    [
    //      '$someAsyncFunc',
    //      (function () {
    //        async function $someAsyncFunc() {}
    //        Object.defineProperty($someAsyncFunc, 'name', {value: ''});
    //        return $someAsyncFunc;
    //      })(),
    //    ],
    //    [
    //      '$someGeneratorFunc',
    //      (function () {
    //        function* $someGeneratorFunc() {}
    //        Object.defineProperty($someGeneratorFunc, 'name', {value: ''});
    //        return $someGeneratorFunc;
    //      })(),
    //    ],
    //    [
    //      '$someFuncWithFakeToString',
    //      (function () {
    //        function $someFuncWithFakeToString() {}
    //        $someFuncWithFakeToString.toString = () => 'Fake to string';
    //        return $someFuncWithFakeToString;
    //      })(),
    //    ],
    //  ])) {
    //    expect(expect.any(fn).toAsymmetricMatcher()).toBe(`Any<${name}>`);
    //  }
    //});

    test("Any throws when called with empty constructor", () => {
      // @ts-expect-error: Testing runtime error
      expect(() => expect.any()).toThrow(
        "any() expects to be passed a constructor function. Please pass one or use anything() to match any object.",
      );
    });

    // Jest and Vitest have no expect.not.any()
    if (isBun) {
      test("expect.not.any is the complement of expect.any for primitives", () => {
        // primitives that match any(Ctor) must NOT match not.any(Ctor)
        expect(5).toEqual(expect.any(Number));
        expect(5).not.toEqual(expect.not.any(Number));
        expect("s").toEqual(expect.any(String));
        expect("s").not.toEqual(expect.not.any(String));
        expect(true).toEqual(expect.any(Boolean));
        expect(true).not.toEqual(expect.not.any(Boolean));
        expect(1n).toEqual(expect.any(BigInt));
        expect(1n).not.toEqual(expect.not.any(BigInt));
        expect(Symbol()).toEqual(expect.any(Symbol));
        expect(Symbol()).not.toEqual(expect.not.any(Symbol));

        // primitives that do NOT match any(Ctor) must match not.any(Ctor)
        expect(5).not.toEqual(expect.any(String));
        expect(5).toEqual(expect.not.any(String));
        expect("s").not.toEqual(expect.any(Number));
        expect("s").toEqual(expect.not.any(Number));

        // boxed primitives were already correct, keep them covered
        expect(new Number(5)).not.toEqual(expect.not.any(Number));
        expect(new String("s")).not.toEqual(expect.not.any(String));

        // any(Object) is `typeof other === "object"`: null matches, a function does not
        expect(null).not.toEqual(expect.not.any(Object));
        expect(() => {}).toEqual(expect.not.any(Object));

        // nested inside object matching
        expect({ a: 1 }).toEqual({ a: expect.not.any(String) });
        expect({ a: 1 }).not.toEqual({ a: expect.not.any(Number) });
      });

      test("expect.not.any with user class", () => {
        class Thing {}
        expect(new Thing()).not.toEqual(expect.not.any(Thing));
        expect({}).toEqual(expect.not.any(Thing));
      });
    }

    test("Anything matches any type", () => {
      expect(expect.anything()).toEqual("jest");
      expect(expect.anything()).toEqual(1);
      expect(expect.anything()).toEqual(() => {});
      expect(expect.anything()).toEqual(true);
      expect(expect.anything()).toEqual({});
      expect(expect.anything()).toEqual([]);
    });

    test("Anything does not match null and undefined", () => {
      expect(expect.anything()).not.toEqual(null);
      expect(expect.anything()).not.toEqual(undefined);
    });

    //test('Anything.toAsymmetricMatcher()', () => {
    //  expect(expect.anything().toAsymmetricMatcher()).toBe('Anything');
    //});

    test("ArrayContaining matches", () => {
      expect(expect.arrayContaining([])).toEqual(["foo", "bar"]);
      expect(expect.arrayContaining(["foo"])).toEqual(["foo"]);
      expect(expect.arrayContaining(["foo"])).toEqual(["foo", "bar"]);
    });

    test("ArrayContaining does not match", () => {
      // we differ in jest on these cases: bun will fail matching non-array expected values, while jest doesn't
      if (isBun) {
        expect(expect.arrayContaining([])).not.toEqual(42);
        expect(expect.arrayContaining([])).not.toEqual("jest");
        expect(expect.arrayContaining([])).not.toEqual({});
        expect(expect.arrayContaining(["foo"])).not.toEqual(42);
      }
      expect(expect.arrayContaining(["foo"])).not.toEqual("foo");
      expect(expect.arrayContaining(["foo"])).not.toEqual(["bar"]);
    });

    test("ArrayContaining throws for non-arrays", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.arrayContaining("foo")).toEqual([]);
      }).toThrow(/*"You must provide an array to ArrayContaining, not 'string'."*/);
    });

    test("ArrayNotContaining matches", () => {
      if (isBun) {
        expect(expect.not.arrayContaining([])).toEqual(42);
        expect(expect.not.arrayContaining([])).toEqual("jest");
        expect(expect.not.arrayContaining([])).toEqual({});
        expect(expect.not.arrayContaining(["foo"])).toEqual(42);
      }
      expect(expect.not.arrayContaining(["foo"])).toEqual("foo");
      expect(expect.not.arrayContaining(["foo"])).toEqual(["bar"]);
    });

    test("ArrayNotContaining does not match", () => {
      expect(expect.not.arrayContaining([])).not.toEqual(["foo"]);
      expect(expect.not.arrayContaining(["foo"])).not.toEqual(["foo"]);
      expect(expect.not.arrayContaining(["foo"])).not.toEqual(["foo", "bar"]);
    });

    test("ArrayNotContaining throws for non-arrays", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.not.arrayContaining("foo")).toEqual([]);
      }).toThrow(/*"You must provide an array to ArrayNotContaining, not 'string'."*/);
    });

    test("ObjectContaining matches", () => {
      // we differ in jest on these cases: bun will fail matching non-object expected values, while jest doesn't
      const foo = Symbol("foo");
      expect(expect.objectContaining({ foo: "foo" })).toEqual({ foo: "foo", jest: "jest" });
      expect(expect.objectContaining({ foo: undefined })).toEqual({ foo: undefined });
      expect(expect.objectContaining({ first: expect.objectContaining({ second: {} }) })).toEqual({
        first: { second: {} },
      });
      expect(expect.objectContaining({ foo: Buffer.from("foo") })).toEqual({
        foo: Buffer.from("foo"),
        jest: "jest",
      });
      expect(expect.objectContaining({ [foo]: "foo" })).toEqual({ [foo]: "foo" });
    });

    test("ObjectContaining does not match", () => {
      const foo = Symbol("foo");
      const bar = Symbol("bar");
      if (isBun) {
        // bun behaves differently to jest on these cases on purpose
        expect(expect.objectContaining({})).not.toEqual(null);
        expect(expect.objectContaining({})).not.toEqual(undefined);
        expect(expect.objectContaining({})).not.toEqual(42);
        expect(expect.objectContaining({})).not.toEqual("jest");
      }
      expect(expect.objectContaining({ foo: "foo" })).not.toEqual(42);
      expect(expect.objectContaining({ foo: "foo" })).not.toEqual("jest");
      expect(expect.objectContaining({ foo: "foo" })).not.toEqual({ bar: "bar" });
      expect(expect.objectContaining({ foo: "foo" })).not.toEqual({ foo: "foox" });
      expect(expect.objectContaining({ foo: undefined })).not.toEqual({});
      expect(expect.objectContaining({ first: { second: {}, third: {} } })).not.toEqual({
        first: { second: {} },
      });
      expect(expect.objectContaining({ first: { second: {} } })).not.toEqual({
        first: { second: {}, third: {} },
      });
      (expect(
        expect.objectContaining({
          answer: 42,
          foo: { bar: "baz", foobar: "qux" },
        }),
      ).not.toEqual({ foo: { bar: "baz" } }),
        expect(expect.objectContaining({ [foo]: "foo" })).not.toEqual({ [bar]: "bar" }));
    });

    test("ObjectContaining matches defined properties", () => {
      const definedPropertyObject = {};
      Object.defineProperty(definedPropertyObject, "foo", { get: () => "bar" });
      expect(expect.objectContaining({ foo: "bar" })).toEqual(definedPropertyObject);
    });

    test("ObjectContaining matches prototype properties", () => {
      const prototypeObject = { foo: "bar" };
      let obj;

      if (Object.create) {
        obj = Object.create(prototypeObject);
      } else {
        function Foo() {}
        Foo.prototype = prototypeObject;
        Foo.prototype.constructor = Foo;
        obj = new (ANY(Foo))();
      }
      expect(expect.objectContaining({ foo: "bar" })).toEqual(obj);
    });

    test("ObjectContaining throws for non-objects", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.objectContaining(1337)).toEqual();
      }).toThrow(/*"You must provide an object to ObjectContaining, not 'number'."*/);
    });

    test("ObjectContaining does not mutate the sample", () => {
      const sample = { foo: { bar: {} } };
      const sample_json = JSON.stringify(sample);
      expect({ foo: { bar: {} } }).toEqual(expect.objectContaining(sample));
      expect(JSON.stringify(sample)).toEqual(sample_json);
    });

    test("ObjectNotContaining matches", () => {
      const foo = Symbol("foo");
      const bar = Symbol("bar");

      if (isBun) {
        // bun behaves differently to jest on these cases on purpose
        expect(expect.not.objectContaining({})).toEqual("jest");
        expect(expect.not.objectContaining({})).toEqual(null);
        expect(expect.not.objectContaining({})).toEqual(undefined);
      }
      expect(expect.not.objectContaining({ [foo]: "foo" })).toEqual({ [bar]: "bar" });
      expect(expect.not.objectContaining({ foo: "foo" })).toEqual({ bar: "bar" });
      expect(expect.not.objectContaining({ foo: "foo" })).toEqual({ foo: "foox" });
      expect(expect.not.objectContaining({ foo: undefined })).toEqual({});
      expect(
        expect.not.objectContaining({
          first: expect.not.objectContaining({ second: {} }),
        }),
      ).toEqual({ first: { second: {} } });
      expect(expect.not.objectContaining({ first: { second: {}, third: {} } })).toEqual({
        first: { second: {} },
      });
      expect(expect.not.objectContaining({ first: { second: {} } })).toEqual({
        first: { second: {}, third: {} },
      });
      expect(expect.not.objectContaining({ foo: "foo", jest: "jest" })).toEqual({
        foo: "foo",
      });
    });

    test("ObjectNotContaining does not match", () => {
      expect(expect.not.objectContaining({})).not.toEqual({});
      expect(expect.not.objectContaining({ foo: "foo" })).not.toEqual({
        foo: "foo",
        jest: "jest",
      });
      expect(expect.not.objectContaining({ foo: undefined })).not.toEqual({ foo: undefined });
      expect(expect.not.objectContaining({ first: { second: {} } })).not.toEqual({
        first: { second: {} },
      });
      expect(
        expect.not.objectContaining({
          first: expect.objectContaining({ second: {} }),
        }),
      ).not.toEqual({ first: { second: {} } });
    });

    test("ObjectNotContaining inverts ObjectContaining", () => {
      for (const [sample, received] of /** @type {const} */ ([
        [{}, null],
        [{ foo: "foo" }, { foo: "foo", jest: "jest" }],
        [{ foo: "foo", jest: "jest" }, { foo: "foo" }],
        [{ foo: undefined }, { foo: undefined }],
        [{ foo: undefined }, {}],
        [{ first: { second: {} } }, { first: { second: {} } }],
        [{ first: expect.objectContaining({ second: {} }) }, { first: { second: {} } }],
        [{ first: expect.not.objectContaining({ second: {} }) }, { first: { second: {} } }],
        [{}, { foo: undefined }],
      ])) {
        let errs = 0;
        try {
          expect(expect.objectContaining(sample)).toEqual(received);
        } catch (_) {
          errs += 1;
        }
        try {
          expect(expect.not.objectContaining(sample)).toEqual(received);
        } catch (_) {
          errs += 1;
        }
        expect(errs).toBe(1); // either contains or not-contains should throw, but not both nor none
      }
    });

    test("ObjectNotContaining throws for non-objects", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.not.objectContaining(1337)).toEqual();
      }).toThrow(/*"You must provide an object to ObjectNotContaining, not 'number'."*/);
    });

    test("StringContaining matches string against string", () => {
      expect(expect.stringContaining("en*")).toEqual("queen*");
      expect(expect.stringContaining("en")).not.toEqual("queue");
    });

    test("StringContaining throws if expected value is not string", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.stringContaining([1])).toEqual("queen");
      }).toThrow(/*"Expected is not a string"*/);
    });

    test("StringContaining returns false if received value is not string", () => {
      expect(expect.stringContaining("en*")).not.toEqual(1);
    });

    test("StringNotContaining matches string against string", () => {
      expect(expect.not.stringContaining("en*")).not.toEqual("queen*");
      expect(expect.not.stringContaining("en")).toEqual("queue");
    });

    test("StringNotContaining throws if expected value is not string", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.not.stringContaining([1])).toEqual("queen");
      }).toThrow(/*"Expected is not a string"*/);
    });

    test("StringNotContaining returns true if received value is not string", () => {
      expect(expect.not.stringContaining("en*")).toEqual(1);
    });

    test("StringMatching matches string against regexp", () => {
      expect(expect.stringMatching(/en/)).toEqual("queen");
      expect(expect.stringMatching(/en/)).not.toEqual("queue");
    });

    test("StringMatching matches string against string", () => {
      expect(expect.stringMatching("en")).toEqual("queen");
      expect(expect.stringMatching("en")).not.toEqual("queue");
    });

    test("StringMatching takes a string as the source of a regular expression", () => {
      expect(expect.stringMatching("^[a-z]+\\d+$")).toEqual("abc123");
      expect(expect.stringMatching("^[a-z]+\\d+$")).not.toEqual("abc");
      expect(expect.stringMatching("x.y")).toEqual("xay");
      expect(expect.stringMatching("a+b")).toEqual("aab");
      expect(expect.stringMatching("a+b")).not.toEqual("a+b");
      expect(expect.stringMatching("")).toEqual("anything");
      expect(expect.stringMatching(new String("x.y"))).toEqual("xay");
      expect({ s: "x.y" }).toEqual({ s: expect.not.stringMatching("^x\\dy$") });
      expect({ s: "x1y" }).not.toEqual({ s: expect.not.stringMatching("^x\\dy$") });
      expect({ s: "x1y" }).toMatchObject({ s: expect.stringMatching("^x\\dy$") });
      const called = jest.fn();
      called("x1y");
      expect(called).toHaveBeenCalledWith(expect.stringMatching("^x\\dy$"));
    });

    test("StringMatching throws right away if the string is not a valid regular expression", () => {
      expect(() => expect.stringMatching("(")).toThrow(SyntaxError);
      expect(() => expect.not.stringMatching("[")).toThrow(SyntaxError);
      expect(() => expect.stringMatching("(")).toThrow("Invalid regular expression: ");
    });

    test_skipIf(!isBun)("StringMatching names itself when it refuses its argument", () => {
      let message = "";
      try {
        expect.stringMatching(ANY(1));
      } catch (e) {
        message = stripVTControlCharacters(ANY(e).message);
      }
      expect(message).toBe("expect.stringMatching(string)\n\nExpected a string or regular expression\n");
    });

    test("StringMatching throws if expected value is neither string nor regexp", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.stringMatching([1])).toEqual("queen");
      }).toThrow(/*"Expected is not a String or a RegExp"*/);
    });

    test("StringMatching returns false if received value is not string", () => {
      expect(expect.stringMatching("en")).not.toEqual(1);
    });

    test("StringMatching returns false even if coerced non-string received value matches pattern", () => {
      expect(expect.stringMatching("null")).not.toEqual(null);
    });

    test("StringNotMatching matches string against regexp", () => {
      expect(expect.not.stringMatching(/en/)).not.toEqual("queen");
      expect(expect.not.stringMatching(/en/)).toEqual("queue");
    });

    test("StringNotMatching matches string against string", () => {
      expect(expect.not.stringMatching("en")).not.toEqual("queen");
      expect(expect.not.stringMatching("en")).toEqual("queue");
    });

    test("StringNotMatching throws if expected value is neither string nor regexp", () => {
      expect(() => {
        // @ts-expect-error: Testing runtime error
        expect(expect.not.stringMatching([1])).toEqual("queen");
      }).toThrow(/*"Expected is not a String or a RegExp"*/);
    });

    test("StringNotMatching returns true if received value is not string", () => {
      expect(expect.not.stringMatching("en")).toEqual(1);
    });

    describe("closeTo", () => {
      for (const [expected, received] of [
        [0, 0],
        [0, 0.001],
        [1.23, 1.229],
        [1.23, 1.226],
        [1.23, 1.225],
        [1.23, 1.234],
        [Infinity, Infinity],
        [-Infinity, -Infinity],
      ]) {
        test(`${expected} closeTo ${received} return true`, () => {
          expect(expect.closeTo(expected)).toEqual(received);
        });
        test(`${expected} notCloseTo ${received} return false`, () => {
          expect(expect.not.closeTo(expected)).not.toEqual(received);
        });
      }

      for (const [expected, received] of [
        [0, 0.01],
        [1, 1.23],
        [1.23, 1.224_999_9],
        [Infinity, -Infinity],
        [Infinity, 1.23],
        [-Infinity, -1.23],
      ]) {
        test(`${expected} closeTo ${received} return false`, () => {
          expect(expect.closeTo(expected)).not.toEqual(received);
        });
        test(`${expected} notCloseTo ${received} return true`, () => {
          expect(expect.not.closeTo(expected)).toEqual(received);
        });
      }

      for (const [expected, received, precision] of [
        [0, 0.1, 0],
        [0, 0.0001, 3],
        [0, 0.000_004, 5],
        [2.000_000_2, 2, 5],
      ]) {
        test(`${expected} closeTo ${received} with precision ${precision} return true`, () => {
          expect(expect.closeTo(expected, precision)).toEqual(received);
        });
        test(`${expected} notCloseTo ${received} with precision ${precision} return false`, () => {
          expect(expect.not.closeTo(expected, precision)).not.toEqual(received);
        });
      }

      for (const [expected, received, precision] of [
        [3.141_592e-7, 3e-7, 8],
        [56_789, 51_234, -4],
      ]) {
        test(`${expected} closeTo ${received} with precision ${precision} return false`, () => {
          expect(expect.closeTo(expected, precision)).not.toEqual(received);
        });
        test(`${expected} notCloseTo ${received} with precision ${precision} return true`, () => {
          expect(expect.not.closeTo(expected, precision)).toEqual(received);
        });
      }

      test("closeTo throw if expected is not number", () => {
        expect(() => {
          // @ts-expect-error: Testing runtime error
          expect.closeTo("a");
        }).toThrow(/*"Expected is not a Number"*/);
      });

      test("notCloseTo throw if expected is not number", () => {
        try {
          // @ts-expect-error: Testing runtime error
          expect.not.closeTo("a");
        } catch (e) {}
        expect(() => {
          // @ts-expect-error: Testing runtime error
          expect.not.closeTo("a");
        }).toThrow(/*"Expected is not a Number"*/);
      });

      test("closeTo throw if precision is not number", () => {
        expect(() => {
          // @ts-expect-error: Testing runtime error
          expect.closeTo(1, "a");
        }).toThrow(/*"Precision is not a Number"*/);
      });

      test("notCloseTo throw if precision is not number", () => {
        expect(() => {
          // @ts-expect-error: Testing runtime error
          expect.not.closeTo(1, "a");
        }).toThrow(/*"Precision is not a Number"*/);
      });

      test("closeTo return false if received is not number", () => {
        expect(expect.closeTo(1)).not.toEqual("a");
      });

      test("notCloseTo return false if received is not number", () => {
        expect(expect.not.closeTo(1)).not.toEqual("a");
      });
    });

    describe("objects with an asymmetricMatch() method", () => {
      const isEven = {
        asymmetricMatch: (/** @type {unknown} */ value) => typeof value === "number" && value % 2 === 0,
      };

      test("toEqual() and toStrictEqual() call asymmetricMatch()", () => {
        expect(2).toEqual(isEven);
        expect([1, 2]).toEqual([1, isEven]);
        expect({ n: 2 }).toEqual({ n: isEven });
        expect([{ n: 2 }]).toStrictEqual([{ n: isEven }]);
        expect(new Map([["n", 2]])).toEqual(new Map([["n", isEven]]));
        expect([3]).not.toEqual([isEven]);
        expect(() => expect([3]).toEqual([isEven])).toThrow();
        expect(() => expect([2]).not.toEqual([isEven])).toThrow();
      });

      test("asymmetricMatch() also works on the received value", () => {
        expect(isEven).toEqual(2);
        expect([isEven]).toEqual([2]);
        expect([isEven]).not.toEqual([3]);
      });

      test("toMatchObject(), toContainEqual() and toHaveProperty() call asymmetricMatch()", () => {
        expect({ n: 2, other: 1 }).toMatchObject({ n: isEven });
        expect({ n: 3, other: 1 }).not.toMatchObject({ n: isEven });
        expect({ deep: { n: 2, other: 1 } }).toMatchObject({ deep: { n: isEven } });
        expect([1, 2]).toContainEqual(isEven);
        expect([1, 3]).not.toContainEqual(isEven);
        expect({ n: 2 }).toHaveProperty("n", isEven);
        expect({ n: 3 }).not.toHaveProperty("n", isEven);
      });

      test("mock function matchers call asymmetricMatch()", () => {
        const double = jest.fn((/** @type {number} */ n, /** @type {string} */ _label) => n * 2);
        double(2, "a");
        expect(double).toHaveBeenCalledWith(isEven, "a");
        expect(double).toHaveBeenLastCalledWith(isEven, "a");
        expect(double).toHaveBeenNthCalledWith(1, isEven, "a");
        expect(double).toHaveReturnedWith(isEven);
        expect(double).not.toHaveBeenCalledWith(isEven, "b");
        double(3, "a");
        expect(double).not.toHaveBeenLastCalledWith(isEven, "a");
      });

      test("expect.objectContaining() and expect.arrayContaining() call asymmetricMatch()", () => {
        expect({ n: 2, other: 1 }).toEqual(expect.objectContaining({ n: isEven }));
        expect({ n: 3, other: 1 }).not.toEqual(expect.objectContaining({ n: isEven }));
        expect([1, 2]).toEqual(expect.arrayContaining([isEven]));
        expect([1, 3]).not.toEqual(expect.arrayContaining([isEven]));
      });

      test("asymmetricMatch() can be a class method", () => {
        class AtLeast {
          constructor(/** @type {number} */ minimum) {
            this.minimum = minimum;
          }
          asymmetricMatch(/** @type {number} */ value) {
            return value >= this.minimum;
          }
        }
        expect({ n: 5 }).toEqual({ n: new AtLeast(5) });
        expect({ n: 4 }).not.toEqual({ n: new AtLeast(5) });
      });

      test("an error thrown by asymmetricMatch() fails the assertion", () => {
        const throws = {
          asymmetricMatch() {
            throw new RangeError("thrown by the matcher");
          },
        };
        expect(() => expect([1]).toEqual([throws])).toThrow(new RangeError("thrown by the matcher"));
        expect(() => expect({ n: 1 }).toMatchObject({ n: throws })).toThrow(new RangeError("thrown by the matcher"));
      });

      test("two matchers are compared as plain objects", () => {
        const never = () => false;
        expect({ asymmetricMatch: never }).toEqual({ asymmetricMatch: never });
        expect({ asymmetricMatch: never, id: 1 }).not.toEqual({ asymmetricMatch: never, id: 2 });
      });

      test("asymmetricMatch is ignored if it isn't a function", () => {
        expect([{ asymmetricMatch: true }]).toEqual([{ asymmetricMatch: true }]);
        expect([1]).not.toEqual([{ asymmetricMatch: true }]);
      });

      test("toBe() ignores asymmetricMatch()", () => {
        expect(2).not.toBe(isEven);
        expect(isEven).toBe(isEven);
      });
    });
  });

  describe("async asymmetric matching", () => {
    if (isBun) {
      test("expect.rejectsTo", async () => {
        await expect(Promise.reject("1")).toEqual(expect.rejectsTo.stringContaining("1"));
        await expect(Promise.reject("2")).toEqual(expect.not.rejectsTo.stringContaining("1"));
        await expect({ a: Promise.reject("1") }).toEqual({ a: expect.rejectsTo.stringContaining("1") });
        await expect({ a: Promise.reject("1") }).toEqual({ a: expect.not.rejectsTo.stringContaining("2") });
        await expect(Promise.reject(new Error("rejectMessage"))).rejects.toMatchObject({ message: "rejectMessage" });

        // a resolved promise should not match
        await expect(Promise.resolve("a")).not.toEqual(expect.rejectsTo.stringContaining("a"));

        // a non-promise value should not match
        await expect("a").not.toEqual(expect.rejectsTo.stringContaining("a"));

        // Different task
        await expect(
          new Promise((_, reject) => {
            setTimeout(() => reject("a"), 0);
          }),
        ).toEqual(expect.rejectsTo.stringContaining("a"));
      });

      test("expect.resolvesTo", async () => {
        await expect(Promise.resolve("1")).toEqual(expect.resolvesTo.stringContaining("1"));
        await expect(Promise.resolve("2")).toEqual(expect.not.resolvesTo.stringContaining("1"));
        await expect({ a: Promise.resolve("1") }).toEqual({ a: expect.resolvesTo.stringContaining("1") });
        await expect({ a: Promise.resolve("1") }).toEqual({ a: expect.not.resolvesTo.stringContaining("2") });
        await expect(
          Promise.resolve(() => {
            throw new Error();
          }),
        ).resolves.toThrow();

        // a rejected promise should not match
        await expect(Promise.reject("a")).not.toEqual(expect.resolvesTo.stringContaining("a"));

        // a non-promise value should not match
        await expect("a").not.toEqual(expect.rejectsTo.stringContaining("a"));

        // Different task
        await expect(
          new Promise(resolve => {
            setTimeout(() => resolve("a"), 0);
          }),
        ).toEqual(expect.resolvesTo.stringContaining("a"));
      });

      test("expect.resolvesTo.any and expect.rejectsTo.any match primitives by constructor type", async () => {
        await expect(Promise.resolve("s")).toEqual(expect.resolvesTo.any(String));
        await expect(Promise.resolve(5)).toEqual(expect.resolvesTo.any(Number));
        await expect(Promise.resolve(true)).toEqual(expect.resolvesTo.any(Boolean));
        await expect(Promise.resolve(1n)).toEqual(expect.resolvesTo.any(BigInt));
        await expect(Promise.resolve(Symbol())).toEqual(expect.resolvesTo.any(Symbol));
        await expect(Promise.resolve({})).toEqual(expect.resolvesTo.any(Object));
        await expect(Promise.resolve(5)).not.toEqual(expect.resolvesTo.any(String));

        await expect(Promise.reject("s")).toEqual(expect.rejectsTo.any(String));
        await expect(Promise.reject(5)).toEqual(expect.rejectsTo.any(Number));
        await expect(Promise.reject(5)).not.toEqual(expect.rejectsTo.any(String));

        // .not is the complement
        await expect(Promise.resolve(5)).not.toEqual(expect.not.resolvesTo.any(Number));
        await expect(Promise.resolve(5)).toEqual(expect.not.resolvesTo.any(String));
        await expect(Promise.reject(5)).not.toEqual(expect.not.rejectsTo.any(Number));
        await expect(Promise.reject(5)).toEqual(expect.not.rejectsTo.any(String));

        // nested in an object, and as a mock call argument
        await expect({ a: Promise.resolve("s") }).toEqual({ a: expect.resolvesTo.any(String) });
        const fn = jest.fn();
        fn(Promise.resolve("s"));
        expect(fn).toHaveBeenCalledWith(expect.resolvesTo.any(String));
      });
    }
  });

  describe("object matching", () => {
    // tests of expect.objectContaining vs expect().toMatchObject

    test("objectContaining, with nested object, containing full props/values", () => {
      expect({ position: { x: 0, y: 0 } }).toEqual(
        expect.objectContaining({
          position: {
            x: expect.any(Number),
            y: expect.any(Number),
          },
        }),
      );
    });

    test("objectContaining, with nested object, containing partial props/values", () => {
      expect({ position: { x: 0, y: 0 } }).not.toEqual(
        expect.objectContaining({
          position: {
            x: expect.any(Number),
          },
        }),
      );
    });

    test("objectContaining, with nested object, also declared with objectContaining, containing partial props/values", () => {
      expect({ position: { x: 0, y: 0 } }).toEqual(
        expect.objectContaining({
          position: expect.objectContaining({
            x: expect.any(Number),
          }),
        }),
      );
    });

    test("toMatchObject, with nested object, containing full props/values", () => {
      expect({ position: { x: 0, y: 0 } }).toMatchObject({
        position: {
          x: expect.any(Number),
          y: expect.any(Number),
        },
      });
    });

    test("toMatchObject, with nested object, containing partial props/values", () => {
      expect({ position: { x: 0, y: 0 } }).toMatchObject({
        position: {
          x: expect.any(Number),
        },
      });
    });

    test("Array of dates", async () => {
      const obj = new Date("2020-01-01T00:00:00.001Z");
      const parsed = JSON.parse(JSON.stringify([obj, obj])).map(a => new Date(a));
      expect(parsed).toEqual([obj, obj]);
    });
  });

  test("expect.hasAssertions doesn't throw when valid", () => {
    expect.hasAssertions();
    expect("a").toEqual("a");
  });

  test("expect.assertions doesn't throw when valid", () => {
    expect.assertions(1);
    expect("a").toEqual("a");
  });

  test("expect.assertions doesn't throw when valid, async", async () => {
    expect.assertions(1);
    await new Promise(resolve => setTimeout(resolve, 1));
    expect("a").toEqual("a");
  });

  test("expect.assertions doesn't throw when valid, callback", done => {
    expect.assertions(1);
    process.nextTick(() => {
      expect("a").toEqual("a");
      done();
    });
  });

  test("expect.assertions doesn't throw when valid, setImmediate", done => {
    expect.assertions(1);
    setImmediate(() => {
      expect("a").toEqual("a");
      done();
    });
  });

  test("expect.assertions doesn't throw when valid, queueMicrotask", done => {
    expect.assertions(1);
    queueMicrotask(() => {
      expect("a").toEqual("a");
      done();
    });
  });

  test("expect.hasAssertions returns undefined", () => {
    expect(expect.hasAssertions()).toBeUndefined();
  });

  test("expect.assertions returns undefined", () => {
    expect(expect.assertions(1)).toBeUndefined();
  });

  const mocked = isBun ? mock(() => {}) : jest.fn(() => {});
  mocked();

  test("fail to return undefined", () => {
    expect(expect().not.fail()).toBeUndefined();
  });
  test("pass to return undefined", () => {
    expect(expect().pass()).toBeUndefined();
  });
  test("rejects to return a promise of undefined", async () => {
    const result = expect(Promise.reject("error")).rejects.toBe("error");
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeUndefined();
  });
  test("resolves to return a promise of undefined", async () => {
    const result = expect(Promise.resolve(1)).resolves.toBe(1);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeUndefined();
  });
  test("toBe to return undefined", () => {
    expect(expect(true).toBe(true)).toBeUndefined();
  });
  test("toBeArray to return undefined", () => {
    expect(expect([]).toBeArray()).toBeUndefined();
  });
  test("toBeArrayOfSize to return undefined", () => {
    expect(expect([]).toBeArrayOfSize(0)).toBeUndefined();
  });
  test("toBeBoolean to return undefined", () => {
    expect(expect(true).toBeBoolean()).toBeUndefined();
  });
  test("toBeCloseTo to return undefined", () => {
    expect(expect(0).toBeCloseTo(0)).toBeUndefined();
  });
  test("toBeDate to return undefined", () => {
    expect(expect(new Date()).toBeDate()).toBeUndefined();
  });
  test("toBeDefined to return undefined", () => {
    expect(expect(true).toBeDefined()).toBeUndefined();
  });
  test("toBeEmpty to return undefined", () => {
    expect(expect("").toBeEmpty()).toBeUndefined();
  });
  test("toBeEven to return undefined", () => {
    expect(expect(2).toBeEven()).toBeUndefined();
  });
  test("toBeFalse to return undefined", () => {
    expect(expect(false).toBeFalse()).toBeUndefined();
  });
  test("toBeFalsy to return undefined", () => {
    expect(expect(false).toBeFalsy()).toBeUndefined();
  });
  test("toBeFinite to return undefined", () => {
    expect(expect(42).toBeFinite()).toBeUndefined();
  });
  test("toBeFunction to return undefined", () => {
    expect(expect(() => {}).toBeFunction()).toBeUndefined();
  });
  test("toBeGreaterThan to return undefined", () => {
    expect(expect(1).toBeGreaterThan(0)).toBeUndefined();
  });
  test("toBeGreaterThanOrEqual to return undefined", () => {
    expect(expect(1).toBeGreaterThanOrEqual(0)).toBeUndefined();
  });
  test("toBeInstanceOf to return undefined", () => {
    expect(expect(new String()).toBeInstanceOf(String)).toBeUndefined();
  });
  test("toBeInteger to return undefined", () => {
    expect(expect(1).toBeInteger()).toBeUndefined();
  });
  test("toBeLessThan to return undefined", () => {
    expect(expect(0).toBeLessThan(1)).toBeUndefined();
  });
  test("toBeLessThanOrEqual to return undefined", () => {
    expect(expect(0).toBeLessThanOrEqual(1)).toBeUndefined();
  });
  test("toBeNaN to return undefined", () => {
    expect(expect(NaN).toBeNaN()).toBeUndefined();
  });
  test("toBeNegative to return undefined", () => {
    expect(expect(-1).toBeNegative()).toBeUndefined();
  });
  test("toBeNil to return undefined", () => {
    expect(expect().toBeNil()).toBeUndefined();
  });
  test("toBeNull to return undefined", () => {
    expect(expect(null).toBeNull()).toBeUndefined();
  });
  test("toBeNumber to return undefined", () => {
    expect(expect(0).toBeNumber()).toBeUndefined();
  });
  test("toBeOdd to return undefined", () => {
    expect(expect(1).toBeOdd()).toBeUndefined();
  });
  test("toBePositive to return undefined", () => {
    expect(expect(1).toBePositive()).toBeUndefined();
  });
  test("toBeString to return undefined", () => {
    expect(expect("").toBeString()).toBeUndefined();
  });
  test("toBeSymbol to return undefined", () => {
    expect(expect(Symbol()).toBeSymbol()).toBeUndefined();
  });
  test("toBeTrue to return undefined", () => {
    expect(expect(true).toBeTrue()).toBeUndefined();
  });
  test("toBeTruthy to return undefined", () => {
    expect(expect(true).toBeTruthy()).toBeUndefined();
  });
  test("toBeTypeOf to return undefined", () => {
    expect(expect(1).toBeTypeOf("number")).toBeUndefined();
  });
  test("toBeUndefined to return undefined", () => {
    expect(expect(undefined).toBeUndefined()).toBeUndefined();
  });
  test("toBeWithin to return undefined", () => {
    expect(expect(1).toBeWithin(0, 2)).toBeUndefined();
  });
  test("toContain to return undefined", () => {
    expect(expect([1]).toContain(1)).toBeUndefined();
  });
  test.todo("toContainEqual to return undefined", () => {
    expect(expect([1]).toContainEqual(1)).toBeUndefined();
  });
  test("toEndWith to return undefined", () => {
    expect(expect("abc").toEndWith("c")).toBeUndefined();
  });
  test("toEqual to return undefined", () => {
    expect(expect(1).toEqual(1)).toBeUndefined();
  });
  test("toEqualIgnoringWhitespace to return undefined", () => {
    expect(expect("a b c").toEqualIgnoringWhitespace("a b c")).toBeUndefined();
  });
  test("toHaveBeenCalled to return undefined", () => {
    expect(expect(mocked).toHaveBeenCalled()).toBeUndefined();
  });
  test("toHaveBeenCalledTimes to return undefined", () => {
    expect(expect(mocked).toHaveBeenCalledTimes(1)).toBeUndefined();
  });
  test("toHaveBeenCalledWith to return undefined", () => {
    expect(expect(mocked).toHaveBeenCalledWith()).toBeUndefined();
  });
  test("toHaveBeenLastCalledWith to return undefined", () => {
    expect(expect(mocked).toHaveBeenLastCalledWith()).toBeUndefined();
  });
  test("toHaveBeenNthCalledWith to return undefined", () => {
    expect(expect(mocked).toHaveBeenNthCalledWith(1)).toBeUndefined();
  });
  test("toHaveLastReturnedWith to return undefined", () => {
    expect(expect(mocked).toHaveLastReturnedWith(undefined)).toBeUndefined();
  });
  test("toHaveLength to return undefined", () => {
    expect(expect([1]).toHaveLength(1)).toBeUndefined();
  });
  test("toHaveNthReturnedWith to return undefined", () => {
    expect(expect(mocked).toHaveNthReturnedWith(1, undefined)).toBeUndefined();
  });
  test("toHaveProperty to return undefined", () => {
    expect(expect({ a: 1 }).toHaveProperty("a")).toBeUndefined();
  });
  test("toHaveReturnedTimes to return undefined", () => {
    expect(expect(mocked).toHaveReturnedTimes(1)).toBeUndefined();
  });
  test("toHaveReturnedWith to return undefined", () => {
    expect(expect(mocked).toHaveReturnedWith(undefined)).toBeUndefined();
  });
  test("toInclude to return undefined", () => {
    expect(expect("abc").toInclude("a")).toBeUndefined();
  });
  test("toIncludeRepeated to return undefined", () => {
    expect(expect("abc").toIncludeRepeated("a", 1)).toBeUndefined();
  });
  test("toMatch to return undefined", () => {
    expect(expect("abc").toMatch("a")).toBeUndefined();
  });
  test("toMatchInlineSnapshot to return undefined", () => {
    expect(expect("abc").toMatchInlineSnapshot('"abc"')).toBeUndefined();
  });
  test("toMatchObject to return undefined", () => {
    expect(expect({}).toMatchObject({})).toBeUndefined();
  });
  test("toMatchSnapshot to return undefined", () => {
    expect(expect("abc").toMatchSnapshot()).toBeUndefined();
  });
  test("toSatisfy to return undefined", () => {
    expect(expect(1).toSatisfy(() => true)).toBeUndefined();
  });
  test("toStartWith to return undefined", () => {
    expect(expect("abc").toStartWith("a")).toBeUndefined();
  });
  test("toStrictEqual to return undefined", () => {
    expect(expect(1).toStrictEqual(1)).toBeUndefined();
  });
  test("toThrow to return undefined", () => {
    expect(
      expect(() => {
        throw "";
      }).toThrow(),
    ).toBeUndefined();
  });
  test("toThrowErrorMatchingInlineSnapshot to return undefined", () => {
    expect(
      expect(() => {
        throw 0;
      }).toThrowErrorMatchingInlineSnapshot("undefined"),
    ).toBeUndefined();
  });
  test("toThrowErrorMatchingSnapshot to return undefined", () => {
    expect(
      expect(() => {
        throw 0;
      }).toThrowErrorMatchingSnapshot("undefined"),
    ).toBeUndefined();
  });

  test(' " " to contain ""', () => {
    expect(" ").toContain("");
  });

  test("should work #13267", () => {
    try {
      expect(() => {
        throw "!";
      }).not.toThrow(/ball/);
      throw undefined;
    } catch (e) {
      expect(e).toBeUndefined();
    }
    try {
      expect(() => {
        throw "ball";
      }).not.toThrow(/ball/);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeDefined();
      expect(e.message).toContain("Received message: ");
      expect(e.message).toContain('"ball"');
    }
  });
});

function tmpFile(exists) {
  const { join } = require("path");
  const { tmpdir } = require("os");
  const { mkdtempSync, writeFileSync } = require("fs");
  const tmpDir = mkdtempSync(join(tmpdir(), "expect-"));
  const tmpFile = join(tmpDir, "empty.txt");
  if (exists) {
    writeFileSync(tmpFile, "");
  }
  return tmpFile;
}
