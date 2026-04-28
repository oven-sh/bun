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
  // Use a dedicated fixture so this specifier is touched only by this test —
  // if jest.mock's auto-mock path ever regresses into a no-op, the assertions
  // below won't pass by accident on a mock left over from an earlier test.
  jest.mock("./auto-mock-fixture-jest");
  const mocked = require("./auto-mock-fixture-jest");
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.plainFunction()).toBeUndefined();
});

test("vi.mock matches mock.module (no factory, auto-mocks)", () => {
  vi.mock("./auto-mock-fixture-vi");
  const mocked = require("./auto-mock-fixture-vi");
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.plainFunction()).toBeUndefined();
});

test("jest.requireMock returns the auto-mocked version of a module", () => {
  jest.mock("./auto-mock-fixture-requiremock");

  const mocked = jest.requireMock("./auto-mock-fixture-requiremock") as any;
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.MyClass.mock).toBeDefined();

  // Configuring the mock via the requireMock handle works as expected.
  mocked.plainFunction.mockReturnValue(7);
  expect(mocked.plainFunction("x")).toBe(7);
});

test("vi.requireMock mirrors jest.requireMock", () => {
  jest.mock("./auto-mock-fixture-virequiremock");

  const viMocked = vi.requireMock("./auto-mock-fixture-virequiremock") as any;
  const jestMocked = jest.requireMock("./auto-mock-fixture-virequiremock") as any;

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

  // A second call must return the *same* mock object, otherwise any
  // `.mockReturnValue(...)` / `.mockImplementation(...)` configured through
  // the first handle would be invisible through later calls (matching
  // Jest's `Runtime.requireMock` caching in `_mockRegistry`).
  const mocked2 = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  expect(mocked2).toBe(mocked);
  expect(mocked2.plainFunction).toBe(mocked.plainFunction);
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
  // accessors instead. We load the real module first so we can observe its
  // real counter.
  const real = require("./auto-mock-fixture-accessor");
  const hitsBefore = real.getterHits();

  const mocked = jest.requireMock("./auto-mock-fixture-accessor") as any;

  // Walking the fixture to build the mock must not have invoked either
  // getter on the real module's `obj`.
  expect(real.getterHits()).toBe(hitsBefore);

  // Top-level mocks still get installed as expected.
  expect(mocked.getterHits.mock).toBeDefined();
  expect(mocked.plain.mock).toBeDefined();

  // The accessor properties themselves were skipped (not copied onto the
  // mock) — only plain data properties come through.
  expect(mocked.obj.sneaky).toBeUndefined();
  expect(mocked.obj.alsoSneaky).toBeUndefined();
  expect(mocked.obj.data).toBe(123);

  // And we still haven't invoked the real getters.
  expect(real.getterHits()).toBe(hitsBefore);
});
