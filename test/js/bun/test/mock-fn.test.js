/**
 * This file is meant to be runnable in both Jest and Bun.
 * `bunx jest mock-fn.test.js`
 */
var { isBun, test, describe, expect, jest, vi, mock, bunTest, spyOn } = require("./test-interop.js")();

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
      expect(jest.fn).toBe(mock);
      expect(jest.fn).toBe(vi.fn);
    });
  }
  test("are callable", () => {
    const fn = jest.fn(() => 42);
    expect(fn()).toBe(42);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[0]).toBeEmpty();
    expect(fn()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
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
    expect(Number(fn.call(234))).toBe(234);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
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
    expect(Number(fn.apply(234))).toBe(234);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
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
    expect(Number(fn.bind(234)())).toBe(234);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[1]).toBeEmpty();
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
    fn.mockReset();
    expect(fn.mock.calls).toBeEmpty();
    expect(fn.mock.results).toBeEmpty();
    expect(fn.mock.instances).toBeEmpty();
    expect(fn).not.toHaveBeenCalled();
    expect(() => expect(fn).toHaveBeenCalled()).toThrow();
    expect(fn(43)).toBe(undefined);
    expect(fn.mock.results).toEqual([
      {
        type: "return",
        value: undefined,
      },
    ]);
    expect(fn.mock.calls).toEqual([[43]]);
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
    fn.mockClear();
    expect(fn.mock.calls).toBeEmpty();
    expect(fn.mock.results).toBeEmpty();
    expect(fn.mock.instances).toBeEmpty();
    expect(fn).not.toHaveBeenCalled();
    expect(() => fn(43)).toThrow("foo");
    expect(fn.mock.results[0]).toEqual({
      type: "throw",
      value: instance,
    });
    expect(fn.mock.calls[0]).toEqual([43]);
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
    const stolen = fn.mock;
    fn.mockClear();
    expect(stolen).not.toBe(fn.mock);
    expect(fn.mock.calls).toBeEmpty();
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
  });
  test("multiple calls work", () => {
    const fn = jest.fn(f => f);
    expect(fn(43)).toBe(43);
    expect(fn(44)).toBe(44);
    expect(fn.mock.calls[0]).toEqual([43]);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: 43,
    });
    expect(fn.mock.calls[1]).toEqual([44]);
    expect(fn.mock.results[1]).toEqual({
      type: "return",
      value: 44,
    });
    expect(fn.mock.contexts).toEqual([undefined, undefined]);
  });
  test("this arg", () => {
    const fn = jest.fn(function (add) {
      return this.foo + add;
    });
    const obj = { foo: 42, fn };
    expect(obj.fn(2)).toBe(44);
    expect(fn.mock.calls[0]).toEqual([2]);
    expect(fn.mock.results[0]).toEqual({
      type: "return",
      value: 44,
    });
  });
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
    const this2 = { foo: 43 };
    expect(fn.call(this2, 2)).toBe(45);
    const this3 = { foo: 44 };
    expect(fn.apply(this3, [2])).toBe(46);
    const this4 = { foo: 45 };
    expect(fn.bind(this4)(3)).toBe(48);
    const this5 = { foo: 45 };
    expect(fn.bind(this5, 2)()).toBe(47);
    expect(fn.mock.calls[0]).toEqual([2]);
    expect(fn.mock.calls[1]).toEqual([2]);
    expect(fn.mock.calls[2]).toEqual([2]);
    expect(fn.mock.calls[3]).toEqual([3]);
    expect(fn.mock.calls[4]).toEqual([2]);
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
    expect(result).toBe(undefined);
    expect(fn()).toBe("1");
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
      jest.restoreAllMocks();
      expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
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
      jest.restoreAllMocks();
      expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
      obj.original;
      expect(fn).not.toHaveBeenCalled();
    });
  }

  // spyOn does not work with getters/setters yet.
});
