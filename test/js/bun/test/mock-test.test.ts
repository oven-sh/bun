import { test, mock, expect, spyOn, jest } from "bun:test";

test("are callable", () => {
  const fn = mock(() => 42);
  expect(fn).not.toHaveBeenCalled();
  expect(fn).not.toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toBeEmpty();
  expect(fn.mock.lastCall).toBeUndefined();

  expect(fn()).toBe(42);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();
  expect(fn.mock.lastCall).not.toBeUndefined();

  expect(fn()).toBe(42);
  expect(fn).toHaveBeenCalledTimes(2);
  expect(fn).not.toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(2);
  expect(fn.mock.calls[1]).toBeEmpty();
  expect(fn.mock.lastCall).toBe(fn.mock.calls[1]); // should refer to the same object
});

test("include arguments", () => {
  const fn = mock(f => f);
  expect(fn(43)).toBe(43);
  expect(fn.mock.results[0]).toEqual({
    type: "return",
    value: 43,
  });
  expect(fn.mock.calls[0]).toEqual([43]);
  expect(fn.mock.lastCall).toEqual([43]);
});

test("works when throwing", () => {
  const instance = new Error("foo");
  const fn = mock(f => {
    throw instance;
  });
  expect(() => fn(43)).toThrow("foo");
  expect(fn.mock.results[0]).toEqual({
    type: "throw",
    value: instance,
  });
  expect(fn.mock.calls[0]).toEqual([43]);
  expect(fn.mock.lastCall).toEqual([43]);
});

test("mockReset works", () => {
  const instance = new Error("foo");
  const fn = mock(f => {
    throw instance;
  });
  expect(() => fn(43)).toThrow("foo");
  expect(fn.mock.results[0]).toEqual({
    type: "throw",
    value: instance,
  });
  expect(fn.mock.calls[0]).toEqual([43]);
  expect(fn.mock.lastCall).toEqual([43]);

  fn.mockReset();

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
  expect(fn.mock.lastCall).toEqual([43]);
});

test("spyOn works on functions", () => {
  var obj = {
    original() {
      return 42;
    },
  };
  const fn = spyOn(obj, "original");
  expect(fn).not.toHaveBeenCalled();
  expect(obj.original()).toBe(42);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();
  jest.restoreAllMocks();
  expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
});

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

declare global {
  var original: number;
}

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

// spyOn does not work with getters/setters yet.

test("lastCall works", () => {
  const fn = mock((v) => -v);
  expect(fn.mock.lastCall).toBeUndefined();
  expect(fn(1)).toBe(-1);
  expect(fn.mock.lastCall).toEqual([1]);
  expect(fn(-2)).toBe(2);
  expect(fn.mock.lastCall).toEqual([-2]);
});
