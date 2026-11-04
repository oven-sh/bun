// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/expect.test.js`
 *  `bunx vitest test/js/bun/test/expect.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/expect.test.js`
 */

import assert from "node:assert";
import { isDeepStrictEqual, stripVTControlCharacters } from "node:util";
import { runInNewContext } from "node:vm";
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

    // A read of `length` or of an element of a Proxy of an array runs a trap, and the trap can throw.
    test.concurrent("toMatchObject and expect.arrayContaining check the exception of each Proxy read", async () => {
      const { bunEnv, bunExe } = require("harness");
      const src = `
        const { expect } = require("bun:test");
        const P = (target, handler = {}) => new Proxy(target, handler);
        const serves = length => P([1], { get: (t, k, r) => (k === "length" ? length : Reflect.get(t, k, r)) });
        const throwsOn = key => P([1], { get(t, k, r) { if (k === key) throw new Error(key); return Reflect.get(t, k, r); } });
        const revoked = () => { const { proxy, revoke } = Proxy.revocable([1], {}); revoke(); return proxy; };
        const badLength = { valueOf() { throw new Error("valueOf"); } };
        const values = [[1], P([1]), P(P([1, 2])), serves(1n), serves(badLength), throwsOn("length"), throwsOn("0"), revoked(), P({})];
        for (const a of values) {
          for (const b of values) {
            try { expect(a).toMatchObject(b); } catch {}
            try { Bun.deepMatch(a, b); } catch {}
            try { expect(a).toEqual(expect.objectContaining(b)); } catch {}
            try { expect(a).toEqual(expect.arrayContaining(b)); } catch {}
            try { expect({ x: a, y: 1 }).toMatchObject({ x: expect.not.arrayContaining(b), y: 1 }); } catch {}
          }
        }
        const late = Proxy.revocable([1], {});
        const received = expect(late.proxy);
        const matcher = expect.arrayContaining(late.proxy);
        late.revoke();
        try { received.toMatchObject([1]); } catch {}
        try { expect([1]).toEqual(matcher); } catch {}
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

    // Bun's own format prints the received value, so only the verdict is checked for it. The formats of
    // Jest and Vitest print the received value merged with the property matchers.
    test.concurrent("the property matchers of toMatchSnapshot take a Proxy of an array", async () => {
      const { bunEnv, bunExe, tempDir } = require("harness");
      const tests = `
        test("a", () => {
          const received = () => new Proxy([{ id: 1, name: "a" }], {});
          expect(received()).toMatchSnapshot([{ id: expect.any(Number) }]);
          expect({ list: received() }).toMatchSnapshot({ list: [{ id: expect.any(Number) }] });
          expect(() => expect(received()).toMatchSnapshot([{ id: expect.any(String) }])).toThrow(
            "to match properties from received object",
          );
        });
      `;
      const jestHeader = "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n";
      using dir = tempDir("proxy-array-property-matchers", {
        "bun.test.js": `import { expect, test } from "bun:test";${tests}`,
        "jest.test.js": `import { expect, test } from "bun:test";${tests}`,
        "__snapshots__/jest.test.js.snap": jestHeader,
        "vitest.test.js": `import { expect, test } from "vitest";${tests}`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./bun.test.js", "./jest.test.js", "./vitest.test.js"],
        env: { ...bunEnv, CI: "false" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout + stderr).toContain(" 3 pass");
      expect(exitCode).toBe(0);

      const written = [
        "",
        "exports[`a 1`] = `",
        "[",
        "  {",
        '    "id": Any<Number>,',
        '    "name": "a",',
        "  },",
        "]",
        "`;",
        "",
        "exports[`a 2`] = `",
        "{",
        '  "list": [',
        "    {",
        '      "id": Any<Number>,',
        '      "name": "a",',
        "    },",
        "  ],",
        "}",
        "`;",
        "",
      ].join("\n");
      expect({
        jest: await Bun.file(`${dir}/__snapshots__/jest.test.js.snap`).text(),
        vitest: await Bun.file(`${dir}/__snapshots__/vitest.test.js.snap`).text(),
      }).toEqual({
        jest: jestHeader + written,
        vitest: "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n" + written,
      });
    });
  }

  // A stand-in for reactive() of Vue. The target keeps the members it was given, and the Proxy serves reactive(member).
  // A read of a property that holds a box() gives what is in the box, as a read of a property that holds a Vue ref does.
  const box = (/** @type {unknown} */ value) => ({ boxed: value });
  /** @type {WeakMap<object, object>} */
  const proxies = new WeakMap();
  /** @type {WeakSet<object>} */
  const served = new WeakSet();
  /** @returns {any} */
  const reactive = (/** @type {any} */ target) => {
    if (target === null || typeof target !== "object" || served.has(target)) return target;
    let proxy = proxies.get(target);
    if (!proxy) {
      proxy = new Proxy(target, target instanceof Set || target instanceof Map ? collectionHandler : recordHandler);
      proxies.set(target, proxy);
      served.add(proxy);
    }
    return proxy;
  };
  /** @type {ProxyHandler<any>} */
  const recordHandler = {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return value !== null && typeof value === "object" && "boxed" in value ? value.boxed : reactive(value);
    },
  };
  /** @type {ProxyHandler<any>} */
  const collectionHandler = {
    get(target, key) {
      if (key === Symbol.iterator) {
        return function* () {
          for (const member of target) yield target instanceof Map ? member.map(reactive) : reactive(member);
        };
      }
      if (key === "get") return (/** @type {unknown} */ k) => reactive(target.get(k));
      const value = Reflect.get(target, key, target);
      return typeof value === "function" && key !== "constructor" ? value.bind(target) : value;
    },
  };
  // A Proxy that serves what its target has, and `instead[key]` in place of it. Unlike reactive(), it serves each member as it is.
  const serving = (/** @type {object} */ target, /** @type {Record<PropertyKey, unknown>} */ instead = {}) =>
    new Proxy(target, {
      get(target, key) {
        const value = Object.hasOwn(instead, key) ? instead[key] : Reflect.get(target, key, target);
        return typeof value === "function" && key !== "constructor" ? value.bind(target) : value;
      },
    });
  const thrownBy = (/** @type {() => void} */ fn) => {
    try {
      fn();
    } catch (e) {
      return e;
    }
  };
  const nameOf = (/** @type {string | symbol} */ key) =>
    typeof key === "symbol" ? `@@${key.description?.replace("Symbol.", "")}` : key;
  // A Proxy that hands each read on to its Set or Map, and logs what it and its iterator are asked for.
  const handingOn = (/** @type {object} */ target, /** @type {string[]} */ log = []) =>
    new Proxy(target, {
      get(target, key) {
        log.push(nameOf(key));
        if (key === Symbol.iterator) {
          return () => {
            const iterator = /** @type {Iterable<unknown>} */ (target)[Symbol.iterator]();
            return {
              next: () => (log.push("next()"), iterator.next()),
              return: () => (log.push("return()"), {}),
            };
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" && key !== "constructor" ? value.bind(target) : value;
      },
    });
  // A Proxy whose `size`, `has`, `get` and iterator are shared by each Proxy and find its Set or Map through `this`, as those of Vue do.
  /** @type {WeakMap<object, any>} */
  const raws = new WeakMap();
  const shared = {
    get size() {
      return raws.get(this).size;
    },
    has(/** @type {unknown} */ member) {
      return raws.get(this).has(member);
    },
    get(/** @type {unknown} */ key) {
      return raws.get(this).get(key);
    },
    [Symbol.iterator]() {
      return raws.get(this)[Symbol.iterator]();
    },
  };
  const viaThis = (/** @type {object} */ target) => {
    const proxy = new Proxy(target, {
      get: (target, key, receiver) => Reflect.get(Object.hasOwn(shared, key) ? shared : target, key, receiver),
    });
    raws.set(proxy, target);
    return proxy;
  };

  describe("a Proxy around a Set or a Map", () => {
    // A record that is kept in a Map: the Proxy serves the entries of the Map as its own properties.
    /** @returns {any} */
    const facade = (/** @type {Map<string, unknown>} */ map) =>
      new Proxy(map, {
        get: (target, key) => (typeof key === "string" ? target.get(key) : undefined),
        has: (target, key) => target.has(/** @type {string} */ (key)),
        ownKeys: target => [...target.keys()],
        getOwnPropertyDescriptor: (target, key) =>
          target.has(/** @type {string} */ (key))
            ? { value: target.get(/** @type {string} */ (key)), enumerable: true, configurable: true, writable: true }
            : undefined,
      });

    test("toEqual() compares the members that the Proxy serves", () => {
      expect(reactive(new Set([1]))).toEqual(new Set([1]));
      expect(new Set([1])).toEqual(reactive(new Set([1])));
      expect(reactive(new Set([1]))).toEqual(reactive(new Set([1])));
      expect(reactive(new Map([["k", 1]]))).toEqual(new Map([["k", 1]]));
      expect(new Map([["k", 1]])).toEqual(reactive(new Map([["k", 1]])));
      expect(reactive({ s: new Set([1]) })).toEqual({ s: new Set([1]) });
      expect(reactive(new Set([1]))).not.toEqual(new Set([2]));
      expect(new Set([1])).not.toEqual(reactive(new Set([2])));
      expect(reactive(new Set([1]))).not.toEqual(reactive(new Set([2])));
      expect(reactive(new Map([["k", 1]]))).not.toEqual(new Map([["k", 2]]));
      expect(reactive(new Map([["k", 1]]))).not.toEqual(new Map([["j", 1]]));
      expect(reactive(new Map([["k", 1]]))).not.toEqual(reactive(new Map([["k", 2]])));
      expect(reactive({ s: new Set([1]) })).not.toEqual({ s: new Set([2]) });
      // the members in another order, and another count of them
      expect(reactive(new Set([1, 2]))).toEqual(new Set([2, 1]));
      expect(reactive(new Set([1, 2]))).not.toEqual(new Set([1]));
      expect(reactive(new Set([1]))).not.toEqual(new Set([1, 2]));
      expect(new Set([1, 2])).not.toEqual(reactive(new Set([1])));
      expect(reactive(new Map([["k", 1]]))).not.toEqual(new Map());
      // a member that is an object: the target holds a box where script reads a number
      expect(reactive(new Set([{ a: box(1) }]))).toEqual(new Set([{ a: 1 }]));
      expect(reactive(new Set([{ a: box(1) }]))).not.toEqual(new Set([{ a: 2 }]));
      expect(reactive(new Set([{ a: 1, b: 2 }]))).not.toEqual(new Set([{ a: 1 }]));
      expect(reactive(new Map([["k", { a: box(1) }]]))).toEqual(new Map([["k", { a: 1 }]]));
      expect(reactive(new Map([["k", { a: 1, b: 2 }]]))).not.toEqual(new Map([["k", { a: 1 }]]));
      expect(reactive(new Map([[{ id: 1 }, "v"]]))).toEqual(new Map([[{ id: 1 }, "v"]]));
      expect(reactive(new Map([[{ id: 1 }, "v"]]))).not.toEqual(new Map([[{ id: 2 }, "v"]]));
      // a Set in a Map in a record
      const store = (/** @type {string} */ tag) => ({ rows: new Map([["r1", { tags: new Set([tag]) }]]) });
      expect(reactive(store("a"))).toEqual(store("a"));
      expect(reactive(store("a"))).not.toEqual(store("b"));
      expect(reactive(store("a"))).not.toEqual(reactive(store("b")));
      // a Proxy around a Proxy
      expect(new Proxy(reactive(new Set([{ a: box(1) }])), {})).toEqual(new Set([{ a: 1 }]));
      expect(new Proxy(reactive(new Set([{ a: box(1) }])), {})).not.toEqual(new Set([{ a: 2 }]));
      // a Set that holds itself
      const holdingItself = () => {
        const set = new Set();
        return set.add(set);
      };
      expect(reactive(holdingItself())).toEqual(holdingItself());
      expect(holdingItself()).toEqual(reactive(holdingItself()));
      expect(reactive(holdingItself())).toEqual(reactive(holdingItself()));
      // The members are compared as toEqual() compares values: a hole is undefined, and the class of an object does not count.
      class A {
        a = 1;
      }
      expect(serving(new Map([["k", [1, , 3]]]))).toEqual(new Map([["k", [1, undefined, 3]]]));
      expect(serving(new Set([new A()]))).toEqual(new Set([{ a: 1 }]));
    });

    test("the two values are compared in the order that they have", () => {
      // The served member reads `a` as 1, and the other Set holds the object with the box. `has` of the Proxy finds that object.
      const member = { a: box(1) };
      expect(reactive(new Set([member]))).not.toEqual(new Set([member]));
      expect(new Set([member])).toEqual(reactive(new Set([member])));
    });

    test("a Map is asked `has` for a key, then `get`, then its entries", () => {
      // `get` gives undefined for this key, and the entries of the Proxy do not have it: the key that the Proxy serves reads `a` as 1.
      const key = { a: box(1) };
      expect(new Map([[key, undefined]])).toEqual(reactive(new Map([[key, undefined]])));
      expect(new Map([["k", undefined]])).toEqual(serving(new Map([["j", 1]]), { has: () => true }));
      expect(new Map([["k", 1]])).not.toEqual(serving(new Map([["j", 1]]), { has: () => true }));
      expect(new Map([["k", 1]])).toEqual(serving(new Map([["k", 1]]), { has: () => false }));
      // a `get` that has a value for each key
      expect(new Map([["a", 0]])).not.toEqual(serving(new Map([["b", 0]]), { get: () => 0 }));
      // An entry is equal to another entry if its key and its value are: the first key that is equal can hold another value.
      const twice = (/** @type {number} */ first, /** @type {number} */ second) =>
        new Map([
          [{ a: 1 }, first],
          [{ a: 1 }, second],
        ]);
      expect(reactive(twice(1, 2))).toEqual(reactive(twice(2, 1)));
      expect(reactive(twice(1, 2))).toEqual(twice(2, 1));
      expect(twice(1, 2)).toEqual(reactive(twice(2, 1)));
      expect(reactive(twice(1, 2))).not.toEqual(reactive(twice(2, 3)));
      // The value of an entry that the Proxy serves is read if its key is equal, and not before.
      const boom = new Error("boom");
      const withEntry = (/** @type {object} */ key) =>
        serving(new Map([[{}, 1]]), {
          *[Symbol.iterator]() {
            yield {
              0: key,
              get 1() {
                throw boom;
              },
            };
          },
        });
      expect(new Map([[{ a: 1 }, 1]])).not.toEqual(withEntry({ a: 2 }));
      expect(thrownBy(() => expect(new Map([[{ a: 1 }, 1]])).toEqual(withEntry({ a: 1 })))).toBe(boom);
    });

    test("a Set is no Map, and a Proxy around another object is neither", () => {
      expect(reactive(new Set())).not.toEqual(new Map());
      expect(new Map()).not.toEqual(reactive(new Set()));
      expect(reactive(new Set())).not.toEqual(reactive(new Map()));
      expect(new Proxy({}, {})).not.toEqual(new Set());
      expect(new Set()).not.toEqual(new Proxy({}, {}));
      expect(reactive({})).not.toEqual(new Map());
      expect(reactive(new Set())).not.toEqual({});
      expect({}).not.toEqual(reactive(new Set()));
      expect(reactive(new Map())).not.toEqual(reactive({}));
      expect(reactive(new Set())).not.toEqual([]);
      expect({ s: reactive(new Set()) }).not.toEqual({ s: {} });
    });

    test("a Proxy that serves no iterator method is compared by its properties", () => {
      const hidden = (/** @type {object} */ target) => new Proxy(target, { get: () => undefined });
      expect(facade(new Map([["a", 1]]))).toEqual({ a: 1 });
      expect({ a: 1 }).toEqual(facade(new Map([["a", 1]])));
      expect({ s: facade(new Map([["a", 1]])) }).toEqual({ s: { a: 1 } });
      expect(facade(new Map([["a", 1]]))).not.toEqual({ a: 2 });
      expect(hidden(new Set([1]))).toEqual({});
      expect({}).toEqual(hidden(new Set([1])));
      expect(hidden(new Set())).toEqual(hidden(new Map()));
      expect(hidden(new Set())).toEqual(hidden({}));
      expect(hidden(new Set())).toStrictEqual(hidden(new Map()));
      expect([facade(new Map([["a", 1]]))]).toContainEqual({ a: 1 });
      expect({ s: facade(new Map([["a", 1]])) }).toHaveProperty("s", { a: 1 });
      // It is still no Set and no Map.
      expect(hidden(new Set())).not.toEqual(new Map());
      expect(new Map()).not.toEqual(hidden(new Set()));
      expect(facade(new Map([["a", 1]]))).not.toEqual(new Map([["a", 1]]));
      expect(new Map([["a", 1]])).not.toEqual(facade(new Map([["a", 1]])));
      expect(facade(new Map())).not.toEqual(new Set());
      // Each value that is false in a condition is no iterator method. These Proxies serve all else that their Set has.
      for (const nothing of [undefined, null, false, 0, "", NaN]) {
        const withoutIterator = (/** @type {number} */ member) =>
          serving(new Set([member]), { [Symbol.iterator]: nothing });
        expect(withoutIterator(1)).toEqual(withoutIterator(2));
        expect(withoutIterator(1)).toEqual(serving(new Set([2])));
        expect(serving(new Set([1]))).toEqual(withoutIterator(2));
        expect({ s: withoutIterator(1) }).toEqual({ s: withoutIterator(2) });
        expect(withoutIterator(1)).not.toEqual({});
        expect({}).not.toEqual(withoutIterator(1));
        expect(withoutIterator(1)).not.toEqual(new Map());
      }
      // An object that is no Set, and says that it is one.
      class Tagged {
        get [Symbol.toStringTag]() {
          return "Set";
        }
      }
      expect(reactive(new Set())).toEqual(new Tagged());
      expect(new Tagged()).toEqual(reactive(new Set()));
      // A Proxy that has a value for each name, Symbol.iterator too.
      /** @returns {object} */
      const defaults = () => new Proxy(new Map(), { get: () => [] });
      expect(defaults()).toEqual({});
      expect({}).toEqual(defaults());
    });

    test("the `constructor` of the two values is compared", () => {
      class Tags extends Set {}
      class Index extends Map {}
      expect(reactive(new Tags([1]))).not.toEqual(new Set([1]));
      expect(new Set([1])).not.toEqual(reactive(new Tags([1])));
      expect(reactive(new Index([["k", 1]]))).not.toEqual(new Map([["k", 1]]));
      expect(reactive(new Tags([1]))).toEqual(new Tags([1]));
      expect(new Tags([1])).toEqual(reactive(new Tags([1])));
      expect(reactive(new Tags([1]))).toEqual(reactive(new Tags([1])));
      expect(reactive(new Tags([1]))).not.toEqual(reactive(new Tags([2])));
      // another class of the same name
      const Other = (() => {
        class Tags extends Set {}
        return Tags;
      })();
      expect(reactive(new Tags([1]))).not.toEqual(reactive(new Other([1])));
      // A Proxy that binds each function of its target: its `constructor` is another function than Set.
      const bindingAll = (/** @type {object} */ target) =>
        new Proxy(target, {
          get(target, key) {
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      expect(bindingAll(new Set([1]))).not.toEqual(new Set([1]));
      expect(new Set([1])).not.toEqual(bindingAll(new Set([1])));
      expect(bindingAll(new Map([["k", 1]]))).not.toEqual(new Map([["k", 1]]));
      expect(bindingAll(new Set([1]))).not.toEqual(bindingAll(new Set([2])));
      // no `constructor`
      expect(serving(new Set([1]), { constructor: undefined })).not.toEqual(new Set([1]));
      expect(new Set([1])).not.toEqual(serving(new Set([1]), { constructor: null }));
      expect(serving(new Set([1]), { constructor: undefined })).toEqual(
        serving(new Set([1]), { constructor: undefined }),
      );
      if (isBun) {
        // Jest 30.5.2 takes two native functions of one name for one constructor. For Vitest 4.1.12 these pairs are unequal.
        expect(bindingAll(new Set([1]))).toEqual(bindingAll(new Set([1])));
        const ofOtherRealm = require("node:vm").runInNewContext("new Set([1])");
        expect(ofOtherRealm.constructor).not.toBe(Set);
        expect(serving(ofOtherRealm)).toEqual(new Set([1]));
        expect(new Set([1])).toEqual(serving(ofOtherRealm));
        expect(serving(ofOtherRealm)).not.toEqual(new Set([2]));
        // A native function is one that Function.prototype.toString prints as `[native code]`.
        const printsNativeCode = (/** @type {Function} */ fn) =>
          Function.prototype.toString.call(fn).includes("[native code]");
        expect(
          [Set, Math.max, [].map, function () {}.bind(null), new Proxy(function () {}, {})].map(printsNativeCode),
        ).toEqual([true, true, true, true, true]);
        expect([class {}, function () {}, () => {}].map(printsNativeCode)).toEqual([false, false, false]);
        for (const constructor of [
          Set,
          Math.max,
          [].map,
          function () {}.bind(null),
          new Proxy(function () {}, {}),
          require("node:events"),
          class {},
          function () {},
          () => {},
        ]) {
          const withConstructor = (/** @type {unknown} */ constructor) => serving(new Set([1]), { constructor });
          const ofTheSameName = Object.defineProperty(function () {}.bind(null), "name", { value: constructor.name });
          expect(withConstructor(constructor)).toEqual(withConstructor(constructor));
          if (printsNativeCode(constructor))
            expect(withConstructor(constructor)).toEqual(withConstructor(ofTheSameName));
          else expect(withConstructor(constructor)).not.toEqual(withConstructor(ofTheSameName));
        }
      }
    });

    test("the matchers that compare as toEqual() does", () => {
      expect([reactive(new Set([1]))]).toContainEqual(new Set([1]));
      expect({ s: reactive(new Set([1])) }).toHaveProperty("s", new Set([1]));
      const called = jest.fn();
      called(reactive(new Set([1])));
      expect(called).toHaveBeenCalledWith(new Set([1]));
      expect(called).not.toHaveBeenCalledWith(new Set([2]));
      expect({ s: reactive(new Set([1])), other: 1 }).toEqual(expect.objectContaining({ s: new Set([1]) }));
      expect({ a: { s: reactive(new Set([1])) } }).toEqual(expect.objectContaining({ a: { s: new Set([1]) } }));
      expect([{ s: reactive(new Set([1])) }]).toEqual(expect.arrayContaining([{ s: new Set([1]) }]));
      if (isBun) {
        // Two Sets with other members are equal for Vitest 4.1.12 in the first two, and for Jest 30.5.2 in the last two, with no Proxy too.
        expect([reactive(new Set([1]))]).not.toContainEqual(new Set([2]));
        expect({ s: reactive(new Set([1])) }).not.toHaveProperty("s", new Set([2]));
        expect({ s: reactive(new Set([1])) }).not.toEqual(expect.objectContaining({ s: new Set([2]) }));
        expect([{ s: reactive(new Set([1])) }]).not.toEqual(expect.arrayContaining([{ s: new Set([2]) }]));
        // expect.arrayContaining() reads a Proxy around an array (#47858), so this pair is unequal, as in Jest 30.5.2 and Vitest 4.1.12.
        expect(reactive(new Map([["k", ["admin"]]]))).not.toEqual(
          new Map([["k", expect.not.arrayContaining(["admin"])]]),
        );
      }
    });

    test("toStrictEqual() of a Proxy that serves Proxies and a Proxy that serves the members as they are", () => {
      // toStrictEqual() does not ask a Proxy for its members. If it does, these fail until #45251 takes the Proxy of a member for its object.
      expect(reactive(new Set([{ a: 1 }]))).toStrictEqual(serving(new Set([{ a: 1 }])));
      expect(serving(new Map([["k", { a: 1 }]]))).toStrictEqual(reactive(new Map([["k", { a: 1 }]])));
    });

    test("a failed toBe() says that the two values serialize to the same string", () => {
      for (const [received, expected] of [
        [reactive(new Set([1])), new Set([1])],
        [new Set([1]), reactive(new Set([1]))],
        [reactive(new Map([["k", 1]])), new Map([["k", 1]])],
        [{ s: reactive(new Set([1])) }, { s: new Set([1]) }],
      ]) {
        expect(() => expect(received).toBe(expected)).toThrow("serializes to the same string");
      }
      const otherMembers = /** @type {Error} */ (thrownBy(() => expect(reactive(new Set([1]))).toBe(new Set([2]))));
      expect(otherMembers).toBeInstanceOf(Error);
      expect(otherMembers.message).not.toContain("serializes to the same string");
      // toBe() compares the two values as toEqual() does for what it says, and the `size` of a Set throws for a Proxy.
      if (isBun) expect(() => expect(new Proxy(new Set([1]), {})).toBe(new Set([1]))).toThrow(TypeError);
    });

    test("a Proxy that does not serve its Set or Map", () => {
      // No method of a Set takes a Proxy around a Set for a Set.
      expect(() => expect(new Proxy(new Set([1]), {})).toEqual(new Set([1]))).toThrow(TypeError);
      expect(() => expect(new Proxy(new Set([1]), {})).not.toEqual(new Set([2]))).toThrow(TypeError);
      expect(() => expect(new Set([1])).toEqual(new Proxy(new Set([1]), {}))).toThrow(TypeError);
      expect(() => expect(new Proxy(new Map(), {})).toEqual(new Map())).toThrow(TypeError);
      const revoked = () => {
        const { proxy, revoke } = Proxy.revocable(new Set([1]), {});
        revoke();
        return proxy;
      };
      expect(() => expect(revoked()).toEqual(new Set([1]))).toThrow(TypeError);
      expect(() => expect(new Set([1])).toEqual(revoked())).toThrow(TypeError);
      expect(() => expect(revoked()).not.toEqual(new Set([1]))).toThrow(TypeError);
      expect(() => expect(new Set([1])).not.toEqual(revoked())).toThrow(TypeError);
      expect(() => expect(new Proxy(revoked(), {})).not.toEqual(reactive(new Set([1])))).toThrow(TypeError);
    });

    test("the size that the Proxy serves and what its `has` says count", () => {
      expect(serving(new Set([1]), { size: 2 })).not.toEqual(new Set([1]));
      expect(new Set([1])).toEqual(serving(new Set([1, 2]), { size: 1 }));
      // Two sizes are equal if `===` says so, also if they are no numbers.
      expect(new Set([1])).not.toEqual(serving(new Set([1]), { size: undefined }));
      expect(serving(new Set([1]), { size: "1" })).not.toEqual(new Set([1]));
      expect(serving(new Set([1]), { size: NaN })).not.toEqual(serving(new Set([1]), { size: NaN }));
      expect(serving(new Set([1]), { size: "1" })).toEqual(serving(new Set([1]), { size: "1" }));
      expect(serving(new Set([1]), { size: 1n })).toEqual(serving(new Set([1]), { size: 1n }));
      expect(serving(new Set([1]), { size: undefined })).toEqual(serving(new Set([1]), { size: undefined }));
      expect(serving(new Set([1]), { size: undefined })).not.toEqual(serving(new Set([2]), { size: undefined }));
      // `has` that says yes to each value, and no to each
      expect(new Set([1])).toEqual(serving(new Set([2]), { has: () => "yes" }));
      expect(new Set([1])).toEqual(serving(new Set([1]), { has: () => 0 }));
      expect(new Set([1])).not.toEqual(serving(new Set([2]), { has: () => 0 }));
    });

    test("the Proxy is the receiver of what it is asked", () => {
      expect(viaThis(new Set([1, 2]))).toEqual(new Set([1, 2]));
      expect(new Set([1, 2])).toEqual(viaThis(new Set([1, 2])));
      expect(new Set([{ a: 1 }])).toEqual(viaThis(new Set([{ a: 1 }])));
      expect(viaThis(new Set([1]))).not.toEqual(viaThis(new Set([2])));
      expect(viaThis(new Map([["k", 1]]))).toEqual(new Map([["k", 1]]));
      expect(new Map([["k", 1]])).toEqual(viaThis(new Map([["k", 1]])));
      expect(new Map([[{ id: 1 }, 1]])).toEqual(viaThis(new Map([[{ id: 1 }, 1]])));
      expect(viaThis(new Map([["k", 1]]))).not.toEqual(viaThis(new Map([["k", 2]])));
    });

    if (isBun) {
      test("Bun.deepEquals() compares what the Proxy is, as node:assert does, and asks it nothing", () => {
        expect(Bun.deepEquals(reactive(new Set([1])), new Set([1]))).toBe(false);
        expect(Bun.deepEquals(new Set([1]), reactive(new Set([1])))).toBe(false);
        expect(Bun.deepEquals(reactive(new Set([1])), reactive(new Set([2])))).toBe(true);
        expect(Bun.deepEquals(reactive(new Map([["k", 1]])), new Map([["k", 1]]))).toBe(false);
        expect(Bun.deepEquals(reactive(new Map([["k", 1]])), reactive(new Map([["k", 2]])))).toBe(true);
        expect(Bun.deepEquals(reactive(new Set([1])), new Set([1]), true)).toBe(false);
        expect(Bun.deepEquals(reactive(new Set([1])), reactive(new Set([2])), true)).toBe(true);
        /** @type {string[]} */
        const log = [];
        for (const strict of [false, true]) {
          expect(Bun.deepEquals(handingOn(new Set([1]), log), new Set([1]), strict)).toBe(false);
          expect(Bun.deepEquals(new Map([["k", 1]]), handingOn(new Map([["k", 1]]), log), strict)).toBe(false);
          expect(Bun.deepEquals(handingOn(new Set([1]), log), handingOn(new Set([2]), log), strict)).toBe(true);
        }
        expect(log).toEqual([]);
        // node:assert and util.isDeepStrictEqual share the comparison. They keep the answers of Node.
        /** @type {[() => object, () => object, boolean][]} */
        const pairs = [
          [() => new Proxy(new Set([1]), {}), () => new Set([1]), false],
          [() => handingOn(new Set([1])), () => new Set([1]), false],
          [() => new Set([1]), () => handingOn(new Set([1])), false],
          [() => handingOn(new Set([1])), () => handingOn(new Set([2])), true],
          [() => handingOn(new Map([["k", 1]])), () => new Map([["k", 1]]), false],
          [() => handingOn(new Map([["k", 1]])), () => handingOn(new Map([["k", 2]])), true],
        ];
        const throws = (/** @type {() => void} */ fn) => {
          try {
            fn();
          } catch {
            return true;
          }
          return false;
        };
        for (const [a, b, equal] of pairs) {
          expect([
            isDeepStrictEqual(a(), b()),
            !throws(() => assert.deepStrictEqual(a(), b())),
            !throws(() => assert.deepEqual(a(), b())),
          ]).toEqual([equal, equal, equal]);
        }
      });

      test("what a Proxy around a Set or a Map is asked, and when", () => {
        /** @type {string[]} */
        const log = [];
        const asked = (/** @type {() => void} */ fn) => {
          log.length = 0;
          fn();
          return log.join(" ");
        };
        // The first value: its iterator method, its `constructor` and its size, then its members until one is not in the second value.
        expect(asked(() => expect(handingOn(new Set([1, 2, 3]), log)).toEqual(new Set([1, 2, 3])))).toBe(
          "@@iterator constructor size next() next() next() next()",
        );
        expect(asked(() => expect(handingOn(new Set([1, 2]), log)).not.toEqual(new Set([1])))).toBe(
          "@@iterator constructor size",
        );
        expect(asked(() => expect(handingOn(new Set([1, 2, 3]), log)).not.toEqual(new Set([4, 5, 6])))).toBe(
          "@@iterator constructor size next() return()",
        );
        expect(asked(() => expect(handingOn(new Map([["k", 1]]), log)).toEqual(new Map([["k", 1]])))).toBe(
          "@@iterator constructor size next() next()",
        );
        expect(asked(() => expect(handingOn(new Map([["k", 1]]), log)).not.toEqual(new Map([["k", 2]])))).toBe(
          "@@iterator constructor size next() return()",
        );
        // The second value: `has` for each member of a Set and for each key of a Map, `get` for a key that it has, and its members for one that it does not find.
        expect(asked(() => expect(new Set([1, 2])).toEqual(handingOn(new Set([1, 2]), log)))).toBe(
          "@@iterator constructor size has has",
        );
        expect(asked(() => expect(new Map([["k", 1]])).toEqual(handingOn(new Map([["k", 1]]), log)))).toBe(
          "@@iterator constructor size has get",
        );
        expect(asked(() => expect(new Map([["k", 1]])).not.toEqual(handingOn(new Map([["k", 2]]), log)))).toBe(
          "@@iterator constructor size has get next() next()",
        );
        expect(asked(() => expect(new Set([{ a: 1 }])).toEqual(handingOn(new Set([{ a: 1 }]), log)))).toBe(
          "@@iterator constructor size has next() return()",
        );
        // A walk that ends at the member it looked for is closed before the next walk starts.
        const twoMembers = () => new Set([{ a: 1 }, { b: 2 }]);
        expect(asked(() => expect(twoMembers()).toEqual(handingOn(twoMembers(), log)))).toBe(
          "@@iterator constructor size has next() has return() next() next() return()",
        );
        const twoKeys = () => new Map([{ a: 1 }, { b: 2 }].map((key, value) => [key, value]));
        expect(asked(() => expect(twoKeys()).toEqual(handingOn(twoKeys(), log)))).toBe(
          "@@iterator constructor size has next() has return() next() next() return()",
        );
        // A Proxy on each side.
        expect(
          asked(() => expect(handingOn(new Set([{ a: 1 }]), log)).toEqual(handingOn(new Set([{ a: 1 }]), log))),
        ).toBe("@@iterator @@iterator constructor constructor size size next() has next() next() return()");
        // A key that holds undefined costs a Map of 1000 keys 1000 `has` and 1000 `get`, and no walk.
        const thousand = () => new Map(Array.from({ length: 1000 }, (_, key) => [key, undefined]));
        expect(asked(() => expect(thousand()).toEqual(handingOn(thousand(), log)))).toBe(
          "@@iterator constructor size" + " has get".repeat(1000),
        );
        // A Proxy that serves no iterator method is asked nothing else by a Set or a Map.
        for (const nothing of [undefined, null, false, 0, "", NaN]) {
          const hidden = () => new Proxy(new Set([1]), { get: (target, key) => (log.push(nameOf(key)), nothing) });
          expect(asked(() => expect(hidden()).not.toEqual(new Set([1])))).toBe("@@iterator");
          expect(asked(() => expect(new Set([1])).not.toEqual(hidden()))).toBe("@@iterator");
          // Two of them are asked what Object.prototype.toString asks, then they are compared by their properties.
          expect(asked(() => expect(hidden()).toEqual(hidden()))).toBe("@@iterator @@toStringTag @@toStringTag");
        }
        // The second value is not asked for its iterator method if the first value serves none.
        expect(
          asked(() => expect(new Proxy(new Set(), { get: () => undefined })).not.toEqual(handingOn(new Map(), log))),
        ).toBe("@@toStringTag");
        // A Proxy around another object is asked nothing by a Set or a Map, and nothing for another Proxy around such an object.
        const around = (/** @type {object} */ target) =>
          new Proxy(target, {
            get: (target, key, receiver) => (log.push(nameOf(key)), Reflect.get(target, key, receiver)),
          });
        expect(asked(() => expect(around({ a: 1 })).not.toEqual(new Set([1])))).toBe("");
        expect(asked(() => expect(new Map()).not.toEqual(around({ a: 1 })))).toBe("");
        expect(asked(() => expect(around({ a: 1 })).toEqual(around({ a: 1 })))).toBe("a a");
        // Against another object, a Proxy around a Set is asked what Object.prototype.toString asks it.
        expect(asked(() => expect(around(new Set([1]))).not.toEqual({}))).toBe("@@toStringTag");
        expect(asked(() => expect({}).not.toEqual(around(new Set([1]))))).toBe("@@toStringTag");
      });

      test("what a Proxy around a Set or a Map throws ends the comparison", () => {
        const boom = new RangeError("boom");
        /** @type {string[]} */
        const log = [];
        const throwingAt = (/** @type {string | symbol} */ step, /** @type {object} */ target) =>
          new Proxy(target, {
            get(target, key) {
              if (key === step) throw boom;
              if (key === Symbol.iterator) {
                return () => {
                  if (step === "@@iterator()") throw boom;
                  const iterator = /** @type {Iterable<unknown>} */ (target)[Symbol.iterator]();
                  return {
                    next: () => {
                      if (step === "next()") throw boom;
                      return iterator.next();
                    },
                    return: () => {
                      log.push("return()");
                      if (step === "return()") throw boom;
                      return {};
                    },
                  };
                };
              }
              const value = Reflect.get(target, key, target);
              if (typeof value !== "function" || key === "constructor") return value;
              return (/** @type {unknown[]} */ ...args) => {
                if (step === `${String(key)}()`) throw boom;
                return value.apply(target, args);
              };
            },
          });
        // The Set does not have the member, and the Map has the key with another value: the second value is asked for its members too.
        for (const [first, second, lookups] of /** @type {const} */ ([
          [() => new Set([{ a: 1 }]), () => new Set([{ a: 1 }]), ["has", "has()"]],
          [() => new Map([["k", 1]]), () => new Map([["k", 2]]), ["has", "has()", "get", "get()"]],
        ])) {
          for (const step of [Symbol.iterator, "constructor", "size", "@@iterator()", "next()"]) {
            expect(thrownBy(() => expect(throwingAt(step, first())).toEqual(second()))).toBe(boom);
            expect(thrownBy(() => expect(first()).toEqual(throwingAt(step, second())))).toBe(boom);
            expect(thrownBy(() => expect(throwingAt(step, first())).not.toEqual(throwingAt(step, second())))).toBe(
              boom,
            );
          }
          for (const step of lookups) {
            expect(thrownBy(() => expect(first()).toEqual(throwingAt(step, second())))).toBe(boom);
          }
          // An iterator that throws is not closed.
          expect(log).toEqual([]);
        }
        // A walk that is left early is closed, and what return() throws is thrown.
        expect(thrownBy(() => expect(new Set([{ a: 1 }])).toEqual(throwingAt("return()", new Set([{ a: 1 }]))))).toBe(
          boom,
        );
        expect(thrownBy(() => expect(throwingAt("return()", new Set([1]))).toEqual(new Set([2])))).toBe(boom);
        expect(thrownBy(() => expect(throwingAt("return()", new Map([["k", 1]]))).toEqual(new Map([["k", 2]])))).toBe(
          boom,
        );
        expect(log).toEqual(["return()", "return()", "return()"]);
        // An error of a member closes the walk and stays the error.
        const matcherError = new Error("from the matcher");
        const throwingMatcher = {
          asymmetricMatch() {
            throw matcherError;
          },
        };
        log.length = 0;
        expect(thrownBy(() => expect(throwingAt("return()", new Set([1]))).toEqual(new Set([throwingMatcher])))).toBe(
          matcherError,
        );
        expect(log).toEqual(["return()"]);
        // So does the error of an entry that is no pair of a key and a value.
        const entries = new Proxy(new Map([["k", 1]]), {
          get(target, key) {
            if (key === Symbol.iterator) {
              return () => ({
                next: () => ({ done: false, value: null }),
                return: () => (log.push("return()"), {}),
              });
            }
            return Reflect.get(target, key, target);
          },
        });
        log.length = 0;
        expect(thrownBy(() => expect(entries).toEqual(new Map([["k", 1]])))).toBeInstanceOf(TypeError);
        expect(log).toEqual(["return()"]);
        // The `name` of a constructor, and what Object.prototype.toString asks.
        const unnamed = Object.defineProperty(function () {}, "name", {
          get() {
            throw boom;
          },
        });
        expect(thrownBy(() => expect(serving(new Set([1]), { constructor: unnamed })).toEqual(new Set([1])))).toBe(
          boom,
        );
        expect(thrownBy(() => expect(new Set([1])).toEqual(serving(new Set([1]), { constructor: unnamed })))).toBe(
          boom,
        );
        expect(thrownBy(() => expect(throwingAt(Symbol.toStringTag, new Set())).toEqual({}))).toBe(boom);
        expect(thrownBy(() => expect({}).toEqual(throwingAt(Symbol.toStringTag, new Set())))).toBe(boom);
      });

      test("a Proxy whose `has` or `get` is no function", () => {
        const noHas = thrownBy(() => expect(new Set([1])).toEqual(serving(new Set([1]), { has: undefined })));
        expect(noHas).toBeInstanceOf(TypeError);
        expect(/** @type {Error} */ (noHas).message).toBe("has is not a function");
        const noHasOfMap = thrownBy(() =>
          expect(new Map([["k", 1]])).toEqual(serving(new Map([["k", 1]]), { has: 1 })),
        );
        expect(noHasOfMap).toBeInstanceOf(TypeError);
        expect(/** @type {Error} */ (noHasOfMap).message).toBe("has is not a function");
        const noGet = thrownBy(() =>
          expect(new Map([["k", 1]])).toEqual(serving(new Map([["k", 1]]), { get: undefined })),
        );
        expect(noGet).toBeInstanceOf(TypeError);
        expect(/** @type {Error} */ (noGet).message).toBe("get is not a function");
        // The first value is asked for neither.
        expect(serving(new Set([1]), { has: undefined })).toEqual(new Set([1]));
        expect(serving(new Map([["k", 1]]), { has: undefined, get: undefined })).toEqual(new Map([["k", 1]]));
      });

      test("a cycle that is made of served members only ends in a RangeError", () => {
        // As it does with no Proxy, and as in Jest 30.5.2. In Vitest 4.1.12 the two values are equal.
        const holdingItself = () => {
          const set = new Set();
          return set.add(set);
        };
        expect(() => expect(new Set([holdingItself()])).toEqual(new Set([holdingItself()]))).toThrow(RangeError);
        expect(() =>
          expect(reactive(new Set([holdingItself()]))).toEqual(reactive(new Set([holdingItself()]))),
        ).toThrow(RangeError);
        expect(() => expect(reactive(new Set([holdingItself()]))).not.toEqual(new Set([holdingItself()]))).toThrow(
          RangeError,
        );
        // The comparison works afterwards.
        expect(reactive(new Set([{ a: 1 }]))).toEqual(new Set([{ a: 1 }]));
      });

      test("where the answer is not that of Jest 30.5.2 and Vitest 4.1.12", () => {
        const noIterator = () => serving(new Set([1]), { [Symbol.iterator]: undefined });
        const untagged = () => serving(new Set([1, 2]), { [Symbol.toStringTag]: undefined });
        /** @returns {object} */
        const throwing = () =>
          new Proxy(new Set(), {
            get(target, key) {
              if (key === Symbol.iterator) throw new RangeError("boom");
            },
          });
        const twoMembers = () => new Set([{ a: 1 }, { b: 2 }]);
        const oneWalk = twoMembers()[Symbol.iterator]();
        // Each row: an assertion, what it does here, and what it does in the references (Jest 30.5.2 and Vitest 4.1.12).
        /** @type {[() => void, "pass" | "fail", "pass" | "fail" | "RangeError"][]} */
        const rows = [
          // A Set is equal to no object that does not stand for a Set. The references compare the two by their properties.
          [() => expect(noIterator()).toEqual(new Set([1])), "fail", "pass"],
          [() => expect(new Set([1])).toEqual(noIterator()), "fail", "pass"],
          [() => expect(new Set([2])).not.toEqual(noIterator()), "pass", "fail"],
          // The references compare the members in order if the first value serves no `size`.
          [() => expect(serving(new Set([1]), { size: undefined })).toEqual(new Set([1])), "fail", "pass"],
          [
            () =>
              expect(serving(new Set([1]), { size: undefined })).toEqual(serving(new Set([1, 2]), { size: undefined })),
            "pass",
            "fail",
          ],
          // So they do if the first value does not say that it is a Set.
          [() => expect(untagged()).toEqual(new Set([2, 1])), "pass", "fail"],
          // A Set is no Map, whatever `constructor` its Proxy serves.
          [() => expect(serving(new Set([1]), { constructor: Map })).toEqual(new Map([[1, 1]])), "fail", "pass"],
          // The references read Symbol.iterator of the first value, whatever the second value is.
          [() => expect(throwing()).toEqual({}), "pass", "RangeError"],
          // The references walk the second value to its end for each member. This Proxy serves one iterator for each walk.
          [
            () => expect(twoMembers()).toEqual(serving(twoMembers(), { [Symbol.iterator]: () => oneWalk })),
            "pass",
            "fail",
          ],
        ];
        for (const [row, bun, references] of rows) {
          const error = thrownBy(row);
          expect(error === undefined ? "pass" : error instanceof RangeError ? "RangeError" : "fail").toBe(bun);
          expect(bun).not.toBe(references);
        }
      });

      test("a member that a Proxy serves stays alive while the other value is asked", () => {
        // Each member is made for the walk, and the comparison alone holds it. `has` collects garbage.
        let collections = 0;
        const fresh = (/** @type {number} */ count) =>
          new Proxy(new Set(), {
            get(target, key) {
              if (key === "size") return count;
              if (key === "has") return () => (Bun.gc(true), collections++, false);
              if (key === Symbol.iterator) {
                return function* () {
                  for (let id = 0; id < count; id++) yield { id, name: `member ${id}` };
                };
              }
              return Reflect.get(target, key, target);
            },
          });
        expect(fresh(3)).toEqual(fresh(3));
        expect(collections).toBe(3);
      });

      // A missing check aborts a debug build under BUN_JSC_validateExceptionChecks=1 (a no-op on release builds).
      test("each call into a Proxy around a Set or a Map is followed by an exception check", async () => {
        const { bunEnv, bunExe } = require("harness");
        const src = `
          const { expect } = require("bun:test");
          const attempt = fn => { try { fn(); } catch {} };
          const boom = new Error("boom");
          const throwingAt = (step, target) => new Proxy(target, {
            get(target, key) {
              if (key === step) throw boom;
              if (key === Symbol.iterator) return () => {
                if (step === "@@iterator()") throw boom;
                const iterator = target[Symbol.iterator]();
                return {
                  next: () => { if (step === "next()") throw boom; return iterator.next(); },
                  return: () => { if (step === "return()") throw boom; return {}; },
                };
              };
              const value = Reflect.get(target, key, target);
              if (typeof value !== "function" || key === "constructor") return value;
              return (...args) => { if (step === String(key) + "()") throw boom; return value.apply(target, args); };
            },
          });
          const serving = (target, instead) => new Proxy(target, {
            get(target, key) {
              const value = Object.hasOwn(instead, key) ? instead[key] : Reflect.get(target, key, target);
              return typeof value === "function" && key !== "constructor" ? value.bind(target) : value;
            },
          });
          const steps = [undefined, Symbol.iterator, Symbol.toStringTag, "constructor", "size", "has", "get", "@@iterator()", "next()", "has()", "get()", "return()"];
          const pairs = [
            [() => new Set([{ a: 1 }, { b: 2 }]), () => new Set([{ a: 1 }, { b: 2 }])],
            [() => new Set([{ a: 1 }, { b: 2 }]), () => new Set([{ c: 3 }, { d: 4 }])],
            [() => new Map([[{ a: 1 }, 1], [{ b: 2 }, 2]]), () => new Map([[{ a: 1 }, 1], [{ b: 2 }, 2]])],
            [() => new Map([["k", { a: 1 }], ["j", 2]]), () => new Map([["k", { a: 1 }], ["j", 2]])],
            [() => new Map([["k", 1], ["j", 2]]), () => new Map([["k", 2], ["j", 1]])],
            [() => new Set([1]), () => new Map([[1, 1]])],
            [() => new Set([1]), () => ({})],
          ];
          for (const [first, second] of pairs) {
            for (const step of steps) {
              attempt(() => expect(throwingAt(step, first())).toEqual(second()));
              attempt(() => expect(first()).toEqual(throwingAt(step, second())));
              attempt(() => expect(throwingAt(step, first())).toEqual(throwingAt(step, second())));
              attempt(() => expect(throwingAt(step, first())).not.toEqual(throwingAt(undefined, second())));
              attempt(() => expect(throwingAt(step, first())).toStrictEqual(throwingAt(step, second())));
            }
          }
          const named = name => Object.defineProperty(function () {}, "name", { get() { if (name === boom) throw boom; return name; } });
          for (const constructor of [undefined, null, 1, class Set {}, Set.bind(null), named("Set"), named(boom)]) {
            attempt(() => expect(serving(new Set([1]), { constructor })).toEqual(new Set([1])));
            attempt(() => expect(new Set([1])).toEqual(serving(new Set([1]), { constructor })));
            attempt(() => expect(serving(new Set([1]), { constructor })).toEqual(serving(new Set([1]), { constructor: Set.bind(null) })));
          }
          for (const size of [undefined, "1", 1n, NaN, 2]) {
            attempt(() => expect(serving(new Set([1]), { size })).toEqual(serving(new Set([1]), { size })));
          }
          for (const iterator of [undefined, null, 0, "", 1, {}]) {
            attempt(() => expect(serving(new Set([1]), { [Symbol.iterator]: iterator })).toEqual(new Set([1])));
            attempt(() => expect(new Set([{}])).toEqual(serving(new Set([{}]), { [Symbol.iterator]: iterator })));
            attempt(() => expect(serving(new Set([1]), { [Symbol.iterator]: iterator })).toEqual(serving(new Set([1]), {})));
            attempt(() => expect(serving(new Set([1]), { [Symbol.iterator]: iterator })).toEqual({}));
          }
          attempt(() => expect(new Proxy(new Set([1]), {})).toEqual(new Set([1])));
          attempt(() => expect(new Set([1])).not.toEqual(new Proxy({}, {})));
          attempt(() => expect(new Proxy({}, {})).not.toEqual(new Proxy(new Map(), {})));
          attempt(() => expect(new Proxy(new Set(), { get: () => undefined })).not.toEqual(new Set()));
          attempt(() => expect(new Proxy(new Set(), { get: () => undefined })).toEqual(new Proxy(new Map(), { get: () => undefined })));
          attempt(() => expect(new Proxy(new Set([1]), {})).toBe(new Set([1])));
          const revoked = Proxy.revocable(new Set([1]), {});
          revoked.revoke();
          attempt(() => expect(revoked.proxy).not.toEqual(new Set([1])));
          attempt(() => expect(new Set([1])).not.toEqual(revoked.proxy));
          attempt(() => expect(revoked.proxy).not.toEqual(throwingAt(undefined, new Set([1]))));
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

    // Jest, Vitest and toEqual() do not see a #field of a class.
    test("the private fields of a class are not compared", () => {
      class Counter {
        #n;
        constructor(/** @type {number} */ n) {
          this.#n = n;
          this.name = "c";
        }
        get n() {
          return this.#n;
        }
      }
      class Holder {
        #o;
        constructor(/** @type {number} */ n) {
          this.#o = { n };
        }
        get o() {
          return this.#o;
        }
      }
      expect(new Counter(1)).toMatchObject(new Counter(2));
      expect({ k: new Counter(1) }).toMatchObject({ k: new Counter(2) });
      expect([new Counter(1)]).toMatchObject([new Counter(2)]);
      expect(new Holder(1)).toMatchObject(new Holder(2));
      expect({ name: "c" }).toMatchObject(new Counter(1));
      // the other properties are compared as before
      const other = new Counter(1);
      other.name = "d";
      expect(new Counter(1)).not.toMatchObject(other);
      expect({}).not.toMatchObject(new Counter(1));
    });

    test("an expected array needs an array", () => {
      expect({}).not.toMatchObject([]);
      expect({ k: {} }).not.toMatchObject({ k: [] });
      expect({ 0: 1, length: 1 }).not.toMatchObject([1]);
      expect(new Uint8Array([1])).not.toMatchObject([1]);
      const arrayLike = Object.create(Array.prototype);
      arrayLike[0] = 1;
      arrayLike.length = 1;
      expect(arrayLike).not.toMatchObject([1]);
      // an expected object can be satisfied by an array
      expect([1]).toMatchObject({ 0: 1 });
      expect([]).toMatchObject({});
      // an array without a prototype and an array of another realm are arrays
      expect(Object.setPrototypeOf(["x"], null)).toMatchObject(["x"]);
      const otherRealm = () => runInNewContext("[1, { a: 1 }]");
      expect(otherRealm()).toMatchObject([1, { a: 1 }]);
      expect([1, { a: 1 }]).toMatchObject(otherRealm());
      expect({ k: otherRealm() }).toMatchObject({ k: [1, { a: 1 }] });
      expect(otherRealm()).not.toMatchObject([1, { a: 2 }]);
    });

    // https://github.com/oven-sh/bun/issues/9103
    test("a Proxy of an array matches as the array that it serves", async () => {
      const P = (/** @type {any[]} */ target, /** @type {ProxyHandler<any>} */ handler = {}) =>
        new Proxy(target, handler);
      // as the received value, as the expected value, as both, and nested each way
      expect(P([{ a: 1 }])).toMatchObject([{ a: 1 }]);
      expect([{ a: 1 }]).toMatchObject(P([{ a: 1 }]));
      expect(P([1, 2])).toMatchObject(P([1, 2]));
      expect({ x: P([{ a: 1 }]) }).toMatchObject({ x: [{ a: 1 }] });
      expect({ x: [{ a: 1 }] }).toMatchObject({ x: P([{ a: 1 }]) });
      expect(P([[1], [2]])).toMatchObject([[1], [2]]);
      expect([P([1]), P([2])]).toMatchObject([[1], [2]]);
      expect(P(P([{ a: 1 }]))).toMatchObject([{ a: 1 }]);
      await expect(Promise.resolve(P([{ a: 1 }]))).resolves.toMatchObject([{ a: 1 }]);
      // an element is still matched as a subset
      expect(P([{ a: 1, b: 2 }])).toMatchObject([{ a: 1 }]);
      expect(P([{ a: 1 }])).not.toMatchObject([{ a: 1, b: 2 }]);
      expect(P([{ a: 1 }])).toMatchObject([{ a: expect.any(Number) }]);
      expect(P([1, "a"])).toMatchObject([expect.any(Number), "a"]);
      expect(P([1])).not.toMatchObject([expect.any(String)]);
      // the length and the keys must be equal, as for two arrays
      expect(P([1, 2])).not.toMatchObject([1, 2, 3]);
      expect(P([1, 2, 3])).not.toMatchObject([1, 2]);
      expect([1, 2, 3]).not.toMatchObject(P([1, 2]));
      expect(P([1, 2])).not.toMatchObject(P([1]));
      expect(P([1, 2, 3])).not.toMatchObject([1, 2, 4]);
      expect(P(Object.assign([1], { x: 1 }))).not.toMatchObject([1]);
      expect(P([1])).not.toMatchObject(Object.assign([1], { x: 1 }));
      expect(P(Object.assign([1], { x: 1 }))).toMatchObject(Object.assign([1], { x: 1 }));
      // the target can be a derived, a null-prototype, a frozen or a sparse array
      class List extends Array {}
      expect(P(List.from([1, 2]))).toMatchObject([1, 2]);
      expect(P(Object.setPrototypeOf([1, 2], null))).toMatchObject([1, 2]);
      expect(P(ANY(Object.freeze([1, 2])))).toMatchObject([1, 2]);
      const sparse = () => Object.assign([1, 2, 3], { length: 4 });
      expect(P(sparse())).toMatchObject(sparse());
      // the `get` trap decides what an element is
      const served = P([1], { get: (target, key, receiver) => (key === "0" ? 9 : Reflect.get(target, key, receiver)) });
      expect(served).toMatchObject([9]);
      expect(served).not.toMatchObject([1]);
      // an array pattern still needs an array, and an object pattern can still be satisfied by one
      expect({}).not.toMatchObject(P([]));
      expect(new Proxy({ 0: 1, length: 1 }, {})).not.toMatchObject([1]);
      expect(P([1])).toMatchObject({ 0: 1 });
      // Array.prototype is an array without indexed storage, as a Proxy of an array is
      expect(Array.prototype).toMatchObject([]);
      expect([]).toMatchObject(Array.prototype);
      expect(P([])).toMatchObject(Array.prototype);
      expect(Array.prototype).toMatchObject(P([]));
      expect([1]).not.toMatchObject(Array.prototype);
      expect(Array.prototype).not.toMatchObject(P([1]));
      // expect() takes no copy of the received value
      const target = [1];
      const late = expect(P(target));
      target.push(2);
      late.toMatchObject([1, 2]);
      // a revoked Proxy is not an array
      const { proxy, revoke } = Proxy.revocable([1], {});
      revoke();
      expect(() => expect(proxy).toMatchObject([1])).toThrow(TypeError);
    });

    test("a reactive array, as Vue and Pinia make it, matches", () => {
      // The part of `reactive()` of @vue/reactivity that matters here: an object is served as a
      // Proxy of itself, and a ref in a member of an object is served as its value.
      const ref = (/** @type {unknown} */ value) => ({ __v_isRef: true, value });
      /** @type {(target: any) => any} */
      const reactive = target =>
        new Proxy(target, {
          get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (value === null || typeof value !== "object") return value;
            if (value.__v_isRef && !Array.isArray(target)) return value.value;
            return reactive(value);
          },
        });

      const alerts = reactive([]);
      alerts.push({ message: "1" });
      expect(alerts).toMatchObject([{ message: "1" }]);
      expect(() => expect(alerts).not.toMatchObject([{ message: "1" }])).toThrow(/toMatchObject|match object/);
      expect(alerts).not.toMatchObject([{ message: "2" }]);
      expect(alerts).not.toMatchObject([]);

      const store = reactive({ alerts: [{ message: "1" }], rows: [{ count: ref(1) }] });
      expect(store).toMatchObject({ alerts: [{ message: "1" }] });
      expect(store.alerts).toMatchObject([{ message: "1" }]);
      // `count` is the value that the Proxy serves, not the ref that the target holds
      expect(store).toMatchObject({ rows: [{ count: 1 }] });
      expect(store).not.toMatchObject({ rows: [{ count: 2 }] });
    });

    // Jest, Vitest and Bun do not give one answer for two arrays with holes. These rows ask only that
    // a Proxy of an array gets the answer of the array that it serves.
    test("the length of a Proxy of an array counts as the length of that array does", () => {
      const P = (/** @type {any[]} */ target, /** @type {ProxyHandler<any>} */ handler = {}) =>
        new Proxy(target, handler);
      const matches = (/** @type {any[]} */ received, /** @type {any[]} */ expected) => {
        try {
          expect(received).toMatchObject(expected);
          return true;
        } catch {
          return false;
        }
      };
      const sparse = () => Object.assign([1, 2, 3], { length: 4 });
      const rows = [
        { received: sparse(), expected: sparse() },
        { received: sparse(), expected: [1, 2, 3] },
        { received: [1, 2, 3], expected: sparse() },
        { received: [1, 2, 3], expected: [1, 2, 3, undefined] },
        { received: [1, undefined], expected: [1] },
        { received: new Array(3), expected: [] },
        { received: [], expected: new Array(3) },
        { received: [, 1], expected: [undefined, 1] },
      ];
      const answers = rows.map(({ received, expected }) => matches(received, expected));
      expect(rows.map(({ received, expected }) => matches(P(received), expected))).toEqual(answers);
      expect(rows.map(({ received, expected }) => matches(received, P(expected)))).toEqual(answers);
      expect(rows.map(({ received, expected }) => matches(P(received), P(expected)))).toEqual(answers);

      // the `get` trap decides what the length is: this Proxy serves [1, <hole>]
      const served = P([1], {
        get: (target, key, receiver) => (key === "length" ? 2 : Reflect.get(target, key, receiver)),
      });
      const holed = () => Object.assign([1], { length: 2 });
      expect(matches(served, holed())).toBe(true);
      expect(matches(holed(), served)).toBe(true);
      expect(matches(served, [1])).toBe(matches(holed(), [1]));
      expect(matches([1], served)).toBe(matches([1], holed()));

      // a `length` trap that throws ends the assertion with its error
      const throws = P([1], {
        get(target, key, receiver) {
          if (key === "length") throw new RangeError("no length");
          return Reflect.get(target, key, receiver);
        },
      });
      expect(() => expect(throws).not.toMatchObject([1])).toThrow(RangeError);
      expect(() => expect([1]).not.toMatchObject(throws)).toThrow(RangeError);
    });

    // Jest rejects every array under expect.objectContaining(), and Vitest compares an array sample key by key.
    // A Proxy of an array gets the answer of the array in each of them.
    test("expect.objectContaining() takes a Proxy of an array as the array that it wraps", () => {
      const P = (/** @type {any[]} */ target) => new Proxy(target, {});
      const equal = (/** @type {unknown} */ value, /** @type {unknown} */ matcher) => {
        try {
          expect(value).toEqual(matcher);
          return true;
        } catch {
          return false;
        }
      };
      const rows = [
        { value: [1, 2], sample: [1, 2] },
        { value: [1, 2], sample: [1] },
        { value: [1, 2], sample: [1, 3] },
        { value: [{ a: 1 }], sample: [{ a: 1 }] },
        { value: [{ a: 1, b: 2 }], sample: [{ a: 1 }] },
        { value: [[1, 2]], sample: [[1, 2]] },
      ];
      for (const containing of [
        (/** @type {any[]} */ sample) => expect.objectContaining(sample),
        (/** @type {any[]} */ sample) => expect.not.objectContaining(sample),
      ]) {
        const answers = rows.map(({ value, sample }) => equal(value, containing(sample)));
        expect(rows.map(({ value, sample }) => equal(P(value), containing(sample)))).toEqual(answers);
        expect(rows.map(({ value, sample }) => equal(value, containing(P(sample))))).toEqual(answers);
        expect(rows.map(({ value, sample }) => equal(P(value), containing(P(sample))))).toEqual(answers);
      }
    });

    if (isBun) {
      test("the match of a Proxy of an array reads `length` once for each Proxy", () => {
        /** @type {string[]} */
        let reads = [];
        const spy = (/** @type {any[]} */ target, /** @type {string} */ name) =>
          new Proxy(target, {
            get(target, key, receiver) {
              reads.push(`${name}.${String(key)}`);
              return Reflect.get(target, key, receiver);
            },
          });
        const lengthReads = () => reads.filter(read => read.endsWith(".length"));

        const received = expect(spy([{ a: 1 }], "received"));
        expect(reads).toEqual([]);
        received.toMatchObject([{ a: 1 }]);
        expect(lengthReads()).toEqual(["received.length"]);

        reads = [];
        expect([{ a: 1 }]).toMatchObject(spy([{ a: 1 }], "expected"));
        expect(lengthReads()).toEqual(["expected.length"]);

        reads = [];
        expect(spy([[1], [2]], "received")).toMatchObject(spy([[1], [2]], "expected"));
        expect(lengthReads()).toEqual(["received.length", "expected.length"]);

        // unequal lengths end the match before an element is read
        reads = [];
        expect(spy([1, 2], "received")).not.toMatchObject([1, 2, 3]);
        expect(reads).toEqual(["received.length"]);
      });
    }

    if (isBun) {
      test("Bun.deepMatch leaves out private fields, and an array in the subset needs an array", () => {
        class Counter {
          #n;
          constructor(/** @type {number} */ n) {
            this.#n = n;
          }
          get n() {
            return this.#n;
          }
        }
        expect(Bun.deepMatch(new Counter(2), new Counter(1))).toBe(true);
        expect(Bun.deepMatch({ k: [new Counter(2)] }, { k: [new Counter(1)] })).toBe(true);
        expect(Bun.deepMatch([], {})).toBe(false);
        expect(Bun.deepMatch([1], { 0: 1, length: 1 })).toBe(false);
        expect(Bun.deepMatch({ 0: 1 }, [1])).toBe(true);
        expect(Bun.deepMatch(["x"], Object.setPrototypeOf(["x"], null))).toBe(true);
        expect(Bun.deepMatch([1, 2], runInNewContext("[1, 2]"))).toBe(true);
      });
    }

    // A Date and an Error have no enumerable properties. Jest and Vitest compare an expected
    // Date by its time value and an expected Error by its message.
    test("an expected Date is compared by its time value", () => {
      expect({ d: new Date(5) }).toMatchObject({ d: new Date(5) });
      expect({ d: new Date(5) }).not.toMatchObject({ d: new Date(6) });
      expect({ a: { d: new Date(5) } }).not.toMatchObject({ a: { d: new Date(6) } });
      expect({ a: [new Date(5)] }).toMatchObject({ a: [new Date(5)] });
      expect({ a: [new Date(5)] }).not.toMatchObject({ a: [new Date(6)] });
      expect({ d: {} }).not.toMatchObject({ d: new Date(5) });
      expect({ d: { x: 1 } }).not.toMatchObject({ d: new Date(5) });
      expect({ d: 5 }).not.toMatchObject({ d: new Date(5) });
      expect(new Date(5)).toMatchObject(new Date(5));
      expect(new Date(5)).not.toMatchObject(new Date(6));
      // a plain expected object still matches the properties of a Date
      expect({ d: new Date(5) }).toMatchObject({ d: {} });
    });

    test("an expected Error is compared by its message", () => {
      expect({ e: new Error("x") }).toMatchObject({ e: new Error("x") });
      expect({ e: new Error("x") }).not.toMatchObject({ e: new Error("y") });
      expect({ a: [new Error("x")] }).not.toMatchObject({ a: [new Error("y")] });
      expect({ e: {} }).not.toMatchObject({ e: new Error("x") });
      expect({ e: { message: "x" } }).not.toMatchObject({ e: new Error("x") });
      expect({ e: "x" }).not.toMatchObject({ e: new Error("x") });
      expect(new Error("x")).toMatchObject(new Error("x"));
      expect(new Error("x")).not.toMatchObject(new Error("y"));
      // a plain expected object still matches the properties of an Error
      expect({ e: new Error("x") }).toMatchObject({ e: { message: "x" } });
      expect({ e: new Error("x") }).not.toMatchObject({ e: { message: "y" } });
    });

    test("an expected Date under a received object that refers to itself", () => {
      /** @type {any} */
      const received = { at: new Date(5) };
      received.self = received;
      expect(received).toMatchObject({ self: { at: new Date(5) } });
      expect(received).not.toMatchObject({ self: { at: new Date(6) } });
    });

    test("a Date or an Error in a private field is not compared", () => {
      class Stamp {
        #at;
        constructor(/** @type {number} */ time) {
          this.#at = new Date(time);
        }
        get at() {
          return this.#at;
        }
      }
      class Failure {
        #error;
        constructor(/** @type {string} */ message) {
          this.#error = new Error(message);
        }
        get error() {
          return this.#error;
        }
      }
      expect(new Stamp(1)).toMatchObject(new Stamp(2));
      expect({ k: [new Stamp(1)] }).toMatchObject({ k: [new Stamp(2)] });
      expect(new Failure("a")).toMatchObject(new Failure("b"));
    });

    // A Set and a Map do not keep what they hold in enumerable properties either. Jest and Vitest
    // compare an expected Set or Map by its members.
    test("an expected Set is compared by its members", () => {
      expect({ s: new Set([1, "a"]) }).toMatchObject({ s: new Set([1, "a"]) });
      expect({ s: new Set([1]) }).not.toMatchObject({ s: new Set([2]) });
      expect({ s: new Set([1, 2, 3]) }).not.toMatchObject({ s: new Set([1, 2]) });
      expect({ s: new Set([1]) }).not.toMatchObject({ s: new Set([1, 2]) });
      expect({ s: new Set([1]) }).not.toMatchObject({ s: new Set() });
      expect({ s: new Set() }).toMatchObject({ s: new Set() });
      expect({ s: new Set([NaN]) }).toMatchObject({ s: new Set([NaN]) });
      expect({ a: [new Set([1])] }).not.toMatchObject({ a: [new Set([2])] });
      expect(new Set([1])).toMatchObject(new Set([1]));
      expect(new Set([1])).not.toMatchObject(new Set([2]));
      // a member matches a member of the expected Set as a subset
      expect({ s: new Set([{ a: 1, b: 2 }]) }).toMatchObject({ s: new Set([{ a: 1 }]) });
      expect({ s: new Set([{ a: 1 }]) }).not.toMatchObject({ s: new Set([{ a: 1, b: 2 }]) });
      expect({ s: new Set([{ a: 1 }, { a: 2 }]) }).toMatchObject({ s: new Set([{ a: 2 }, { a: 1 }]) });
      expect({ s: new Set([{ a: 1 }]) }).not.toMatchObject({ s: new Set([{ a: 2 }]) });
      expect({ s: new Set([[1, 2]]) }).not.toMatchObject({ s: new Set([[1]]) });
      // as in Jest, two received members can match the same expected member
      expect({
        s: new Set([
          { a: 1, b: 1 },
          { a: 1, b: 2 },
        ]),
      }).toMatchObject({ s: new Set([{ a: 1 }, { c: 3 }]) });
      expect({ s: new Set([new Date(5)]) }).toMatchObject({ s: new Set([new Date(5)]) });
      expect({ s: new Set([new Date(5)]) }).not.toMatchObject({ s: new Set([new Date(6)]) });
      expect({ s: new Set([new Set([1])]) }).toMatchObject({ s: new Set([new Set([1])]) });
      expect({ s: new Set([new Set([1])]) }).not.toMatchObject({ s: new Set([new Set([2])]) });
      expect({ s: new Set([5]) }).toMatchObject({ s: new Set([expect.any(Number)]) });
      expect({ s: new Set(["x"]) }).not.toMatchObject({ s: new Set([expect.any(Number)]) });
      expect({ s: new Set([{ id: 1, kind: "a" }]) }).toMatchObject({
        s: new Set([{ id: expect.any(Number), kind: "a" }]),
      });
      // only a Set matches an expected Set
      expect({ s: [1] }).not.toMatchObject({ s: new Set([1]) });
      expect({ s: {} }).not.toMatchObject({ s: new Set() });
      expect({ s: new Map() }).not.toMatchObject({ s: new Set() });
      expect({ s: new Set([1]) }).not.toMatchObject({ s: [1] });
      // a plain expected object still matches the properties of a Set
      expect({ s: new Set([1]) }).toMatchObject({ s: {} });
      expect({ s: new Set([1]) }).toMatchObject({ s: { size: 1 } });
      expect({ s: new Set([1]) }).not.toMatchObject({ s: { size: 2 } });
    });

    test("an expected Map is compared by its entries", () => {
      expect({ m: new Map([["a", 1]]) }).toMatchObject({ m: new Map([["a", 1]]) });
      expect({ m: new Map([["a", 1]]) }).not.toMatchObject({ m: new Map([["a", 2]]) });
      expect({ m: new Map([["a", 1]]) }).not.toMatchObject({ m: new Map([["b", 1]]) });
      // prettier-ignore
      expect({ m: new Map([["a", 1], ["b", 2]]) }).not.toMatchObject({ m: new Map([["a", 1]]) });
      // prettier-ignore
      expect({ m: new Map([["a", 1]]) }).not.toMatchObject({ m: new Map([["a", 1], ["b", 2]]) });
      // prettier-ignore
      expect({ m: new Map([["a", 1], ["b", 2]]) }).toMatchObject({ m: new Map([["b", 2], ["a", 1]]) });
      expect({ m: new Map([["a", undefined]]) }).not.toMatchObject({ m: new Map([["b", undefined]]) });
      expect({ m: new Map([[NaN, 1]]) }).toMatchObject({ m: new Map([[NaN, 1]]) });
      expect({ a: [new Map([["a", 1]])] }).not.toMatchObject({ a: [new Map([["a", 2]])] });
      expect(new Map([["a", 1]])).toMatchObject(new Map([["a", 1]]));
      expect(new Map([["a", 1]])).not.toMatchObject(new Map([["a", 2]]));
      // a value matches the expected value as a subset
      expect({ m: new Map([["a", { x: 1, y: 2 }]]) }).toMatchObject({ m: new Map([["a", { x: 1 }]]) });
      expect({ m: new Map([["a", { x: 1 }]]) }).not.toMatchObject({ m: new Map([["a", { x: 1, y: 2 }]]) });
      expect({ m: new Map([["a", new Date(5)]]) }).not.toMatchObject({ m: new Map([["a", new Date(6)]]) });
      expect({ m: new Map([["a", new Set([1])]]) }).not.toMatchObject({ m: new Map([["a", new Set([2])]]) });
      expect({ m: new Map([["a", 5]]) }).toMatchObject({ m: new Map([["a", expect.any(Number)]]) });
      expect({ m: new Map([["a", "x"]]) }).not.toMatchObject({ m: new Map([["a", expect.any(Number)]]) });
      expect({ m: new Map([["a", { id: 1 }]]) }).toMatchObject({ m: new Map([["a", { id: expect.any(Number) }]]) });
      // a key that is not in the expected Map matches an expected key as a subset
      expect({ m: new Map([[{ a: 1 }, 1]]) }).toMatchObject({ m: new Map([[{ a: 1 }, 1]]) });
      expect({ m: new Map([[{ a: 1 }, 1]]) }).not.toMatchObject({ m: new Map([[{ a: 2 }, 1]]) });
      expect({ m: new Map([[{ a: 1 }, 1]]) }).not.toMatchObject({ m: new Map([[{ a: 1 }, 2]]) });
      expect({ m: new Map([["a", 1]]) }).toMatchObject({ m: new Map([[expect.any(String), 1]]) });
      expect({ m: new Map([[1, 1]]) }).not.toMatchObject({ m: new Map([[expect.any(String), 1]]) });
      // as in Jest, two received entries can match the same expected entry
      // prettier-ignore
      expect({ m: new Map([[{ k: 1, x: 1 }, 1], [{ k: 1, x: 2 }, 1]]) }).toMatchObject({
        m: new Map([[{ k: 1 }, 1], [{ z: 9 }, 2]]),
      });
      // the value under the same key differs, and another expected entry matches
      // prettier-ignore
      expect({ m: new Map([["z", 0], ["a", 1]]) }).toMatchObject({
        m: new Map([["a", 2], [expect.any(String), expect.any(Number)]]),
      });
      const sameKey = { id: 1 };
      // prettier-ignore
      expect({ m: new Map([[sameKey, { x: 1 }], [{ id: 1 }, { x: 2 }]]) }).toMatchObject({
        m: new Map([[sameKey, { x: 2 }], [{ id: 1 }, { x: 1 }]]),
      });
      // prettier-ignore
      expect({ m: new Map([[{ id: 0 }, 0], [sameKey, { x: 1 }]]) }).not.toMatchObject({
        m: new Map([[{ id: 0 }, 0], [sameKey, { x: 2 }]]),
      });
      // only a Map matches an expected Map
      expect({ m: {} }).not.toMatchObject({ m: new Map() });
      expect({ m: new Set() }).not.toMatchObject({ m: new Map() });
      expect({ m: new WeakMap() }).not.toMatchObject({ m: new Map() });
      // a plain expected object still matches the properties of a Map
      expect({ m: new Map([["a", 1]]) }).toMatchObject({ m: {} });
    });

    test("a Set member or a Map entry that fails one candidate is compared again with the next", () => {
      // The first candidate compares { v: 2 } with `shared` and fails. The second one has to compare them again.
      const shared = { v: 1 };
      expect({
        s: new Set([
          { k: { v: 2 }, z: 2 },
          { z: 2, k: { v: 1 } },
        ]),
      }).not.toMatchObject({
        s: new Set([
          { k: shared, z: 1 },
          { z: 2, k: shared },
        ]),
      });
      expect({
        s: new Set([
          { k: { v: 1 }, z: 2 },
          { z: 1, k: { v: 1 } },
        ]),
      }).toMatchObject({
        s: new Set([
          { k: shared, z: 1 },
          { z: 2, k: shared },
        ]),
      });
      // prettier-ignore
      expect({ m: new Map([[{ id: 1 }, { k: { v: 2 }, z: 2 }], [{ id: 2 }, { z: 2, k: { v: 1 } }]]) }).not.toMatchObject({
        m: new Map([[{ id: 1 }, { k: shared, z: 1 }], [{ id: 1 }, { z: 2, k: shared }]]),
      });
      // prettier-ignore
      expect({ m: new Map([[{ id: 1 }, { k: { v: 1 }, z: 2 }], [{ id: 1 }, { z: 1, k: { v: 1 } }]]) }).toMatchObject({
        m: new Map([[{ id: 1 }, { k: shared, z: 1 }], [{ id: 1 }, { z: 2, k: shared }]]),
      });
    });

    /** @type {<T>(items: T[]) => T[][]} */
    const permutations = items =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, i) =>
            permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]),
          );

    test("the order of the members of a Set or a Map does not change the result", () => {
      const ids = [0, 1, 2, 3];
      const members = () => ids.map(id => ({ id, extra: true }));
      for (const order of permutations(ids)) {
        expect({ s: new Set(members()) }).toMatchObject({ s: new Set(order.map(id => ({ id }))) });
        expect({ m: new Map(members().map(member => [member, 1])) }).toMatchObject({
          m: new Map(order.map(id => [{ id }, 1])),
        });
        for (const missing of ids) {
          // one expected member matches no received member
          const expected = order.map(id => ({ id: id === missing ? -1 : id }));
          expect({ s: new Set(members()) }).not.toMatchObject({ s: new Set(expected) });
          expect({ m: new Map(members().map(member => [member, 1])) }).not.toMatchObject({
            m: new Map(expected.map(key => [key, 1])),
          });
        }
      }
    });

    test("a Set member or a Map entry that fails a candidate leaves nothing behind, in each order", () => {
      for (const received of permutations([0, 1, 2])) {
        for (const expected of permutations([0, 1, 2])) {
          for (const v of [1, 2]) {
            // `shared` is in two candidates. { v: 2 } matches neither.
            const shared = { v: 1 };
            const members = [{ k: { v: 1 }, z: 1 }, { k: { v }, z: 2 }, { z: 3 }];
            const patterns = [{ k: shared, z: 1 }, { z: 2, k: shared }, { z: 3 }];
            const set = expect({ s: new Set(received.map(i => members[i])) });
            (v === 1 ? set : set.not).toMatchObject({ s: new Set(expected.map(i => patterns[i])) });
            const map = expect({ m: new Map(received.map(i => [members[i], 1])) });
            (v === 1 ? map : map.not).toMatchObject({ m: new Map(expected.map(i => [patterns[i], 1])) });
          }
        }
      }
    });

    test("a matcher that throws ends the comparison of a Set or a Map with its error", () => {
      const only = (/** @type {number} */ n) => ({
        asymmetricMatch: (/** @type {unknown} */ value) => {
          if (value !== n) throw new RangeError("not my member");
          return true;
        },
      });
      for (const order of [
        [0, 2, 1],
        [2, 1, 0],
      ]) {
        expect(() =>
          expect({ s: new Set([0, 1, 2].map(id => ({ id }))) }).toMatchObject({
            s: new Set(order.map(id => ({ id: only(id) }))),
          }),
        ).toThrow(new RangeError("not my member"));
        expect(() =>
          expect({ m: new Map([0, 1, 2].map(id => [{ id }, 1])) }).toMatchObject({
            m: new Map(order.map(id => [{ id: only(id) }, 1])),
          }),
        ).toThrow(new RangeError("not my member"));
      }
    });

    test("ends on cycles through a Set or a Map", () => {
      const throughSet = (/** @type {number} */ n) => {
        /** @type {any} */
        const o = {};
        o.s = new Set([o]);
        o.n = n;
        return o;
      };
      expect(throughSet(1)).toMatchObject(throughSet(1));
      expect(throughSet(1)).not.toMatchObject(throughSet(2));
      const throughMap = (/** @type {number} */ n) => {
        /** @type {any} */
        const o = {};
        o.m = new Map([["self", o]]);
        o.n = n;
        return o;
      };
      expect(throughMap(1)).toMatchObject(throughMap(1));
      expect(throughMap(1)).not.toMatchObject(throughMap(2));
    });

    test("a Set or a Map inside a candidate that fails leaves nothing behind", () => {
      // The nested Set matches, then the candidate fails on `v`. The second candidate shares `inner`.
      const inner = { s: new Set([{ q: 1 }]), v: 1 };
      const received = (/** @type {number} */ v) => ({ s: new Set([{ q: 1 }]), v });
      // prettier-ignore
      expect({ o: new Set([{ a: received(2), z: 2 }, { a: received(1), z: 1 }]) }).not.toMatchObject({
        o: new Set([{ a: inner, z: 1 }, { z: 2, a: inner }]),
      });
      // prettier-ignore
      expect({ o: new Set([{ a: received(1), z: 2 }, { a: received(1), z: 1 }]) }).toMatchObject({
        o: new Set([{ a: inner, z: 1 }, { z: 2, a: inner }]),
      });
      // `shared` is compared after the nested Set `n` has matched.
      const shared = { v: 1 };
      const n = () => new Set([{ q: 1 }]);
      // prettier-ignore
      expect({ o: new Set([{ n: n(), k: { v: 2 }, z: 2 }, { n: n(), k: { v: 1 }, z: 1 }]) }).not.toMatchObject({
        o: new Set([{ n: n(), k: shared, z: 1 }, { z: 2, n: n(), k: shared }]),
      });
      // prettier-ignore
      expect({ o: new Set([{ n: n(), k: { v: 1 }, z: 2 }, { n: n(), k: { v: 1 }, z: 1 }]) }).toMatchObject({
        o: new Set([{ n: n(), k: shared, z: 1 }, { z: 2, n: n(), k: shared }]),
      });
      // Inside the member, { a: 1 } fails against { a: 2 } first. Then `back` returns to the member.
      const cyclic = (/** @type {object[]} */ members, /** @type {number} */ count) => {
        /** @type {any} */
        const m = { t: new Set(members), count };
        m.back = m;
        return m;
      };
      expect({ set: new Set([cyclic([{ a: 1 }, { a: 2 }], 1)]) }).toMatchObject({
        set: new Set([cyclic([{ a: 2 }, { a: 1 }], 1)]),
      });
      expect({ set: new Set([cyclic([{ a: 1 }, { a: 2 }], 1)]) }).not.toMatchObject({
        set: new Set([cyclic([{ a: 2 }, { a: 1 }], 2)]),
      });
    });

    test("a Set or a Map in a private field is not compared", () => {
      class Tags {
        #set;
        #map;
        constructor(/** @type {number} */ value) {
          this.#set = new Set([value]);
          this.#map = new Map([["k", value]]);
        }
        get size() {
          return this.#set.size + this.#map.size;
        }
      }
      expect(new Tags(1)).toMatchObject(new Tags(2));
      expect({ k: [new Tags(1)] }).toMatchObject({ k: [new Tags(2)] });
    });

    test("a matcher beside a value that only has the type of a matcher is applied", () => {
      // A Response and a URL are objects of the type that the built-in matchers have.
      const isResponse = { asymmetricMatch: (/** @type {unknown} */ value) => value instanceof Response };
      const isNumber = { asymmetricMatch: (/** @type {unknown} */ value) => typeof value === "number" };
      expect({ k: new Set([new Response("")]) }).toMatchObject({ k: new Set([isResponse]) });
      expect({ k: new Set([new Response("")]) }).not.toMatchObject({ k: new Set([isNumber]) });
      expect({ k: new Map([["a", new URL("http://a/")]]) }).toMatchObject({
        k: new Map([["a", { asymmetricMatch: (/** @type {unknown} */ value) => value instanceof URL }]]),
      });
      expect({ k: new Set([expect.any(Response)]) }).toMatchObject({ k: new Set([new Response("")]) });
      // under a property, and in toEqual()
      expect({ k: new Response("") }).toMatchObject({ k: isResponse });
      expect({ k: new Response("") }).not.toMatchObject({ k: isNumber });
      expect({ k: expect.any(Response) }).toMatchObject({ k: new Response("") });
      expect({ k: new Response("") }).toEqual({ k: isResponse });
      expect({ k: new Response("") }).not.toEqual({ k: isNumber });
      expect({ k: { asymmetricMatch: (/** @type {unknown} */ value) => value instanceof URL } }).toEqual({
        k: new URL("http://a/"),
      });
      expect({ k: expect.any(Number) }).not.toEqual({ k: new Response("") });
      expect({ k: expect.any(Response) }).toEqual({ k: new Response("") });
    });

    describe("toMatchObject() with a Proxy around a Set or a Map", () => {
      test("a Proxy around a Set or a Map is compared by the members it serves", () => {
        // the target holds a box where script reads a number
        const counters = reactive(new Map([["a", { count: box(1) }]]));
        expect(counters).toMatchObject(new Map([["a", { count: 1 }]]));
        expect(counters).not.toMatchObject(new Map([["a", { count: 2 }]]));
        expect(counters).not.toMatchObject(new Map([["a", { count: { boxed: 1 } }]]));
        const doubled = reactive(new Set([{ double: box(4), extra: 1 }]));
        expect(doubled).toMatchObject(new Set([{ double: 4 }]));
        expect(doubled).not.toMatchObject(new Set([{ double: 5 }]));
        // members, size and kind
        expect({ s: reactive(new Set([1])) }).not.toMatchObject({ s: new Set([2]) });
        expect({ m: reactive(new Map([["k", 1]])) }).not.toMatchObject({ m: new Map([["k", 2]]) });
        expect({ m: reactive(new Map([["k", 1]])) }).not.toMatchObject({ m: new Map([["j", 1]]) });
        expect([reactive(new Set([1]))]).not.toMatchObject([new Set([2])]);
        expect(reactive(new Set([1, 2]))).toMatchObject(new Set([2, 1]));
        expect(reactive(new Set([1, 2]))).not.toMatchObject(new Set([1]));
        expect(reactive(new Set([1]))).not.toMatchObject(new Set([1, 2]));
        expect(reactive(new Set([1]))).not.toMatchObject(new Map());
        expect(reactive(new Map())).not.toMatchObject(new Set());
        expect(reactive(new Set())).toMatchObject(new Set());
        expect(reactive(new Map())).toMatchObject(new Map());
        // the state of a store: a Map of records with a box and an array field
        const store = reactive({ rows: new Map([["t1", { title: "x", done: box(false), tags: ["a", "b"] }]]) });
        expect(store).toMatchObject({ rows: new Map([["t1", { title: "x", done: false, tags: ["a", "b"] }]]) });
        expect(store).not.toMatchObject({ rows: new Map([["t1", { done: true }]]) });
        expect(store).not.toMatchObject({ rows: new Map([["t1", { tags: ["a"] }]]) });
        // a Set in a member, and an object as a key
        expect(reactive(new Map([["k", new Set([1])]]))).toMatchObject(new Map([["k", new Set([1])]]));
        expect(reactive(new Map([["k", new Set([1])]]))).not.toMatchObject(new Map([["k", new Set([2])]]));
        expect(reactive(new Map([[{ id: 1 }, "v"]]))).toMatchObject(new Map([[{ id: 1 }, "v"]]));
        expect(reactive(new Map([[{ id: 1 }, "v"]]))).not.toMatchObject(new Map([[{ id: 2 }, "v"]]));
        // matchers in the expected Set or Map
        expect(reactive(new Set([{ a: 1, b: 2 }]))).toMatchObject(new Set([expect.objectContaining({ a: 1 })]));
        expect(reactive(new Map([["k", 1]]))).toMatchObject(new Map([["k", expect.any(Number)]]));
        expect(reactive(new Map([["k", 1]]))).not.toMatchObject(new Map([["k", expect.any(String)]]));
        expect(reactive(new Map([["k", { tags: ["x", "y"] }]]))).toMatchObject(
          new Map([["k", { tags: expect.arrayContaining(["y"]) }]]),
        );
        // a Proxy around a Proxy
        expect(new Proxy(reactive(new Set([{ n: box(1) }])), {})).toMatchObject(new Set([{ n: 1 }]));
        expect(new Proxy(reactive(new Set([{ n: box(1) }])), {})).not.toMatchObject(new Set([{ n: 2 }]));
        // a Set that holds itself, and a record that its own Set holds
        const holdingItself = () => {
          const set = new Set();
          return set.add(set);
        };
        expect(reactive(holdingItself())).toMatchObject(holdingItself());
        expect(holdingItself()).toMatchObject(reactive(holdingItself()));
        const heldByItsSet = (/** @type {number} */ n) => {
          /** @type {any} */
          const record = { n };
          record.s = new Set([record]);
          return record;
        };
        expect(reactive(heldByItsSet(1))).toMatchObject(heldByItsSet(1));
        expect(reactive(heldByItsSet(1))).not.toMatchObject(heldByItsSet(2));
      });

      test("a Proxy around a Set or a Map is asked as the expected value too", () => {
        expect(new Set([1])).toMatchObject(reactive(new Set([1])));
        expect(new Set([1])).not.toMatchObject(reactive(new Set([2])));
        expect(new Map([["k", 1]])).toMatchObject(reactive(new Map([["k", 1]])));
        expect(new Map([["k", 1]])).not.toMatchObject(reactive(new Map([["k", 2]])));
        expect({ s: new Set([{ a: 1, b: 2 }]) }).toMatchObject({ s: reactive(new Set([{ a: box(1) }])) });
        expect({ s: new Set([{ a: 1, b: 2 }]) }).not.toMatchObject({ s: reactive(new Set([{ a: box(2) }])) });
        expect({}).not.toMatchObject(reactive(new Set([1])));
        // a Proxy on both sides
        expect(reactive(new Set([{ a: 1, b: 2 }]))).toMatchObject(reactive(new Set([{ a: 1 }])));
        expect(reactive(new Set([{ a: 1 }]))).not.toMatchObject(reactive(new Set([{ a: 1, b: 2 }])));
        expect(reactive(new Map([["k", 1]]))).not.toMatchObject(reactive(new Map([["k", 2]])));
        // a Proxy that stands for no Set and no Map is a pattern of properties
        expect({ a: 1, b: 2 }).toMatchObject(reactive({ a: 1 }));
        expect({ a: 1, b: 2 }).not.toMatchObject(reactive({ a: 2 }));
        expect(reactive(new Set([1]))).toMatchObject(serving({ size: 1 }));
        expect(reactive(new Set([1]))).not.toMatchObject(serving({ size: 2 }));
      });

      test("a Set that serves one member twice has the size that it says", () => {
        const member = { a: 1 };
        const twice = reactive(new Set([member, reactive(member)]));
        expect([twice.size, new Set(twice).size]).toEqual([2, 1]);
        expect(twice).toMatchObject(new Set([{ a: 1 }, { a: 1 }]));
        expect(twice).not.toMatchObject(new Set([{ a: 1 }]));
      });

      test("the size that a Proxy serves and what its `has` and `get` say count", () => {
        expect(serving(new Set([1]), { size: 2 })).not.toMatchObject(new Set([1]));
        expect(new Set([1])).toMatchObject(serving(new Set([1, 2]), { size: 1 }));
        // Two sizes are the same if `===` says so, also if they are no numbers.
        expect(new Set([1])).not.toMatchObject(serving(new Set([1]), { size: undefined }));
        expect(serving(new Set([1]), { size: "1" })).not.toMatchObject(new Set([1]));
        expect(serving(new Set([1]), { size: NaN })).not.toMatchObject(serving(new Set([1]), { size: NaN }));
        expect(serving(new Set([1]), { size: "1" })).toMatchObject(serving(new Set([1]), { size: "1" }));
        expect(serving(new Set([1]), { size: "1" })).not.toMatchObject(serving(new Set([2]), { size: "1" }));
        expect(serving(new Set([1]), { size: 1n })).toMatchObject(serving(new Set([1]), { size: 1n }));
        expect(serving(new Set([1]), { size: undefined })).toMatchObject(serving(new Set([1]), { size: undefined }));
        expect(serving(new Set([1]), { size: undefined })).not.toMatchObject(
          serving(new Set([2]), { size: undefined }),
        );
        // `has` that says yes to each value, and no to each
        expect(new Set([1])).toMatchObject(serving(new Set([2]), { has: () => "yes" }));
        expect(new Set([1])).toMatchObject(serving(new Set([1]), { has: () => 0 }));
        expect(new Set([1])).not.toMatchObject(serving(new Set([2]), { has: () => 0 }));
        // `get` gives the value of a key that `has` finds
        const anyKey = (/** @type {unknown} */ value) =>
          serving(new Map([["j", 5]]), { has: () => true, get: () => value });
        expect(new Map([["k", 1]])).toMatchObject(anyKey(1));
        expect(new Map([["k", undefined]])).toMatchObject(anyKey(undefined));
        expect(new Map([["k", 1]])).not.toMatchObject(anyKey(2));
        expect(new Map([["k", 1]])).toMatchObject(serving(new Map([["k", 1]]), { has: () => false }));
      });

      test("a Map that serves one key in several entries matches each of them", () => {
        const key = { id: 1 };
        // Its `has` finds no key, so each received entry is looked for among the entries that the iterator gives.
        const sameKey = serving(new Map(), {
          size: 3,
          *[Symbol.iterator]() {
            yield* [1, 2, 3].map(value => [key, value]);
          },
        });
        const received = (/** @type {number[]} */ values) => new Map(values.map(value => [{ id: 1 }, value]));
        expect(received([1, 2, 3])).toMatchObject(sameKey);
        expect(received([1, 3, 2])).toMatchObject(sameKey);
        expect(received([3, 2, 1])).toMatchObject(sameKey);
        expect(received([1, 2, 4])).not.toMatchObject(sameKey);
      });

      test("the value of an entry that a Proxy serves is read if its key is found, and not before", () => {
        const boom = new Error("boom");
        // A Map of one entry. The value of the entry throws when it is read.
        const withEntry = (/** @type {unknown} */ key) =>
          serving(new Map([[key, 1]]), {
            *[Symbol.iterator]() {
              yield {
                0: key,
                get 1() {
                  throw boom;
                },
              };
            },
          });
        // the expected entry: its key is another one, then the same one
        expect(new Map([[{ a: 1 }, 1]])).not.toMatchObject(withEntry({ a: 2 }));
        expect(thrownBy(() => expect(new Map([[{ a: 1 }, 1]])).toMatchObject(withEntry({ a: 1 })))).toBe(boom);
        // the received entry: the expected Map has no such key, then it has one
        expect(withEntry({ a: 2 })).not.toMatchObject(new Map([[{ a: 1 }, 1]]));
        expect(withEntry("k")).not.toMatchObject(new Map([["j", 1]]));
        expect(thrownBy(() => expect(withEntry({ a: 1 })).toMatchObject(new Map([[{ a: 1 }, 1]])))).toBe(boom);
        expect(thrownBy(() => expect(withEntry("k")).toMatchObject(new Map([["k", 1]])))).toBe(boom);
      });

      test("the Proxy is the receiver of what it is asked", () => {
        expect(viaThis(new Set([1, 2]))).toMatchObject(new Set([1, 2]));
        expect(new Set([1, 2])).toMatchObject(viaThis(new Set([1, 2])));
        expect(new Set([{ a: 1, b: 2 }])).toMatchObject(viaThis(new Set([{ a: 1 }])));
        expect(viaThis(new Set([1]))).not.toMatchObject(viaThis(new Set([2])));
        expect(viaThis(new Map([["k", { a: 1, b: 2 }]]))).toMatchObject(new Map([["k", { a: 1 }]]));
        expect(new Map([["k", 1]])).toMatchObject(viaThis(new Map([["k", 1]])));
        expect(new Map([[{ id: 1 }, 1]])).toMatchObject(viaThis(new Map([[{ id: 1 }, 1]])));
        expect(viaThis(new Map([["k", 1]]))).not.toMatchObject(viaThis(new Map([["k", 2]])));
      });

      test("a Proxy that serves no members of its Set or Map", () => {
        // No method of a Set takes a Proxy around a Set for a Set. Jest and Vitest throw this TypeError too.
        expect(() => expect({ s: new Proxy(new Set([1]), {}) }).toMatchObject({ s: new Set([1]) })).toThrow(TypeError);
        expect(() => expect({ m: new Proxy(new Map(), {}) }).toMatchObject({ m: new Map([["a", 1]]) })).toThrow(
          TypeError,
        );
        expect(() => expect(new Set([1])).toMatchObject(new Proxy(new Set([1]), {}))).toThrow(TypeError);
        const revoked = (/** @type {object} */ target) => {
          const { proxy, revoke } = Proxy.revocable(target, {});
          revoke();
          return proxy;
        };
        expect(() => expect({ s: revoked(new Set([1])) }).toMatchObject({ s: new Set([1]) })).toThrow(TypeError);
        expect(() => expect({ s: new Set([1]) }).toMatchObject({ s: revoked(new Set([1])) })).toThrow(TypeError);
        expect(() => expect({ s: revoked({}) }).toMatchObject({ s: reactive(new Set()) })).toThrow(TypeError);
        expect(() => expect(new Proxy(revoked(new Set()), {})).toMatchObject(reactive(new Set()))).toThrow(TypeError);
        expect(() => expect(new Set()).toMatchObject(new Proxy(revoked(new Set()), {}))).toThrow(TypeError);
        expect(() => expect(new Set()).toMatchObject(new Proxy(revoked(new Set()), { ownKeys: () => [] }))).toThrow(
          TypeError,
        );
        // a Proxy around an object that is no Set and no Map
        expect({ s: new Proxy({}, {}) }).not.toMatchObject({ s: new Set() });
        expect({ s: new Proxy([], {}) }).not.toMatchObject({ s: new Set() });
        expect({ m: reactive({}) }).not.toMatchObject({ m: new Map() });
        expect({ s: reactive({}) }).not.toMatchObject({ s: reactive(new Set()) });
      });

      test("a Proxy that serves no iterator method is matched by its properties", () => {
        // Each value that is false in a condition is no iterator method. These Proxies serve all else that their Set has.
        for (const nothing of [undefined, null, false, 0, "", NaN]) {
          const withoutIterator = (/** @type {number} */ member) =>
            serving(new Set([member]), { [Symbol.iterator]: nothing });
          expect(withoutIterator(1)).toMatchObject(new Set([2]));
          expect(new Set([1])).toMatchObject(withoutIterator(2));
          expect(withoutIterator(1)).toMatchObject(withoutIterator(2));
          expect(withoutIterator(1)).toMatchObject(serving(new Set([2])));
          expect(serving(new Set([1]))).toMatchObject(withoutIterator(2));
        }
        // Each other value is called.
        for (const noFunction of [1, "x", {}, true]) {
          expect(() =>
            expect(serving(new Set([1]), { [Symbol.iterator]: noFunction })).toMatchObject(new Set([1])),
          ).toThrow(TypeError);
          expect(() =>
            expect(new Set([{}])).toMatchObject(serving(new Set([{}]), { [Symbol.iterator]: noFunction })),
          ).toThrow(TypeError);
        }
      });

      // The matcher compares what a member holds as toEqual() does, so it has to read a Proxy around a Set or a Map too.
      test("a served member holds a Set or a Map under expect.objectContaining() or expect.arrayContaining()", () => {
        const users = () => reactive(new Map([["u1", { roles: new Set(["admin"]), visits: 1 }]]));
        expect(users()).toMatchObject(new Map([["u1", expect.objectContaining({ roles: new Set(["admin"]) })]]));
        expect(users()).not.toMatchObject(new Map([["u1", expect.objectContaining({ roles: new Map() })]]));
        expect(users()).not.toMatchObject(new Map([["u1", expect.objectContaining({ roles: ["admin"] })]]));
        // a Map of records, and a box in a member of a Set
        expect(reactive(new Map([["k", { m: new Map([["a", { x: 1 }]]) }]]))).toMatchObject(
          new Map([["k", expect.objectContaining({ m: new Map([["a", { x: 1 }]]) })]]),
        );
        expect(reactive(new Map([["k", { s: new Set([{ n: box(1) }]) }]]))).toMatchObject(
          new Map([["k", expect.objectContaining({ s: new Set([{ n: 1 }]) })]]),
        );
        // one object deeper than the matcher, and a Set in a Set
        expect(reactive(new Set([{ o: { p: { s: new Set([1]) } } }]))).toMatchObject(
          new Set([{ o: expect.objectContaining({ p: { s: new Set([1]) } }) }]),
        );
        expect(reactive(new Map([["k", { s: new Set([new Set([1])]) }]]))).toMatchObject(
          new Map([["k", expect.objectContaining({ s: new Set([new Set([1])]) })]]),
        );
        // in an element of expect.arrayContaining()
        const lists = () => reactive(new Map([["k", { list: [{ s: new Set([1]), x: 1 }, new Map([["a", 1]])] }]]));
        expect(lists()).toMatchObject(new Map([["k", { list: expect.arrayContaining([{ s: new Set([1]), x: 1 }]) }]]));
        expect(lists()).toMatchObject(new Map([["k", { list: expect.arrayContaining([new Map([["a", 1]])]) }]]));
        expect(lists()).toMatchObject(
          new Map([["k", { list: expect.arrayContaining([expect.objectContaining({ s: new Set([1]) })]) }]]),
        );
        expect(lists()).not.toMatchObject(new Map([["k", { list: expect.arrayContaining([{ s: new Set([1]) }]) }]]));
        expect(lists()).not.toMatchObject(new Map([["k", { list: expect.arrayContaining([new Set([1])]) }]]));
      });
    });

    if (isBun) {
      test("Bun.deepMatch compares an expected Date and Error", () => {
        expect(Bun.deepMatch(new Date(1), new Date(2))).toBe(false);
        expect(Bun.deepMatch({ d: new Date(2) }, { d: new Date(1) })).toBe(false);
        expect(Bun.deepMatch({ d: new Date(1) }, { d: new Date(1) })).toBe(true);
        expect(Bun.deepMatch(new Error("b"), new Error("a"))).toBe(false);
        expect(Bun.deepMatch({ e: new Error("x") }, { e: new Error("x") })).toBe(true);
        expect(Bun.deepMatch({ d: new Date() }, { d: {} })).toBe(false);
        expect(Bun.deepMatch({ d: {} }, { d: new Date() })).toBe(true);
      });

      test("details of the Date and Error comparison", () => {
        // an invalid Date equals no Date, as in toEqual and in Jest
        expect({ d: new Date(NaN) }).not.toMatchObject({ d: new Date(NaN) });
        // as in Jest, the class, the name and the cause of an Error are not compared
        expect({ e: new TypeError("x") }).toMatchObject({ e: new Error("x") });
        expect({ e: new Error("x", { cause: 1 }) }).toMatchObject({ e: new Error("x", { cause: 2 }) });
        // a DOMException is an Error
        expect({ e: new DOMException("x") }).toMatchObject({ e: new Error("x") });
        expect({ e: new DOMException("x") }).not.toMatchObject({ e: new Error("y") });
        // the enumerable properties of the expected Date or Error are matched, as before
        const withCode = () => Object.assign(new Error("x"), { code: 1 });
        expect({ e: Object.assign(withCode(), { extra: 2 }) }).toMatchObject({ e: withCode() });
        expect({ e: new Error("x") }).not.toMatchObject({ e: withCode() });
        expect({ d: new Date(5) }).not.toMatchObject({ d: Object.assign(new Date(5), { x: 1 }) });
      });

      test("Bun.deepMatch compares an expected Set and Map", () => {
        expect(Bun.deepMatch(new Set([1]), new Set([2]))).toBe(false);
        expect(Bun.deepMatch({ s: new Set([2]) }, { s: new Set([1]) })).toBe(false);
        expect(Bun.deepMatch({ s: new Set([{ a: 1 }]) }, { s: new Set([{ a: 1, b: 2 }]) })).toBe(true);
        expect(Bun.deepMatch({ s: new Set([{ a: 1, b: 2 }]) }, { s: new Set([{ a: 1 }]) })).toBe(false);
        expect(Bun.deepMatch(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
        expect(Bun.deepMatch({ m: new Map([["a", { x: 1 }]]) }, { m: new Map([["a", { x: 1, y: 2 }]]) })).toBe(true);
        expect(Bun.deepMatch({ m: new Map() }, { m: {} })).toBe(false);
        expect(Bun.deepMatch({ m: {} }, { m: new Map() })).toBe(true);
        // Bun.deepMatch has no asymmetric matchers
        expect(Bun.deepMatch({ s: new Set([expect.any(Number)]) }, { s: new Set([5]) })).toBe(false);
      });

      test("details of the Set and Map comparison", () => {
        // a received Set or Map keeps its members when they match a matcher
        const received = { s: new Set([5]), m: new Map([["a", 5]]) };
        expect(received).toMatchObject({ s: new Set([expect.any(Number)]), m: new Map([["a", expect.any(Number)]]) });
        expect([...received.s, ...received.m]).toEqual([5, ["a", 5]]);
        // the class of a Set or a Map is not compared, as in toEqual
        class MySet extends Set {}
        expect({ s: new MySet([1]) }).toMatchObject({ s: new Set([1]) });
        expect({ s: new MySet([1]) }).not.toMatchObject({ s: new Set([2]) });
        // the enumerable properties of the expected Set or Map are matched, as before
        const withTag = () => Object.assign(new Set([1]), { tag: 1 });
        expect({ s: Object.assign(withTag(), { extra: 2 }) }).toMatchObject({ s: withTag() });
        expect({ s: new Set([1]) }).not.toMatchObject({ s: withTag() });
        // an object in the expected Set needs an object, as a property does
        expect({ s: new Set([1]) }).not.toMatchObject({ s: new Set([{}]) });
        // a function in a Set or a Map is matched as a function under a property is
        expect({ s: new Set([() => 1]) }).toMatchObject({ s: new Set([() => 2]) });
        // expect.objectContaining() still takes a Set or a Map as an object with no properties
        expect({ a: 1 }).toEqual(expect.objectContaining(new Set([1])));
      });

      test("what toMatchObject() asks a Proxy around a Set or a Map, and when", () => {
        /** @type {string[]} */
        const log = [];
        const asked = (/** @type {() => void} */ fn) => {
          log.length = 0;
          fn();
          return log.join(" ");
        };
        // The received value: its iterator method and its size first, then the members until one does not match.
        expect(asked(() => expect(handingOn(new Set([1, 2, 3]), log)).toMatchObject(new Set([1, 2, 3])))).toBe(
          "@@iterator size next() next() next() next()",
        );
        expect(asked(() => expect(handingOn(new Set([1, 2]), log)).not.toMatchObject(new Set([1])))).toBe(
          "@@iterator size",
        );
        expect(asked(() => expect(handingOn(new Set([1, 2, 3]), log)).not.toMatchObject(new Set([4, 5, 6])))).toBe(
          "@@iterator size next() return()",
        );
        expect(asked(() => expect(handingOn(new Map([["k", 1]]), log)).toMatchObject(new Map([["k", 1]])))).toBe(
          "@@iterator size next() next()",
        );
        expect(asked(() => expect(handingOn(new Map([["k", 1]]), log)).not.toMatchObject(new Map([["k", 2]])))).toBe(
          "@@iterator size next() return()",
        );
        // The expected value: `has` for each received member, `get` for the value of a Map, and its members for a member that it has not.
        expect(asked(() => expect(new Set([1, 2])).toMatchObject(handingOn(new Set([1, 2]), log)))).toBe(
          "@@iterator size has has",
        );
        expect(asked(() => expect(new Map([["k", 1]])).toMatchObject(handingOn(new Map([["k", 1]]), log)))).toBe(
          "@@iterator size has get",
        );
        expect(asked(() => expect(new Map([["k", 1]])).not.toMatchObject(handingOn(new Map([["k", 2]]), log)))).toBe(
          "@@iterator size has get next() next()",
        );
        expect(asked(() => expect(new Set([{ a: 1 }])).toMatchObject(handingOn(new Set([{ a: 1 }]), log)))).toBe(
          "@@iterator size has next() return()",
        );
        // A Proxy on each side. The sizes are asked before an iterator is made.
        expect(
          asked(() => expect(handingOn(new Set([{ a: 1 }]), log)).toMatchObject(handingOn(new Set([{ a: 1 }]), log))),
        ).toBe("@@iterator @@iterator size size next() has next() next() return()");
        expect(
          asked(() => expect(handingOn(new Set([1, 2]), log)).not.toMatchObject(handingOn(new Set([1]), log))),
        ).toBe("@@iterator @@iterator size size");
        // The walk of the expected members goes on behind the last match. One that is left for a walk from the start is closed first.
        const inOrder = (/** @type {number[]} */ ids) => ids.map(id => ({ id }));
        expect(
          asked(() => expect(new Set(inOrder([0, 1, 2]))).toMatchObject(handingOn(new Set(inOrder([0, 2, 1])), log))),
        ).toBe("@@iterator size has next() has next() return() next() next() next() has next() next() next() return()");
        expect(
          asked(() =>
            expect(new Map(inOrder([0, 1, 2]).map(key => [key, 1]))).toMatchObject(
              handingOn(new Map(inOrder([0, 2, 1]).map(key => [key, 1])), log),
            ),
          ),
        ).toBe("@@iterator size has next() has next() return() next() next() next() has next() next() next() return()");
        // Nothing else is asked of a Proxy that serves no iterator method: the key walk decides, as for each other object.
        for (const nothing of [undefined, null, false, 0, "", NaN]) {
          const hidden = () => new Proxy(new Set([1]), { get: (target, key) => (log.push(nameOf(key)), nothing) });
          expect(asked(() => expect(hidden()).toMatchObject(new Set([2])))).toBe("@@iterator");
          expect(asked(() => expect(new Set([2])).toMatchObject(hidden()))).toBe("@@iterator");
          // The expected value is not asked if the received value serves none.
          expect(asked(() => expect(hidden()).toMatchObject(hidden()))).toBe("@@iterator");
        }
        // A Proxy around another object is asked nothing for a Set or a Map, and for its properties as a pattern.
        const around = (/** @type {object} */ target) =>
          new Proxy(target, {
            get: (target, key, receiver) => (log.push(nameOf(key)), Reflect.get(target, key, receiver)),
          });
        expect(asked(() => expect(around({ a: 1 })).not.toMatchObject(new Set([1])))).toBe("");
        expect(asked(() => expect(around({})).not.toMatchObject(handingOn(new Set(), log)))).toBe("");
        expect(asked(() => expect(handingOn(new Set(), log)).toMatchObject(around({})))).toBe("");
        expect(asked(() => expect({ a: 1, b: 2 }).toMatchObject(around({ a: 1 })))).toBe("a");
        // A Set is no Map: neither Proxy is asked.
        expect(
          asked(() => expect(handingOn(new Set([1]), log)).not.toMatchObject(handingOn(new Map([[1, 1]]), log))),
        ).toBe("");
        // An entry that a Proxy serves: its key when the walk gives it, and its value when the key is found, in front of `get`.
        const oneEntry = (/** @type {string} */ name, /** @type {unknown} */ key, /** @type {unknown} */ value) =>
          serving(new Map([[key, value]]), {
            *[Symbol.iterator]() {
              yield {
                get 0() {
                  log.push(`${name}[0]`);
                  return key;
                },
                get 1() {
                  log.push(`${name}[1]`);
                  return value;
                },
              };
            },
            has: (/** @type {unknown} */ k) => (log.push(`${name}.has`), k === key),
            get: () => (log.push(`${name}.get`), value),
          });
        expect(asked(() => expect(oneEntry("a", "k", 1)).toMatchObject(oneEntry("b", "k", 1)))).toBe(
          "a[0] b.has a[1] b.get",
        );
        expect(asked(() => expect(oneEntry("a", "k", 1)).not.toMatchObject(oneEntry("b", "k", 2)))).toBe(
          "a[0] b.has a[1] b.get b[0] a[1] b[1]",
        );
        expect(asked(() => expect(oneEntry("a", { id: 1 }, 1)).toMatchObject(oneEntry("b", { id: 1 }, 1)))).toBe(
          "a[0] b.has b[0] a[1] b[1]",
        );
        expect(asked(() => expect(oneEntry("a", { id: 1 }, 1)).not.toMatchObject(oneEntry("b", { id: 2 }, 1)))).toBe(
          "a[0] b.has b[0]",
        );
      });

      test("what a Proxy around a Set or a Map throws ends toMatchObject()", () => {
        const boom = new RangeError("boom");
        /** @type {string[]} */
        const log = [];
        let steps = 0;
        const throwingAt = (/** @type {string | symbol} */ step, /** @type {object} */ target) =>
          new Proxy(target, {
            get(target, key) {
              if (key === step) throw boom;
              if (key === Symbol.iterator) {
                return () => {
                  if (step === "@@iterator()") throw boom;
                  const iterator = /** @type {Iterable<unknown>} */ (target)[Symbol.iterator]();
                  return {
                    next: () => {
                      steps++;
                      if (step === "next()") throw boom;
                      return iterator.next();
                    },
                    return: () => {
                      log.push("return()");
                      if (step === "return()") throw boom;
                      return {};
                    },
                  };
                };
              }
              const value = Reflect.get(target, key, target);
              if (typeof value !== "function" || key === "constructor") return value;
              return (/** @type {unknown[]} */ ...args) => {
                if (step === `${String(key)}()`) throw boom;
                return value.apply(target, args);
              };
            },
          });
        const matcherError = new Error("from the matcher");
        const throwingMatcher = {
          asymmetricMatch() {
            throw matcherError;
          },
        };
        // The member and the key are objects, so that the expected value is asked for its members too.
        for (const [collection, other, withMatcher] of /** @type {const} */ ([
          [() => new Set([{ a: 1 }]), () => new Set([{ a: 2 }]), () => new Set([throwingMatcher])],
          [() => new Map([[{ a: 1 }, 1]]), () => new Map([[{ a: 2 }, 1]]), () => new Map([[throwingMatcher, 1]])],
        ])) {
          for (const step of [Symbol.iterator, "size", "@@iterator()", "next()"]) {
            expect(thrownBy(() => expect(throwingAt(step, collection())).toMatchObject(collection()))).toBe(boom);
            expect(thrownBy(() => expect(collection()).toMatchObject(throwingAt(step, collection())))).toBe(boom);
          }
          for (const step of ["has", "has()"]) {
            expect(thrownBy(() => expect(collection()).toMatchObject(throwingAt(step, collection())))).toBe(boom);
          }
          // An iterator that throws is not closed.
          expect(log).toEqual([]);
          // A walk that is left early is closed, and what return() throws is thrown.
          expect(thrownBy(() => expect(throwingAt("return()", collection())).toMatchObject(other()))).toBe(boom);
          expect(thrownBy(() => expect(collection()).toMatchObject(throwingAt("return()", collection())))).toBe(boom);
          expect(log).toEqual(["return()", "return()"]);
          // An error of a member closes the walk and stays the error.
          log.length = 0;
          expect(thrownBy(() => expect(throwingAt("return()", collection())).toMatchObject(withMatcher()))).toBe(
            matcherError,
          );
          expect(log).toEqual(["return()"]);
          log.length = 0;
        }
        // `get` is asked for the value of a key that `has` finds.
        for (const step of ["get", "get()"]) {
          expect(thrownBy(() => expect(new Map([["k", 1]])).toMatchObject(throwingAt(step, new Map([["k", 1]]))))).toBe(
            boom,
          );
        }
        // What return() throws where a walk is left for a walk from the start ends the comparison there: two steps, and none behind it.
        for (const inOrder of [
          (/** @type {number[]} */ ids) => new Set(ids.map(id => ({ id }))),
          (/** @type {number[]} */ ids) => new Map(ids.map(id => [{ id }, 1])),
        ]) {
          steps = 0;
          expect(
            thrownBy(() => expect(inOrder([0, 1, 2])).toMatchObject(throwingAt("return()", inOrder([0, 2, 1])))),
          ).toBe(boom);
          expect({ log, steps }).toEqual({ log: ["return()"], steps: 2 });
          log.length = 0;
        }
        // So does the error of an entry that is no pair of a key and a value, and of an entry whose value throws. Their walks are closed.
        const serves = (/** @type {unknown} */ entry) =>
          serving(new Map([["k", 1]]), {
            [Symbol.iterator]: () => ({
              next: () => ({ done: false, value: entry }),
              return: () => (log.push("return()"), {}),
            }),
          });
        const valueThrows = (/** @type {unknown} */ key) => ({
          0: key,
          get 1() {
            throw boom;
          },
        });
        expect(thrownBy(() => expect(serves(null)).toMatchObject(new Map([["k", 1]])))).toBeInstanceOf(TypeError);
        expect(thrownBy(() => expect(serves(valueThrows("k"))).toMatchObject(new Map([["k", 1]])))).toBe(boom);
        expect(thrownBy(() => expect(new Map([[{}, 1]])).toMatchObject(serves(valueThrows({}))))).toBe(boom);
        expect(log).toEqual(["return()", "return()", "return()"]);
        // The value of a received entry is read in front of `get` of the expected Map, so `get` is not asked if that value throws.
        /** @type {string[]} */
        const asked = [];
        expect(
          thrownBy(() => expect(serves(valueThrows("k"))).toMatchObject(handingOn(new Map([["k", 1]]), asked))),
        ).toBe(boom);
        expect(asked).toEqual(["@@iterator", "size", "has"]);
      });

      test("a member that a Proxy serves stays alive while the expected value is asked", () => {
        // Each member is made for the walk, and the comparison alone holds it. `has` collects garbage.
        let collections = 0;
        const fresh = (/** @type {object} */ target, /** @type {number} */ count) =>
          new Proxy(target, {
            get(target, key) {
              if (key === "size") return count;
              if (key === "has") return () => (Bun.gc(true), collections++, false);
              if (key === Symbol.iterator) {
                return function* () {
                  for (let id = 0; id < count; id++) {
                    const member = { id, name: `member ${id}` };
                    yield target instanceof Map ? [member, { of: member.name }] : member;
                  }
                };
              }
              return Reflect.get(target, key, target);
            },
          });
        expect(fresh(new Set(), 3)).toMatchObject(fresh(new Set(), 3));
        expect(fresh(new Map(), 3)).toMatchObject(fresh(new Map(), 3));
        expect(collections).toBe(6);
      });

      test("an expected Proxy whose `has` or `get` is no function", () => {
        for (const [method, received, expected] of /** @type {const} */ ([
          ["has", new Set([1]), serving(new Set([1]), { has: undefined })],
          ["has", new Map([["k", 1]]), serving(new Map([["k", 1]]), { has: 1 })],
          ["get", new Map([["k", 1]]), serving(new Map([["k", 1]]), { get: undefined })],
        ])) {
          const error = thrownBy(() => expect(received).toMatchObject(expected));
          expect(error).toBeInstanceOf(TypeError);
          expect(/** @type {Error} */ (error).message).toBe(`${method} is not a function`);
        }
        // The received value is asked for neither.
        expect(serving(new Set([1]), { has: undefined })).toMatchObject(new Set([1]));
        expect(serving(new Map([["k", 1]]), { has: undefined, get: undefined })).toMatchObject(new Map([["k", 1]]));
      });

      test("where toMatchObject() of a Proxy around a Set or a Map is not that of Jest 30.5.2 and Vitest 4.1.12", () => {
        class Tags extends Set {}
        /** @returns {object} */
        const servingASet = (/** @type {number[]} */ members) =>
          new Proxy(
            {},
            {
              get(target, key) {
                const set = new Set(members);
                const value = Reflect.get(set, key, set);
                return typeof value === "function" && key !== "constructor" ? value.bind(set) : value;
              },
            },
          );
        const unsized = (/** @type {number[]} */ members) => serving(new Set(members), { size: undefined });
        // Each row: an assertion, what it does here, and what it does in the references (Jest 30.5.2 and Vitest 4.1.12).
        /** @type {[() => void, "pass" | "fail", "pass" | "fail"][]} */
        const rows = [
          // The class of a Set or a Map is not compared, with a Proxy or without one. The references compare `constructor`.
          [() => expect(new Tags([1])).toMatchObject(new Set([1])), "pass", "fail"],
          [() => expect(reactive(new Tags([1]))).toMatchObject(new Set([1])), "pass", "fail"],
          [() => expect(new Set([1])).toMatchObject(reactive(new Tags([1]))), "pass", "fail"],
          [() => expect(serving(new Set([1]), { constructor: undefined })).toMatchObject(new Set([1])), "pass", "fail"],
          // The references compare the members in order if the received value serves no `size`.
          [() => expect(unsized([1])).toMatchObject(new Set([1])), "fail", "pass"],
          [() => expect(unsized([1, 2])).toMatchObject(unsized([2, 1])), "pass", "fail"],
          [() => expect(unsized([1])).toMatchObject(unsized([1, 2])), "pass", "fail"],
          // So they do if the received value does not say that it is a Set.
          [
            () => expect(serving(new Set([1, 2]), { [Symbol.toStringTag]: undefined })).toMatchObject(new Set([2, 1])),
            "pass",
            "fail",
          ],
          // What a Proxy stands for is what its target is. The references take what it serves.
          [() => expect(servingASet([1])).toMatchObject(new Set([1])), "fail", "pass"],
          [() => expect(new Set([1])).toMatchObject(servingASet([2])), "pass", "fail"],
        ];
        for (const [row, bun, references] of rows) {
          expect(thrownBy(row) === undefined ? "pass" : "fail").toBe(bun);
          expect(bun).not.toBe(references);
        }
      });

      // A missing check aborts a debug build under BUN_JSC_validateExceptionChecks=1 (a no-op on release builds).
      test("toMatchObject() checks for an exception behind each call into a Proxy around a Set or a Map", async () => {
        const { bunEnv, bunExe } = require("harness");
        const src = `
          const { expect } = require("bun:test");
          const attempt = fn => { try { fn(); } catch {} };
          const boom = new Error("boom");
          const throwingAt = (step, target) => new Proxy(target, {
            get(target, key) {
              if (key === step) throw boom;
              if (key === Symbol.iterator) return () => {
                if (step === "@@iterator()") throw boom;
                const iterator = target[Symbol.iterator]();
                return {
                  next: () => {
                    if (step === "next()") throw boom;
                    const result = iterator.next();
                    if (result.done || !(target instanceof Map)) return result;
                    const [key, value] = result.value;
                    return { done: false, value: { get 0() { if (step === "[0]") throw boom; return key; }, get 1() { if (step === "[1]") throw boom; return value; } } };
                  },
                  return: () => { if (step === "return()") throw boom; return {}; },
                };
              };
              const value = Reflect.get(target, key, target);
              if (typeof value !== "function" || key === "constructor") return value;
              return (...args) => { if (step === String(key) + "()") throw boom; return value.apply(target, args); };
            },
          });
          const serving = (target, instead) => new Proxy(target, {
            get(target, key) {
              const value = Object.hasOwn(instead, key) ? instead[key] : Reflect.get(target, key, target);
              return typeof value === "function" && key !== "constructor" ? value.bind(target) : value;
            },
          });
          const steps = [undefined, Symbol.iterator, "size", "has", "get", "@@iterator()", "next()", "[0]", "[1]", "has()", "get()", "return()"];
          const pairs = [
            [() => new Set([{ a: 1 }, { b: 2 }]), () => new Set([{ a: 1 }, { b: 2 }])],
            [() => new Set([{ a: 1 }, { b: 2 }]), () => new Set([{ b: 2 }, { a: 1 }])],
            [() => new Set([{ a: 1 }, { b: 2 }]), () => new Set([{ c: 3 }, { d: 4 }])],
            [() => new Map([[{ a: 1 }, 1], [{ b: 2 }, 2]]), () => new Map([[{ a: 1 }, 1], [{ b: 2 }, 2]])],
            [() => new Map([[{ a: 1 }, 1], [{ b: 2 }, 2]]), () => new Map([[{ b: 2 }, 2], [{ a: 1 }, 1]])],
            [() => new Map([["k", { a: 1 }], ["j", 2]]), () => new Map([["k", { a: 1 }], ["j", 2]])],
            [() => new Map([["k", 1], ["j", 2]]), () => new Map([["k", 2], ["j", 1]])],
            [() => new Set([1]), () => new Map([[1, 1]])],
            [() => new Set([1]), () => ({})],
            [() => ({}), () => new Set([1])],
          ];
          for (const [received, expected] of pairs) {
            for (const step of steps) {
              attempt(() => expect(throwingAt(step, received())).toMatchObject(expected()));
              attempt(() => expect(received()).toMatchObject(throwingAt(step, expected())));
              attempt(() => expect(throwingAt(step, received())).toMatchObject(throwingAt(step, expected())));
              attempt(() => expect(throwingAt(step, received())).not.toMatchObject(throwingAt(undefined, expected())));
              attempt(() => Bun.deepMatch(throwingAt(step, expected()), throwingAt(undefined, received())));
            }
          }
          for (const size of [undefined, "1", 1n, NaN, 2]) {
            attempt(() => expect(serving(new Set([1]), { size })).toMatchObject(serving(new Set([1]), { size })));
          }
          for (const iterator of [undefined, null, 0, "", 1, {}]) {
            attempt(() => expect(serving(new Set([1]), { [Symbol.iterator]: iterator })).toMatchObject(new Set([1])));
            attempt(() => expect(new Set([{}])).toMatchObject(serving(new Set([{}]), { [Symbol.iterator]: iterator })));
            attempt(() => expect(serving(new Set([1]), { [Symbol.iterator]: iterator })).toMatchObject(serving(new Set([1]), {})));
          }
          for (const method of ["has", "get"]) {
            attempt(() => expect(new Map([["k", 1]])).toMatchObject(serving(new Map([["k", 1]]), { [method]: undefined })));
          }
          attempt(() => expect(new Proxy(new Set([1]), {})).toMatchObject(new Set([1])));
          attempt(() => expect(new Set([1])).toMatchObject(new Proxy(new Set([1]), {})));
          const revoked = Proxy.revocable(new Set([1]), {});
          revoked.revoke();
          attempt(() => expect(revoked.proxy).toMatchObject(new Set([1])));
          attempt(() => expect(new Set([1])).toMatchObject(revoked.proxy));
          attempt(() => expect(revoked.proxy).toMatchObject(throwingAt(undefined, new Set([1]))));
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

      test("members of a Set or a Map that follow each other in the same order take one try each", () => {
        // Each expected member holds a matcher. One call of `tried` is one try of a candidate: [received id, candidate id].
        const tried = jest.fn((/** @type {unknown} */ value, /** @type {number} */ id) => value === id);
        const counted = (/** @type {number} */ id) => ({
          id: { asymmetricMatch: (/** @type {unknown} */ value) => tried(value, id) },
        });
        const ids = Array.from({ length: 50 }, (_, id) => id);

        // A scan from the first expected member for each received member makes 1275 tries.
        expect({ s: new Set(ids.map(id => ({ id }))) }).toMatchObject({ s: new Set(ids.map(counted)) });
        expect(tried).toHaveBeenCalledTimes(ids.length);
        tried.mockClear();
        expect({ m: new Map(ids.map(id => [{ id }, 1])) }).toMatchObject({
          m: new Map(ids.map(id => [counted(id), 1])),
        });
        expect(tried).toHaveBeenCalledTimes(ids.length);
        tried.mockClear();

        // Another order: the try behind the last match fails. The scan from the start then leaves that candidate out.
        // prettier-ignore
        const pairs = [[0, 1], [0, 0], [1, 2], [1, 1], [2, 0], [2, 1], [2, 2]];
        expect({ s: new Set([0, 1, 2].map(id => ({ id }))) }).toMatchObject({ s: new Set([1, 0, 2].map(counted)) });
        expect(tried.mock.calls).toEqual(pairs);
        tried.mockClear();
        expect({ m: new Map([0, 1, 2].map(id => [{ id }, 1])) }).toMatchObject({
          m: new Map([1, 0, 2].map(id => [counted(id), 1])),
        });
        expect(tried.mock.calls).toEqual(pairs);
        tried.mockClear();

        // The same tries when a Proxy serves the received members or the expected ones.
        expect({ s: handingOn(new Set(ids.map(id => ({ id })))) }).toMatchObject({ s: new Set(ids.map(counted)) });
        expect(tried).toHaveBeenCalledTimes(ids.length);
        tried.mockClear();
        expect({ m: new Map(ids.map(id => [{ id }, 1])) }).toMatchObject({
          m: handingOn(new Map(ids.map(id => [counted(id), 1]))),
        });
        expect(tried).toHaveBeenCalledTimes(ids.length);
        tried.mockClear();
        expect({ s: handingOn(new Set([0, 1, 2].map(id => ({ id })))) }).toMatchObject({
          s: handingOn(new Set([1, 0, 2].map(counted))),
        });
        expect(tried.mock.calls).toEqual(pairs);
        tried.mockClear();
        expect({ m: handingOn(new Map([0, 1, 2].map(id => [{ id }, 1]))) }).toMatchObject({
          m: handingOn(new Map([1, 0, 2].map(id => [counted(id), 1]))),
        });
        expect(tried.mock.calls).toEqual(pairs);
        tried.mockClear();

        // A member that the expected Set holds itself does not move the first try, so the scan starts at the front again.
        expect({ s: new Set(ids.flatMap(id => ["s" + id, { id }])) }).toMatchObject({
          s: new Set(ids.flatMap(id => ["s" + id, counted(id)])),
        });
        expect(tried).toHaveBeenCalledTimes(1275);
      });

      test("a pair that a Set or a Map compared first still shows its matcher under a property", () => {
        const item = { id: 5 };
        const shape = { id: expect.any(Number) };
        const messageOf = (/** @type {() => void} */ fn) => {
          try {
            fn();
          } catch (e) {
            return stripVTControlCharacters(/** @type {Error} */ (e).message);
          }
          return "no error";
        };
        // `z` is the one property that differs. The matcher under `p` matched, so `p` is not listed.
        const setFirst = messageOf(() =>
          expect({ s: new Set([item]), p: item, z: 1 }).toMatchObject({ s: new Set([shape]), p: shape, z: 2 }),
        );
        const propertyFirst = messageOf(() =>
          expect({ p: item, s: new Set([item]), z: 1 }).toMatchObject({ p: shape, s: new Set([shape]), z: 2 }),
        );
        expect(setFirst).toContain("- Expected  - 2");
        expect(setFirst).toBe(propertyFirst);
        const mapFirst = messageOf(() =>
          expect({ m: new Map([["k", item]]), p: item, z: 1 }).toMatchObject({
            m: new Map([["k", shape]]),
            p: shape,
            z: 2,
          }),
        );
        expect(mapFirst).toContain("- Expected  - 2");
      });
    }
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

    test("ArrayContaining takes a Proxy of an array as an array", () => {
      const P = (/** @type {any[]} */ target, /** @type {ProxyHandler<any>} */ handler = {}) =>
        new Proxy(target, handler);
      // as the value, as the sample, and as both
      expect(P([1, 2])).toEqual(expect.arrayContaining([1]));
      expect([1, 2]).toEqual(expect.arrayContaining(P([1])));
      expect(P([1, 2])).toEqual(expect.arrayContaining(P([1])));
      expect(P([1, 2])).toEqual(expect.arrayContaining([]));
      expect(P([{ a: 1 }, { b: 2 }])).toEqual(expect.arrayContaining([{ b: 2 }]));
      expect(P([1, 2])).not.toEqual(expect.arrayContaining([3]));
      expect([1, 2]).not.toEqual(expect.arrayContaining(P([3])));
      // nested in a pattern, and for the argument of a call
      expect({ x: P([1, 2]) }).toMatchObject({ x: expect.arrayContaining([1]) });
      expect({ x: P([1, 2]) }).not.toMatchObject({ x: expect.arrayContaining([3]) });
      const fn = jest.fn();
      fn(P([1, 2]));
      expect(fn).toHaveBeenCalledWith(expect.arrayContaining([1]));
      // the `get` trap decides what an element is
      const served = P([1], { get: (target, key, receiver) => (key === "0" ? 9 : Reflect.get(target, key, receiver)) });
      expect(served).toEqual(expect.arrayContaining([9]));
      expect(served).not.toEqual(expect.arrayContaining([1]));
      // the sample is read when it is matched
      const sample = [1];
      const matcher = expect.arrayContaining(P(sample));
      sample.push(3);
      expect([1, 2]).not.toEqual(matcher);
      expect([1, 2, 3]).toEqual(matcher);
      // a served length of 2 ** 32 does not wrap to 0
      const long = P([1], {
        get: (target, key, receiver) => (key === "length" ? 2 ** 32 : Reflect.get(target, key, receiver)),
      });
      expect(long).toEqual(expect.arrayContaining([1]));
      expect([]).not.toEqual(expect.arrayContaining(long));
      // a Proxy of an object is not an array, and a revoked Proxy throws
      const notArray = () => ANY(new Proxy({ 0: 1, length: 1 }, {}));
      expect(notArray()).not.toEqual(expect.arrayContaining([1]));
      const notAnArray = /Expected a array|You must provide an array/;
      expect(() => expect([1]).toEqual(expect.arrayContaining(notArray()))).toThrow(notAnArray);
      expect(() => expect([1]).toEqual(expect.not.arrayContaining(notArray()))).toThrow(notAnArray);
      const revoked = () => {
        const { proxy, revoke } = Proxy.revocable([1], {});
        revoke();
        return proxy;
      };
      expect(() => expect([1]).toEqual(expect.arrayContaining(revoked()))).toThrow(TypeError);
      expect(() => expect(revoked()).toEqual(expect.arrayContaining([1]))).toThrow(TypeError);
    });

    test("ArrayNotContaining takes a Proxy of an array as an array", () => {
      const P = (/** @type {any[]} */ target) => new Proxy(target, {});
      expect(P([1, 2])).not.toEqual(expect.not.arrayContaining([1]));
      expect(P([1, 2])).toEqual(expect.not.arrayContaining([3]));
      expect([1, 2]).not.toEqual(expect.not.arrayContaining(P([1])));
      expect([1, 2]).toEqual(expect.not.arrayContaining(P([3])));
      expect({ x: P([1, 2]) }).not.toMatchObject({ x: expect.not.arrayContaining([1]) });
      // a trap that throws ends the assertion with its error, and so does a revoked Proxy
      for (const key of ["length", "0"]) {
        const throws = () =>
          new Proxy([1], {
            get(target, property, receiver) {
              if (property === key) throw new RangeError(key);
              return Reflect.get(target, property, receiver);
            },
          });
        expect(() => expect(throws()).toEqual(expect.not.arrayContaining([2]))).toThrow(RangeError);
        expect(() => expect([1]).toEqual(expect.not.arrayContaining(throws()))).toThrow(RangeError);
        expect(() => expect({ x: throws(), y: 1 }).toMatchObject({ x: expect.not.arrayContaining([2]), y: 1 })).toThrow(
          RangeError,
        );
      }
      const { proxy, revoke } = Proxy.revocable([1], {});
      revoke();
      expect(() => expect(proxy).toEqual(expect.not.arrayContaining([1]))).toThrow(TypeError);
    });

    if (isBun) {
      test("ArrayContaining reads `length` once and each element when it needs it", () => {
        /** @type {string[]} */
        const reads = [];
        const spy = new Proxy([1, 2, 3], {
          get(target, key, receiver) {
            reads.push(String(key));
            return Reflect.get(target, key, receiver);
          },
        });
        const matcher = expect.arrayContaining(spy);
        expect(reads).toEqual([]);
        expect([3, 1, 2]).toEqual(matcher);
        expect(reads).toEqual(["length", "0", "1", "2"]);
      });

      test("ArrayContaining checks that its sample is an array when it is made", () => {
        const notArray = ANY(new Proxy({ 0: 1, length: 1 }, {}));
        expect(() => expect.arrayContaining(notArray)).toThrow("Expected a array");
        expect(() => expect.not.arrayContaining(notArray)).toThrow("Expected a array");
        const { proxy, revoke } = Proxy.revocable([1], {});
        revoke();
        expect(() => expect.arrayContaining(proxy)).toThrow(TypeError);
        expect(() => expect.not.arrayContaining(proxy)).toThrow(TypeError);
      });
    }

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
