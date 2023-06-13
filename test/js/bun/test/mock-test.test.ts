import { test, mock, expect, spyOn, jest } from "bun:test";

test("mockResolvedValue", async () => {
  const fn = mock.mockResolvedValueOnce(42).mockResolvedValue(43);
  expect(await fn()).toBe(42);
  expect(await fn()).toBe(43);
  expect(await fn()).toBe(43);
});

test("mockRejectedValue", async () => {
  const fn = mock.mockRejectedValue(42);
  expect(await fn()).toBe(42);
  fn.mockRejectedValue(43);
  expect(await fn()).toBe(43);
});

test("are callable", () => {
  const fn = mock(() => 42);
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

test(".call works", () => {
  const fn = mock(function hey() {
    // @ts-expect-error
    return this;
  });
  expect(fn.call(123)).toBe(123);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();

  expect(fn()).toBe(undefined);
  expect(fn).toHaveBeenCalledTimes(2);

  expect(fn.mock.calls).toHaveLength(2);
  expect(fn.mock.calls[1]).toBeEmpty();
});

test(".apply works", () => {
  const fn = mock(function hey() {
    // @ts-expect-error
    return this;
  });
  expect(fn.apply(123)).toBe(123);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();

  expect(fn.apply(undefined)).toBe(undefined);
  expect(fn).toHaveBeenCalledTimes(2);

  expect(fn.mock.calls).toHaveLength(2);
  expect(fn.mock.calls[1]).toBeEmpty();
});

test(".bind works", () => {
  const fn = mock(function hey() {
    // @ts-expect-error
    return this;
  });
  expect(fn.bind(123)()).toBe(123);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();

  expect(fn.bind(undefined)()).toBe(undefined);
  expect(fn).toHaveBeenCalledTimes(2);

  expect(fn.mock.calls).toHaveLength(2);
  expect(fn.mock.calls[1]).toBeEmpty();
});

test(".name works", () => {
  const fn = mock(function hey() {
    // @ts-expect-error
    return this;
  });
  expect(fn.name).toBe("hey");
});

test(".name throwing doesnt segfault", () => {
  function baddie() {
    // @ts-expect-error
    return this;
  }
  Object.defineProperty(baddie, "name", {
    get() {
      throw new Error("foo");
    },
  });

  const fn = mock(baddie);
  fn.name;
});

test("include arguments", () => {
  const fn = mock(f => f);
  expect(fn(43)).toBe(43);
  expect(fn.mock.results[0]).toEqual({
    type: "return",
    value: 43,
  });
  expect(fn.mock.calls[0]).toEqual([43]);
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
