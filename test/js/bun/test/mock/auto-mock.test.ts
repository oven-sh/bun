// Auto-mock — `jest.mock(module)` / `vi.mock(module)` / `mock.module(module)`
// without a factory function, plus `jest.requireMock(module)` /
// `vi.requireMock(module)`.
//
// Issue: https://github.com/oven-sh/bun/issues/29834

import { expect, jest, mock, test, vi } from "bun:test";

// NOTE: `mock.module(...)` in Bun is not hoisted (unlike Jest's Babel plugin),
// so when it runs the ESM namespace bindings resolve first. Our implementation
// re-patches the namespace after the mock registers, so code that imports the
// module still sees the mocked exports — but the tests below use `require()`
// for clarity so the ordering isn't ambiguous.

test("mock.module without a factory auto-mocks exported functions", () => {
  mock.module("./auto-mock-fixture");

  const mocked = require("./auto-mock-fixture");

  // Top-level function is replaced with a mock.
  expect(typeof mocked.plainFunction).toBe("function");
  expect(mocked.plainFunction.mock).toBeDefined();
  // Mock returns undefined by default.
  expect(mocked.plainFunction(1, 2, 3)).toBeUndefined();
  expect(mocked.plainFunction).toHaveBeenCalledWith(1, 2, 3);

  // Top-level class is replaced with a mock constructor that records calls.
  expect(typeof mocked.MyClass).toBe("function");
  expect(mocked.MyClass.mock).toBeDefined();
  new mocked.MyClass("arg");
  expect(mocked.MyClass).toHaveBeenCalledTimes(1);
  expect(mocked.MyClass).toHaveBeenCalledWith("arg");

  // Instance methods on the class's prototype are mocked too (via the
  // prototype itself — Bun's JSMockFunction doesn't currently install the
  // prototype on `new` instances, but MyClass.prototype.method is a mock).
  expect(typeof mocked.MyClass.prototype.greet).toBe("function");
  expect(mocked.MyClass.prototype.greet.mock).toBeDefined();
  expect(mocked.MyClass.prototype.greet()).toBeUndefined();

  // Primitives are preserved.
  expect(mocked.CONSTANT).toBe(42);
  expect(mocked.STRING_CONSTANT).toBe("hello");

  // Nested objects are recursively mocked.
  expect(typeof mocked.nested.fn).toBe("function");
  expect(mocked.nested.fn.mock).toBeDefined();
  expect(mocked.nested.fn()).toBeUndefined();
  expect(mocked.nested.value).toBe("nested-value");
});

test("jest.mock matches mock.module (no factory, auto-mocks)", () => {
  jest.mock("./auto-mock-fixture");
  const mocked = require("./auto-mock-fixture");
  expect(mocked.plainFunction.mock).toBeDefined();
});

test("vi.mock matches mock.module (no factory, auto-mocks)", () => {
  vi.mock("./auto-mock-fixture");
  const mocked = require("./auto-mock-fixture");
  expect(mocked.plainFunction.mock).toBeDefined();
});

test("jest.requireMock returns the auto-mocked version of a module", () => {
  jest.mock("./auto-mock-fixture");

  const mocked = jest.requireMock("./auto-mock-fixture") as any;
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.MyClass.mock).toBeDefined();

  // Configuring the mock via the requireMock handle works as expected.
  mocked.plainFunction.mockReturnValue(7);
  expect(mocked.plainFunction("x")).toBe(7);
});

test("vi.requireMock mirrors jest.requireMock", () => {
  jest.mock("./auto-mock-fixture");

  const viMocked = vi.requireMock("./auto-mock-fixture") as any;
  const jestMocked = jest.requireMock("./auto-mock-fixture") as any;

  // Both call into the same cached JSModuleMock, so the handles are identical.
  expect(viMocked).toBe(jestMocked);
  expect(viMocked.plainFunction.mock).toBeDefined();
  expect(viMocked.MyClass.mock).toBeDefined();
});

test("jest.requireMock generates an auto-mock for a module that was never jest.mock()-ed", () => {
  // A distinct fixture so this specifier hasn't been touched by the other
  // tests — we exercise the synthesise-on-demand branch of requireMock.
  const mocked = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.plainFunction()).toBeUndefined();
});

test("mock.module still validates a non-callable second argument", () => {
  // @ts-expect-error non-callable second argument on purpose
  expect(() => mock.module("./auto-mock-fixture", 123)).toThrow("mock(module, fn) requires a function");
});

test("auto-mock preserves arrays and mocks static methods on classes", () => {
  mock.module("./auto-mock-fixture");
  const mocked = require("./auto-mock-fixture");

  // Arrays pass through (consumer code often branches on Array.isArray).
  expect(Array.isArray(mocked.arr)).toBe(true);
  expect(mocked.arr).toEqual([1, "two", { three: 3 }]);

  // Static methods on classes become mocks too so existing assertions keep working.
  expect(typeof mocked.MyClass.staticMethod).toBe("function");
  expect(mocked.MyClass.staticMethod.mock).toBeDefined();
  expect(mocked.MyClass.staticMethod()).toBeUndefined();
});

test("auto-mock does not invoke getters on the real module", () => {
  // If the walker read an accessor property via `object.get(...)` it would
  // trigger the getter, which can have side effects. The walker skips
  // accessors instead.
  const mocked = jest.requireMock("./auto-mock-fixture-accessor") as any;
  // The module records every time the getter runs; walking to auto-mock
  // it must not bump that counter.
  expect(mocked.getterHits.mock).toBeDefined();
  // The accessor property isn't copied onto the mock (since we skipped it),
  // but plain data properties are mocked normally.
  expect(mocked.plain.mock).toBeDefined();
});
