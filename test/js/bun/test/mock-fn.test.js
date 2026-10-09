/**
 * This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/mock-fn.test.js`
 *  `bunx vitest test/js/bun/test/mock-fn.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/mock-fn.test.js`
 */
import test_interop from "./test-interop.js";
var { isBun, describe, test, it, expect, jest, vi, mock, spyOn } = await test_interop();

// if you want to test vitest, comment the above and uncomment the below

// import { expect, describe, test, vi } from "vitest";
// const isBun = false;
// const jest = { fn: vi.fn, restoreAllMocks: vi.restoreAllMocks };
// const spyOn = vi.spyOn;
// import * as extended from "jest-extended";
// expect.extend(extended);

async function expectResolves(promise) {
  expect(promise).toBeInstanceOf(Promise);
  return await promise;
}

async function expectRejects(promise) {
  expect(promise).toBeInstanceOf(Promise);
  var value;
  try {
    value = await promise;
  } catch (e) {
    return e;
  }
  throw new Error("Expected promise to reject, but it resolved to " + value);
}

describe("mock()", () => {
  if (isBun) {
    test("exists as jest.fn, bunTest.mock, and vi.fn", () => {
      expect(mock).toBeFunction();
      expect(jest.fn).toBeFunction();
      expect(vi.fn).toBeFunction();
    });

    test("mock", () => {
      const binaryType = "arraybuffer";
      const data = new ArrayBuffer(10);
      const port = 1234;
      const address = "1";
      const type = ArrayBuffer;
      const onData = mock((socket, data, port, address) => {
        expect(socket).toBeInstanceOf(Object);
        expect(socket.binaryType).toBe(binaryType || "nodebuffer");
        expect(data).toBeInstanceOf(type);
        expect(port).toBeInteger();
        expect(port).toBeWithin(1, 65535 + 1);
        expect(port).not.toBe(socket.port);
        expect(address).toBeString();
        expect(address).not.toBeEmpty();
      });

      onData({ binaryType }, data, port, address);

      expect(onData).toHaveBeenCalled();
    });

    // https://github.com/oven-sh/bun/issues/13331
    describe("checks the this value", () => {
      const fn = jest.fn();
      const proto = Object.getPrototypeOf(fn);
      test.each(Object.getOwnPropertyNames(proto))("%s", fnName => {
        if (fnName === "_isMockFunction") {
          expect(proto[fnName]).toBe(true);
          return;
        }

        if (typeof Object.getOwnPropertyDescriptor(proto, fnName)?.value === "function") {
          try {
            const protoFn = fn[fnName];
            protoFn.call(undefined);
            expect.unreachable();
          } catch (e) {
            expect(e).toHaveProperty("code", "ERR_INVALID_THIS");
            expect(e.message).toContain("Mock");
          }
        } else if ("value" in Object.getOwnPropertyDescriptor(proto, fnName)) {
          try {
            proto[fnName].value;
            expect.unreachable();
          } catch (e) {
            expect(e.message).not.toContain("unreachable");
          }
        } else {
          try {
            proto[fnName];
            expect.unreachable();
          } catch (e) {
            expect(e.message).not.toContain("unreachable");
          }
        }
      });
    });
  }
  test("are callable", () => {
    const fn = jest.fn(() => 42);
    expect(fn).not.toHaveBeenCalledOnce();
    expect(fn()).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(fn()).toBe(42);
    expect(fn).not.toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(fn).toHaveBeenCalledWith();
  });

  test("mockName returns this", () => {
    const fn = jest.fn();
    expect(fn.mockName()).toBe(fn);
    fn.mockName("foo");
    expect(fn.getMockName()).toBe("foo");

    // nullish values are ignored.
    expect(fn.mockName("")).toBe(fn);

    expect(fn.getMockName()).toBe("foo");
  });

  test("jest.clearAllMocks()", () => {
    const func = jest.fn(() => 42);
    expect(func).not.toHaveBeenCalled();
    expect(func()).toBe(42);
    expect(func).toHaveBeenCalled();

    jest.clearAllMocks();

    expect(func).not.toHaveBeenCalled();
    expect(func()).toBe(42);
    expect(func).toHaveBeenCalled();
  });

  test("toHaveReturned()", () => {
    const func = jest.fn(() => "the jedi");
    expect(func).not.toHaveReturned();
    func();
    expect(func).toHaveReturned();
    expect(func).toHaveReturnedTimes(1);
    expect(func.mock.calls).toHaveLength(1);
    expect(func.mock.calls[0]).toBeEmpty();
    func();
    expect(func).toHaveReturnedTimes(2);
    const func2 = jest.fn(() => {
      throw new Error("the jedi");
    });
    expect(func2).not.toHaveReturned();
    try {
      func2();
    } catch (e) {}

    expect(func2).not.toHaveReturned();
    try {
      expect(func2).toHaveReturned();
    } catch (e) {
      expect(e.message.replaceAll(/\x1B\[[0-9;]*m/g, "")).toMatchInlineSnapshot(`
        "expect(received).toHaveReturned(expected)

        Expected number of succesful returns: >= 1
        Received number of succesful returns:    0
        Received number of calls:                1
        "
      `);
    }
  });

  test("toHaveNthReturnedWith", () => {
    const fn = jest.fn();

    // Test when function hasn't been called
    expect(() => expect(fn).toHaveNthReturnedWith(1, "value")).toThrow();

    // Call with different return values
    fn.mockReturnValueOnce("first");
    fn.mockReturnValueOnce("second");
    fn.mockReturnValueOnce("third");

    fn();
    fn();
    fn();

    // Test positive cases
    expect(fn).toHaveNthReturnedWith(1, "first");
    expect(fn).toHaveNthReturnedWith(2, "second");
    expect(fn).toHaveNthReturnedWith(3, "third");

    // Test negative cases
    expect(fn).not.toHaveNthReturnedWith(1, "wrong");
    expect(fn).not.toHaveNthReturnedWith(2, "wrong");
    expect(fn).not.toHaveNthReturnedWith(3, "wrong");

    // Test out of bounds
    expect(() => expect(fn).toHaveNthReturnedWith(4, "value")).toThrow();
    expect(() => expect(fn).toHaveNthReturnedWith(0, "value")).toThrow();
    expect(() => expect(fn).toHaveNthReturnedWith(-1, "value")).toThrow();

    // Test with objects
    const obj1 = { a: 1 };
    const obj2 = { b: 2 };
    fn.mockReturnValueOnce(obj1);
    fn.mockReturnValueOnce(obj2);

    fn();
    fn();

    expect(fn).toHaveNthReturnedWith(4, obj1);
    expect(fn).toHaveNthReturnedWith(5, obj2);

    // Test with thrown errors
    const error = new Error("test error");
    fn.mockImplementationOnce(() => {
      throw error;
    });

    try {
      fn();
    } catch (e) {}

    expect(() => expect(fn).toHaveNthReturnedWith(6, "value")).toThrow();
  });

  test("passes this value", () => {
    const fn = jest.fn(function hey() {
      "use strict";
      return this;
    });
    const obj = { fn };
    expect(obj.fn()).toBe(obj);
  });
  if (isBun) {
    test("jest.fn(10) return value shorthand", () => {
      expect(jest.fn(10)()).toBe(10);
      expect(jest.fn(null)()).toBe(null);
    });
  }
  test("blank function still logs a return", () => {
    const fn = jest.fn();
    expect(fn()).toBe(undefined);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: undefined,
    });
  });
  test(".call passes this value", () => {
    const fn = jest.fn(function () {
      return this;
    });
    expect(Number(fn.call(123))).toBe(123);
  });
  test(".call works", () => {
    const fn = jest.fn(function hey() {
      return this;
    });
    expect(Number(fn.call(123))).toBe(123);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(Number(fn.call(234))).toBe(234);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(fn).toHaveBeenCalledWith();
  });
  test(".apply works", function () {
    const fn = jest.fn(function hey() {
      return this;
    });
    expect(Number(fn.apply(123))).toBe(123);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(Number(fn.apply(234))).toBe(234);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(fn).toHaveBeenCalledWith();
  });
  test(".bind works", () => {
    const fn = jest.fn(function hey() {
      return this;
    });
    expect(Number(fn.bind(123)())).toBe(123);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(Number(fn.bind(234)())).toBe(234);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
    expect(fn).toHaveBeenLastCalledWith();
    expect(fn).toHaveBeenCalledWith();
  });
  test(".name works", () => {
    const fn = jest.fn(function hey() {
      return this;
    });

    if (isBun) {
      expect(fn.name).toBe("hey");
    }
    expect(typeof fn.name).toBe("string");
  });
  test(".name without implementation", () => {
    const fn = jest.fn();
    expect(fn.name).toBe("mockConstructor");
  });
  test(".name throwing doesnt segfault", () => {
    function baddie() {
      return this;
    }
    Object.defineProperty(baddie, "name", {
      get() {
        throw new Error("foo");
      },
    });
    const fn = jest.fn(baddie);
    expect(typeof fn.name).toBe("string");
  });
  if (isBun) {
    // bun exposes the live results array, so a full-length array makes the
    // internal push throw; the call must surface that error, not continue
    // with it pending.
    test("throws cleanly when recording the result fails", () => {
      let called = false;
      const fn = jest.fn(() => {
        called = true;
        return 42;
      });
      fn.mock.results.length = 2 ** 32 - 1;
      expect(() => fn(1)).toThrow(RangeError);
      expect(called).toBe(false);
    });
  }
  test(".length works", () => {
    const fn = jest.fn(function hey(a, b, c) {
      return this;
    });

    expect(fn.length).toBe(3);
  });
  test("include arguments", () => {
    const fn = jest.fn(f => f);
    expect(fn(43)).toBe(43);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: 43,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
  });
  test("works when throwing", () => {
    const instance = new Error("foo");
    const fn = jest.fn(f => {
      throw instance;
    });
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
  });
  test("mockReset works", () => {
    const instance = new Error("foo");
    const fn = jest.fn(f => {
      throw instance;
    });
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
    fn.mockReset();
    expect(fn.mock.calls).toBeEmpty();
    expect(fn.mock.results).toBeEmpty();
    expect(fn.mock.instances).toBeEmpty();
    expect(fn).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenLastCalledWith(43);
    expect(fn).not.toHaveBeenCalledWith(43);
    expect(() => expect(fn).toHaveBeenCalled()).toThrow();
    expect(fn(43)).toBe(undefined);
    expect(fn.mock.results).toEqual([
      {
        type: "return",
        value: undefined,
      },
    ]);
    expect(fn.mock.calls).toEqual([[43]]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
  });
  test("mockClear works", () => {
    const instance = new Error("foo");
    const fn = jest.fn(f => {
      throw instance;
    });
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
    fn.mockClear();
    expect(fn.mock.calls).toBeEmpty();
    expect(fn.mock.results).toBeEmpty();
    expect(fn.mock.instances).toBeEmpty();
    expect(fn).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenLastCalledWith(43);
    expect(fn).not.toHaveBeenCalledWith(43);
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
  });
  // this is an implementation detail i don't think we *need* to support
  test("mockClear doesnt update existing object", () => {
    const instance = new Error("foo");
    const fn = jest.fn(f => {
      throw instance;
    });
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
    const stolen = fn.mock;
    fn.mockClear();
    expect(stolen).not.toBe(fn.mock);
    expect(fn.mock.calls).toBeEmpty();
    expect(fn).not.toHaveBeenLastCalledWith(43);
    expect(fn).not.toHaveBeenCalledWith(43);
    expect(stolen.calls).not.toBeEmpty();
    expect(fn.mock.results).toBeEmpty();
    expect(stolen.results).not.toBeEmpty();
    expect(fn.mock.instances).toBeEmpty();
    expect(stolen.instances).not.toBe(fn.mock.instances);
    expect(fn).not.toHaveBeenCalled();
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn).toHaveBeenCalledWith(43);
  });
  test("multiple calls work", () => {
    const fn = jest.fn(f => f);
    expect(fn(43)).toBe(43);
    expect(fn).toHaveBeenLastCalledWith(43);
    expect(fn(44)).toBe(44);
    expect(fn).toHaveBeenLastCalledWith(44);
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: 43,
    });
    expect(fn.mock.calls[1]).toEqual([44]);
    expect(fn).toHaveBeenLastCalledWith(44);
    expect(fn.mock.results[1]).toEqual({
      type: "return",
      value: 44,
    });
    expect(fn.mock.contexts).toEqual([undefined, undefined]);
    expect(fn).toHaveBeenCalledWith(43);
    expect(fn).toHaveBeenCalledWith(44);
  });
  test("this arg", () => {
    const fn = jest.fn(function (add) {
      return this.foo + add;
    });
    const obj = { foo: 42, fn };
    expect(obj.fn(2)).toBe(44);
    expect(fn.mock.calls[0]).toEqual([2]);
    expect(fn).toHaveBeenLastCalledWith(2);
    expect(fn).toHaveBeenCalledWith(2);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: 44,
    });
  });
  test("this is undefined when called without a receiver from a closure", () => {
    const fn = jest.fn().mockReturnThis();
    // Referencing `fn` from an inner function moves it into the closure's
    // scope, so the bare call below resolves it through that scope object.
    function keep() {
      return fn;
    }
    expect(fn()).toBeUndefined();
    expect(fn.mock.contexts).toEqual([undefined]);
    expect(fn.mock.results).toEqual([{ type: "return", value: undefined }]);
    expect(keep()).toBe(fn);
  });
  if (isBun) {
    test("mock.lastCall getter ignores the closure scope it is called through", () => {
      const calls = [["from the enclosing scope"]];
      const lastCall = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(jest.fn().mock), "lastCall").get;
      function keep() {
        return [calls, lastCall];
      }
      expect(lastCall()).toBeUndefined();
      expect(keep()).toEqual([calls, lastCall]);
    });
    test("mock methods called without a receiver from a closure throw the invalid this error", () => {
      const { mockName } = jest.fn();
      function keep() {
        return mockName;
      }
      expect(() => mockName("name")).toThrow(/^Expected this to be instanceof Mock$/);
      expect(keep()).toBe(mockName);
    });
  }
  test("looks like a function", () => {
    const fn = jest.fn(function nameHere(a, b, c) {
      return [a, b, c];
    });
    expect(typeof fn).toBe("function");
    expect(typeof fn.name).toBe("string");
    expect(fn.name.length).toBeGreaterThan(0);
    expect(fn.toString).not.toBe(undefined);
    expect(fn.bind).not.toBe(undefined);
    expect(fn.call).not.toBe(undefined);
    expect(fn.apply).not.toBe(undefined);
    expect(typeof fn.length).toBe("number");
  });
  test("apply/call/bind", () => {
    const fn = jest.fn(function (add) {
      "use strict";
      return this.foo + add;
    });
    const obj = { foo: 42, fn };
    expect(obj.fn(2)).toBe(44);
    expect(fn).toHaveBeenLastCalledWith(2);
    const this2 = { foo: 43 };
    expect(fn.call(this2, 2)).toBe(45);
    expect(fn).toHaveBeenLastCalledWith(2);
    const this3 = { foo: 44 };
    expect(fn.apply(this3, [2])).toBe(46);
    expect(fn).toHaveBeenLastCalledWith(2);
    const this4 = { foo: 45 };
    expect(fn.bind(this4)(3)).toBe(48);
    expect(fn).toHaveBeenLastCalledWith(3);
    const this5 = { foo: 45 };
    expect(fn.bind(this5, 2)()).toBe(47);
    expect(fn).toHaveBeenLastCalledWith(2);
    expect(fn.mock.calls[0]).toEqual([2]);
    expect(fn.mock.calls[1]).toEqual([2]);
    expect(fn.mock.calls[2]).toEqual([2]);
    expect(fn.mock.calls[3]).toEqual([3]);
    expect(fn.mock.calls[4]).toEqual([2]);
    expect(fn).toHaveBeenCalledWith(2);
    expect(fn).toHaveBeenCalledWith(3);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: 44,
    });
    expect(fn.mock.results[1]).toEqual({
      type: "return",
      value: 45,
    });
    expect(fn.mock.results[2]).toEqual({
      type: "return",
      value: 46,
    });
    expect(fn.mock.results[3]).toEqual({
      type: "return",
      value: 48,
    });
    expect(fn.mock.results[4]).toEqual({
      type: "return",
      value: 47,
    });
  });
  test("mockReturnValueOnce with no implementation", () => {
    const fn = jest.fn();
    fn.mockReturnValueOnce(10);
    expect(fn()).toBe(10);
    expect(fn()).toBe(undefined);
    fn.mockReturnValueOnce("x").mockReturnValue(true);
    expect(fn()).toBe("x");
    expect(fn()).toBe(true);
    expect(fn()).toBe(true);
    fn.mockReturnValue("y");
    expect(fn()).toBe("y");
  });
  test("mockReturnValue then mockReturnValueOnce", () => {
    const fn = jest.fn();
    fn.mockReturnValue(true).mockReturnValueOnce(10).mockReturnValueOnce("x");
    expect(fn()).toBe(10);
    expect(fn()).toBe("x");
    expect(fn()).toBe(true);
    expect(fn()).toBe(true);
  });
  test("mockReturnValue then fallback to original", () => {
    const fn = jest.fn(() => "fallback");
    fn.mockReturnValueOnce(true).mockReturnValueOnce(10).mockReturnValueOnce("x");
    expect(fn()).toBe(true);
    expect(fn()).toBe(10);
    expect(fn()).toBe("x");
    expect(fn()).toBe("fallback");
  });
  test("mockImplementation", () => {
    const fn = jest.fn();
    fn.mockImplementation(a => !a);
    expect(fn()).toBe(true);
    expect(fn()).toBe(true);
    fn.mockImplementation(a => a + 2);
    expect(fn(8)).toBe(10);
  });
  test("mockImplementationOnce", () => {
    const fn = jest.fn();
    fn.mockImplementationOnce(a => ["a", a]);
    fn.mockImplementationOnce(a => ["b", a]);
    fn.mockImplementationOnce(a => ["c", a]);
    fn.mockImplementation(a => ["d", a]);
    expect(fn(1)).toEqual(["a", 1]);
    expect(fn(2)).toEqual(["b", 2]);
    expect(fn(3)).toEqual(["c", 3]);
    expect(fn(4)).toEqual(["d", 4]);
    expect(fn(5)).toEqual(["d", 5]);
    fn.mockImplementationOnce(a => ["e", a]);
    expect(fn(5)).toEqual(["e", 5]);
    expect(fn(6)).toEqual(["d", 6]);
    fn.mockImplementationOnce(a => ["f", a]);
    fn.mockImplementation(a => ["g", a]);
    expect(fn(7)).toEqual(["f", 7]);
    expect(fn(8)).toEqual(["g", 8]);
    expect(fn(9)).toEqual(["g", 9]);
  });
  test("mockImplementation falls back", () => {
    const fn = jest.fn(() => "fallback");
    fn.mockImplementationOnce(a => ["a", a]);
    fn.mockImplementationOnce(a => ["b", a]);
    expect(fn(1)).toEqual(["a", 1]);
    expect(fn(2)).toEqual(["b", 2]);
    expect(fn(3)).toEqual("fallback");
  });
  test("mixing mockImplementation and mockReturnValue", () => {
    const fn = jest.fn(() => "fallback");
    fn.mockReturnValueOnce(true).mockImplementationOnce(() => 12);
    expect(fn()).toBe(true);
    expect(fn()).toBe(12);
    expect(fn()).toBe("fallback");
    fn.mockImplementation(() => 13);
    expect(fn()).toBe(13);
    fn.mockReturnValue("FAIL").mockImplementation(() => 14);
    expect(fn()).toBe(14);
    fn.mockReturnValueOnce(15).mockImplementation(() => 16);
    expect(fn()).toBe(15);
    expect(fn()).toBe(16);
  });
  // these promise based tests were written before .resolves/.rejects were added to bun:test
  test("mockResolvedValue", async () => {
    const fn = jest.fn();
    fn.mockResolvedValue(42);
    expect(await expectResolves(fn())).toBe(42);
    fn.mockResolvedValueOnce(43);
    fn.mockResolvedValueOnce(44);
    expect(await expectResolves(fn())).toBe(43);
    expect(await expectResolves(fn())).toBe(44);
    expect(await expectResolves(fn())).toBe(42);
  });
  test("mockRejectedValue", async () => {
    const fn = jest.fn();
    fn.mockRejectedValue(42);
    expect(await expectRejects(fn())).toBe(42);
    expect(await expectRejects(fn())).toBe(42);
    fn.mockRejectedValueOnce(43);
    fn.mockRejectedValueOnce(44);
    expect(await expectRejects(fn())).toBe(43);
    expect(await expectRejects(fn())).toBe(44);
    expect(await expectRejects(fn())).toBe(42);
  });
  test("mockRejectedValue doesn't throw when never called", () => {
    const fn = jest.fn().mockRejectedValue(new Error("Test error"));
    expect(fn).toBeDefined();
    expect(typeof fn).toBe("function");
  });
  test("withImplementation (sync)", () => {
    const fn = jest.fn(() => "1");
    expect(fn()).toBe("1");
    const result = fn.withImplementation(
      () => "2",
      function () {
        expect(fn()).toBe("2");
        expect(fn()).toBe("2");
        return "3";
      },
    );
    expect(fn()).toBe("1");
  });
  if (isBun) {
    // Bun wraps the value in a promise when mockResolvedValue is called, not when the mock is.
    test("mockResolvedValue propagates an error thrown while wrapping the value in a promise", () => {
      const boom = new Error("boom");
      const value = Promise.resolve(1);
      Object.defineProperty(value, "constructor", {
        get() {
          throw boom;
        },
      });
      const fn = jest.fn();
      expect(() => fn.mockResolvedValue(value)).toThrow(boom);
      expect(() => fn.mockResolvedValueOnce(value)).toThrow(boom);
      // nothing was queued
      expect(fn()).toBeUndefined();
    });
  }
  test("withImplementation (callback throws)", () => {
    const fn = jest.fn(() => "1");
    expect(() =>
      fn.withImplementation(
        () => "2",
        () => {
          expect(fn()).toBe("2");
          throw new Error("from callback");
        },
      ),
    ).toThrow("from callback");
  });
  test("withImplementation restores a queued mockImplementationOnce chain", () => {
    const fn = jest.fn(() => "base");
    fn.mockImplementationOnce(() => "a").mockImplementationOnce(() => "b");
    fn.withImplementation(
      () => "temp",
      () => {
        expect(fn()).toBe("temp");
      },
    );
    fn.mockImplementationOnce(() => "c");
    expect([fn(), fn(), fn(), fn()]).toEqual(["a", "b", "c", "base"]);
  });
  test("copying name/length from the implementation propagates getter errors", () => {
    const impl = function () {};
    Object.defineProperty(impl, "length", {
      get() {
        throw new Error("length getter");
      },
    });
    expect(() => jest.fn(impl)).toThrow("length getter");
    const obj = { method: impl };
    expect(() => jest.spyOn(obj, "method")).toThrow("length getter");
    expect(obj.method).toBe(impl);
  });
  test("withImplementation (async)", async () => {
    const fn = jest.fn(() => "1");
    expect(fn()).toBe("1");
    const result = fn.withImplementation(
      () => "2",
      async function () {
        expect(fn()).toBe("2");
        expect(fn()).toBe("2");
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(fn()).toBe("2");
        expect(fn()).toBe("2");
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(fn()).toBe("2");
        expect(fn()).toBe("2");
        return "3";
      },
    );
    await expectResolves(result);
    expect(fn()).toBe("1");
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fn()).toBe("1");
  });
  test("lastCall works", () => {
    const fn = jest.fn(v => -v);
    expect(fn.mock.lastCall).toBeUndefined();
    expect(fn(1)).toBe(-1);
    expect(fn.mock.lastCall).toEqual([1]);
    expect(fn(-2)).toBe(2);
    expect(fn.mock.lastCall).toEqual([-2]);
  });
  test("invocationCallOrder works", () => {
    const fn1 = jest.fn(v => -v);
    const fn2 = jest.fn(v => -v);
    fn1(1);
    fn2(1);
    fn2(1);
    fn1(1);
    const first = fn1.mock.invocationCallOrder[0];
    expect(first).toBeGreaterThan(0);
    expect(fn1.mock.invocationCallOrder).toEqual([first, first + 3]);
    expect(fn2.mock.invocationCallOrder).toEqual([first + 1, first + 2]);
  });

  test("toHaveBeenCalledWith, toHaveBeenLastCalledWith works", () => {
    const fn = jest.fn();
    expect(() => expect(() => {}).not.toHaveBeenLastCalledWith()).toThrow();
    expect(() => expect(() => {}).not.toHaveBeenNthCalledWith()).toThrow();
    expect(() => expect(() => {}).not.toHaveBeenCalledWith()).toThrow();
    expect(fn).not.toHaveBeenCalled();
    expect(() => expect(fn).toHaveBeenCalledTimes(-1)).toThrow();
    expect(fn).toHaveBeenCalledTimes(0);
    expect(fn).not.toHaveBeenCalledWith();
    expect(fn).not.toHaveBeenLastCalledWith();
    expect(() => expect(fn).toHaveBeenNthCalledWith(0)).toThrow();
    expect(() => expect(fn).toHaveBeenNthCalledWith(-1)).toThrow();
    expect(() => expect(fn).toHaveBeenNthCalledWith(1.1)).toThrow();
    expect(fn).not.toHaveBeenNthCalledWith(1);
    fn();
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith();
    expect(fn).toHaveBeenLastCalledWith();
    expect(fn).toHaveBeenNthCalledWith(1);
    expect(fn).not.toHaveBeenNthCalledWith(1, 1);
    expect(fn).not.toHaveBeenCalledWith(1);
    fn(1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(fn).toHaveBeenLastCalledWith(1);
    expect(fn).toHaveBeenNthCalledWith(1);
    expect(fn).toHaveBeenNthCalledWith(2, 1);
    fn(1, 2, 3);
    expect(fn).not.toHaveBeenCalledWith("123");
    expect(fn).not.toHaveBeenLastCalledWith(1);
    expect(fn).not.toHaveBeenLastCalledWith(1, 2);
    expect(fn).not.toHaveBeenLastCalledWith("123");
    expect(fn).toHaveBeenLastCalledWith(1, 2, 3);
    expect(fn).not.toHaveBeenLastCalledWith(3, 2, 1);
    expect(fn).toHaveBeenNthCalledWith(3, 1, 2, 3);
    expect(fn).not.toHaveBeenNthCalledWith(4, 3, 2, 1);
    fn("random string");
    expect(fn).toHaveBeenCalledWith();
    expect(fn).toHaveBeenNthCalledWith(1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(fn).toHaveBeenNthCalledWith(2, 1);
    expect(fn).toHaveBeenCalledWith(1, 2, 3);
    expect(fn).toHaveBeenNthCalledWith(3, 1, 2, 3);
    expect(fn).toHaveBeenCalledWith("random string");
    expect(fn).toHaveBeenLastCalledWith("random string");
    expect(fn).toHaveBeenNthCalledWith(4, "random string");
    expect(fn).toHaveBeenCalledWith(expect.stringMatching(/^random \w+$/));
    expect(fn).toHaveBeenLastCalledWith(expect.stringMatching(/^random \w+$/));
    expect(fn).toHaveBeenNthCalledWith(4, expect.stringMatching(/^random \w+$/));
    fn(1, undefined);
    expect(fn).toHaveBeenLastCalledWith(1, undefined);
    expect(fn).not.toHaveBeenLastCalledWith(1);
    expect(fn).toHaveBeenCalledWith(1, undefined);
    expect(fn).not.toHaveBeenCalledWith(undefined);
    expect(fn).toHaveBeenNthCalledWith(5, 1, undefined);
    expect(fn).not.toHaveBeenNthCalledWith(5, 1);
  });

  test("toHaveBeenCalledTimes with calls.length > i32 max", () => {
    const fn = jest.fn();
    // Array length can be up to 2^32-1; the matcher must not panic on the narrowed count.
    fn.mock.calls.length = 3_000_000_000;
    expect(fn).not.toHaveBeenCalledTimes(5);
    expect(fn).toHaveBeenCalledTimes(3_000_000_000);
    expect(() => expect(fn).toHaveBeenCalledTimes(5)).toThrow();
  });

  it("no segmentation fault when passing jest.fn into another jest.fn, issue#5900", () => {
    function foo() {
      return true;
    }

    function bar(fn = jest.fn(foo)) {
      expect(fn.name).toBe("foo");
      let newFn = jest.fn(fn);
      expect(newFn.name).toBe("foo");
      return newFn;
    }

    expect(bar()()).toBe(true);
  });
});

describe("resetAllMocks", () => {
  test("removes implementations, not just calls", () => {
    const fn = jest.fn(() => 42);
    expect(fn()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.resetAllMocks();

    expect(fn).toHaveBeenCalledTimes(0);
    expect(fn.mock.results).toEqual([]);
    expect(fn.getMockImplementation()).toBeUndefined();
    expect(fn()).toBeUndefined();
  });

  test("removes mockReturnValue", () => {
    const fn = jest.fn();
    fn.mockReturnValue("stubbed");
    expect(fn()).toBe("stubbed");

    jest.resetAllMocks();

    expect(fn()).toBeUndefined();
  });

  test("removes a spy's implementation without restoring the original", () => {
    const obj = {
      original() {
        return "original";
      },
    };
    const spy = spyOn(obj, "original");
    expect(obj.original()).toBe("original");

    jest.resetAllMocks();

    expect(obj.original()).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    expect(obj.original()).toBe("original");
  });

  if (isBun) {
    test("vi.resetAllMocks removes implementations too", () => {
      const fn = jest.fn(() => 42);
      expect(fn()).toBe(42);

      vi.resetAllMocks();

      expect(fn()).toBeUndefined();
    });
  }
});

describe("spyOn", () => {
  test("works on functions", () => {
    var obj = {
      original() {
        return 42;
      },
    };
    const fn = spyOn(obj, "original");
    expect(fn).toBe(obj.original);
    expect(fn).not.toHaveBeenCalled();
    expect(() => expect(fn).toHaveBeenCalled()).toThrow();
    expect(obj.original()).toBe(42);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => expect(fn).not.toHaveBeenCalled()).toThrow();
    expect(() => expect(fn).not.toHaveBeenCalledTimes(1)).toThrow();
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    jest.clearAllMocks();
    // verify that the spy's history is cleared, but the spy is still intact
    expect(fn).not.toHaveBeenCalled();
    expect(fn.mock.calls).toHaveLength(0);
    expect(obj.original()).toBe(42);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
    expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
    expect(fn).not.toHaveBeenCalled();
    expect(obj.original()).toBe(42);
    expect(fn).not.toHaveBeenCalled();
  });

  test("override impl after doesnt break restore", () => {
    var obj = {
      original() {
        return 42;
      },
    };
    const fn = spyOn(obj, "original");
    expect(fn.getMockName()).toBe("original");
    fn.mockName("not the original");
    expect(fn.getMockName()).toBe("not the original");
    expect(obj.original.name).toBe("not the original");
    fn.mockImplementation(() => 43);
    expect(fn).toBe(obj.original);
    expect(obj.original()).toBe(43);
    expect(fn).toHaveBeenCalled();
    fn.mockRestore();
    expect(obj.original()).toBe(42);
    expect(fn).not.toHaveBeenCalled();
  });

  test("mockRestore works", () => {
    var obj = {
      original() {
        return 42;
      },
    };
    const fn = spyOn(obj, "original");
    expect(fn).toBe(obj.original);
    expect(fn).not.toHaveBeenCalled();
    expect(() => expect(fn).toHaveBeenCalled()).toThrow();
    expect(obj.original()).toBe(42);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => expect(fn).not.toHaveBeenCalled()).toThrow();
    expect(() => expect(fn).not.toHaveBeenCalledTimes(1)).toThrow();
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    fn.mockRestore();
    expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
    expect(fn).not.toHaveBeenCalled();
    expect(obj.original()).toBe(42);
    expect(fn).not.toHaveBeenCalled();
  });

  if (isBun) {
    // Jest doesn't allow spying on properties
    test("spyOn works on object", () => {
      var obj = { original: 42 };
      obj.original = 42;
      const fn = spyOn(obj, "original");
      expect(fn).not.toHaveBeenCalled();
      expect(obj.original).toBe(42);
      expect(fn).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls).toHaveLength(1);
      expect(fn.mock.calls[0]).toBeEmpty();
      jest.clearAllMocks();
      // verify that the spy's history is cleared, but the spy is still intact
      expect(fn).not.toHaveBeenCalled();
      expect(fn.mock.calls).toHaveLength(0);
      expect(obj.original).toBe(42);
      expect(fn).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
      expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
      expect(fn).not.toHaveBeenCalled();
      expect(obj.original).toBe(42);
      expect(fn).not.toHaveBeenCalled();
    });

    test("spyOn on object doens't crash if object GC'd", () => {
      const spies = new Array(1000);
      (() => {
        for (let i = 0; i < 1000; i++) {
          var obj = { original: 42 };
          obj.original = 42;
          const fn = spyOn(obj, "original");
          spies[i] = fn;
        }
        Bun.gc(true);
      })();
      Bun.gc(true);

      jest.restoreAllMocks();
    });

    test("spyOn works on globalThis", () => {
      var obj = globalThis;
      obj.original = 42;
      const fn = spyOn(obj, "original");
      expect(fn).not.toHaveBeenCalled();
      expect(obj.original).toBe(42);
      expect(fn).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls).toHaveLength(1);
      expect(fn.mock.calls[0]).toBeEmpty();
      jest.clearAllMocks();
      // verify that the spy's history is cleared, but the spy is still intact
      expect(fn).not.toHaveBeenCalled();
      expect(fn.mock.calls).toHaveLength(0);
      expect(obj.original).toBe(42);
      expect(fn).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
      expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
      obj.original;
      expect(fn).not.toHaveBeenCalled();
    });
  }

  test("spyOn twice works", () => {
    var obj = {
      original() {
        return 42;
      },
    };
    const _original = obj.original;
    const fn = spyOn(obj, "original");
    const fn2 = spyOn(obj, "original");
    expect(fn).toBe(obj.original);
    expect(fn2).toBe(fn);
    expect(fn).not.toBe(_original);
  });

  if (isBun) {
    // Test for spyOn with numeric/indexed property keys
    test("spyOn works with indexed properties", () => {
      function original() {
        return 42;
      }
      const arr = [];
      arr[0] = original;

      const fn = spyOn(arr, 0);
      expect(fn).toBe(arr[0]);
      expect(fn).not.toHaveBeenCalled();
      expect(arr[0]()).toBe(42);
      expect(fn).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls).toHaveLength(1);

      fn.mockRestore();
      expect(arr[0]).toBe(original);
      expect(arr[0]()).toBe(42);
      expect(fn).not.toHaveBeenCalled();
    });

    test("spyOn works with indexed properties using string keys", () => {
      function original() {
        return 123;
      }
      const arr = [];
      arr[0] = original;

      // Using string "0" instead of number 0
      const fn = spyOn(arr, "0");
      expect(fn).toBe(arr[0]);
      expect(arr[0]()).toBe(123);
      expect(fn).toHaveBeenCalled();

      fn.mockRestore();
      expect(arr[0]).toBe(original);
    });

    test("spyOn works with indexed properties using BigInt keys", () => {
      function original() {
        return 456;
      }
      const arr = [];
      arr[14] = original;

      // Using BigInt 14n as property key
      const fn = spyOn(arr, 14n);
      expect(fn).toBe(arr[14]);
      expect(arr[14]()).toBe(456);
      expect(fn).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);

      fn.mockRestore();
      expect(arr[14]).toBe(original);
      expect(arr[14]()).toBe(456);
      expect(fn).not.toHaveBeenCalled();
    });

    // Like named properties, a non-function indexed property gets a getter/setter spy.
    // This used to store the mock itself flagged as an accessor, and the next write to
    // the index crashed the process.
    test("spyOn works with indexed properties that are not functions", () => {
      const arr = [42];

      const fn = spyOn(arr, 0);
      expect(fn).not.toHaveBeenCalled();
      expect(arr[0]).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);

      arr[0] = 7;
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[1]).toEqual([7]);
      expect(arr[0]).toBe(42);

      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(arr, 0)).toEqual({
        value: 42,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(arr[0]).toBe(42);
      expect(fn).not.toHaveBeenCalled();
    });

    test("spyOn works with indexed properties on plain objects", () => {
      const obj = {};
      obj[213] = obj;

      const fn = spyOn(obj, 213);
      obj[213] = 1;
      expect(fn).toHaveBeenCalledTimes(1);
      expect(obj[213]).toBe(obj);
      expect(fn).toHaveBeenCalledTimes(2);

      // Same as named keys: spying again gives the same spy, without reading the property.
      expect(spyOn(obj, 213)).toBe(fn);
      expect(fn).toHaveBeenCalledTimes(2);

      fn.mockRestore();
      expect(obj[213]).toBe(obj);
      expect(fn).not.toHaveBeenCalled();
    });

    // An int32 at an index of an object literal is in Int32 storage. The plain object
    // above has Contiguous storage, because its value is an object.
    test("spyOn works with an index key of an object literal", () => {
      const obj = { 0: 42 };

      const fn = spyOn(obj, 0);
      expect(Object.getOwnPropertyDescriptor(obj, 0)).toEqual({
        get: fn,
        set: fn,
        enumerable: true,
        configurable: true,
      });
      expect(obj[0]).toBe(42);
      obj[0] = 7;
      expect(obj[0]).toBe(42);
      expect(fn.mock.calls).toEqual([[], [7], []]);

      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(obj, 0)).toEqual({
        value: 42,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      obj[0] = 8;
      expect(obj[0]).toBe(8);
      expect(fn).not.toHaveBeenCalled();
    });

    // An index this large never gets vector storage. It lives in the sparse map from the
    // start, which is where the malformed accessor entry used to crash reads and writes.
    test("spyOn works with a large sparse index that is not a function", () => {
      const obj = {};
      const original = [1.5];
      obj[3221225473] = original;

      const fn = spyOn(obj, 3221225473);
      expect(Object.getOwnPropertyDescriptor(obj, 3221225473)).toEqual({
        get: fn,
        set: fn,
        enumerable: true,
        configurable: true,
      });
      expect(obj[3221225473]).toBe(original);
      obj[3221225473] = 5;
      expect(obj[3221225473]).toBe(original);
      expect(fn.mock.calls).toEqual([[], [5], []]);

      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(obj, 3221225473)).toEqual({
        value: original,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      obj[3221225473] = 6;
      expect(obj[3221225473]).toBe(6);
      expect(fn).not.toHaveBeenCalled();
    });

    // An array filled after creation is not copy-on-write, so it takes a different
    // storage path than an array literal when the index becomes an accessor.
    test("spyOn installs a getter/setter on an indexed property that is not a function", () => {
      const arr = [];
      arr[0] = 42;

      const fn = spyOn(arr, 0);
      expect(Object.getOwnPropertyDescriptor(arr, 0)).toEqual({
        get: fn,
        set: fn,
        enumerable: true,
        configurable: true,
      });
      expect(arr[0]).toBe(42);
      arr[0] = 7;
      expect(arr[0]).toBe(42);
      expect(fn.mock.calls).toEqual([[], [7], []]);

      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(arr, 0)).toEqual({
        value: 42,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      arr[0] = 8;
      expect(arr[0]).toBe(8);
      expect(fn).not.toHaveBeenCalled();
    });

    // Making one index an accessor moves the whole array out of contiguous storage.
    // The other elements and the length must survive that move.
    test("spyOn on one array element keeps the other elements and the length", () => {
      const arr = [1, 2, 3];

      const fn = spyOn(arr, 1);
      expect(arr[1]).toBe(2);
      arr[1] = 20;
      expect(arr[1]).toBe(2);
      expect(fn.mock.calls).toEqual([[], [20], []]);
      expect(arr.length).toBe(3);
      expect([arr[0], arr[2]]).toEqual([1, 3]);

      fn.mockRestore();
      expect(arr).toEqual([1, 2, 3]);
      expect(Object.getOwnPropertyDescriptor(arr, 1)).toEqual({
        value: 2,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(fn).not.toHaveBeenCalled();
    });

    test("spyOn works with missing indexed properties", () => {
      const arr = [];

      const fn = spyOn(arr, 3);
      expect(arr[3]).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
      arr[3] = "x";
      expect(fn).toHaveBeenCalledTimes(2);
      expect(arr[3]).toBeUndefined();

      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(arr, 3)).toBeUndefined();
      expect(arr[3]).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });

    // A plain object has no indexed storage at all, so the spy creates it.
    test("spyOn works with a missing indexed property on a plain object", () => {
      const obj = {};

      const fn = spyOn(obj, 169);
      expect(Object.getOwnPropertyDescriptor(obj, 169)).toEqual({
        get: fn,
        set: fn,
        enumerable: true,
        configurable: true,
      });
      expect(obj[169]).toBeUndefined();
      obj[169] = "x";
      expect(obj[169]).toBeUndefined();
      expect(fn.mock.calls).toEqual([[], ["x"], []]);

      fn.mockRestore();
      // Same as a missing named key: it is missing again.
      expect(Object.getOwnPropertyDescriptor(obj, 169)).toBeUndefined();
      expect(obj[169]).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });

    // The engine serves a function's `prototype` property specially, so it cannot be
    // replaced with a getter/setter spy; historically this crashed the process.
    test("spyOn on a function's prototype property throws instead of crashing", () => {
      function Foo() {}
      const fooPrototype = Foo.prototype;
      expect(() => spyOn(Foo, "prototype")).toThrow(
        "Cannot spy on the `prototype` property because it is not a function",
      );
      // the function is left untouched
      expect(Foo.prototype).toBe(fooPrototype);
      expect(new Foo()).toBeInstanceOf(Foo);

      class K {
        m() {
          return 42;
        }
      }
      const kPrototype = K.prototype;
      expect(() => spyOn(K, "prototype")).toThrow(
        "Cannot spy on the `prototype` property because it is not a function",
      );
      expect(K.prototype).toBe(kPrototype);
      expect(new K().m()).toBe(42);

      // arrow functions have no prototype property at all
      const arrow = () => {};
      expect(() => spyOn(arrow, "prototype")).toThrow(
        "Cannot spy on the `prototype` property because it is not a function",
      );
      expect(Object.hasOwn(arrow, "prototype")).toBe(false);
    });

    test("spyOn still works when a function's prototype is itself a function", () => {
      function Bar() {}
      Bar.prototype = function original() {
        return 7;
      };
      const fn = spyOn(Bar, "prototype");
      expect(Bar.prototype).toBe(fn);
      expect(Bar.prototype()).toBe(7);
      expect(fn).toHaveBeenCalledTimes(1);
      fn.mockRestore();
      expect(Bar.prototype()).toBe(7);
      expect(fn).not.toHaveBeenCalled();
    });
  }

  test("restoring a spy on an inherited method removes the own property", () => {
    class A {
      method() {
        return 1;
      }
    }
    const a = new A();
    const fn = spyOn(a, "method");
    expect(Object.hasOwn(a, "method")).toBe(true);
    expect(a.method()).toBe(1);
    fn.mockRestore();
    expect(Object.hasOwn(a, "method")).toBe(false);
    expect(a.method).toBe(A.prototype.method);
  });

  describe("through a Proxy", () => {
    test("an own method", () => {
      const method = function () {
        return this;
      };
      const target = { method };
      const proxy = new Proxy(target, {});
      const fn = spyOn(proxy, "method");
      expect(proxy.method).toBe(fn);
      expect(target.method).toBe(fn);
      expect(spyOn(proxy, "method")).toBe(fn);
      expect(proxy.method()).toBe(proxy);
      expect(fn).toHaveBeenCalledTimes(1);
      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(target, "method")).toEqual({
        value: method,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    });

    test("an inherited method", () => {
      class A {
        method() {
          return 1;
        }
      }
      const target = new A();
      const proxy = new Proxy(new Proxy(target, {}), {});
      const fn = spyOn(proxy, "method");
      expect(proxy.method()).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(Object.hasOwn(target, "method")).toBe(true);
      fn.mockRestore();
      expect(Object.hasOwn(target, "method")).toBe(false);
      expect(proxy.method).toBe(A.prototype.method);
    });

    test("getters, setters and a method that a getter returns", () => {
      let value = 1;
      const method = () => "method";
      const target = {
        get x() {
          return value;
        },
        set x(next) {
          value = next;
        },
        get method() {
          return method;
        },
      };
      const descriptors = Object.getOwnPropertyDescriptors(target);
      const proxy = new Proxy(target, {});

      const getter = spyOn(proxy, "x", "get");
      const setter = spyOn(proxy, "x", "set");
      const fn = spyOn(proxy, "method");
      proxy.x = 2;
      expect(setter.mock.calls).toEqual([[2]]);
      expect(proxy.x).toBe(2);
      expect(getter).toHaveBeenCalledTimes(1);
      getter.mockReturnValue(5);
      expect(proxy.x).toBe(5);
      expect(proxy.method).toBe(fn);
      expect(proxy.method()).toBe("method");

      fn.mockRestore();
      setter.mockRestore();
      getter.mockRestore();
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(descriptors);
    });

    test("the traps decide", () => {
      const defineProperty = jest.fn(Reflect.defineProperty);
      const deleteProperty = jest.fn(Reflect.deleteProperty);
      const target = Object.create({ get x() { return 1; } }); // prettier-ignore
      const proxy = new Proxy(target, { defineProperty, deleteProperty });
      const getter = spyOn(proxy, "x", "get");
      expect(defineProperty).toHaveBeenCalledTimes(1);
      getter.mockRestore();
      expect(deleteProperty).toHaveBeenCalledTimes(1);

      // Jest throws too, and then once more when it restores the spy that it could not install.
      if (!isBun) return;
      const frozen = new Proxy(Object.freeze({ method() {}, get x() { return 1; } }), {}); // prettier-ignore
      expect(() => spyOn(frozen, "method")).toThrow(TypeError);
      expect(() => spyOn(frozen, "x", "get")).toThrow(TypeError);
    });
  });

  describe("getters and setters", () => {
    function counter() {
      let value = 1;
      const obj = {
        get x() {
          return this === obj ? value : "wrong this";
        },
        set x(next) {
          value = this === obj ? next : "wrong this";
        },
      };
      return obj;
    }

    test("a getter spy calls through, can be mocked, and restores the descriptor", () => {
      const obj = counter();
      const original = Object.getOwnPropertyDescriptor(obj, "x");

      const getter = spyOn(obj, "x", "get");
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual({ ...original, get: getter });
      expect(getter).not.toHaveBeenCalled();
      expect(obj.x).toBe(1);
      expect(getter.mock.calls).toEqual([[]]);
      expect(getter.mock.contexts[0]).toBe(obj);
      expect(getter.mock.results).toEqual([{ type: "return", value: 1 }]);

      obj.x = 5;
      expect(getter).toHaveBeenCalledTimes(1);
      expect(obj.x).toBe(5);

      getter.mockReturnValue(9);
      expect(obj.x).toBe(9);
      getter.mockImplementation(function () {
        return this === obj;
      });
      expect(obj.x).toBe(true);

      getter.mockRestore();
      const restored = Object.getOwnPropertyDescriptor(obj, "x");
      expect(restored).toEqual(original);
      expect(restored.get).toBe(original.get);
      expect(restored.set).toBe(original.set);
      expect(obj.x).toBe(5);
    });

    test("a setter spy calls through, can be mocked, and restores the descriptor", () => {
      const obj = counter();
      const original = Object.getOwnPropertyDescriptor(obj, "x");

      const setter = spyOn(obj, "x", "set");
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual({ ...original, set: setter });
      obj.x = 7;
      expect(setter.mock.calls).toEqual([[7]]);
      expect(setter.mock.contexts[0]).toBe(obj);
      expect(obj.x).toBe(7);

      setter.mockImplementation(() => {});
      obj.x = 8;
      expect(setter.mock.calls).toEqual([[7], [8]]);
      expect(obj.x).toBe(7);

      setter.mockRestore();
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);
      obj.x = 10;
      expect(obj.x).toBe(10);
    });

    test("spying twice gives the same spy", () => {
      const obj = counter();
      const getter = spyOn(obj, "x", "get");
      const setter = spyOn(obj, "x", "set");
      expect(getter).not.toBe(setter);
      expect(spyOn(obj, "x", "get")).toBe(getter);
      expect(spyOn(obj, "x", "set")).toBe(setter);
      setter.mockRestore();
      getter.mockRestore();
    });

    test.each([
      ["getter first", (getter, setter) => (getter.mockRestore(), setter.mockRestore())],
      ["setter first", (getter, setter) => (setter.mockRestore(), getter.mockRestore())],
      ["restoreAllMocks", () => jest.restoreAllMocks()],
    ])("both halves spied, restored %s", (_, restore) => {
      // Jest and Vitest leave the getter spy installed unless the setter spy is restored first.
      if (!isBun) return;
      const obj = counter();
      const original = Object.getOwnPropertyDescriptor(obj, "x");
      const getter = spyOn(obj, "x", "get");
      const setter = spyOn(obj, "x", "set");
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual({ ...original, get: getter, set: setter });
      obj.x = 3;
      expect(obj.x).toBe(3);
      expect(getter).toHaveBeenCalledTimes(1);
      expect(setter).toHaveBeenCalledTimes(1);

      restore(getter, setter);
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);
    });

    test("an inherited accessor is shadowed on the object and the shadow is removed again", () => {
      class A {
        value = 4;
        get x() {
          return this.value;
        }
      }
      const original = Object.getOwnPropertyDescriptor(A.prototype, "x");
      const a = new A();

      const getter = spyOn(a, "x", "get");
      expect(Object.getOwnPropertyDescriptor(a, "x")).toEqual({ ...original, get: getter });
      expect(Object.getOwnPropertyDescriptor(A.prototype, "x")).toEqual(original);
      expect(a.x).toBe(4);
      getter.mockReturnValue(1);
      expect(a.x).toBe(1);
      expect(new A().x).toBe(4);

      getter.mockRestore();
      expect(Object.hasOwn(a, "x")).toBe(false);
      expect(Object.getOwnPropertyDescriptor(A.prototype, "x")).toEqual(original);
      expect(a.x).toBe(4);
    });

    test("prototype and static accessors", () => {
      class A {
        value = 4;
        get x() {
          return this.value;
        }
        static get y() {
          return this === A;
        }
      }
      const a = new A();
      const original = Object.getOwnPropertyDescriptor(A.prototype, "x");
      const x = spyOn(A.prototype, "x", "get");
      expect(a.x).toBe(4);
      expect(x.mock.contexts[0]).toBe(a);
      x.mockRestore();
      expect(Object.getOwnPropertyDescriptor(A.prototype, "x")).toEqual(original);

      const y = spyOn(A, "y", "get");
      expect(A.y).toBe(true);
      y.mockReturnValue(8);
      expect(A.y).toBe(8);
      y.mockRestore();
      expect(A.y).toBe(true);
      expect(Object.getOwnPropertyDescriptor(A, "y").enumerable).toBe(false);
    });

    test("symbol and index keys", () => {
      const symbol = Symbol("key");
      const array = [1, 2];
      Object.defineProperty(array, 1, { get: () => 1, configurable: true, enumerable: true });
      for (const [obj, key] of [
        [{ get [symbol]() { return 1; } }, symbol], // prettier-ignore
        [{ get 0() { return 1; } }, 0], // prettier-ignore
        [array, 1],
      ]) {
        const original = Object.getOwnPropertyDescriptor(obj, key);
        const getter = spyOn(obj, key, "get").mockReturnValue(2);
        expect(obj[key]).toBe(2);
        getter.mockRestore();
        expect(obj[key]).toBe(1);
        expect(Object.getOwnPropertyDescriptor(obj, key)).toEqual(original);
      }
    });

    test("a method that a getter returns", () => {
      let reads = 0;
      function method(arg) {
        return [this === obj, arg];
      }
      const obj = {
        get method() {
          reads++;
          return method;
        },
      };
      const original = Object.getOwnPropertyDescriptor(obj, "method");

      const fn = spyOn(obj, "method");
      expect(reads).toBe(1);
      expect(obj.method).toBe(fn);
      expect(obj.method(1)).toEqual([true, 1]);
      expect(fn.mock.calls).toEqual([[1]]);
      expect(reads).toBe(1);
      const spied = Object.getOwnPropertyDescriptor(obj, "method");
      expect(spied).toEqual({ ...original, get: expect.any(Function) });
      expect(spied.get).not.toBe(original.get);
      expect(spyOn(obj, "method")).toBe(fn);

      fn.mockReturnValue("mocked");
      expect(obj.method(2)).toBe("mocked");

      fn.mockRestore();
      expect(Object.getOwnPropertyDescriptor(obj, "method")).toEqual(original);
      expect(obj.method).toBe(method);
    });

    test("a method that a getter returns keeps its setter", () => {
      let method = () => 1;
      const obj = {
        get method() {
          return method;
        },
        set method(next) {
          method = next;
        },
      };
      const fn = spyOn(obj, "method");
      obj.method = () => 2;
      expect(obj.method).toBe(fn);
      expect(method()).toBe(2);
      fn.mockRestore();
      expect(obj.method()).toBe(2);
    });

    test("a method that an inherited getter returns", () => {
      const method = () => 1;
      class A {
        get method() {
          return method;
        }
      }
      const a = new A();
      const fn = spyOn(a, "method");
      expect(a.method).toBe(fn);
      expect(new A().method).toBe(method);
      fn.mockRestore();
      expect(Object.hasOwn(a, "method")).toBe(false);
      expect(a.method).toBe(method);
    });

    test("a getter that returns a mock", () => {
      const fn = jest.fn();
      const obj = {
        get method() {
          return fn;
        },
      };
      const original = Object.getOwnPropertyDescriptor(obj, "method");
      expect(spyOn(obj, "method")).toBe(fn);
      expect(Object.getOwnPropertyDescriptor(obj, "method")).toEqual(original);
    });

    test.each([
      ["number", { get x() { return 1; } }], // prettier-ignore
      ["undefined", { get x() { return undefined; } }], // prettier-ignore
      ["null", { get x() { return null; } }], // prettier-ignore
      ["undefined", { set x(value) {} }], // prettier-ignore
    ])("a getter that returns %s cannot be spied as a method", (type, obj) => {
      const original = Object.getOwnPropertyDescriptor(obj, "x");
      if (isBun) {
        expect(() => spyOn(obj, "x")).toThrow(
          new TypeError(`Cannot spy on the \`x\` property because it is not a function; ${type} given instead`),
        );
      } else {
        expect(() => spyOn(obj, "x")).toThrow();
      }
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);
    });

    test("a missing property has no getter or setter to spy on", () => {
      const obj = {};
      if (isBun) {
        expect(() => spyOn(obj, "x", "get")).toThrow(
          new TypeError("spyOn(target, prop, accessType) expects target to have the property `x`"),
        );
        expect(() => spyOn(obj, Symbol("y"), "set")).toThrow(
          new TypeError("spyOn(target, prop, accessType) expects target to have the property `Symbol(y)`"),
        );
      } else {
        expect(() => spyOn(obj, "x", "get")).toThrow();
      }
      expect(Reflect.ownKeys(obj)).toEqual([]);
    });

    if (isBun) {
      test("accessType has to be get or set", () => {
        const obj = counter();
        const original = Object.getOwnPropertyDescriptor(obj, "x");
        for (const accessType of ["value", "GET", 1, {}, true]) {
          expect(() => spyOn(obj, "x", accessType)).toThrow(
            new TypeError('spyOn(target, prop, accessType) expects accessType to be "get" or "set"'),
          );
        }
        expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);
      });

      test("the getter runs with the object as this when the method is read", () => {
        class A {
          #method = () => 7;
          get method() {
            return this.#method;
          }
        }
        const a = new A();
        spyOn(a, "method");
        expect(a.method()).toBe(7);
      });

      // Vitest allows these, Jest throws "does not have access type".
      test("the half of an accessor that is missing", () => {
        const readonly = { get x() { return 1; } }; // prettier-ignore
        const setter = spyOn(readonly, "x", "set");
        readonly.x = 3;
        expect(setter.mock.calls).toEqual([[3]]);
        expect(readonly.x).toBe(1);
        setter.mockRestore();
        expect(Object.getOwnPropertyDescriptor(readonly, "x").set).toBeUndefined();

        const writeonly = { set x(value) {} }; // prettier-ignore
        const getter = spyOn(writeonly, "x", "get");
        expect(writeonly.x).toBeUndefined();
        expect(getter).toHaveBeenCalledTimes(1);
        getter.mockRestore();
        expect(Object.getOwnPropertyDescriptor(writeonly, "x").get).toBeUndefined();
      });

      test("a data property", () => {
        const obj = { x: 1 };
        const original = Object.getOwnPropertyDescriptor(obj, "x");

        const getter = spyOn(obj, "x", "get");
        expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual({
          get: getter,
          set: undefined,
          enumerable: true,
          configurable: true,
        });
        expect(obj.x).toBe(1);
        expect(getter).toHaveBeenCalledTimes(1);
        getter.mockReturnValue(2);
        expect(obj.x).toBe(2);
        getter.mockRestore();
        expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);

        const setter = spyOn(obj, "x", "set");
        obj.x = 5;
        expect(setter.mock.calls).toEqual([[5]]);
        setter.mockRestore();
        expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);

        // the engine serves this one specially: it cannot become an accessor
        function Foo() {}
        expect(() => spyOn(Foo, "prototype", "get")).toThrow(
          "Cannot spy on the `prototype` property because it is not a function",
        );
      });

      // Like a spy on a method, which replaces a read-only or non-configurable property too.
      test("non-configurable, frozen and non-extensible targets", () => {
        const fixed = Object.defineProperty({}, "x", { get: () => 1 });
        const frozen = Object.freeze({ get x() { return 1; } }); // prettier-ignore
        const sealed = Object.preventExtensions(Object.create(fixed));
        // what TypeScript emits for `export { method }` in CommonJS
        const exports = Object.defineProperty({}, "method", { enumerable: true, get: () => Math.abs });

        for (const obj of [fixed, frozen, sealed]) {
          const original = Object.getOwnPropertyDescriptor(obj, "x");
          const getter = spyOn(obj, "x", "get").mockReturnValue(2);
          expect(obj.x).toBe(2);
          getter.mockRestore();
          expect(obj.x).toBe(1);
          expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(original);
        }

        const original = Object.getOwnPropertyDescriptor(exports, "method");
        const fn = spyOn(exports, "method");
        expect(exports.method(-1)).toBe(1);
        expect(fn).toHaveBeenCalledWith(-1);
        fn.mockRestore();
        expect(Object.getOwnPropertyDescriptor(exports, "method")).toEqual(original);
      });

      test("properties that the object does not store", () => {
        for (const [obj, key] of [
          [[1, 2], "length"],
          [new String("ab"), "length"],
          [new String("ab"), 0],
          [new Uint8Array(2), 0],
          [/a/g, "lastIndex"],
        ]) {
          const original = Object.getOwnPropertyDescriptor(obj, key);
          expect(() => spyOn(obj, key, "get")).toThrow(
            new TypeError(`Cannot spy on the getter of the \`${key}\` property because it cannot be redefined`),
          );
          expect(() => spyOn(obj, key, "set")).toThrow(
            new TypeError(`Cannot spy on the setter of the \`${key}\` property because it cannot be redefined`),
          );
          expect(Object.getOwnPropertyDescriptor(obj, key)).toEqual(original);
        }
        // an accessor on the prototype can be shadowed
        const bytes = new Uint8Array(2);
        const length = spyOn(bytes, "length", "get").mockReturnValue(9);
        expect(bytes.length).toBe(9);
        length.mockRestore();
        expect(bytes.length).toBe(2);
      });

      test("accessors implemented natively", () => {
        const original = Object.getOwnPropertyDescriptor(Response.prototype, "status");
        const onPrototype = spyOn(Response.prototype, "status", "get");
        expect(new Response("", { status: 201 }).status).toBe(201);
        expect(onPrototype).toHaveBeenCalledTimes(1);
        onPrototype.mockReturnValue(5);
        expect(new Response("").status).toBe(5);
        onPrototype.mockRestore();
        expect(Object.getOwnPropertyDescriptor(Response.prototype, "status")).toEqual(original);
        expect(new Response("", { status: 202 }).status).toBe(202);

        const response = new Response("", { status: 203 });
        const onInstance = spyOn(response, "status", "get");
        expect(response.status).toBe(203);
        onInstance.mockReturnValue(1);
        expect(response.status).toBe(1);
        expect(new Response("").status).toBe(200);
        onInstance.mockRestore();
        expect(Object.hasOwn(response, "status")).toBe(false);
        expect(response.status).toBe(203);

        for (const [obj, key] of [
          [process, "title"],
          [process, "platform"],
          [navigator, "userAgent"],
          [globalThis, "navigator"],
        ]) {
          const original = Object.getOwnPropertyDescriptor(obj, key);
          const value = obj[key];
          const getter = spyOn(obj, key, "get");
          expect(obj[key]).toBe(value);
          getter.mockReturnValue("mocked");
          expect(obj[key]).toBe("mocked");
          getter.mockRestore();
          expect(Object.getOwnPropertyDescriptor(obj, key)).toEqual(original);
          expect(obj[key]).toBe(value);
        }
      });

      test("the exports of a module namespace object are not accessors", async () => {
        const namespace = await import("./test-interop.js");
        expect(() => spyOn(namespace, "default", "get")).toThrow(
          new TypeError(
            "Cannot spy on the getter of the `default` export because the exports of a module namespace object are not accessors",
          ),
        );
        expect(() => spyOn(namespace, "default", "set")).toThrow(
          new TypeError(
            "Cannot spy on the setter of the `default` export because the exports of a module namespace object are not accessors",
          ),
        );
        expect(namespace.default).toBe(test_interop);
      });

      test("a name that a module namespace object does not export", async () => {
        const namespace = await import("./test-interop.js");
        expect(() => spyOn(namespace, "notAnExport")).toThrow(
          new TypeError("spyOn(target, prop) expects the module namespace object to export `notAnExport`"),
        );
        expect("notAnExport" in namespace).toBe(false);
        expect(Object.keys(namespace)).toEqual(["default"]);
      });

      test("spies are named after the accessor", () => {
        const symbol = Symbol("key");
        const obj = { get x() { return 1; }, set x(value) {}, get [symbol]() { return 1; } }; // prettier-ignore
        expect(spyOn(obj, "x", "get").name).toBe("get x");
        expect(spyOn(obj, "x", "set").name).toBe("set x");
        expect(spyOn(obj, symbol, "get").name).toBe("get [key]");
      });

      test("using", () => {
        const obj = counter();
        {
          using getter = spyOn(obj, "x", "get").mockReturnValue(2);
          expect(obj.x).toBe(2);
          expect(getter).toHaveBeenCalledTimes(1);
        }
        expect(obj.x).toBe(1);
      });
    }
  });
});

if (isBun) {
  describe("new on a mock", () => {
    test("a class implementation constructs", () => {
      class A {
        field = 1;
        constructor(x) {
          this.x = x;
          this.newTarget = new.target;
        }
        method() {
          return "method " + this.x;
        }
      }
      const Mock = vi.fn(A);
      const instance = new Mock(2);
      expect(instance).toBeInstanceOf(A);
      expect(instance).toBeInstanceOf(Mock);
      expect(instance.x).toBe(2);
      expect(instance.field).toBe(1);
      expect(instance.method()).toBe("method 2");
      expect(instance.newTarget).toBe(Mock);
      expect(instance.constructor).toBe(Mock);
      expect(Object.getPrototypeOf(instance)).toBe(Mock.prototype);
      expect(Object.getPrototypeOf(Mock.prototype)).toBe(A.prototype);
      expect(Mock.mock.calls).toEqual([[2]]);
      expect(Mock.mock.instances).toEqual([instance]);
      expect(Mock.mock.instances[0]).toBe(instance);
      expect(Mock.mock.contexts[0]).toBe(instance);
      expect(Mock.mock.results[0].type).toBe("return");
      expect(Mock.mock.results[0].value).toBe(instance);
      expect(() => Mock()).toThrow(TypeError);
    });

    test("a function implementation gets the new object as this", () => {
      let newTarget, resultsDuring;
      const Mock = vi.fn(function (w) {
        newTarget = new.target;
        resultsDuring = structuredClone(Mock.mock.results);
        this.w = w;
      });
      const instance = new Mock(9);
      expect(instance.w).toBe(9);
      expect(resultsDuring).toEqual([{ type: "incomplete", value: undefined }]);
      expect(instance).toBeInstanceOf(Mock);
      expect(newTarget).toBe(Mock);
      expect(Mock.mock.instances[0]).toBe(instance);
      expect(Mock.mock.contexts[0]).toBe(instance);
      expect(Mock.mock.results[0].value).toBe(instance);
      Mock.call({});
      expect(newTarget).toBeUndefined();
    });

    test("what a function implementation returns", () => {
      const object = {};
      const ReturnsObject = vi.fn(function () {
        return object;
      });
      expect(new ReturnsObject()).toBe(object);
      expect(ReturnsObject.mock.instances[0]).toBe(object);

      const ReturnsPrimitive = vi.fn(function () {
        this.w = 1;
        return 5;
      });
      expect(new ReturnsPrimitive()).toEqual({ w: 1 });
    });

    test("the prototype of a function implementation is behind mock.prototype", () => {
      function F() {}
      F.prototype.hi = () => "hi";
      const Mock = vi.fn(F);
      expect(Mock.prototype.hi()).toBe("hi");
      Mock.prototype.hi = () => "shadowed";
      expect(new Mock().hi()).toBe("shadowed");
      expect(new Mock()).toBeInstanceOf(F);
      expect(F.prototype.hi()).toBe("hi");
    });

    test("without an implementation", () => {
      for (const fn of [jest.fn, vi.fn, mock]) {
        const Mock = fn();
        const instance = new Mock(1);
        expect(typeof instance).toBe("object");
        expect(instance).toBeInstanceOf(Mock);
        expect(Object.getPrototypeOf(instance)).toBe(Mock.prototype);
        expect(Mock.mock.calls).toEqual([[1]]);
        expect(Mock.mock.instances[0]).toBe(instance);
        expect(Mock.mock.contexts[0]).toBe(instance);
      }
    });

    test("mock.prototype", () => {
      const Mock = jest.fn();
      expect(Object.getOwnPropertyDescriptor(Mock, "prototype")).toEqual({
        value: Mock.prototype,
        writable: true,
        enumerable: false,
        configurable: false,
      });
      expect(Object.getOwnPropertyDescriptor(Mock.prototype, "constructor")).toEqual({
        value: Mock,
        writable: true,
        enumerable: false,
        configurable: true,
      });

      Mock.prototype.speak = jest.fn(() => "bark");
      const instance = new Mock();
      expect(instance.speak()).toBe("bark");
      expect(Mock.prototype.speak.mock.contexts[0]).toBe(instance);

      const prototype = { z: 1 };
      Mock.prototype = prototype;
      expect(Object.getPrototypeOf(new Mock())).toBe(prototype);
    });

    // Vitest throws "is not a constructor" for these; Jest, and Bun so far, call them.
    test("implementations that are not constructors are called on a new object", () => {
      const object = { a: 1 };
      for (const fn of [jest.fn, vi.fn]) {
        const Arrow = fn(() => object);
        expect(new Arrow()).toBe(object);
        expect(Arrow.mock.results).toEqual([{ type: "return", value: object }]);
        expect(Arrow.mock.instances[0]).toBeInstanceOf(Arrow);
        expect(Arrow.mock.contexts[0]).toBe(Arrow.mock.instances[0]);

        const ArrowPrimitive = fn(() => 3);
        expect(new ArrowPrimitive()).toBe(ArrowPrimitive.mock.instances[0]);
        expect(ArrowPrimitive.mock.instances[0]).toBeInstanceOf(ArrowPrimitive);

        const Method = fn({ method() { this.q = 1; } }.method); // prettier-ignore
        expect(new Method()).toEqual({ q: 1 });

        expect(new (fn(async () => {}))()).toBeInstanceOf(Promise);
      }
    });

    // Vitest throws "Cannot use `mockReturnValue` when called with `new`".
    test("mockReturnValue and friends", async () => {
      const object = {};
      for (const fn of [jest.fn, vi.fn]) {
        expect(new (fn().mockReturnValue(object))()).toBe(object);
        expect(new (fn().mockReturnValueOnce(object))()).toBe(object);
        const Primitive = fn().mockReturnValue(4);
        expect(new Primitive()).toBe(Primitive.mock.instances[0]);
        expect(await new (fn().mockResolvedValue(1))()).toBe(1);
        expect(new (fn().mockRejectedValue(2))()).rejects.toBe(2);
        const This = fn().mockReturnThis();
        const instance = new This();
        expect(instance).toBeInstanceOf(This);
        expect(This.mock.results[0].value).toBe(instance);
      }
    });

    test("mockImplementation(class)", () => {
      class A {
        method() {
          return "A";
        }
      }
      const Mock = jest.fn().mockImplementation(A);
      expect(Object.getPrototypeOf(Mock.prototype)).toBe(A.prototype);
      const instance = new Mock();
      expect(instance).toBeInstanceOf(A);
      expect(instance.method()).toBe("A");
    });

    test("mockImplementationOnce(class)", () => {
      class A {
        a = 1;
      }
      class B {
        b = 1;
      }
      const Mock = jest.fn(A).mockImplementationOnce(B);
      expect(Object.getPrototypeOf(Mock.prototype)).toBe(B.prototype);
      expect(new Mock()).toEqual({ b: 1 });
      expect(new Mock()).toEqual({ a: 1 });
      expect(Object.getPrototypeOf(Mock.prototype)).toBe(A.prototype);
    });

    test("withImplementation(class)", () => {
      class A {
        method() {
          return "A";
        }
      }
      class B {
        method() {
          return "B";
        }
      }
      const Mock = jest.fn(A);
      let inside;
      Mock.withImplementation(B, () => {
        inside = new Mock().method();
      });
      expect(inside).toBe("B");
      expect(Object.getPrototypeOf(Mock.prototype)).toBe(A.prototype);
      expect(new Mock().method()).toBe("A");
    });

    test("a constructor that throws", () => {
      const error = new Error("boom");
      const Mock = vi.fn(
        class {
          constructor() {
            throw error;
          }
        },
      );
      expect(() => new Mock()).toThrow(error);
      expect(Mock.mock.results).toEqual([{ type: "throw", value: error }]);
      expect(Mock.mock.instances).toEqual([undefined]);
      expect(Mock.mock.contexts).toEqual([undefined]);
    });

    test("spyOn a class", () => {
      class K {
        constructor(a) {
          this.a = a;
        }
        method() {
          return this.a;
        }
        static create() {
          return "created by " + this.name;
        }
        static value = 2;
      }
      const obj = { K };
      const spy = spyOn(obj, "K");
      const instance = new obj.K(3);
      expect(instance).toBeInstanceOf(K);
      expect(instance).toBeInstanceOf(obj.K);
      expect(instance.method()).toBe(3);
      expect(spy.mock.calls).toEqual([[3]]);
      expect(spy.mock.instances[0]).toBe(instance);
      expect(obj.K.create()).toBe("created by K");
      expect(obj.K.value).toBe(2);

      class Fake {
        method() {
          return "fake";
        }
      }
      spy.mockImplementation(Fake);
      expect(new obj.K().method()).toBe("fake");
      expect(new obj.K()).not.toBeInstanceOf(K);

      spy.mockRestore();
      expect(obj.K).toBe(K);
    });

    test("spyOn a builtin class", () => {
      const obj = { Date };
      const spy = spyOn(obj, "Date");
      const date = new obj.Date(0);
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBe(0);
      expect(obj.Date.UTC(1970)).toBe(0);
      expect(spy).toHaveBeenCalledWith(0);
    });

    test("extending a mock", () => {
      const Base = jest.fn(function () {
        this.base = 1;
      });
      class Sub extends Base {
        sub = 2;
      }
      const instance = new Sub();
      expect(instance).toEqual({ base: 1, sub: 2 });
      expect(instance).toBeInstanceOf(Sub);
      expect(instance).toBeInstanceOf(Base);
      expect(Base.mock.instances[0]).toBe(instance);

      class A {
        constructor() {
          this.newTarget = new.target;
        }
      }
      class SubOfClass extends jest.fn(A) {}
      expect(new SubOfClass().newTarget).toBe(SubOfClass);
      expect(new SubOfClass()).toBeInstanceOf(A);
    });

    test("Reflect.construct with another new.target", () => {
      class A {}
      class Other {}
      const Mock = jest.fn(A);
      const instance = Reflect.construct(Mock, [], Other);
      expect(instance).toBeInstanceOf(Other);
      expect(instance).not.toBeInstanceOf(Mock);
    });

    test("mock.instances holds this for plain calls", () => {
      const fn = jest.fn();
      const obj = { fn };
      obj.fn();
      fn();
      fn.call(5);
      expect(fn.mock.instances).toEqual([obj, undefined, 5]);
      expect(fn.mock.instances[0]).toBe(obj);
      expect(fn.mock.contexts).toEqual(fn.mock.instances);
      fn.mockClear();
      expect(fn.mock.instances).toEqual([]);
    });

    test("mock.results entries are completed in place", () => {
      let during;
      const fn = jest.fn(() => {
        during = fn.mock.results[0];
        return 1;
      });
      fn();
      expect(during).toBe(fn.mock.results[0]);
      expect(during).toEqual({ type: "return", value: 1 });
    });
  });

  describe("static members of the implementation", () => {
    test("are copied by fn(implementation) and spyOn", () => {
      const symbol = Symbol("static");
      class A {
        static inherited() {
          return "inherited";
        }
      }
      class B extends A {
        static own() {
          return this;
        }
        static value = 1;
        static get accessor() {
          return "accessor";
        }
        static [symbol] = 2;
      }
      for (const Mock of [jest.fn(B), spyOn({ B }, "B")]) {
        expect(Mock.inherited()).toBe("inherited");
        expect(Mock.own()).toBe(Mock);
        expect(Mock[symbol]).toBe(2);
        expect(Object.getOwnPropertyDescriptor(Mock, "value")).toEqual(Object.getOwnPropertyDescriptor(B, "value"));
        expect(Object.getOwnPropertyDescriptor(Mock, "own")).toEqual(Object.getOwnPropertyDescriptor(B, "own"));
        expect(Object.getOwnPropertyDescriptor(Mock, "accessor")).toEqual(
          Object.getOwnPropertyDescriptor(B, "accessor"),
        );
        expect(Mock.name).toBe("B");
        expect(Mock.prototype).not.toBe(B.prototype);
      }
      expect(jest.fn().mockImplementation(B).own).toBeUndefined();
    });

    test("do not replace what a mock has", () => {
      function implementation() {}
      implementation.mockClear = "mockClear";
      implementation.mock = "mock";
      implementation.call = "call";
      implementation.other = "other";
      const fn = jest.fn(implementation);
      expect(fn.other).toBe("other");
      expect(fn.mock.calls).toEqual([]);
      expect(fn.mockClear()).toBe(fn);
      expect(fn.call).toBe(Function.prototype.call);
    });

    test("fetch.preconnect survives spyOn(globalThis, 'fetch')", () => {
      using spy = spyOn(globalThis, "fetch");
      expect(fetch).toBe(spy);
      expect(fetch.preconnect).toBeFunction();
    });

    test("util.promisify.custom is left out, so that promisify() calls the mock", async () => {
      const { promisify } = require("node:util");
      function implementation(callback) {
        callback(null, "callback");
      }
      implementation[promisify.custom] = async () => "custom";
      implementation[Symbol.for("other")] = "other";
      const fn = jest.fn(implementation);
      expect(Object.getOwnPropertySymbols(fn)).toEqual([Symbol.for("other")]);
      expect(await promisify(fn)()).toBe("callback");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
}

if (isBun) {
  describe("vi.mockObject", () => {
    const modes = [
      ["automock", undefined],
      ["spy", { spy: true }],
    ];

    test("functions become mocks that return undefined", () => {
      const original = {
        simple: () => "value",
        nested: { method: (a, b) => "real" },
        prop: "foo",
      };
      const mocked = vi.mockObject(original);
      expect(mocked).not.toBe(original);
      expect(mocked.nested).not.toBe(original.nested);
      expect(Object.keys(mocked)).toEqual(["simple", "nested", "prop"]);
      expect(mocked.prop).toBe("foo");
      expect(vi.isMockFunction(mocked.simple)).toBe(true);
      expect(mocked.simple()).toBeUndefined();
      expect(mocked.nested.method(1)).toBeUndefined();
      expect(mocked.nested.method).toHaveBeenCalledWith(1);
      expect(mocked.nested.method.name).toBe("method");
      expect(mocked.nested.method.length).toBe(2);
      mocked.simple.mockReturnValue("mocked");
      expect(mocked.simple()).toBe("mocked");

      expect(vi.isMockFunction(original.simple)).toBe(false);
      expect(original.simple()).toBe("value");
    });

    test("{ spy: true } keeps the implementations, and the objects they run on", () => {
      class Service {
        #secret = "secret";
        reveal() {
          return this.#secret;
        }
      }
      const original = {
        simple: () => "value",
        nested: { method: () => "real" },
        service: new Service(),
      };
      const { nested, service } = original;
      const spied = vi.mockObject(original, { spy: true });
      expect(spied).toBe(original);
      expect(spied.nested).toBe(nested);
      expect(spied.service).toBe(service);
      expect(spied.simple()).toBe("value");
      expect(spied.simple).toHaveBeenCalledTimes(1);
      expect(spied.nested.method()).toBe("real");
      expect(spied.service.reveal()).toBe("secret");
      expect(spied.service.reveal).toHaveBeenCalledTimes(1);
      expect(spied.service).toBeInstanceOf(Service);
      spied.simple.mockReturnValue("mocked");
      expect(spied.simple()).toBe("mocked");
    });

    test.each(modes)("%s: primitives and a lone function", (_, options) => {
      for (const value of [1, "a", null, undefined, true, 10n, Symbol.iterator]) {
        expect(vi.mockObject(value, options)).toBe(value);
      }
      function lone(a) {
        return "lone";
      }
      const mocked = vi.mockObject(lone, options);
      expect(mocked).not.toBe(lone);
      expect(vi.isMockFunction(mocked)).toBe(true);
      expect(mocked.name).toBe("lone");
      expect(mocked.length).toBe(1);
      expect(mocked()).toBe(options ? "lone" : undefined);
    });

    test.each(modes)("%s: every kind of function", (_, options) => {
      const mocked = vi.mockObject(
        {
          arrow: () => 1,
          async: async () => 1,
          *generator() {},
          async *asyncGenerator() {},
          bound: function () {}.bind(null),
          proxy: new Proxy(function () {}, {}),
          [Symbol.for("symbol")]: () => 1,
          0: () => 1,
        },
        options,
      );
      for (const key of Reflect.ownKeys(mocked)) {
        expect(vi.isMockFunction(mocked[key])).toBe(true);
      }
      expect(Reflect.ownKeys(mocked)).toHaveLength(8);
    });

    test.each(modes)("%s: builtin and tagged objects, and mocks, are kept", (_, options) => {
      class Tagged {
        get [Symbol.toStringTag]() {
          return "Tagged";
        }
        method() {}
      }
      const kept = {
        date: new Date(0),
        regexp: /x/,
        map: new Map(),
        set: new Set(),
        weakMap: new WeakMap(),
        promise: Promise.resolve(),
        error: new Error("x"),
        bytes: new Uint8Array(2),
        buffer: new ArrayBuffer(1),
        boxed: Object(1),
        url: new URL("http://localhost"),
        tagged: new Tagged(),
        mock: vi.fn(() => "already a mock"),
        globalThis,
        console,
      };
      const mocked = vi.mockObject({ ...kept }, options);
      for (const key of Object.keys(kept)) {
        expect([key, mocked[key] === kept[key]]).toEqual([key, true]);
      }
      expect(vi.isMockFunction(mocked.tagged.method)).toBe(false);
      expect(mocked.mock()).toBe("already a mock");
    });

    test("arrays become empty", () => {
      const original = { list: [1, () => 2] };
      const mocked = vi.mockObject(original);
      expect(mocked.list).toEqual([]);
      expect(original.list).toHaveLength(2);
      expect(vi.mockObject([1, 2])).toEqual([]);
    });

    test("{ spy: true } maps arrays", () => {
      const element = { method: () => "element" };
      // prettier-ignore
      const list = [1, element, () => 2, "s", null, , [() => 3]];
      const spied = vi.mockObject({ list }, { spy: true });
      expect(spied.list).not.toBe(list);
      expect(spied.list).toHaveLength(7);
      expect(spied.list[0]).toBe(1);
      expect(spied.list[1].method()).toBe("element");
      expect(spied.list[1].method).toHaveBeenCalledTimes(1);
      expect(spied.list[2]()).toBe(2);
      expect(vi.isMockFunction(spied.list[2])).toBe(true);
      expect(spied.list.slice(3, 5)).toEqual(["s", null]);
      expect(5 in spied.list).toBe(false);
      expect(spied.list[6]).toBeArrayOfSize(1);
      expect(spied.list[6][0]()).toBe(3);
      expect(vi.isMockFunction(list[2])).toBe(false);
    });

    test.each(modes)("%s: cycles and shared references", (_, options) => {
      const shared = { method() {} };
      const fn = () => 1;
      const list = [1];
      const original = { a: shared, b: shared, fn1: fn, fn2: fn, list1: list, list2: list, child: {} };
      original.self = original;
      original.child.parent = original;
      fn.owner = original;

      const mocked = vi.mockObject(original, options);
      expect(mocked.self).toBe(mocked);
      expect(mocked.child.parent).toBe(mocked);
      expect(mocked.a).toBe(mocked.b);
      expect(mocked.fn1).toBe(mocked.fn2);
      expect(mocked.fn1.owner).toBe(mocked);
      expect(mocked.list1).toBe(mocked.list2);
      expect(Object.keys(mocked)).toEqual(["a", "b", "fn1", "fn2", "list1", "list2", "child", "self"]);
    });

    test.each(modes)("%s: a graph deeper than the stack", (_, options) => {
      const { isDebug, isASAN } = require("harness");
      const levels = isDebug || isASAN ? 2_000 : 100_000;
      let original = { leaf() {} };
      for (let i = 0; i < levels; i++) original = { child: original };
      let mocked = vi.mockObject(original, options);
      let depth = 0;
      for (; mocked.child; mocked = mocked.child) depth++;
      expect(depth).toBe(levels);
      expect(vi.isMockFunction(mocked.leaf)).toBe(true);
    });

    test("getters and setters are mocked without being run", () => {
      const run = vi.fn();
      const original = {
        get both() {
          run();
          return 1;
        },
        set both(value) {
          run();
        },
        get readonly() {
          run();
          return 1;
        },
        set writeonly(value) {
          run();
        },
      };
      Object.defineProperty(original, "hidden", { get: run, enumerable: false, configurable: false });

      const mocked = vi.mockObject(original);
      expect(run).not.toHaveBeenCalled();
      expect(Object.getOwnPropertyDescriptor(mocked, "both")).toEqual({
        get: expect.any(Function),
        set: expect.any(Function),
        enumerable: true,
        configurable: true,
      });
      expect(Object.getOwnPropertyDescriptor(mocked, "readonly")).toEqual({
        get: expect.any(Function),
        set: undefined,
        enumerable: true,
        configurable: true,
      });
      expect(Object.getOwnPropertyDescriptor(mocked, "hidden")).toEqual({
        get: expect.any(Function),
        set: undefined,
        enumerable: false,
        configurable: false,
      });
      expect(Object.getOwnPropertyDescriptor(mocked, "writeonly")).toEqual({
        value: undefined,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(mocked.both).toBeUndefined();
      mocked.both = 1;
      expect(mocked.readonly).toBeUndefined();
      expect(run).not.toHaveBeenCalled();

      vi.spyOn(mocked, "both", "get").mockReturnValue(2);
      expect(mocked.both).toBe(2);
    });

    test("{ spy: true } leaves getters and setters alone", () => {
      const run = vi.fn(() => 1);
      const original = {
        get both() {
          return run();
        },
        set both(value) {
          run();
        },
        set writeonly(value) {
          run();
        },
      };
      const descriptors = Object.getOwnPropertyDescriptors(original);
      const spied = vi.mockObject(original, { spy: true });
      expect(run).not.toHaveBeenCalled();
      expect(Object.getOwnPropertyDescriptors(spied)).toEqual(descriptors);
      expect(spied.both).toBe(1);
    });

    test("the nearest definition of a property wins", () => {
      class A {
        get x() {
          return "A";
        }
        method() {
          return "A";
        }
      }
      class B extends A {
        get x() {
          return "B";
        }
        method() {
          return "B";
        }
      }
      const Spied = vi.mockObject(B, { spy: true });
      expect(new Spied().x).toBe("B");
      expect(new Spied().method()).toBe("B");
      const shadowing = Object.create({ get x() { return "getter"; } }, { x: { value: "value", enumerable: true } }); // prettier-ignore
      expect(vi.mockObject(shadowing).x).toBe("value");
    });

    test("an instance is flattened into a plain object", () => {
      class A {
        inherited() {}
      }
      class B extends A {
        field = 1;
        method() {}
      }
      const mocked = vi.mockObject(new B());
      expect(Object.getPrototypeOf(mocked)).toBe(Object.prototype);
      expect(Object.keys(mocked).sort()).toEqual(["constructor", "field", "inherited", "method"]);
      expect(mocked.field).toBe(1);
      expect(vi.isMockFunction(mocked.method)).toBe(true);
      expect(vi.isMockFunction(mocked.inherited)).toBe(true);
      expect(vi.isMockFunction(B.prototype.method)).toBe(false);
    });

    test("properties are copied as if assigned", () => {
      const symbol = Symbol("symbol");
      const original = Object.create(null, {
        hidden: { value() {}, enumerable: false },
        fixed: { value: 1, enumerable: true },
        [symbol]: { value: 2 },
      });
      const mocked = vi.mockObject(original);
      expect(Object.getPrototypeOf(mocked)).toBe(Object.prototype);
      for (const key of ["hidden", "fixed", symbol]) {
        expect(Object.getOwnPropertyDescriptor(mocked, key)).toEqual({
          value: mocked[key],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    });

    test("an own __proto__ property stays a property", () => {
      const mocked = vi.mockObject(JSON.parse('{ "__proto__": { "polluted": true } }'));
      expect(Object.getPrototypeOf(mocked)).toBe(Object.prototype);
      expect(mocked.polluted).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(mocked, "__proto__").value).toEqual({ polluted: true });
    });

    test("{ spy: true } skips what cannot be assigned", () => {
      const method = () => 1;
      const frozen = Object.freeze({ method, nested: { method } });
      const spied = vi.mockObject(frozen, { spy: true });
      expect(spied.method).toBe(method);
      expect(vi.isMockFunction(spied.nested.method)).toBe(true);
    });

    test("methods called name, length and caller are mocked too", () => {
      const mocked = vi.mockObject({ name() {}, length() {}, caller() {}, arguments() {} });
      expect(Object.keys(mocked)).toEqual(["name", "length", "caller", "arguments"]);
      for (const key of Object.keys(mocked)) expect(vi.isMockFunction(mocked[key])).toBe(true);
    });

    test.each(modes)("%s: static members of a function", (_, options) => {
      function original() {
        return "original";
      }
      original.method = () => "method";
      original.value = 1;
      original.nested = { method: () => "nested" };
      const mocked = vi.mockObject(original, options);
      expect(mocked.value).toBe(1);
      expect(mocked.method()).toBe(options ? "method" : undefined);
      expect(mocked.method).toHaveBeenCalledTimes(1);
      expect(mocked.nested.method()).toBe(options ? "nested" : undefined);
      expect(mocked.nested.method).toHaveBeenCalledTimes(1);
      expect(mocked.prototype.constructor).toBe(mocked);
    });

    describe("classes", () => {
      class Base {
        static inheritedStatic() {
          return "inheritedStatic";
        }
        inherited() {
          return "inherited";
        }
      }
      class Klass extends Base {
        static ownStatic() {
          return "ownStatic";
        }
        static get accessor() {
          return "accessor";
        }
        field = "field";
        constructor(x) {
          super();
          this.x = x;
        }
        method() {
          return "method " + this.x;
        }
        get accessor() {
          return "accessor " + this.x;
        }
      }

      test("automock", () => {
        const Mocked = vi.mockObject(Klass);
        expect(Mocked.name).toBe("Klass");
        expect(Mocked.length).toBe(1);
        expect(Mocked.ownStatic()).toBeUndefined();
        expect(Mocked.inheritedStatic()).toBeUndefined();
        expect(Mocked.inheritedStatic).toHaveBeenCalledTimes(1);
        expect(Mocked.accessor).toBeUndefined();
        expect(Mocked.prototype).not.toBe(Klass.prototype);
        expect(Object.getPrototypeOf(Mocked.prototype)).toBe(Object.prototype);
        expect(Mocked.prototype.constructor).toBe(Mocked);

        const instance = new Mocked(1);
        expect(instance).toBeInstanceOf(Mocked);
        expect(instance).not.toBeInstanceOf(Klass);
        expect(instance.constructor).toBe(Mocked);
        expect(instance.x).toBeUndefined();
        expect(instance.field).toBeUndefined();
        expect(instance.accessor).toBeUndefined();
        expect(instance.method()).toBeUndefined();
        expect(instance.inherited()).toBeUndefined();
        expect(Mocked.mock.calls).toEqual([[1]]);
        expect(Mocked.mock.instances[0]).toBe(instance);
        expect(Mocked()).toBeUndefined();

        expect(vi.isMockFunction(Klass.prototype.method)).toBe(false);
        expect(vi.isMockFunction(Klass.ownStatic)).toBe(false);
      });

      test("{ spy: true }", () => {
        class Spied extends Klass {}
        const Mocked = vi.mockObject(Spied, { spy: true });
        expect(Mocked).not.toBe(Spied);
        expect(Mocked.ownStatic()).toBe("ownStatic");
        expect(Mocked.ownStatic).toHaveBeenCalledTimes(1);
        expect(Mocked.inheritedStatic()).toBe("inheritedStatic");
        expect(Mocked.accessor).toBe("accessor");
        expect(Mocked.prototype).toBe(Spied.prototype);

        const instance = new Mocked(1);
        expect(instance).toBeInstanceOf(Mocked);
        expect(instance).toBeInstanceOf(Klass);
        expect(instance.x).toBe(1);
        expect(instance.field).toBe("field");
        expect(instance.accessor).toBe("accessor 1");
        expect(instance.method()).toBe("method 1");
        expect(instance.method).toHaveBeenCalledTimes(1);
        expect(instance.inherited()).toBe("inherited");
        expect(Mocked.mock.instances[0]).toBe(instance);
        expect(() => Mocked()).toThrow(TypeError);

        expect(vi.isMockFunction(Klass.prototype.method)).toBe(false);
      });

      test.each(modes)("%s: every instance has its own mocks, which the prototype's mocks see", (_, options) => {
        class K {
          method() {
            return "real";
          }
        }
        const real = options ? "real" : undefined;
        const Mocked = vi.mockObject(K, options);
        const a = new Mocked();
        const b = new Mocked();
        expect(a.method).not.toBe(b.method);
        expect(a.method).not.toBe(Mocked.prototype.method);
        expect(Object.keys(a)).toEqual(["method"]);
        expect(a.method.name).toBe("method");

        expect(a.method(1)).toBe(real);
        b.method(2);
        b.method(3);
        expect(a.method.mock.calls).toEqual([[1]]);
        expect(b.method.mock.calls).toEqual([[2], [3]]);
        expect(Mocked.prototype.method.mock.calls).toEqual([[1], [2], [3]]);
        expect(Mocked.prototype.method.mock.contexts).toEqual([a, b, b]);
        expect(Mocked.prototype.method.mock.instances[0]).toBe(a);
        expect(Mocked.prototype.method.mock.results[0]).toBe(a.method.mock.results[0]);
        expect(Mocked.prototype.method.mock.invocationCallOrder[1]).toBe(b.method.mock.invocationCallOrder[0]);

        Mocked.prototype.method.mockReturnValue("prototype");
        expect([a.method(), b.method()]).toEqual(["prototype", "prototype"]);
        a.method.mockReturnValue("a");
        expect([a.method(), b.method()]).toEqual(["a", "prototype"]);
        expect(Mocked.prototype.method).toHaveBeenCalledTimes(7);
        Mocked.prototype.method.mockReturnValueOnce("once");
        expect([a.method(), b.method(), b.method()]).toEqual(["a", "once", "prototype"]);

        a.method.mockClear();
        expect(a.method).not.toHaveBeenCalled();
        expect(Mocked.prototype.method).toHaveBeenCalledTimes(10);
      });

      test.each(modes)("%s: what a subclass or the constructor defines is left alone", (_, options) => {
        class K {
          overridden() {}
          kept() {}
        }
        const Mocked = vi.mockObject(K, options);
        class Sub extends Mocked {
          overridden() {
            return "sub";
          }
        }
        const sub = new Sub();
        expect(sub.overridden()).toBe("sub");
        expect(Object.keys(sub)).toEqual(["kept"]);
        expect(vi.isMockFunction(sub.kept)).toBe(true);
      });

      test("mockImplementation on an automocked class", () => {
        const Mocked = vi.mockObject(Klass);
        Mocked.mockImplementation(
          class {
            constructor() {
              this.fake = true;
            }
          },
        );
        const instance = new Mocked();
        expect(instance.fake).toBe(true);
        expect(instance).toBeInstanceOf(Mocked);
        expect(vi.isMockFunction(instance.method)).toBe(true);
      });
    });

    describe("modules", () => {
      test.each(modes)("%s: a module namespace object", async (_, options) => {
        using dir = require("harness").tempDir("mock-object", {
          "module.js": `
            export const value = 1;
            export function fn() { return "fn"; }
            export const object = { method() { return "method"; } };
            export class Klass { method() { return "Klass.method"; } }
            export default function () { return "default"; }
            export * as nested from "./module.js";
          `,
        });
        const namespace = await import(require("node:path").join(String(dir), "module.js"));
        const mocked = vi.mockObject(namespace, options);
        expect(Object.getPrototypeOf(mocked)).toBeNull();
        expect(Object.getOwnPropertyDescriptor(mocked, Symbol.toStringTag)).toEqual({
          value: "Module",
          writable: true,
          enumerable: false,
          configurable: true,
        });
        expect(Object.keys(mocked).sort()).toEqual(["Klass", "default", "fn", "nested", "object", "value"]);
        expect(mocked.value).toBe(1);
        expect(mocked.fn()).toBe(options ? "fn" : undefined);
        expect(mocked.default()).toBe(options ? "default" : undefined);
        expect(mocked.object.method()).toBe(options ? "method" : undefined);
        expect(new mocked.Klass().method()).toBe(options ? "Klass.method" : undefined);
        expect(Object.getPrototypeOf(mocked.nested)).toBeNull();
        expect(mocked.nested[Symbol.toStringTag]).toBe("Module");
        expect(mocked.nested.default).toBe(mocked.default);
        expect(vi.isMockFunction(namespace.fn)).toBe(false);
      });

      test("vi.mock(path, { spy: true }) leaves the exports object of the original alone", async () => {
        const { bunEnv, bunExe, tempDir } = require("harness");
        using dir = tempDir("mock-object-module", {
          "dep.cjs": `
            module.exports = { fn() { return "real"; }, value: 1 };
            module.exports.self = module.exports;
            Object.defineProperty(module.exports, "lazy", { enumerable: true, get: () => function lazy() { return "lazy"; } });
          `,
          "instance.cjs": `
            class Service {
              #secret = "secret";
              reveal() { return this.#secret; }
            }
            module.exports = new Service();
          `,
          "spy.test.js": `
            import { expect, test, vi } from "bun:test";
            vi.mock("./dep.cjs", { spy: true });
            vi.mock("node:path", { spy: true });
            vi.mock("./instance.cjs", { spy: true });
            const dep = require("./dep.cjs");
            const path = require("node:path");
            const instance = require("./instance.cjs");

            test("the mocks are spies and the originals are not", async () => {
              expect(dep.fn()).toBe("real");
              expect(dep.fn).toHaveBeenCalledTimes(1);
              expect(dep.value).toBe(1);
              expect(dep.self).toBe(dep);
              expect(dep.lazy()).toBe("lazy");
              expect(dep.lazy).toHaveBeenCalledTimes(1);
              expect(path.basename("a/b")).toBe("b");
              expect(path.basename).toHaveBeenCalledTimes(1);

              for (const [mocked, specifier] of [[dep, "./dep.cjs"], [path, "node:path"]]) {
                const { default: original } = await vi.importActual(specifier);
                expect(original === mocked).toBe(false);
                expect(Object.keys(original)).toEqual(Object.keys(mocked));
                expect(Object.keys(original).filter(key => vi.isMockFunction(original[key]))).toEqual([]);
              }
            });

            test("an instance of a class is not a container of exports", () => {
              expect(instance.reveal()).toBe("secret");
              expect(instance.reveal).toHaveBeenCalledTimes(1);
            });
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "spy.test.js"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toContain(" 2 pass\n 0 fail\n");
        expect({ stdout: stdout.replace(/^bun test .*\n/, ""), exitCode }).toEqual({ stdout: "", exitCode: 0 });
      });

      test("vi.mock(builtin, { spy: true }) leaves the builtin alone", async () => {
        const { bunEnv, bunExe, tempDir } = require("harness");
        using dir = tempDir("mock-object-builtin", {
          "spy.test.js": `
            import { expect, test, vi } from "bun:test";
            vi.mock("node:fs", { spy: true });
            vi.mock("node:path", { spy: true });
            vi.mock("node:util", { spy: true });
            vi.mock("node:events", { spy: true });
            const fs = require("node:fs");
            const path = require("node:path");
            const util = require("node:util");
            const { EventEmitter } = require("node:events");

            test("the mocks are spies, at every depth", async () => {
              expect(path.win32.basename("a\\\\b")).toBe("b");
              expect(path.win32.basename).toHaveBeenCalledTimes(1);
              expect(util.format("%s", 1)).toBe("1");
              expect(util.format).toHaveBeenCalledTimes(1);
              expect(util.types.isDate(new Date())).toBe(true);
              expect(util.types.isDate).toHaveBeenCalledTimes(1);
              expect(await fs.promises.readFile(import.meta.path, "utf8")).toContain("at every depth");
              expect(fs.promises.readFile).toHaveBeenCalledTimes(1);

              const listener = vi.fn();
              const emitter = new EventEmitter();
              emitter.on("event", listener);
              expect(emitter.emit("event", 1)).toBe(true);
              expect(listener).toHaveBeenCalledWith(1);
              expect(emitter.emit).toHaveBeenCalledWith("event", 1);
              expect(EventEmitter.prototype.emit).toHaveBeenCalledWith("event", 1);
              expect(emitter).toBeInstanceOf((await vi.importActual("node:events")).EventEmitter);
            });

            test("the builtins are not", async () => {
              const actual = {
                fs: (await vi.importActual("node:fs")).default,
                path: (await vi.importActual("node:path")).default,
                util: (await vi.importActual("node:util")).default,
                events: (await vi.importActual("node:events")).default,
              };
              expect(
                Object.entries({
                  "fs.readFileSync": actual.fs.readFileSync,
                  "fs.promises.readFile": actual.fs.promises.readFile,
                  "fs.ReadStream": actual.fs.ReadStream,
                  "fs.ReadStream.prototype._read": actual.fs.ReadStream.prototype._read,
                  "path.basename": actual.path.basename,
                  "path.win32.basename": actual.path.win32.basename,
                  "util.format": actual.util.format,
                  "util.types.isDate": actual.util.types.isDate,
                  "EventEmitter": actual.events.EventEmitter,
                  "EventEmitter.prototype.emit": actual.events.EventEmitter.prototype.emit,
                  "EventEmitter.prototype.constructor": actual.events.EventEmitter.prototype.constructor,
                  "process.emit": process.emit,
                })
                  .filter(([, value]) => vi.isMockFunction(value))
                  .map(([name]) => name),
              ).toEqual([]);
            });
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "spy.test.js"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toContain(" 2 pass\n 0 fail\n");
        expect({ stdout: stdout.replace(/^bun test .*\n/, ""), exitCode }).toEqual({ stdout: "", exitCode: 0 });
      });

      test("vi.mock(builtin) mocks the exports that are accessors", async () => {
        const { bunEnv, bunExe, tempDir } = require("harness");
        using dir = tempDir("mock-object-builtin-automock", {
          "automock.test.js": `
            import { expect, test, vi } from "bun:test";
            vi.mock("node:fs");
            vi.mock("node:util");
            const fs = require("node:fs");
            const util = require("node:util");

            test("automock", async () => {
              expect(Object.getOwnPropertyDescriptor((await vi.importActual("node:util")).default, "format").get).toBeFunction();
              expect(util.format("%s", 1)).toBeUndefined();
              expect(util.format).toHaveBeenCalledWith("%s", 1);
              expect(fs.promises.readFile("missing")).toBeUndefined();
              expect(fs.promises.readFile).toHaveBeenCalledTimes(1);
              expect(new fs.ReadStream("missing")).toBeInstanceOf(fs.ReadStream);
              expect((await vi.importActual("node:util")).format("%s", 1)).toBe("1");
            });
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "automock.test.js"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toContain(" 1 pass\n 0 fail\n");
        expect({ stdout: stdout.replace(/^bun test .*\n/, ""), exitCode }).toEqual({ stdout: "", exitCode: 0 });
      });

      test("the getters of a transpiled module are read, once", () => {
        const reads = vi.fn();
        const exports = { __esModule: true };
        Object.defineProperty(exports, "fn", { enumerable: true, get: () => (reads(), () => "fn") });
        Object.defineProperty(exports, "value", { enumerable: true, get: () => (reads(), 5) });

        const mocked = vi.mockObject(exports);
        expect(reads).toHaveBeenCalledTimes(2);
        expect(Object.getOwnPropertyDescriptors(mocked)).toEqual({
          __esModule: { value: true, writable: true, enumerable: true, configurable: true },
          fn: { value: expect.any(Function), writable: true, enumerable: true, configurable: true },
          value: { value: 5, writable: true, enumerable: true, configurable: true },
        });
        expect(vi.isMockFunction(mocked.fn)).toBe(true);
      });
    });

    test("an error thrown while the value is read is passed on", () => {
      const error = new Error("trap");
      const proxy = new Proxy({}, { ownKeys: () => { throw error; } }); // prettier-ignore
      expect(() => vi.mockObject({ proxy })).toThrow(error);
      const exports = { __esModule: true, get broken() { throw error; } }; // prettier-ignore
      expect(() => vi.mockObject(exports)).toThrow(error);
    });

    test("clearAllMocks and resetAllMocks reach the mocks", () => {
      const mocked = vi.mockObject({ method() {} });
      mocked.method.mockReturnValue(1);
      mocked.method();
      vi.clearAllMocks();
      expect(mocked.method).not.toHaveBeenCalled();
      expect(mocked.method()).toBe(1);
      vi.resetAllMocks();
      expect(mocked.method()).toBeUndefined();
    });

    test("survives garbage collection while it runs", () => {
      const original = {};
      for (let i = 0; i < 200; i++) {
        original["key" + i] = {
          get [Symbol.toStringTag]() {
            if (i % 50 === 0) Bun.gc(true);
            return "Object";
          },
          method() {},
          list: [i],
          klass: class {
            method() {}
          },
        };
      }
      const mocked = vi.mockObject(original);
      Bun.gc(true);
      for (let i = 0; i < 200; i++) {
        const entry = mocked["key" + i];
        expect(vi.isMockFunction(entry.method)).toBe(true);
        expect(new entry.klass().method()).toBeUndefined();
      }
    });
  });

  describe("mock utilities", () => {
    test("isMockFunction", () => {
      expect(jest.isMockFunction).toBe(vi.isMockFunction);
      expect(vi.isMockFunction(vi.fn())).toBe(true);
      expect(vi.isMockFunction(jest.fn())).toBe(true);
      expect(vi.isMockFunction(mock())).toBe(true);
      expect(vi.isMockFunction(spyOn({ method() {} }, "method"))).toBe(true);
      for (const value of [() => {}, {}, null, undefined, 1, { _isMockFunction: true }]) {
        expect(vi.isMockFunction(value)).toBe(false);
      }
      expect(vi.isMockFunction()).toBe(false);
    });

    test("mocked", () => {
      expect(jest.mocked).toBe(vi.mocked);
      const value = { method() {} };
      expect(vi.mocked(value)).toBe(value);
      expect(vi.mocked(value, true)).toBe(value);
      expect(vi.mocked(value, { deep: true, partial: true })).toBe(value);
      expect(vi.mocked()).toBeUndefined();
    });

    test("mockThrow and mockThrowOnce", () => {
      const error = new Error("always");
      const fn = jest.fn(() => "implementation");
      expect(fn.mockThrowOnce("once")).toBe(fn);
      expect(fn).toThrow("once");
      expect(fn()).toBe("implementation");
      expect(fn.mockThrow(error)).toBe(fn);
      expect(fn).toThrow(error);
      expect(() => new fn()).toThrow(error);
      expect(fn.mock.results).toEqual([
        { type: "throw", value: "once" },
        { type: "return", value: "implementation" },
        { type: "throw", value: error },
        { type: "throw", value: error },
      ]);
      expect(fn.mock.calls).toHaveLength(4);
      expect(fn.mock.settledResults[0]).toEqual({ type: "rejected", value: "once" });
      fn.mockReset();
      expect(fn()).toBeUndefined();
      expect(() => fn.mockThrow.call({})).toThrow(TypeError);
    });

    test("mock.settledResults", async () => {
      const error = new Error("thrown");
      const { promise: pending, resolve } = Promise.withResolvers();
      const fn = jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(2)
        .mockReturnValueOnce(3)
        .mockImplementationOnce(() => pending)
        .mockImplementationOnce(() => {
          throw error;
        });
      expect(fn.mock.settledResults).toEqual([]);

      const fulfilled = fn();
      const rejected = fn().catch(() => {});
      fn();
      fn();
      expect(fn).toThrow(error);
      await fulfilled;
      await rejected;

      expect(fn.mock.settledResults).toEqual([
        { type: "fulfilled", value: 1 },
        { type: "rejected", value: 2 },
        { type: "fulfilled", value: 3 },
        { type: "incomplete", value: undefined },
        { type: "rejected", value: error },
      ]);
      resolve(4);
      await pending;
      expect(fn.mock.settledResults[3]).toEqual({ type: "fulfilled", value: 4 });

      fn.mockClear();
      expect(fn.mock.settledResults).toEqual([]);
    });

    test("mock.settledResults when the test has written to mock.results", () => {
      const fn = jest.fn(() => 1);
      fn();
      fn.mock.results.push(undefined, null, 5, {}, { type: "other", value: 2 });
      fn.mock.results.length++;
      fn.mock.results.push({ type: "return", value: 3 }, { type: "throw", value: 4 });
      const incomplete = { type: "incomplete", value: undefined };
      expect(fn.mock.settledResults).toEqual([
        { type: "fulfilled", value: 1 },
        incomplete,
        incomplete,
        incomplete,
        incomplete,
        incomplete,
        incomplete,
        { type: "fulfilled", value: 3 },
        { type: "rejected", value: 4 },
      ]);
    });

    test("mock.settledResults is incomplete while the call runs", () => {
      let during;
      const fn = jest.fn(() => {
        during = fn.mock.settledResults;
      });
      fn();
      expect(during).toEqual([{ type: "incomplete", value: undefined }]);
      expect(fn.mock.settledResults).toEqual([{ type: "fulfilled", value: undefined }]);
    });

    test("reading mock.settledResults does not handle a rejection", async () => {
      const { bunEnv, bunExe } = require("harness");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { jest } = Bun.jest(import.meta.path);
          process.on("unhandledRejection", reason => console.log("unhandled", reason));
          const fn = jest.fn().mockRejectedValue("reason");
          fn();
          console.log(JSON.stringify(fn.mock.settledResults));
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: '[{"type":"rejected","value":"reason"}]\nunhandled reason\n',
        stderr: "",
        exitCode: 0,
      });
    });
  });
}

// What each column does was checked against Vitest 5.0 and Jest 30.
if (isBun) {
  describe("mocks made through vi behave as Vitest's, the others as Jest's", () => {
    const flavors = [
      ["vi", true, vi.fn, vi.spyOn],
      ["jest", false, jest.fn, jest.spyOn],
      ["bun:test", false, mock, spyOn],
    ];

    test("vi.fn and vi.spyOn are functions of their own", () => {
      expect(vi.fn).not.toBe(jest.fn);
      expect(vi.spyOn).not.toBe(jest.spyOn);
      expect(jest.fn).not.toBe(mock);
      expect(jest.spyOn).not.toBe(spyOn);
      expect(vi.fn.name).toBe("fn");
      expect(vi.fn.length).toBe(jest.fn.length);
      expect(vi.spyOn.name).toBe("spyOn");
      expect(vi.spyOn.length).toBe(jest.spyOn.length);
    });

    test.each(flavors)("%s: fn(implementation).mockReset()", (_, isVitest, fn) => {
      const implementation = () => "initial";
      const mocked = fn(implementation)
        .mockImplementation(() => "later")
        .mockImplementationOnce(() => "once");
      mocked();
      expect(mocked.mockReset()).toBe(mocked);
      expect(mocked).not.toHaveBeenCalled();
      expect(mocked()).toBe(isVitest ? "initial" : undefined);
      expect(mocked()).toBe(isVitest ? "initial" : undefined);
      expect(mocked.getMockImplementation()).toBe(isVitest ? implementation : undefined);

      const bare = fn().mockReturnValue(1);
      bare.mockReset();
      expect(bare()).toBeUndefined();
    });

    test.each(flavors)("%s: fn(implementation).mockRestore()", (_, isVitest, fn) => {
      const mocked = fn(() => "initial").mockImplementation(() => "later");
      mocked();
      mocked.mockRestore();
      expect(mocked).not.toHaveBeenCalled();
      expect(mocked()).toBe(isVitest ? "initial" : undefined);
    });

    test.each(flavors)("%s: fn(class).mockReset()", (_, isVitest, fn) => {
      class A {}
      const Mock = fn(A).mockImplementation(class B {});
      Mock.mockReset();
      expect(Object.getPrototypeOf(Mock.prototype)).toBe(isVitest ? A.prototype : Object.prototype);
      expect(new Mock() instanceof A).toBe(isVitest);
    });

    test.each(flavors)("%s: spy.mockReset()", (_, isVitest, fn, spyOn) => {
      const obj = { method: () => "original" };
      const spy = spyOn(obj, "method").mockReturnValue("mocked");
      obj.method();
      spy.mockReset();
      expect(obj.method).toBe(spy);
      expect(spy).not.toHaveBeenCalled();
      expect(obj.method()).toBe(isVitest ? "original" : undefined);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test.each(flavors)("%s: spy.mockRestore()", (_, isVitest, fn, spyOn) => {
      const method = () => "original";
      const obj = { method };
      const spy = spyOn(obj, "method").mockReturnValue("mocked");
      obj.method();
      spy.mockRestore();
      expect(obj.method).toBe(method);
      expect(spy).not.toHaveBeenCalled();
      expect(spy()).toBe(isVitest ? "original" : undefined);
      expect(spyOn(obj, "method")).not.toBe(spy);
    });

    test.each(flavors)("%s: getter and setter spies and mockReset()", (_, isVitest, fn, spyOn) => {
      let value = 1;
      const obj = {
        get x() {
          return value;
        },
        set x(next) {
          value = next;
        },
      };
      const getter = spyOn(obj, "x", "get").mockReturnValue(9);
      const setter = spyOn(obj, "x", "set").mockImplementation(() => {});
      getter.mockReset();
      setter.mockReset();
      obj.x = 2;
      expect(value).toBe(isVitest ? 2 : 1);
      expect(obj.x).toBe(isVitest ? 2 : undefined);
      expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual({
        get: getter,
        set: setter,
        enumerable: true,
        configurable: true,
      });
    });

    // Every *AllMocks function acts on all mocks, on each in the way of the function that made it.
    const everyApi = [
      ["vi", vi],
      ["jest", jest],
    ];

    test.each(everyApi)("%s.resetAllMocks()", (_, api) => {
      for (const [, isVitest, fn, spyOn] of flavors) {
        const obj = { method: () => "original" };
        const withImplementation = fn(() => "initial").mockImplementation(() => "later");
        const bare = fn().mockReturnValue(5);
        const spy = spyOn(obj, "method").mockReturnValue("mocked");
        withImplementation();
        obj.method();

        expect(api.resetAllMocks()).toBe(api);
        expect(withImplementation).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
        expect(withImplementation()).toBe(isVitest ? "initial" : undefined);
        expect(bare()).toBeUndefined();
        expect(obj.method).toBe(spy);
        expect(obj.method()).toBe(isVitest ? "original" : undefined);
      }
    });

    test.each([...everyApi, ["mock", { restoreAllMocks: () => mock.restore() }]])(
      "%s.restoreAllMocks()",
      (name, api) => {
        for (const [, isVitest, fn, spyOn] of flavors) {
          let value = 1;
          const method = () => "original";
          const obj = {
            method,
            get x() {
              return value;
            },
            set x(next) {
              value = next;
            },
          };
          const descriptor = Object.getOwnPropertyDescriptor(obj, "x");
          const withImplementation = fn(() => "initial").mockImplementation(() => "later");
          const bare = fn().mockReturnValue(5);
          const spy = spyOn(obj, "method").mockReturnValue("mocked");
          const getter = spyOn(obj, "x", "get").mockReturnValue(9);
          const setter = spyOn(obj, "x", "set").mockImplementation(() => {});
          withImplementation();
          bare();
          obj.method();
          obj.x = obj.x;

          const returned = api.restoreAllMocks();
          if (name !== "mock") expect(returned).toBe(api);

          expect(obj.method).toBe(method);
          expect(Object.getOwnPropertyDescriptor(obj, "x")).toEqual(descriptor);
          // mocks that are not spies are left as they are
          expect(withImplementation).toHaveBeenCalledTimes(1);
          expect(bare).toHaveBeenCalledTimes(1);
          expect(withImplementation()).toBe("later");
          expect(bare()).toBe(5);
          // Vitest and Jest 30 leave the spies as they are too; Bun has always reset them
          expect(spy).toHaveBeenCalledTimes(isVitest ? 1 : 0);
          expect(getter).toHaveBeenCalledTimes(isVitest ? 1 : 0);
          expect(setter).toHaveBeenCalledTimes(isVitest ? 1 : 0);
          expect(spy()).toBe(isVitest ? "mocked" : undefined);
        }
      },
    );

    test.each(everyApi)("%s.clearAllMocks()", (_, api) => {
      for (const [, , fn, spyOn] of flavors) {
        const obj = { method: () => "original" };
        const mocked = fn(() => "initial").mockImplementation(() => "later");
        const spy = spyOn(obj, "method").mockReturnValue("mocked");
        mocked();
        obj.method();
        expect(api.clearAllMocks()).toBe(api);
        expect(mocked).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
        expect(mocked()).toBe("later");
        expect(obj.method()).toBe("mocked");
      }
    });

    test.each(flavors)("%s: fn.mock across mockClear()", (_, isVitest, fn) => {
      const mocked = fn();
      const state = mocked.mock;
      const { calls } = state;
      mocked(1);
      mocked.mockClear();
      expect(mocked.mock === state).toBe(isVitest);
      expect(mocked.mock.calls).not.toBe(calls);
      expect(calls).toEqual([[1]]);
      expect(state.calls).toEqual(isVitest ? [] : [[1]]);
      mocked(2);
      expect(mocked.mock.calls).toEqual([[2]]);
      expect(mocked.mock.contexts).toEqual([undefined]);
      expect(mocked.mock.instances).toEqual([undefined]);
      expect(mocked.mock.results).toEqual([{ type: "return", value: undefined }]);
      expect(mocked.mock.invocationCallOrder).toHaveLength(1);
      expect(mocked.mock.lastCall).toEqual([2]);
      expect(state.calls).toEqual(isVitest ? [[2]] : [[1]]);
      expect(mocked).toHaveBeenCalledTimes(1);
    });

    test.each(flavors)("%s: fn(mock)", (_, isVitest, fn) => {
      const mocked = fn();
      expect(fn(mocked) === mocked).toBe(isVitest);
    });

    test.each(flavors)("%s: what withImplementation() returns", (_, isVitest, fn) => {
      const mocked = fn();
      expect(mocked.withImplementation(() => 1, () => {})).toBe(isVitest ? mocked : undefined); // prettier-ignore
    });

    test.each(flavors)("%s: new on a function implementation", (_, isVitest, fn) => {
      let newTarget, instancesDuring;
      function implementation() {
        newTarget = new.target;
        instancesDuring = [...Mock.mock.instances];
        this.w = 1;
        return 5;
      }
      const Mock = fn(implementation);
      const instance = new Mock();
      expect(instance).toEqual({ w: 1 });
      expect(instance).toBeInstanceOf(Mock);
      expect(newTarget).toBe(isVitest ? Mock : undefined);
      expect(instancesDuring).toEqual([isVitest ? undefined : instance]);
      expect(Mock.mock.instances[0]).toBe(instance);
      expect(Mock.mock.contexts[0]).toBe(instance);
      expect(Mock.mock.results).toEqual([{ type: "return", value: isVitest ? instance : 5 }]);

      const other = {};
      const ReturnsObject = fn(function () {
        return other;
      });
      expect(new ReturnsObject()).toBe(other);
      expect(ReturnsObject.mock.instances[0] === other).toBe(isVitest);
      expect(ReturnsObject.mock.results[0].value).toBe(other);

      const Throws = fn(function () {
        throw new Error("boom");
      });
      expect(() => new Throws()).toThrow("boom");
      expect(Throws.mock.instances[0] === undefined).toBe(isVitest);
    });

    test.each(flavors)("%s: new without an implementation", (_, isVitest, fn) => {
      const Mock = fn();
      const instance = new Mock();
      expect(instance).toBeInstanceOf(Mock);
      expect(Mock.mock.results).toEqual([{ type: "return", value: isVitest ? instance : undefined }]);
      const Primitive = fn().mockReturnValue(4);
      const other = new Primitive();
      expect(other).toBeInstanceOf(Primitive);
      expect(Primitive.mock.results).toEqual([{ type: "return", value: isVitest ? other : 4 }]);
    });

    test.each(flavors)("%s: new on a class implementation", (_, isVitest, fn, spyOn) => {
      class A {
        constructor() {
          this.newTarget = new.target;
        }
      }
      for (const Mock of [fn(A), spyOn({ A }, "A")]) {
        const instance = new Mock();
        expect(instance).toBeInstanceOf(A);
        expect(instance.newTarget).toBe(Mock);
        expect(Mock.mock.instances[0]).toBe(instance);
        expect(Mock.mock.results[0].value).toBe(instance);
      }
    });

    describe("getMockName()", () => {
      const symbol = Symbol("sym");
      const target = () => ({
        method() {},
        get accessor() {
          return 1;
        },
        [symbol]() {},
      });
      const names = (fn, spyOn) => ({
        "fn()": fn().getMockName(),
        "fn(function)": fn(function implementation() {}).getMockName(),
        "fn(arrow)": fn(() => {}).getMockName(),
        "spyOn(method)": spyOn(target(), "method").getMockName(),
        "spyOn(getter)": spyOn(target(), "accessor", "get").getMockName(),
        "spyOn(symbol)": spyOn(target(), symbol).getMockName(),
      });

      test("vi: 'vi.fn()', and the name of the property for a spy", () => {
        expect(names(vi.fn, vi.spyOn)).toEqual({
          "fn()": "vi.fn()",
          "fn(function)": "vi.fn()",
          "fn(arrow)": "vi.fn()",
          "spyOn(method)": "method",
          "spyOn(getter)": "get accessor",
          "spyOn(symbol)": "[sym]",
        });
      });

      test("jest: 'jest.fn()'", () => {
        expect(names(jest.fn, jest.spyOn)).toEqual({
          "fn()": "jest.fn()",
          "fn(function)": "jest.fn()",
          "fn(arrow)": "jest.fn()",
          "spyOn(method)": "jest.fn()",
          "spyOn(getter)": "jest.fn()",
          "spyOn(symbol)": "jest.fn()",
        });
      });

      test("bun:test: the name of the function", () => {
        expect(names(mock, spyOn)).toEqual({
          "fn()": "mockConstructor",
          "fn(function)": "implementation",
          "fn(arrow)": "",
          "spyOn(method)": "method",
          "spyOn(getter)": "get accessor",
          "spyOn(symbol)": "[sym]",
        });
      });

      test.each(flavors)("%s: mockName() sets it, mockClear() keeps it", (_, isVitest, fn, spyOn) => {
        for (const mocked of [fn(), spyOn(target(), "method")]) {
          expect(mocked.mockName("given")).toBe(mocked);
          expect(mocked.getMockName()).toBe("given");
          expect(mocked.mockClear().getMockName()).toBe("given");
        }
      });

      test.each([
        ["vi", vi.fn, vi.spyOn, "vi.fn()", "method"],
        ["jest", jest.fn, jest.spyOn, "jest.fn()", "jest.fn()"],
        ["bun:test", mock, spyOn, "given", "given"],
      ])("%s: after mockReset() and mockRestore()", (_, fn, spyOn, ofFn, ofSpy) => {
        for (const reset of ["mockReset", "mockRestore"]) {
          const mocked = fn().mockName("given");
          mocked[reset]();
          expect(mocked.getMockName()).toBe(ofFn);
          const spy = spyOn(target(), "method").mockName("given");
          spy[reset]();
          expect(spy.getMockName()).toBe(ofSpy);
        }
      });

      test.each([
        ["vi", vi.fn, vi.spyOn, { "": "vi.fn()", undefined: "given", 5: "given" }],
        ["jest", jest.fn, jest.spyOn, { "": "given", undefined: "given", 5: "5" }],
        ["bun:test", mock, spyOn, { "": "given", undefined: "given", 5: "5" }],
      ])("%s: mockName() with something else than a name", (_, fn, spyOn, expected) => {
        for (const make of [() => fn(), () => spyOn(target(), "method")]) {
          expect({
            "": make().mockName("given").mockName("").getMockName(),
            undefined: make().mockName("given").mockName(undefined).getMockName(),
            5: make().mockName("given").mockName(5).getMockName(),
          }).toEqual(expected);
        }
      });

      test.each([
        ["vi", vi.fn, false],
        ["jest", jest.fn, false],
        ["bun:test", mock, true],
      ])("%s: whether mockName() renames the function", (_, fn, renames) => {
        const mocked = fn(function implementation() {}).mockName("given");
        expect(mocked.name).toBe(renames ? "given" : "implementation");
      });

      test("the mocks that an automocked class gives its instances", () => {
        const Mocked = vi.mockObject(
          class {
            method() {}
          },
        );
        expect(new Mocked().method.getMockName()).toBe("vi.fn()");
      });
    });

    test("vi.mockObject(value, { spy: true }) goes back to the originals", () => {
      class K {
        method() {
          return "real";
        }
      }
      const spied = vi.mockObject({ fn: () => "real", K }, { spy: true });
      const instance = new spied.K();
      spied.fn.mockReturnValue("mocked");
      spied.K.prototype.method.mockReturnValue("mocked");
      instance.method.mockReturnValue("mocked");

      vi.restoreAllMocks();
      expect(spied.fn()).toBe("mocked");

      jest.resetAllMocks();
      expect(spied.fn()).toBe("real");
      expect(instance.method()).toBe("real");
      expect(new spied.K().method()).toBe("real");
      expect(new spied.K()).toBeInstanceOf(K);
    });

    describe.each(flavors)("%s: `prototype` of a mock that nothing has looked at yet", (_, isVitest, fn) => {
      const makers = [
        ["fn()", () => fn(), Object.prototype],
        ["fn(function)", implementation => fn(implementation), undefined],
      ];
      describe.each(makers)("%s", (_, make, parent) => {
        function implementation() {}
        const fresh = () => make(implementation);
        parent ??= implementation.prototype;
        const attributes = { writable: true, enumerable: false, configurable: false };

        test("getOwnPropertyDescriptor", () => {
          const mocked = fresh();
          const descriptor = Object.getOwnPropertyDescriptor(mocked, "prototype");
          expect(descriptor).toEqual({ value: expect.any(Object), ...attributes });
          expect(descriptor.value).toBe(mocked.prototype);
          expect(Object.getOwnPropertyDescriptor(descriptor.value, "constructor")).toEqual({
            value: mocked,
            writable: true,
            enumerable: false,
            configurable: true,
          });
          expect(Reflect.ownKeys(descriptor.value)).toEqual(["constructor"]);
          expect(Object.getPrototypeOf(descriptor.value)).toBe(parent);
        });

        test("own keys", () => {
          expect(Object.keys(fresh())).toEqual([]);
          expect(Reflect.ownKeys(fresh())[0]).toBe("prototype");
          expect(Object.getOwnPropertyNames(fresh())[0]).toBe("prototype");
          const read = fresh();
          read.prototype;
          expect(Reflect.ownKeys(fresh())).toEqual(Reflect.ownKeys(read));
          expect({ ...fresh() }).toEqual({});
          const keys = [];
          for (const key in fresh()) keys.push(key);
          expect(keys).not.toContain("prototype");
        });

        test("has", () => {
          expect(Object.hasOwn(fresh(), "prototype")).toBe(true);
          expect(fresh().hasOwnProperty("prototype")).toBe(true);
          expect("prototype" in fresh()).toBe(true);
          expect(fresh().propertyIsEnumerable("prototype")).toBe(false);
        });

        test("read", () => {
          const mocked = fresh();
          expect(mocked.prototype).toBe(mocked.prototype);
          expect(mocked.prototype.constructor).toBe(mocked);
          const other = fresh();
          expect(other.prototype).not.toBe(mocked.prototype);
          const receiver = {};
          const viaReflect = fresh();
          expect(Reflect.get(viaReflect, "prototype", receiver)).toBe(viaReflect.prototype);
          const inherited = fresh();
          expect(Object.create(inherited).prototype).toBe(inherited.prototype);
        });

        test("assignment", () => {
          const mocked = fresh();
          const assigned = {};
          mocked.prototype = assigned;
          expect(Object.getOwnPropertyDescriptor(mocked, "prototype")).toEqual({ value: assigned, ...attributes });
          expect(new mocked()).toBeInstanceOf(mocked);
          expect(Object.getPrototypeOf(new mocked())).toBe(assigned);

          const primitive = fresh();
          primitive.prototype = 5;
          expect(Object.getOwnPropertyDescriptor(primitive, "prototype")).toEqual({ value: 5, ...attributes });

          const viaReflect = fresh();
          expect(Reflect.set(viaReflect, "prototype", assigned)).toBe(true);
          expect(viaReflect.prototype).toBe(assigned);

          const notExtensible = Object.preventExtensions(fresh());
          notExtensible.prototype = assigned;
          expect(notExtensible.prototype).toBe(assigned);
        });

        test("assignment through an object that inherits from it", () => {
          const mocked = fresh();
          const child = Object.create(mocked);
          child.prototype = 1;
          expect(Object.getOwnPropertyDescriptor(child, "prototype")).toEqual({
            value: 1,
            writable: true,
            enumerable: true,
            configurable: true,
          });
          expect(mocked.prototype.constructor).toBe(mocked);

          const receiver = {};
          const other = fresh();
          expect(Reflect.set(other, "prototype", 1, receiver)).toBe(true);
          expect(receiver).toEqual({ prototype: 1 });
          expect(other.prototype.constructor).toBe(other);
        });

        test("defineProperty", () => {
          const value = {};
          const mocked = fresh();
          Object.defineProperty(mocked, "prototype", { value });
          expect(Object.getOwnPropertyDescriptor(mocked, "prototype")).toEqual({ value, ...attributes });

          const readOnly = fresh();
          Object.defineProperty(readOnly, "prototype", { writable: false });
          const descriptor = Object.getOwnPropertyDescriptor(readOnly, "prototype");
          expect(descriptor).toEqual({ value: expect.any(Object), ...attributes, writable: false });
          expect(descriptor.value.constructor).toBe(readOnly);
          expect(() => {
            "use strict";
            readOnly.prototype = {};
          }).toThrow(TypeError);

          expect(() => Object.defineProperty(fresh(), "prototype", { enumerable: true })).toThrow(TypeError);
          expect(() => Object.defineProperty(fresh(), "prototype", { configurable: true })).toThrow(TypeError);
          expect(() => Object.defineProperty(fresh(), "prototype", { get() {} })).toThrow(TypeError);
          expect(Reflect.defineProperty(fresh(), "prototype", { enumerable: true })).toBe(false);
        });

        test("delete", () => {
          const mocked = fresh();
          expect(Reflect.deleteProperty(mocked, "prototype")).toBe(false);
          expect(() => {
            "use strict";
            delete mocked.prototype;
          }).toThrow(TypeError);
          expect(mocked.prototype.constructor).toBe(mocked);
        });

        test("freeze and seal", () => {
          const frozen = Object.freeze(fresh());
          expect(Object.getOwnPropertyDescriptor(frozen, "prototype")).toEqual({
            value: expect.any(Object),
            ...attributes,
            writable: false,
          });
          expect(frozen.prototype.constructor).toBe(frozen);
          expect(Object.isFrozen(frozen)).toBe(true);

          const sealed = Object.seal(fresh());
          expect(Object.getOwnPropertyDescriptor(sealed, "prototype")).toEqual({
            value: expect.any(Object),
            ...attributes,
          });
          expect(sealed.prototype.constructor).toBe(sealed);
        });

        test("what makes instances", () => {
          const mocked = fresh();
          const instance = new mocked();
          expect(Object.getPrototypeOf(instance)).toBe(mocked.prototype);
          expect(instance).toBeInstanceOf(mocked);
          expect({}).not.toBeInstanceOf(fresh());

          const base = fresh();
          class Derived extends base {}
          expect(Object.getPrototypeOf(Derived.prototype)).toBe(base.prototype);
          expect(new Derived()).toBeInstanceOf(base);

          const newTarget = fresh();
          expect(Object.getPrototypeOf(Reflect.construct(Object, [], newTarget))).toBe(newTarget.prototype);
          expect(Object.getPrototypeOf(Reflect.construct(class {}, [], newTarget))).toBe(newTarget.prototype);
        });

        test("its parent is that of the implementation of the moment", () => {
          class Later {}
          const configuredFirst = fresh().mockImplementation(Later);
          expect(Object.getPrototypeOf(configuredFirst.prototype)).toBe(Later.prototype);

          const readFirst = fresh();
          const prototype = readFirst.prototype;
          readFirst.mockImplementation(Later);
          expect(readFirst.prototype).toBe(prototype);
          expect(Object.getPrototypeOf(prototype)).toBe(Later.prototype);
          readFirst.mockReset();
          expect(Object.getPrototypeOf(prototype)).toBe(isVitest ? parent : Object.prototype);

          const resetFirst = fresh().mockImplementation(Later).mockReset();
          expect(Object.getPrototypeOf(resetFirst.prototype)).toBe(isVitest ? parent : Object.prototype);
        });

        test("spyOn", () => {
          const mocked = fresh();
          const spy = spyOn(mocked, "prototype", "get").mockReturnValue("spied");
          expect(mocked.prototype).toBe("spied");
          spy.mockRestore();
          expect(Object.getOwnPropertyDescriptor(mocked, "prototype")).toEqual({
            value: expect.any(Object),
            ...attributes,
          });
          expect(mocked.prototype.constructor).toBe(mocked);

          const other = fresh();
          const both = spyOn(other, "prototype");
          expect(other.prototype.constructor).toBe(other);
          expect(both).toHaveBeenCalledTimes(1);
          both.mockRestore();
          expect(Object.getOwnPropertyDescriptor(other, "prototype")).toEqual({
            value: expect.any(Object),
            ...attributes,
          });
        });

        test("in code that has seen both kinds", () => {
          const read = mocked => mocked.prototype;
          const write = (mocked, value) => {
            mocked.prototype = value;
          };
          const assigned = {};
          for (let i = 0; i < 2000; i++) {
            const mocked = fresh();
            expect(read(mocked)).toBe(read(mocked));
            expect(read(mocked).constructor).toBe(mocked);
            const written = fresh();
            write(written, assigned);
            write(written, assigned);
            expect(read(written)).toBe(assigned);
          }
        });

        test("survives garbage collection", () => {
          const mocks = Array.from({ length: 200 }, fresh);
          Bun.gc(true);
          const prototypes = mocks.map(mocked => mocked.prototype);
          Bun.gc(true);
          expect(
            mocks.every((mocked, i) => mocked.prototype === prototypes[i] && prototypes[i].constructor === mocked),
          ).toBe(true);
        });
      });
    });

    describe.each(flavors)(
      "%s: *AllMocks() finds a mock each time something has been done to it",
      (_, isVitest, fn, spy) => {
        test("clearAllMocks()", () => {
          const called = fn();
          const untouched = fn();
          for (let round = 0; round < 3; round++) {
            called(round);
            expect(called.mock.calls).toEqual([[round]]);
            jest.clearAllMocks();
            expect(called).not.toHaveBeenCalled();
            expect(called.mock).toEqual({
              calls: [],
              contexts: [],
              instances: [],
              invocationCallOrder: [],
              results: [],
            });
            expect(untouched).not.toHaveBeenCalled();
          }
        });

        test("clearAllMocks() after `mock` was only read, and written to", () => {
          const mocked = fn();
          for (let round = 0; round < 3; round++) {
            const state = mocked.mock;
            const { calls, contexts, instances, invocationCallOrder, results } = state;
            calls.push(["written"]);
            jest.clearAllMocks();
            expect(mocked.mock === state).toBe(isVitest);
            expect(mocked.mock.calls).toEqual([]);
            expect(mocked.mock.calls).not.toBe(calls);
            expect(mocked.mock.contexts).not.toBe(contexts);
            expect(mocked.mock.instances).not.toBe(instances);
            expect(mocked.mock.invocationCallOrder).not.toBe(invocationCallOrder);
            expect(mocked.mock.results).not.toBe(results);
          }
        });

        test("clearAllMocks() keeps the implementations, which resetAllMocks() still finds", () => {
          const configured = fn().mockReturnValue("configured");
          const named = fn().mockName("named");
          const made = fn(() => "initial");
          const once = fn().mockReturnValueOnce("once");
          jest.clearAllMocks();
          jest.clearAllMocks();
          expect([configured(), named.getMockName(), made()]).toEqual(["configured", "named", "initial"]);
          jest.resetAllMocks();
          expect([configured(), made(), once()]).toEqual([undefined, isVitest ? "initial" : undefined, undefined]);
          expect(named.getMockName()).toBe(fn === mock ? "named" : fn().getMockName());
        });

        test("resetAllMocks()", () => {
          const mocked = fn(() => "initial");
          const object = { method: () => "original" };
          const spied = spy(object, "method");
          const initial = isVitest ? ["initial", "original"] : [undefined, undefined];
          for (let round = 0; round < 3; round++) {
            mocked.mockReturnValue(round);
            spied.mockReturnValue(round);
            expect([mocked(), object.method()]).toEqual([round, round]);
            jest.resetAllMocks();
            expect(mocked).not.toHaveBeenCalled();
            expect(spied).not.toHaveBeenCalled();
            expect([mocked(), object.method()]).toEqual(initial);
          }
          for (const configure of [
            mocked => mocked.mockImplementation(() => 1),
            mocked => mocked.mockImplementationOnce(() => 1),
            mocked => mocked.mockReturnValueOnce(1),
            mocked => mocked.mockReturnThis(),
            mocked => mocked.mockResolvedValue(1),
            mocked => mocked.mockResolvedValueOnce(1),
            mocked => mocked.mockRejectedValue(1),
            mocked => mocked.mockRejectedValueOnce(1),
            mocked => mocked.mockThrow(1),
            mocked => mocked.mockThrowOnce(1),
          ]) {
            configure(mocked);
            jest.resetAllMocks();
            expect(mocked()).toBe(initial[0]);
          }
          spied.mockRestore();
        });

        test("resetAllMocks() after a withImplementation() whose callback threw", () => {
          const mocked = fn(() => "initial");
          jest.resetAllMocks();
          expect(() =>
            mocked.withImplementation(
              () => "temporary",
              () => {
                throw new Error("thrown by the callback");
              },
            ),
          ).toThrow("thrown by the callback");
          expect(mocked()).toBe("temporary");
          jest.resetAllMocks();
          expect(mocked()).toBe(isVitest ? "initial" : undefined);
        });

        test("the mocks are collected all the same", () => {
          const { heapStats } = require("bun:jsc");
          const count = () => (Bun.gc(true), heapStats().objectTypeCounts.Mock ?? 0);
          const before = count();
          (function () {
            for (let i = 0; i < 500; i++) {
              const object = { method() {} };
              fn(() => {}).mockReturnValue(1)();
              spy(object, "method")();
            }
          })();
          expect(count() - before).toBeLessThan(100);
        });
      },
    );

    describe.each(flavors)("%s: a mock that is as new is found again", (_, isVitest, fn, spy) => {
      const initial = isVitest ? "initial" : undefined;
      const asNew = { calls: [], contexts: [], instances: [], invocationCallOrder: [], results: [] };
      const makeAsNew = [
        ["clearAllMocks() and resetAllMocks()", () => (jest.clearAllMocks(), jest.resetAllMocks())],
        ["mockClear() and mockReset()", mocked => mocked.mockClear().mockReset()],
        ["mockRestore()", mocked => mocked.mockRestore()],
        [
          "all of them, twice",
          mocked => {
            for (let i = 0; i < 2; i++) {
              mocked.mockClear().mockReset().mockRestore();
              jest.clearAllMocks();
              jest.resetAllMocks();
              jest.restoreAllMocks();
            }
          },
        ],
      ];

      describe.each(makeAsNew)("after %s", (_, makeAsNew) => {
        test.each([
          ["a call", mocked => mocked()],
          ["a call with a receiver", mocked => mocked.call({})],
          ["new", mocked => new mocked()],
          ["Reflect.construct()", mocked => Reflect.construct(mocked, [], class {})],
          ["a call that throws", mocked => expect(() => mocked.mockThrowOnce(new Error("thrown"))()).toThrow("thrown")],
          ["a write to what `mock` gives", mocked => mocked.mock.calls.push(["written"])],
        ])("by clearAllMocks(), after %s", (_, record) => {
          const mocked = fn(() => "initial");
          for (let round = 0; round < 3; round++) {
            record(mocked);
            makeAsNew(mocked);
            expect(mocked.mock).toEqual(asNew);
            makeAsNew(mocked);
            record(mocked);
            expect(mocked.mock).not.toEqual(asNew);
            jest.clearAllMocks();
            expect(mocked.mock).toEqual(asNew);
          }
        });

        test.each([
          ["mockImplementation()", mocked => mocked.mockImplementation(() => "configured")],
          ["mockImplementationOnce()", mocked => mocked.mockImplementationOnce(() => "configured")],
          ["mockReturnValue()", mocked => mocked.mockReturnValue("configured")],
          ["mockReturnValueOnce()", mocked => mocked.mockReturnValueOnce("configured")],
          [
            "two mockReturnValueOnce(), one of them used",
            mocked => mocked.mockReturnValueOnce("used").mockReturnValueOnce("configured")(),
          ],
          [
            "mockReturnValue() and a mockReturnValueOnce() that is used",
            mocked => mocked.mockReturnValue("configured").mockReturnValueOnce("used")(),
          ],
          ["mockReturnThis()", mocked => mocked.mockReturnThis()],
          ["mockResolvedValue()", mocked => mocked.mockResolvedValue("configured")],
          ["mockResolvedValueOnce()", mocked => mocked.mockResolvedValueOnce("configured")],
          ["mockRejectedValue()", mocked => mocked.mockRejectedValue("configured")],
          ["mockRejectedValueOnce()", mocked => mocked.mockRejectedValueOnce("configured")],
          ["mockThrow()", mocked => mocked.mockThrow("configured")],
          ["mockThrowOnce()", mocked => mocked.mockThrowOnce("configured")],
          [
            "a withImplementation() whose callback throws",
            mocked =>
              expect(() =>
                mocked.withImplementation(
                  () => "configured",
                  () => {
                    throw new Error("thrown");
                  },
                ),
              ).toThrow("thrown"),
          ],
        ])("by resetAllMocks(), after %s", (_, configure) => {
          const mocked = fn(() => "initial");
          for (let round = 0; round < 3; round++) {
            configure(mocked);
            makeAsNew(mocked);
            expect(mocked.call("this")).toBe(initial);
            makeAsNew(mocked);
            configure(mocked);
            jest.resetAllMocks();
            expect(mocked.call("this")).toBe(initial);
          }
        });

        if (fn !== mock) {
          test("by resetAllMocks(), after mockName()", () => {
            const mocked = fn();
            const name = mocked.getMockName();
            for (let round = 0; round < 3; round++) {
              mocked.mockName("named");
              makeAsNew(mocked);
              expect(mocked.getMockName()).toBe(name);
              mocked.mockName("named");
              jest.resetAllMocks();
              expect(mocked.getMockName()).toBe(name);
            }
          });
        }

        test("by restoreAllMocks(), after spyOn()", () => {
          const method = () => "original";
          const object = { method };
          for (let round = 0; round < 3; round++) {
            makeAsNew(spy(object, "method"));
            jest.restoreAllMocks();
            expect(object.method).toBe(method);
            spy(object, "method");
            expect(object.method).not.toBe(method);
            jest.restoreAllMocks();
            expect(object.method).toBe(method);
          }
        });
      });

      test("after a garbage collection", () => {
        const object = { method: () => "original" };
        const mocked = fn(() => "initial").mockReturnValue("configured");
        const spied = spy(object, "method");
        for (let i = 0; i < 200; i++) {
          fn().mockReturnValue(i)();
          spy({ method() {} }, "method")();
        }
        mocked();
        object.method();
        Bun.gc(true);
        jest.resetAllMocks();
        expect([mocked.mock.calls.length, spied.mock.calls.length, mocked()]).toEqual([0, 0, initial]);
        Bun.gc(true);
        jest.restoreAllMocks();
        expect(jest.isMockFunction(object.method)).toBe(false);
        mocked.mockReturnValue("configured")();
        Bun.gc(true);
        mocked.mockReset();
        Bun.gc(true);
        mocked.mockReturnValue("configured")();
        jest.resetAllMocks();
        expect([mocked.mock.calls.length, mocked()]).toEqual([0, initial]);
      });
    });

    test("the mock of a method on the prototype of an automocked class, which the instances record on", () => {
      const { Class } = vi.mockObject({
        Class: class {
          method() {}
        },
      });
      const instance = new Class();
      for (let round = 0; round < 3; round++) {
        Class.prototype.method.mockReturnValueOnce("once");
        vi.clearAllMocks();
        expect(instance.method("argument")).toBe("once");
        expect([Class.prototype.method.mock.calls, instance.method.mock.calls]).toEqual([
          [["argument"]],
          [["argument"]],
        ]);
        vi.clearAllMocks();
        expect([Class.prototype.method.mock.calls, instance.method.mock.calls]).toEqual([[], []]);
        Class.prototype.method.mockReturnValueOnce("once").mockReturnValueOnce("left");
        instance.method();
        vi.resetAllMocks();
        expect(instance.method()).toBeUndefined();
      }
    });

    test("a mock that is configured again while resetAllMocks() resets it", () => {
      let configureAgain = false;
      const implementation = new Proxy(function () {}, {
        get(target, key, receiver) {
          if (key === "prototype" && configureAgain) {
            configureAgain = false;
            mocked.mockReturnValue("configured again");
          }
          return Reflect.get(target, key, receiver);
        },
      });
      const mocked = vi.fn(implementation).mockReturnValue("configured");
      mocked.prototype;
      configureAgain = true;
      vi.resetAllMocks();
      expect(mocked()).toBe("configured again");
      vi.resetAllMocks();
      expect(mocked()).toBeUndefined();
    });

    test("a mock that is cleared while a call is recorded", async () => {
      const { bunEnv, bunExe } = require("harness");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { jest, vi } = Bun.jest(import.meta.path);
          for (const fn of [jest.fn, vi.fn]) {
            const mocked = fn();
            let clear = false;
            Object.defineProperty(Array.prototype, 1, {
              configurable: true,
              set(value) {
                Object.defineProperty(this, 1, { value, writable: true, enumerable: true, configurable: true });
                if (!clear) return;
                clear = false;
                mocked.mockClear();
              },
            });
            mocked("first");
            clear = true;
            mocked("second");
            delete Array.prototype[1];
            const recorded = Object.values(mocked.mock).map(array => array.length);
            jest.clearAllMocks();
            console.log(JSON.stringify(recorded), JSON.stringify(mocked.mock));
          }
          `,
        ],
        env: bunEnv,
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const asNew = `{"calls":[],"contexts":[],"instances":[],"results":[],"invocationCallOrder":[]}`;
      expect(stdout).toBe(`[0,1,1,1,1] ${asNew}\n[0,1,1,1,1] ${asNew}\n`);
      expect(exitCode).toBe(0);
    });

    test("a mock that is configured while a call is recorded", async () => {
      const { bunEnv, bunExe } = require("harness");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { jest, vi, mock } = Bun.jest(import.meta.path);
          const configurations = {
            mockReturnValue: mocked => mocked.mockReturnValue("configured"),
            mockReturnThis: mocked => mocked.mockReturnThis(),
            mockThrow: mocked => mocked.mockThrow("configured"),
            mockImplementation: mocked => mocked.mockImplementation(() => "configured"),
            mockResolvedValue: mocked => mocked.mockResolvedValue("configured"),
          };
          for (const fn of [jest.fn, vi.fn, mock]) {
            const seen = [];
            for (const configure of Object.values(configurations)) {
              for (const construct of [false, true]) {
                const mocked = fn(function () { return "initial"; });
                mocked();
                let armed = true;
                Object.defineProperty(Array.prototype, 1, {
                  configurable: true,
                  set(value) {
                    Object.defineProperty(this, 1, { value, writable: true, enumerable: true, configurable: true });
                    if (!armed) return;
                    armed = false;
                    configure(mocked);
                  },
                });
                let result;
                try {
                  result = construct ? typeof new mocked() : mocked.call("this");
                } catch (thrown) {
                  result = "thrown: " + thrown;
                }
                delete Array.prototype[1];
                seen.push(result instanceof Promise ? "promise" : result);
              }
            }
            console.log(seen.join());
          }
          `,
        ],
        env: bunEnv,
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      // `new` on a mock of `vi` constructs with the function that it has taken before the call is recorded.
      const seen = thrownByNew =>
        `configured,object,this,object,thrown: configured,${thrownByNew},configured,object,promise,object\n`;
      expect(stdout).toBe(seen("thrown: configured") + seen("object") + seen("thrown: configured"));
      expect(exitCode).toBe(0);
    });

    describe.each(flavors)("%s: resetAllMocks() finds what withImplementation() has put back", (_, isVitest, fn) => {
      const initial = isVitest ? "initial" : undefined;
      const configured = () =>
        fn(() => "initial")
          .mockImplementation(() => "configured")
          .mockImplementationOnce(() => "once");

      test("after a callback that reset all mocks", () => {
        const mocked = configured();
        mocked.withImplementation(
          () => "temporary",
          () => {
            jest.resetAllMocks();
            expect(mocked()).toBe(initial);
          },
        );
        expect([mocked(), mocked()]).toEqual(["once", "configured"]);
        jest.resetAllMocks();
        expect(mocked()).toBe(initial);
      });

      test("after a callback that reset the mock", () => {
        const mocked = configured();
        jest.resetAllMocks();
        mocked.mockImplementation(() => "configured");
        mocked.withImplementation(
          () => "temporary",
          () => {
            mocked.mockReset();
            jest.resetAllMocks();
          },
        );
        expect(mocked()).toBe("configured");
        jest.resetAllMocks();
        expect(mocked()).toBe(initial);
      });

      test("once the promise of the callback has settled, when all mocks were reset before", async () => {
        for (const settle of ["resolve", "reject"]) {
          const mocked = configured();
          const callback = Promise.withResolvers();
          const done = mocked.withImplementation(
            () => "temporary",
            () => callback.promise,
          );
          expect(mocked()).toBe("temporary");
          jest.resetAllMocks();
          expect(mocked()).toBe(initial);
          callback[settle]("settled");
          await done.catch(() => {});
          expect([mocked(), mocked()]).toEqual(["once", "configured"]);
          jest.resetAllMocks();
          expect(mocked()).toBe(initial);
        }
      });
    });

    test("mock.instances of calls that were made before it was first read", () => {
      for (const [, , fn] of flavors) {
        const mocked = fn();
        const first = {};
        mocked.call(first);
        mocked.call(5);
        mocked();
        expect(mocked.mock.instances).toEqual([first, 5, undefined]);
        expect(mocked.mock.instances[0]).toBe(first);
        expect(mocked.mock.instances).not.toBe(mocked.mock.contexts);
        const instances = mocked.mock.instances;
        mocked.call(first);
        const instance = new mocked();
        expect(mocked.mock.instances).toBe(instances);
        expect(instances).toEqual([first, 5, undefined, first, instance]);
        expect(mocked.mock.contexts).toEqual([first, 5, undefined, first, instance]);

        const constructedFirst = fn();
        constructedFirst.call(first);
        const constructed = new constructedFirst();
        constructedFirst.call(first);
        expect(constructedFirst.mock.instances).toEqual([first, constructed, first]);
        expect(constructedFirst.mock.instances[1]).toBe(constructed);
      }
    });

    test("a result that the implementation has changed the shape of is still completed", () => {
      for (const [, , fn] of flavors) {
        for (const change of [
          result => Object.freeze(result),
          result => (result.extra = 1),
          result => Object.defineProperty(result, "value", { enumerable: false }),
          result => Object.setPrototypeOf(result, null),
          result => delete result.type,
        ]) {
          const mocked = fn(() => {
            change(mocked.mock.results[0]);
            return "returned";
          });
          mocked();
          const { type, value } = mocked.mock.results[0];
          expect({ type, value }).toEqual({ type: "return", value: "returned" });
        }
      }
    });

    test("code that has read the incomplete result of a call sees the complete one", () => {
      const read = result => result.type + ":" + result.value;
      const seen = new Set();
      const mocked = vi.fn(() => {
        const { results } = mocked.mock;
        seen.add(read(results[results.length - 1]));
        return "returned";
      });
      for (let i = 0; i < 3000; i++) {
        mocked();
        seen.add(read(mocked.mock.results[i]));
      }
      expect([...seen]).toEqual(["incomplete:undefined", "return:returned"]);
    });

    test("resetAllMocks() does nothing to a mock that is as resetting leaves it", () => {
      let reads = 0;
      const implementation = new Proxy(function () {}, {
        get(target, key, receiver) {
          if (key === "prototype") reads++;
          return Reflect.get(target, key, receiver);
        },
      });
      const mocked = vi.fn(implementation);
      mocked.prototype;
      mocked.mockReturnValue(1);
      reads = 0;
      vi.resetAllMocks();
      expect(reads).toBe(1);
      vi.resetAllMocks();
      vi.resetAllMocks();
      expect(reads).toBe(1);
    });

    test("clearAllMocks() does nothing to a mock that nothing was done to since the last one", () => {
      const mocked = vi.fn();
      const state = mocked.mock;
      vi.clearAllMocks();
      const { calls } = state;
      vi.clearAllMocks();
      expect(state.calls).toBe(calls);
      mocked();
      vi.clearAllMocks();
      expect(state.calls).not.toBe(calls);
    });

    describe("restoreAllMocks()", () => {
      test.each(flavors)(
        "%s: the others are restored when one throws, and that one the next time",
        (_, isVitest, fn, spy) => {
          const objects = [{ method() {} }, { method() {} }, { method() {} }];
          let shouldThrow = false;
          const proxy = new Proxy(objects[1], {
            defineProperty(target, key, descriptor) {
              if (shouldThrow) throw new Error("thrown by the trap");
              return Reflect.defineProperty(target, key, descriptor);
            },
          });
          spy(objects[0], "method");
          spy(proxy, "method");
          spy(objects[2], "method");
          const mocked = () => objects.map(object => jest.isMockFunction(object.method));
          expect(mocked()).toEqual([true, true, true]);

          shouldThrow = true;
          expect(() => jest.restoreAllMocks()).toThrow("thrown by the trap");
          expect(mocked()).toEqual([false, true, false]);
          expect(() => jest.restoreAllMocks()).toThrow("thrown by the trap");
          expect(() => objects[1].method.mockRestore()).toThrow("thrown by the trap");
          expect(mocked()).toEqual([false, true, false]);

          shouldThrow = false;
          jest.restoreAllMocks();
          expect(mocked()).toEqual([false, false, false]);
        },
      );

      test.each(flavors)("%s: a spy that is made while it runs", (_, isVitest, fn, spy) => {
        const other = { method: () => "original" };
        let armed = false;
        const proxy = new Proxy(
          { method() {} },
          {
            defineProperty(target, key, descriptor) {
              if (armed) {
                armed = false;
                spy(other, "method").mockReturnValue("spied");
              }
              return Reflect.defineProperty(target, key, descriptor);
            },
          },
        );
        spy(proxy, "method");
        armed = true;
        jest.restoreAllMocks();
        expect(other.method()).toBe("spied");
        jest.restoreAllMocks();
        expect(other.method()).toBe("original");
        expect(jest.isMockFunction(other.method)).toBe(false);
      });
    });

    test("restoring a native accessor that was made non-configurable meanwhile", () => {
      const original = Object.getOwnPropertyDescriptor(Response.prototype, "redirected");
      const spied = spyOn(Response.prototype, "redirected", "get").mockReturnValue("spied");
      expect(new Response().redirected).toBe("spied");
      Object.defineProperty(Response.prototype, "redirected", { configurable: false });
      spied.mockRestore();
      expect(new Response().redirected).toBe(false);
      expect(Object.getOwnPropertyDescriptor(Response.prototype, "redirected")).toEqual(original);
    });

    test("vi.mockObject() of a prototype whose Symbol.toStringTag getter needs an instance", () => {
      class Tagged {
        #tag = "Tagged";
        get [Symbol.toStringTag]() {
          return this.#tag;
        }
        method() {
          return "real";
        }
      }
      expect(() => Tagged.prototype[Symbol.toStringTag]).toThrow(TypeError);
      const { Tagged: Mocked } = vi.mockObject({ Tagged });
      expect(jest.isMockFunction(Mocked.prototype.method)).toBe(true);
      expect(new Mocked().method()).toBeUndefined();

      const sqlite = vi.mockObject(require("bun:sqlite"));
      expect(jest.isMockFunction(sqlite.Database)).toBe(true);
      expect(jest.isMockFunction(sqlite.Statement.prototype.finalize)).toBe(true);
    });

    describe("an array that is nearly all holes", () => {
      const last = 2 ** 32 - 2;

      test("vi.mockObject(array, { spy: true })", () => {
        const array = [() => "first"];
        array[last] = () => "last";
        const mocked = vi.mockObject({ array }, { spy: true }).array;
        expect(mocked.length).toBe(last + 1);
        expect(Object.keys(mocked)).toEqual(["0", String(last)]);
        expect([mocked[0](), mocked[last]()]).toEqual(["first", "last"]);
        expect(mocked[last]).toHaveBeenCalledTimes(1);
      });

      test("mock.settledResults", () => {
        const mocked = jest.fn(() => "first");
        mocked();
        mocked.mock.results[last] = { type: "throw", value: "last" };
        const settled = mocked.mock.settledResults;
        expect(settled.length).toBe(last + 1);
        expect(Object.keys(settled)).toEqual(["0", String(last)]);
        expect([settled[0], settled[last]]).toEqual([
          { type: "fulfilled", value: "first" },
          { type: "rejected", value: "last" },
        ]);
      });
    });

    test("mock.lastCall when the last call is a getter that throws", () => {
      const mocked = jest.fn();
      mocked();
      Object.defineProperty(mocked.mock.calls, 0, {
        get() {
          throw new Error("thrown by the getter");
        },
      });
      expect(() => mocked.mock.lastCall).toThrow("thrown by the getter");
    });
  });
}
